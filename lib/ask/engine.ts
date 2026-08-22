import { zodResponseFormat } from 'openai/helpers/zod'
import { z } from 'zod'
import { openai, samplingParams } from '../openai'
import { selectAll } from '../supabase-admin'
import { ANALYSIS_MODEL, SYNTHESIS_MODEL, estimateCost, ASK_MAX_CLAIMS, ASK_THEMES_PER_CLAIM, ASK_QUOTES_PER_THEME, ASK_INPUT_CHARS } from '../config'
import { logAiCall } from '../pipeline/ai-log'
import { CALIBRATED_PROSE_RULE, stripThemeRefs } from '../pipeline/prose-rules'
import { embedTexts } from '../pipeline/cluster'
import { bucketByAudienceId, fetchInsightsByIds, fetchQuotesByAudience, scopeToClientVoices } from '../quotes'
import { normaliseRef, shortlistThemes, summarise, validateJudgement, validateVerdicts, type AskTheme, type RawVerdict } from './verdicts'
import type { AskResult, ClaimResult, ExtractedClaim } from './types'

// The Ask engine — one pipeline, three faces (test an idea, check a plan,
// later: talk to the consumer). All three reduce to the same question:
//
//   which of these statements does the conversation we already mined actually
//   support, contradict, or say nothing about?
//
// Generalised from say_vs_hear, which asks it of the client's own video claims.
//
// The output is deliberately split into two registers — grounded claims and
// the model's own judgement — produced by two SEPARATE calls. One call
// returning both would let a proposal drift into the evidence field under
// instruction pressure; two calls make that structurally impossible, and the
// judgement call gets to see the grounded findings, which is what makes its
// proposals worth reading.

const PROMPT_VERSION_EXTRACT = 'ask_extract_v1'
const PROMPT_VERSION_VERDICT = 'ask_verdict_v1'
const PROMPT_VERSION_JUDGE = 'ask_judge_v1'

const ExtractSchema = z.object({
  title: z.string(),
  claims: z.array(
    z.object({
      claim: z.string(),
      // The sentence the claim was drawn FROM, copied exactly. This is what
      // lets the annotated view highlight the document in place. It is
      // validated as a real substring before anything is shown — the same
      // exact-copy discipline Pass A applies to comment quotes, for the same
      // reason: a model asked for a verbatim will occasionally paraphrase, and
      // an unverified "quote" of the client's own document is worse than none.
      source: z.string(),
    }),
  ),
})

const VerdictSchema = z.object({
  verdicts: z.array(
    z.object({
      claim_ref: z.string(),
      verdict: z.enum(['echoes', 'contradicts', 'silent']),
      they_say: z.string().nullable(),
      theme_refs: z.array(z.string()),
    }),
  ),
})

const JudgeSchema = z.object({
  judgement: z.array(z.object({ text: z.string(), based_on_refs: z.array(z.string()) })),
})

export interface AskInput {
  clientId: string
  runId: string
  kind: 'idea' | 'plan'
  text: string
  companyName: string
  persist?: boolean
}

/** Load the themes of a run in the shape the engine needs, embeddings included.
 *  Exported because re-evaluation loads a LATER run's themes for the same plan. */
export async function loadAskThemes(
  admin: ReturnType<typeof import('../supabase-admin').createAdminClient>,
  clientId: string,
  runId: string,
): Promise<AskTheme[]> {
  const rows = await selectAll<{
    id: string
    registry_id: string | null
    label: string | null
    description: string | null
    bucket: string | null
    supporting_insight_ids: string[] | null
    supporting_video_ids: string[] | null
    embedding: unknown
  }>(() =>
    admin
      .from('themes')
      .select('id, registry_id, label, description, bucket, supporting_insight_ids, supporting_video_ids, embedding')
      .eq('client_id', clientId)
      .eq('run_id', runId)
      .order('id', { ascending: true }),
  )
  return rows.map((r) => ({
    themeId: r.id,
    registryId: r.registry_id ?? null,
    label: r.label ?? '',
    description: r.description ?? '',
    bucket: r.bucket ?? 'industry-other',
    insightIds: r.supporting_insight_ids ?? [],
    videoIds: r.supporting_video_ids ?? [],
    // Stored as jsonb (there is no pgvector here); anything else is unusable.
    embedding: Array.isArray(r.embedding) ? (r.embedding as number[]) : null,
  }))
}

export function buildExtractPrompt(kind: 'idea' | 'plan'): string {
  return [
    kind === 'plan'
      ? 'You read a marketing or business document and list the TESTABLE CLAIMS it rests on.'
      : 'You read a short idea and list the TESTABLE CLAIMS it rests on.',
    '',
    'A testable claim is an assertion about customers, the market, or a product that real consumer conversation could support or contradict — "buyers care most about price", "people find the setup confusing", "our audience wants a subscription".',
    '',
    'Rules:',
    '- Use the author\'s own terms. Do not sharpen, correct, or improve a claim; you are indexing the document, not editing it.',
    '- An assumption stated in passing is still a claim. Prefer the load-bearing ones.',
    '- Skip anything not testable against consumer conversation: budgets, timelines, staffing, internal process, legal.',
    '- One assertion per claim. Split a sentence that carries two.',
    '- Return them in the order they appear.',
    '- For each claim, also return `source`: the sentence in the document the claim comes from, COPIED EXACTLY, character for character. Do not tidy it, do not join two sentences, do not paraphrase. If a claim is implied rather than stated anywhere, return an empty string — that is a real and useful answer, not a failure.',
    '',
    'Also return a short title naming the document, in plain words.',
  ].join('\n')
}

export function buildVerdictPrompt(companyName: string): string {
  return [
    `You judge claims against what real people actually said in ${companyName}'s category on social video.`,
    '',
    'Each claim is labelled [C#] and comes with the themes the conversation contains that are closest to it, each labelled [T#] with its description and some real comments.',
    '',
    'For every claim return a verdict:',
    '- "echoes" — the conversation independently says the same thing.',
    '- "contradicts" — the conversation pushes back on it, or says something incompatible.',
    '- "silent" — the conversation does not engage with this claim.',
    '',
    'Rules:',
    '- SILENT IS A REAL ANSWER and often the right one. The themes shown are merely the closest ones; closest is not the same as relevant. If the conversation does not speak to the claim, say silent — never stretch a loosely-related theme to manufacture a verdict.',
    '- they_say: what the conversation actually says on this subject, in plain words. Null when silent.',
    '- theme_refs: the [T#] handles that carry your verdict. Empty when silent.',
    '- Judge ONLY against what is shown. You are not being asked whether the claim is true in the world — only whether this conversation supports it.',
    '- Do not advise, propose, or recommend here. This is the evidence register; recommendations come later and separately.',
    CALIBRATED_PROSE_RULE,
  ].join('\n')
}

export function buildJudgePrompt(companyName: string): string {
  return [
    `You are advising ${companyName} after their plan was checked against real consumer conversation.`,
    '',
    'You see each claim, the verdict, and what the audience said. Now give YOUR view: what you would change, what the pattern of verdicts suggests, what to do about the untested parts.',
    '',
    'Rules:',
    '- This is explicitly your judgement, and it will be shown to the reader as your judgement, clearly separated from the evidence. So reason freely: infer, connect claims, propose. You are not restricted to repeating what the evidence says.',
    '- Cite the claims you are reasoning from in based_on_refs. A proposal that builds on nothing is allowed, but one that builds on evidence is worth more.',
    '- Do not restate a verdict as advice. "Assumption 4 is contradicted" is already on the page; what should they DO about it?',
    '- A claim being untested is not a failure — say what would settle it, or whether it matters.',
    '- Fewer, sharper points. Three good ones beat eight.',
    CALIBRATED_PROSE_RULE,
  ].join('\n')
}

/** Clip long documents code-point-safely, the way transcripts are clipped. */
export function clipInput(text: string, max = ASK_INPUT_CHARS): { text: string; clipped: boolean } {
  const chars = [...text]
  if (chars.length <= max) return { text, clipped: false }
  return { text: chars.slice(0, max).join(''), clipped: true }
}

/**
 * The verdict half: shortlist themes for each claim, show the model the real
 * voices behind them, judge, then enforce the contract in code.
 *
 * Exported because re-evaluation runs exactly this against a LATER run's
 * themes, reusing the claims already extracted — re-extracting from the stored
 * document would let claim refs shift, and then "assumption 4 moved" would be
 * comparing two different assumption 4s.
 */
export async function verdictPass(
  admin: ReturnType<typeof import('../supabase-admin').createAdminClient>,
  args: { clientId: string; runId: string; companyName: string; claims: ExtractedClaim[]; persist?: boolean },
): Promise<{ claims: ClaimResult[]; costUsd: number }> {
  const { clientId, runId, companyName, claims } = args
  const persist = args.persist !== false
  let costUsd = 0
  let usage = { prompt_tokens: 0, completion_tokens: 0 }

  // 2. Shortlist themes per claim by embedding. Reproducible relevance, and it
  // fixes the under-recall of showing a reasoning model theme labels alone.
  const themes = await loadAskThemes(admin, clientId, runId)
  const claimVectors = await embedTexts(claims.map((c) => c.claim))
  const shortlists = shortlistThemes(claims, claimVectors, themes, { perClaim: ASK_THEMES_PER_CLAIM })

  // 3. Real voices for the shortlisted themes, so the verdict is judged against
  // what people said and not against a label.
  //
  // Entity-scoped: a claim the client makes about their own market must not be
  // evidenced by a competitor's customers. The rule and its history are in
  // lib/quotes.ts — Market, Competitive and Dashboard all obey it, and this is
  // the same kind of surface.
  const bucketById = bucketByAudienceId(
    themes.map((t) => ({ bucket: t.bucket, supporting_insight_ids: t.insightIds })),
  )
  const poolIds = scopeToClientVoices(
    [...new Set(shortlists.flatMap((s) => s.themes.flatMap((t) => t.insightIds.slice(0, 40))))],
    bucketById,
  )
  const quotesByAudience = poolIds.length ? await fetchQuotesByAudience(admin, poolIds) : new Map()

  // What the verdicts get checked against: which of those insights still exist,
  // which actually carry a quotable comment, and which video each came from.
  // The base table, not the view — stored ids must resolve even when a newer
  // run has superseded the rows but not yet pruned them.
  const insightRows = poolIds.length
    ? await fetchInsightsByIds<{ id: string; source_video_id: string | null }>(admin, poolIds, 'id, source_video_id')
    : []
  const liveInsightIds = new Set(insightRows.map((r) => r.id))
  const quotedInsightIds = new Set([...quotesByAudience.keys()] as string[])

  // Evidence unreachable is NOT the same as evidence absent.
  //
  // fetchQuotesByAudience swallows its query error and returns an empty map, so
  // a schema or permission problem looks exactly like a corpus with nothing in
  // it. Left alone, the quote-backing rule would then downgrade every claim in
  // a plan to "untested" and tell the user their whole document is unmeasured —
  // a confident, wrong answer, which is worse than the bluff the rule exists to
  // prevent. When a real pool resolves nothing, say so loudly and stand the
  // rule down for this run rather than inventing a verdict about the verdicts.
  const evidenceUnreachable = poolIds.length > 0 && quotedInsightIds.size === 0
  if (evidenceUnreachable) {
    console.warn(
      `[ask] ${poolIds.length} insight ids resolved 0 evidence rows — quote-backing not enforced for this check; check insight_evidence reachability`,
    )
  }

  const grounding = {
    liveInsightIds,
    quotedInsightIds: evidenceUnreachable ? liveInsightIds : quotedInsightIds,
    videoByInsightId: new Map(
      insightRows.filter((r) => r.source_video_id).map((r) => [r.id, r.source_video_id as string]),
    ),
  }

  // Keyed exactly as validateVerdicts looks them up. A divergence here would
  // silently empty every pool and downgrade every verdict to silent.
  const themesByClaimRef = new Map(shortlists.map((s) => [normaliseRef(s.claim.ref), s.themes]))
  const verdictUser = shortlists
    .map((s) => {
      const lines = [`[${s.claim.ref}] ${s.claim.claim}`]
      if (!s.themes.length) {
        lines.push('   (nothing in the conversation came close to this claim)')
        return lines.join('\n')
      }
      s.themes.forEach((t, i) => {
        lines.push(`   [T${i + 1}] ${t.label}${t.description ? ` — ${t.description}` : ''}`)
        const quotes = t.insightIds
          .flatMap((id) => (quotesByAudience.get(id) ?? []).map((q: { quote: string }) => q.quote))
          .slice(0, ASK_QUOTES_PER_THEME)
        for (const q of quotes) lines.push(`       "${q}"`)
      })
      return lines.join('\n')
    })
    .join('\n\n')

  const verdictSystem = buildVerdictPrompt(companyName)
  const startedVerdict = Date.now()
  let verdicts: z.infer<typeof VerdictSchema> | null = null
  usage = { prompt_tokens: 0, completion_tokens: 0 }
  try {
    const completion = await openai.chat.completions.parse({
      model: SYNTHESIS_MODEL,
      ...samplingParams(SYNTHESIS_MODEL),
      messages: [
        { role: 'system', content: verdictSystem },
        { role: 'user', content: verdictUser },
      ],
      response_format: zodResponseFormat(VerdictSchema, 'ask_verdict'),
    })
    verdicts = completion.choices[0]?.message?.parsed ?? null
    if (completion.usage) usage = { prompt_tokens: completion.usage.prompt_tokens, completion_tokens: completion.usage.completion_tokens }
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e)
    if (persist) await logAiCall(admin, { clientId, runId, pass: 'ask_verdict', callIndex: 1, model: SYNTHESIS_MODEL, promptVersion: PROMPT_VERSION_VERDICT, systemPrompt: verdictSystem, userPrompt: verdictUser, response: null, error, usage, durationMs: Date.now() - startedVerdict, validationStatus: 'parse_error' })
    throw new Error(`Ask verdict call failed: ${error}`)
  }
  costUsd += estimateCost(SYNTHESIS_MODEL, usage.prompt_tokens, usage.completion_tokens)
  if (persist) await logAiCall(admin, { clientId, runId, pass: 'ask_verdict', callIndex: 1, model: SYNTHESIS_MODEL, promptVersion: PROMPT_VERSION_VERDICT, systemPrompt: verdictSystem, userPrompt: verdictUser, response: verdicts, error: null, usage, durationMs: Date.now() - startedVerdict, validationStatus: verdicts ? 'ok' : 'parse_error' })

  const validated = validateVerdicts((verdicts?.verdicts ?? []) as RawVerdict[], claims, themesByClaimRef, grounding)
    .map((c) => ({ ...c, theySay: c.theySay ? stripThemeRefs(c.theySay) : null }))
  return { claims: validated, costUsd }
}

export async function runAsk(
  admin: ReturnType<typeof import('../supabase-admin').createAdminClient>,
  input: AskInput,
): Promise<AskResult & { title: string; clipped: boolean }> {
  const { clientId, runId, kind, companyName } = input
  const persist = input.persist !== false
  let costUsd = 0

  const { text, clipped } = clipInput(input.text)

  // 1. Extract the claims. Cheap model: this is indexing, not judgement.
  const extractSystem = buildExtractPrompt(kind)
  const extractUser = text
  const startedExtract = Date.now()
  let extracted: z.infer<typeof ExtractSchema> | null = null
  let usage = { prompt_tokens: 0, completion_tokens: 0 }
  try {
    const completion = await openai.chat.completions.parse({
      model: ANALYSIS_MODEL,
      messages: [
        { role: 'system', content: extractSystem },
        { role: 'user', content: extractUser },
      ],
      response_format: zodResponseFormat(ExtractSchema, 'ask_extract'),
    })
    extracted = completion.choices[0]?.message?.parsed ?? null
    if (completion.usage) usage = { prompt_tokens: completion.usage.prompt_tokens, completion_tokens: completion.usage.completion_tokens }
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e)
    if (persist) await logAiCall(admin, { clientId, runId, pass: 'ask_extract', callIndex: 1, model: ANALYSIS_MODEL, promptVersion: PROMPT_VERSION_EXTRACT, systemPrompt: extractSystem, userPrompt: extractUser, response: null, error, usage, durationMs: Date.now() - startedExtract, validationStatus: 'parse_error' })
    throw new Error(`Ask claim extraction failed: ${error}`)
  }
  costUsd += estimateCost(ANALYSIS_MODEL, usage.prompt_tokens, usage.completion_tokens)
  if (persist) await logAiCall(admin, { clientId, runId, pass: 'ask_extract', callIndex: 1, model: ANALYSIS_MODEL, promptVersion: PROMPT_VERSION_EXTRACT, systemPrompt: extractSystem, userPrompt: extractUser, response: extracted, error: null, usage, durationMs: Date.now() - startedExtract, validationStatus: extracted ? 'ok' : 'parse_error' })

  const claims: ExtractedClaim[] = (extracted?.claims ?? [])
    .filter((c) => Boolean(c.claim?.trim()))
    .slice(0, ASK_MAX_CLAIMS)
    .map((c, i) => ({ ref: `C${i + 1}`, claim: c.claim.trim(), source: (c.source ?? '').trim() || null }))

  const title = stripThemeRefs(extracted?.title?.trim() ?? '')
  if (!claims.length) {
    return { claims: [], summary: { supported: 0, contradicted: 0, untested: 0 }, judgement: [], costUsd, title, clipped }
  }

  const verdictOut = await verdictPass(admin, { clientId, runId, companyName, claims, persist })
  costUsd += verdictOut.costUsd
  const validated = verdictOut.claims
  const summary = summarise(validated)

  // 4. Judgement — a separate call, so a proposal cannot leak into the evidence
  // register under instruction pressure. It sees the grounded findings.
  const judgeUser = validated
    .map((c) => `[${c.ref}] ${c.claim}\n   verdict: ${c.verdict}${c.theySay ? `\n   audience: ${c.theySay}` : ''}`)
    .join('\n\n')
  const judgeSystem = buildJudgePrompt(companyName)
  const startedJudge = Date.now()
  let judged: z.infer<typeof JudgeSchema> | null = null
  usage = { prompt_tokens: 0, completion_tokens: 0 }
  try {
    const completion = await openai.chat.completions.parse({
      model: SYNTHESIS_MODEL,
      ...samplingParams(SYNTHESIS_MODEL),
      messages: [
        { role: 'system', content: judgeSystem },
        { role: 'user', content: judgeUser },
      ],
      response_format: zodResponseFormat(JudgeSchema, 'ask_judge'),
    })
    judged = completion.choices[0]?.message?.parsed ?? null
    if (completion.usage) usage = { prompt_tokens: completion.usage.prompt_tokens, completion_tokens: completion.usage.completion_tokens }
  } catch (e) {
    // Judgement is additive: the evidence stands without it. Losing the opinion
    // is much better than losing the answer.
    console.error(`[ask] judgement call failed: ${e instanceof Error ? e.message : String(e)}`)
  }
  if (judged) {
    costUsd += estimateCost(SYNTHESIS_MODEL, usage.prompt_tokens, usage.completion_tokens)
    if (persist) await logAiCall(admin, { clientId, runId, pass: 'ask_judge', callIndex: 1, model: SYNTHESIS_MODEL, promptVersion: PROMPT_VERSION_JUDGE, systemPrompt: judgeSystem, userPrompt: judgeUser, response: judged, error: null, usage, durationMs: Date.now() - startedJudge, validationStatus: 'ok' })
  }
  const judgement = validateJudgement(judged?.judgement ?? [], validated).map((j) => ({
    ...j,
    text: stripThemeRefs(j.text),
  }))

  return { claims: validated, summary, judgement, costUsd, title, clipped }
}
