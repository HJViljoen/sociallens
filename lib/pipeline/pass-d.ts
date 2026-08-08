import { zodResponseFormat } from 'openai/helpers/zod'
import { createAdminClient } from '../supabase-admin'
import { openai, samplingParams } from '../openai'
import { SYNTHESIS_MODEL, CITATION_RELEVANCE_FLOOR, estimateCost } from '../config'
import { PassDaSchema, PassDaSchemaV5, PassDbSchema, type PassDaOutput, type PassDbOutput, type CiSummary, type ExecutiveBrief, type SayVsHearItemOut, type SayVsHearEntry } from './schemas'
import { priorityForRank } from '../calibration'
import { CALIBRATED_PROSE_RULE, stripThemeRefs } from './prose-rules'
import { validateBrief } from './narrative'
import { logAiCall } from './ai-log'
import { indexThemes, type PersistedCompetitiveInsight } from './pass-c'
import type { BrandClaim } from './claims'
import { readsAsHeroQuote } from '../quotes'
import { embedTexts, cosine } from './cluster'
import { loadThemes } from './themes'
import type { AggregatedTheme, SovEntry } from './types'

// Pass D — market intelligence + recommendations, SPLIT per Redesign Spec
// 2026-07-03 §8 into two calls:
//   D-a: market insights + the consumer_intelligence_summary (the "someone
//        already read everything for you" block leading Market Intelligence).
//   D-b: recommendations, grounded via evidence retrieval — the model sees the
//        actual verbatim quotes behind each market insight's themes, which is
//        the fix for generic recommendations (trigger: the 2026-07-03 Ossur run).
// Themes (T#) and competitive insights (C#) are referenced by index; D-b
// references D-a's market insights by M#. Code maps every index back to a UUID
// and rejects unknowns (invariant 8).

// v2/v4 (2026-07-04): calibrated language — both prompts get the shared prose
// rule (no model-chosen intensity words; measured badges say how much), and D-b
// switches from a model-set priority field to RANKED output: array order is the
// priority, code assigns high/medium/low by position (priorityForRank).
// v3 (2026-07-18): also author the executive_brief — the woven dashboard hero
// (headline_finding + metric-tagged beats carrying [[n]] tokens). The one place
// the model frames numbers; validateBrief scrubs any it leaks and the dashboard
// substitutes the authoritative figures at render.
// v4 (2026-07-18): consumer_intelligence_summary gains a woven `narrative` — the
// executive-read paragraph that leads Market Intelligence (same voice as the
// brief), so that page reads as a written briefing, not list-shaped cards.
const PROMPT_VERSION_A = 'pass_d_a_v4'
// v5 (2026-08-08, Step 2b): + say_vs_hear over [S#] client claims — selected
// only when claims exist, so claim-less tenants keep the v4 schema/prompt.
const PROMPT_VERSION_A_V5 = 'pass_d_a_v5'
// v5 (2026-07-07): also select a hero_quote per recommendation AND per market
// insight (evidence-led cards, Redesign Spec §1) — the one place a raw verbatim
// belongs. Code validates each against the shown quotes and drops non-matches.
// v6 (2026-07-10): entity-scoped hero pool (teardown §Run 1, defect 1 — a
// competitor's customers were quoted on a client positioning rec). Competitor-
// audience quotes now appear LABELLED, for competitive context only; the hero
// validation map is built from client + category voices exclusively, so a
// competitor voice can never lead a client-facing card.
const PROMPT_VERSION_B = 'pass_d_b_v6'

/** Max verbatim quotes retrieved per market insight for the D-b prompt. */
const QUOTES_PER_INSIGHT = 6
/** Max labelled competitor-audience quotes per market insight (context only). */
const COMPETITOR_QUOTES_PER_INSIGHT = 4

const clampScore = (n: number) => Math.max(1, Math.min(10, Math.round(n)))

/** A say-vs-hear item that survived validation, S# resolved to its claim. */
export interface ValidSvhItem {
  claim: BrandClaim
  audience: SayVsHearItemOut['audience']
  they_say: string | null
  gap: string
  supporting_themes: string[]
}

/** Pure say-vs-hear validation (exported for tests): resolve S# against the
 *  claims shown (1-based), enforce the silent contract (silence carries NO
 *  audience voice and NO theme refs — enforced, not trusted), require they_say
 *  on non-silent verdicts, cap 3. */
export function validateSayVsHear(items: SayVsHearItemOut[], claims: BrandClaim[]): ValidSvhItem[] {
  const out: ValidSvhItem[] = []
  const usedRefs = new Set<number>()
  for (const it of items) {
    if (out.length >= 3) break
    // Lenient parse ("[S1]", "S 1" — the input literally shows [S#]), same
    // spirit as D-b's hero-index handling; one claim gets at most one verdict.
    const m = /^s(\d+)$/.exec(it.you_say_ref.toLowerCase().replace(/[^a-z0-9]/g, ''))
    const idx = m ? Number(m[1]) : NaN
    const claim = m ? claims[idx - 1] : undefined
    if (!claim || usedRefs.has(idx) || !it.gap.trim()) continue
    usedRefs.add(idx)
    if (it.audience === 'silent') {
      out.push({ claim, audience: 'silent', they_say: null, gap: it.gap, supporting_themes: [] })
      continue
    }
    const they = it.they_say?.trim()
    if (!they) continue
    out.push({ claim, audience: it.audience, they_say: they, gap: it.gap, supporting_themes: it.supporting_themes })
  }
  return out
}

export interface RunPassDOptions {
  clientId: string
  runId: string
  themes: AggregatedTheme[]
  competitiveInsights?: PersistedCompetitiveInsight[]
  /** The client's display name (clients.company_name) — insights name it directly. */
  brandName?: string
  sov?: Record<string, SovEntry>
  /** The client's own video claims (Step 2b) — D-a's say-vs-hear input. */
  clientClaims?: BrandClaim[]
  persist?: boolean
  dryRun?: boolean
}

export interface RunPassDResult {
  marketInsights: { id: string; insight_type: string; title: string; confidence_score: number; opportunity_score: number }[]
  recommendations: { id: string; type: string; title: string; priority: string | null }[]
  ciSummary: CiSummary | null
  /** Sanitised dashboard hero brief, or null when the model produced none usable
   *  (render falls back to a code-composed narrative). */
  executiveBrief: ExecutiveBrief | null
  /** Say-vs-hear entries (v5, claims resolved for the UI), or null when the
   *  run had no client claims / nothing validated. */
  sayVsHear: SayVsHearEntry[] | null
  rejectedRefs: number
  promptTokens: number
  completionTokens: number
  costUsd: number
  dryRun: boolean
}

// ---- D-a: market insights + CI summary --------------------------------------

/** Exported for tests (v5 say-vs-hear pins). */
export function buildSystemPromptA(brandName?: string, hasClaims = false): string {
  const name = brandName?.trim() || 'the brand'
  const base = [
    `You are a media-based consumer intelligence analyst producing the strategic output that ${name} pays for.`,
    '',
    'You are given audience themes (distilled from real comments) and, if present, competitive insights.',
    'Synthesise across the whole conversation — not one theme at a time.',
    '',
    'Produce three things:',
    '1. market_insights — patterns that span themes: unmet needs, platform patterns, industry signals,',
    '   cross-platform synthesis, sentiment trajectory. Look at the market, not a single bucket.',
    '2. consumer_intelligence_summary — the at-a-glance read of the whole corpus:',
    '   - narrative: the executive read that LEADS the page — 2–4 flowing sentences, written the way you would',
    '     brief a busy owner out loud: what the market is telling ' + name + ', what is driving it, and what it',
    '     means for them. ONE woven paragraph, not a list; plain client-facing prose, no numbers, no bracket',
    '     indices. This is the same voice as the executive_brief below — a written read, not bullet points.',
    '   - top_unmet_needs: the 3 (at most) clearest unmet needs in the conversation.',
    '   - top_buying_triggers: the 3 (at most) clearest events/reasons that push people to buy.',
    '   - top_differentiators: the 3 (at most) clearest things that set brands apart in this conversation (name the brand each favours).',
    '   - emotional_snapshot: 1–2 sentences on the dominant feelings in the audience.',
    '   - threats: up to 3 findings that should worry ' + name + ' (empty array if none are genuine).',
    '   Every summary item must trace back to the themes/competitive insights below — nothing invented, no numbers.',
    '   The summary is client-facing prose: NEVER include bracket indices (T1, C2, …) or any internal references',
    '   in its text — plain sentences only. Indices belong ONLY in the market_insights supporting fields.',
    '3. executive_brief — the short briefing that leads the dashboard, written for a busy decision-maker:',
    '   - headline_finding: the single most important thing ' + name + ' should take away this update —',
    '     WHAT the audience is telling them and WHY it matters, in one or two plain sentences. No figures.',
    '   - narrative: 2–3 short beats, most important first, each featuring ONE of these measured figures:',
    '       • top_theme — the single theme the conversation most returns to (name it; you have the labels).',
    `       • sentiment — how customers feel across the conversation.`,
    `       • share_of_voice — ${name}'s presence in the tracked conversation.`,
    '     Write each beat as ONE woven sentence and place the literal token [[n]] exactly once, at the spot',
    '     where the figure belongs — the product substitutes the real number there. Do NOT write the number',
    '     yourself, and do NOT state its size or direction (no "positive", no "leads", no "small"): the product',
    '     supplies the value and its calibrated word. Explain what the figure reveals and why it matters. Use',
    '     each metric at most once and omit a beat whose evidence is thin. Example shape: "Strap comfort is the',
    '     thread buyers keep returning to, heard across [[n]]." Same client-facing prose rules as the summary.',
    '',
    'Rules:',
    `- When you refer to the brand, always call it by name, "${name}" — never "the client", "the brand", or "our brand".`,
    '- Reference supporting themes by their bracket index (e.g. "T2") and competitive insights by theirs (e.g. "C1"). Use ONLY indices present in the input.',
    '- supporting_themes must list ONLY the themes a market insight is directly distilled from — the specific themes whose comments are the evidence for the claim. Cite the few that genuinely apply (usually 1–4), never a broad list. Do NOT add a theme just to satisfy a grounding requirement: the product shows the user the actual comments behind each cited theme as proof, so an unrelated theme there is a visible defect.',
    '- Some insights are NOT distilled from comment themes at all — insights about share of voice, content volume, posting presence, or platform coverage are derived from the SHARE OF VOICE data above, not from comments. For these, return an EMPTY supporting_themes array and rely on the share-of-voice figures. Never back-fill them with comment themes.',
    '- Do NOT invent counts or percentages. confidence_score and opportunity_score are 1–10 judgments, not measured quantities.',
    CALIBRATED_PROSE_RULE,
    '- If the data is thin, produce fewer, honest insights rather than padding. Fewer, tightly-grounded insights beat many loosely-grounded ones.',
  ]
  if (!hasClaims) return base.join('\n')
  // v5: the say_vs_hear deliverable is spliced in as item 4 BEFORE the Rules
  // block (a fourth deliverable announced after the rules weakens instruction-
  // following on exactly the calibration rules that matter — review finding).
  const sayVsHearItem = [
    `4. say_vs_hear — the input includes claims ${name} makes in its OWN videos, labelled [S1], [S2], …`,
    `   For up to 3 claims where the contrast is genuinely informative, return: you_say_ref (the S# label),`,
    '   audience ("echoes" = the audience independently says the same thing; "contradicts" = the audience',
    '   pushes back on it; "silent" = the tracked conversation simply does not engage with this claim),',
    '   they_say (what the audience actually says on this subject — null when silent), gap (the one-sentence',
    '   takeaway: what the mismatch or match means for ' + name + '), and supporting_themes (T# indices',
    '   grounding the audience side — EMPTY when silent).',
    '   Judge only against the themes provided — silence is a real, reportable verdict, never invent',
    '   audience voice to fill it. Pick the claims with the most decision value, not the first three.',
    '   gap and they_say are client-facing prose: no indices, no numbers.',
    '',
  ]
  const rulesAt = base.indexOf('Rules:')
  const v5 = [
    ...base.slice(0, rulesAt).map((l) => (l === 'Produce three things:' ? 'Produce four things:' : l)),
    ...sayVsHearItem,
    ...base.slice(rulesAt),
  ]
  return v5.join('\n')
}

function themeLine(label: string, theme: AggregatedTheme): string {
  const name = theme.label ?? theme.theme
  return (
    `[${label}] bucket=${theme.bucket} category=${theme.category} "${name}" ` +
    `· ${theme.evidenceCount} videos · strength ${theme.strengthScore} · ${theme.dominantEmotion}/${theme.dominantSentimentImpact}`
  )
}

/** Exported for tests (v5 say-vs-hear pins). */
export function buildUserPromptA(
  themeIndex: { label: string; theme: AggregatedTheme }[],
  ciIndex: Map<string, PersistedCompetitiveInsight>,
  sov: Record<string, SovEntry> | undefined,
  clientClaims: BrandClaim[] = [],
): string {
  const lines: string[] = []
  if (sov && Object.keys(sov).length) {
    lines.push('SHARE OF VOICE (by bucket):')
    for (const [bucket, e] of Object.entries(sov)) lines.push(`- ${bucket}: ${e.videos} videos (${e.pct_videos}%)`)
    lines.push('')
  }
  if (clientClaims.length) {
    lines.push('WHAT THE BRAND SAYS IN ITS OWN VIDEOS (from transcripts):')
    clientClaims.forEach((c, i) => lines.push(`[S${i + 1}] ${c.claim} — "${c.quote}"`))
    lines.push('')
  }
  lines.push(`THEMES (${themeIndex.length})`)
  for (const { label, theme } of themeIndex) lines.push(themeLine(label, theme))
  if (ciIndex.size) {
    lines.push('', `COMPETITIVE INSIGHTS (${ciIndex.size})`)
    let i = 0
    for (const [, ci] of ciIndex) {
      i++
      lines.push(`[C${i}] category=${ci.category} ${ci.competitor_name ? `competitor=${ci.competitor_name} ` : ''}— ${ci.title}: ${ci.finding}`)
    }
  }
  return lines.join('\n')
}

// ---- D-b: grounded recommendations ------------------------------------------

// v3 (2026-07-03): open-world generation, categories tag afterwards. v2's frame
// ("content ideas, hook strategies, …") made the taxonomy the blinders — every
// action came out social-content-shaped, which reads as a content planner, not
// consumer intelligence (trigger: buyer-persona feedback, see vault Strategy
// §Retention risk). The category list must never appear as the menu of what to
// produce; it exists only for the tag-after step.
function buildSystemPromptB(brandName?: string): string {
  const name = brandName?.trim() || 'the brand'
  return [
    `You advise ${name}'s leadership on what the business should do — not just its social media team.`,
    '',
    'You are given market insights (M#) — each with the VERBATIM customer quotes behind it — plus',
    'competitive insights (C#) and share-of-voice context.',
    '',
    'Produce recommendations: the highest-value actions this evidence supports, across ANY part of the',
    'business — product and service, positioning and messaging, customer experience, pricing and access,',
    'partnerships and distribution, competitive response, audience targeting, content and communication,',
    'or anything else the evidence justifies. Never force a content answer when the evidence points at a',
    'product, service, positioning, or experience move. Mix horizons: quick wins alongside bigger moves',
    'that take a quarter — a recommendation is never too big to state if the evidence carries it.',
    '',
    'Only after deciding a recommendation, tag it with the closest type from the schema. If none genuinely',
    'fits, use type "other" and put a short snake_case category of your own in custom_category',
    '(set custom_category to null for every named type).',
    '',
    'Rules:',
    `- When you refer to the brand, always call it by name, "${name}" — never "the client", "the brand", or "our brand".`,
    '- Each recommendation must be concrete enough to start acting on: name the move, the angle, the audience,',
    '  or the change. "Post more educational content" and "improve customer experience" are failures;',
    '  a specific action drawn from the quotes is the standard.',
    '- Ground reasoning in the evidence, but NEVER copy customer quotes verbatim into the title or reasoning:',
    '  raw comments are often fragments and in many languages, so out of context they read as noise. Paraphrase',
    '  what customers are saying in plain English instead (translating where needed). The product shows the real',
    '  quotes behind every recommendation via its evidence link, so your prose never needs to reproduce them.',
    '  (Hooks, titles, or example questions you AUTHOR yourself may of course be quoted.)',
    '- EXCEPTION — the hero_quote fields are the ONE place a raw verbatim belongs, because the card leads with it.',
    '  For EACH recommendation, set hero_quote to the single most representative real customer quote behind it,',
    '  copied EXACTLY (word for word) from the quotes shown under the market insights it follows from. Choose the',
    '  line that best makes a reader FEEL why this matters; prefer one that reads clearly in English. Do not edit,',
    '  translate, or trim it — it must be one of the quotes shown, or it is discarded.',
    '- Also return insight_hero_quotes: exactly one entry per market insight (by its index, e.g. "M1"), each the',
    '  single most representative real customer quote for THAT insight, copied EXACTLY from the quotes shown for it.',
    `- Quotes labelled "[…'s audience]" are OTHER brands' customers, shown for competitive context only. NEVER pick`,
    `  a labelled quote as any hero_quote — putting a competitor's customer's words on a card about ${name}`,
    '  misattributes the voice (the code rejects labelled picks). Heroes come from the unlabelled quotes only;',
    '  if an insight has no unlabelled quotes, return no hero for it.',
    '- based_on lists the market insights a recommendation follows from as "M1", "M2" … and/or competitive insights as "C1" …',
    '  Use ONLY indices present in the input.',
    '- Do NOT invent counts or percentages.',
    CALIBRATED_PROSE_RULE,
    '- ORDER IS PRIORITY: return recommendations ranked, most important first. There is no priority field —',
    '  the product labels your first recommendation "Act now" and the next two "Plan next", so rank deliberately.',
    '- Fewer, sharper recommendations beat a padded list. Every one must be worth the client\'s time.',
  ].join('\n')
}

interface MarketInsightForB {
  index: string
  title: string
  description: string
  /** Hero-eligible voices: client + category audience. The hero validation map
   *  is built from these ONLY. */
  quotes: string[]
  /** Competitor-audience voices, shown labelled for context — never heroes. */
  competitorQuotes: { audience: string; quote: string }[]
}

function buildUserPromptB(
  insights: MarketInsightForB[],
  ciIndex: Map<string, PersistedCompetitiveInsight>,
  sov: Record<string, SovEntry> | undefined,
): string {
  const lines: string[] = []
  if (sov && Object.keys(sov).length) {
    lines.push('SHARE OF VOICE (by bucket):')
    for (const [bucket, e] of Object.entries(sov)) lines.push(`- ${bucket}: ${e.videos} videos (${e.pct_videos}%)`)
    lines.push('')
  }
  lines.push(`MARKET INSIGHTS (${insights.length})`)
  for (const mi of insights) {
    lines.push(`[${mi.index}] ${mi.title} — ${mi.description}`)
    for (const q of mi.quotes) lines.push(`    · "${q}"`)
    for (const cq of mi.competitorQuotes) lines.push(`    · [${cq.audience}'s audience] "${cq.quote}"`)
  }
  if (ciIndex.size) {
    lines.push('', `COMPETITIVE INSIGHTS (${ciIndex.size})`)
    let i = 0
    for (const [, ci] of ciIndex) {
      i++
      lines.push(`[C${i}] category=${ci.category} ${ci.competitor_name ? `competitor=${ci.competitor_name} ` : ''}— ${ci.title}: ${ci.finding}`)
    }
  }
  return lines.join('\n')
}

/** Verbatim quotes behind a set of audience_insights ids, best-ranked first,
 *  each with the audience insight it came from (for bucket attribution). */
async function retrieveQuotes(
  admin: ReturnType<typeof createAdminClient>,
  insightIds: string[],
  cap: number,
): Promise<{ quote: string; audienceId: string }[]> {
  if (insightIds.length === 0 || cap === 0) return []
  const quotes: { quote: string; audienceId: string }[] = []
  const CHUNK = 100
  for (let i = 0; i < insightIds.length && quotes.length < cap; i += CHUNK) {
    const { data, error } = await admin
      .from('insight_evidence')
      .select('quote, audience_insight_id')
      .in('audience_insight_id', insightIds.slice(i, i + CHUNK))
      .order('relevance_rank', { ascending: true })
      .limit(cap - quotes.length)
    if (error) throw new Error(`retrieve evidence: ${error.message}`)
    for (const row of data ?? []) {
      const q = (row.quote ?? '').trim()
      if (q) quotes.push({ quote: q, audienceId: row.audience_insight_id as string })
    }
  }
  return quotes
}

/** audience_insight id → entity bucket, from the run's themes (each theme
 *  carries its bucket + the insight ids that support it). */
function bucketByInsightId(themes: AggregatedTheme[]): Map<string, string> {
  const map = new Map<string, string>()
  for (const t of themes) for (const id of t.supportingInsightIds) map.set(id, t.bucket)
  return map
}

/** Assemble one market insight's D-b entry with the entity-scoped quote pools:
 *  hero-eligible voices (client + industry buckets) and labelled competitor-
 *  audience context. Unmapped ids stay hero-eligible — the map is built from
 *  the same themes the evidence came from, so a miss means legacy data, not a
 *  competitor voice. */
async function buildInsightForB(
  admin: ReturnType<typeof createAdminClient>,
  index: string,
  title: string,
  description: string,
  audienceIds: string[],
  bucketById: Map<string, string>,
): Promise<MarketInsightForB> {
  const heroIds: string[] = []
  const competitorIds: string[] = []
  for (const id of audienceIds) {
    if (bucketById.get(id)?.startsWith('competitor:')) competitorIds.push(id)
    else heroIds.push(id)
  }
  // Over-fetch the hero pool and offer card-carrying quotes first (vault:
  // hero-quote language/weight rules — "Yo quiero 🙌🙌" led a run-1 card).
  // Thin/non-English quotes only fill whatever slots remain.
  const [hero, competitor] = await Promise.all([
    retrieveQuotes(admin, heroIds, QUOTES_PER_INSIGHT * 3),
    retrieveQuotes(admin, competitorIds, COMPETITOR_QUOTES_PER_INSIGHT),
  ])
  const heroPool = [...hero.filter((r) => readsAsHeroQuote(r.quote)), ...hero.filter((r) => !readsAsHeroQuote(r.quote))]
  return {
    index,
    title,
    description,
    quotes: heroPool.slice(0, QUOTES_PER_INSIGHT).map((r) => r.quote),
    competitorQuotes: competitor.map((r) => ({
      audience: (bucketById.get(r.audienceId) ?? 'competitor:another brand').slice('competitor:'.length),
      quote: r.quote,
    })),
  }
}

// ---- orchestration -----------------------------------------------------------

type ParsedCall<T> = { parsed: T | null; usage: { prompt_tokens: number; completion_tokens: number }; durationMs: number }

async function structuredCall<T>(
  schema: Parameters<typeof zodResponseFormat>[0],
  schemaName: string,
  systemPrompt: string,
  userPrompt: string,
): Promise<ParsedCall<T>> {
  const startedAt = Date.now()
  const completion = await openai.chat.completions.parse({
    model: SYNTHESIS_MODEL,
    ...samplingParams(SYNTHESIS_MODEL),
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    response_format: zodResponseFormat(schema, schemaName),
  })
  const usage = completion.usage
    ? { prompt_tokens: completion.usage.prompt_tokens, completion_tokens: completion.usage.completion_tokens }
    : { prompt_tokens: 0, completion_tokens: 0 }
  return { parsed: (completion.choices[0]?.message?.parsed ?? null) as T | null, usage, durationMs: Date.now() - startedAt }
}

export async function runPassD(opts: RunPassDOptions): Promise<RunPassDResult> {
  const { clientId, runId, themes, sov } = opts
  const competitive = opts.competitiveInsights ?? []
  const clientClaims = opts.clientClaims ?? []
  const dryRun = opts.dryRun ?? false
  const persist = opts.persist ?? !dryRun
  const admin = createAdminClient()

  const themeIndex = indexThemes(themes)
  const themeByLabel = new Map(themeIndex.map((t) => [t.label.toLowerCase(), t.theme]))
  // C# index, 1-based in input order.
  const ciIndex = new Map<string, PersistedCompetitiveInsight>()
  competitive.forEach((ci, i) => ciIndex.set(`c${i + 1}`, ci))

  const result: RunPassDResult = {
    marketInsights: [],
    recommendations: [],
    ciSummary: null,
    executiveBrief: null,
    sayVsHear: null,
    rejectedRefs: 0,
    promptTokens: 0,
    completionTokens: 0,
    costUsd: 0,
    dryRun,
  }
  if (dryRun) return result

  // ---- D-a: market insights + CI summary (+ say_vs_hear when claims exist) ----
  const promptVersionA = clientClaims.length ? PROMPT_VERSION_A_V5 : PROMPT_VERSION_A
  const systemPromptA = buildSystemPromptA(opts.brandName, clientClaims.length > 0)
  const userPromptA = buildUserPromptA(themeIndex, ciIndex, sov, clientClaims)

  type ParsedDa = PassDaOutput & { say_vs_hear?: SayVsHearItemOut[] }
  let a: ParsedCall<ParsedDa>
  try {
    a = await structuredCall<ParsedDa>(clientClaims.length ? PassDaSchemaV5 : PassDaSchema, 'pass_d_a', systemPromptA, userPromptA)
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e)
    if (persist) {
      await logAiCall(admin, { clientId, runId, pass: 'pass_d_a', callIndex: 1, model: SYNTHESIS_MODEL, promptVersion: promptVersionA, systemPrompt: systemPromptA, userPrompt: userPromptA, response: null, error, usage: { prompt_tokens: 0, completion_tokens: 0 }, durationMs: 0, validationStatus: 'parse_error' })
    }
    throw new Error(`Pass D-a call failed: ${error}`)
  }
  result.promptTokens += a.usage.prompt_tokens
  result.completionTokens += a.usage.completion_tokens
  result.costUsd += estimateCost(SYNTHESIS_MODEL, a.usage.prompt_tokens, a.usage.completion_tokens)

  if (!a.parsed) {
    if (persist) {
      await logAiCall(admin, { clientId, runId, pass: 'pass_d_a', callIndex: 1, model: SYNTHESIS_MODEL, promptVersion: promptVersionA, systemPrompt: systemPromptA, userPrompt: userPromptA, response: { refusal: true }, error: 'no parsed output', usage: a.usage, durationMs: a.durationMs, validationStatus: 'parse_error' })
    }
    return result
  }
  result.ciSummary = a.parsed.consumer_intelligence_summary
  // Executive brief: scrub any number/magnitude the model leaked into its prose;
  // the dashboard substitutes authoritative figures at render (a null brief just
  // means render falls back to the code-composed narrative).
  const brief = validateBrief(a.parsed.executive_brief)
  result.executiveBrief = brief.brief

  // Citation-relevance floor (teardown §Run 1, defect 1): a T# ref must be
  // semantically RELATED to the insight citing it, not merely exist — run 1 had
  // travel themes grounding a sustainability insight, and "Grounded in N
  // conversations" inherited the padding. Refs below the floor are dropped
  // BEFORE evidence resolution, so grounding counts follow surviving refs only.
  // One embedding call covers all insights + their cited themes; a failure
  // throws (the Inngest step retries — never fail-open into unvalidated refs,
  // the gather gate's original sin).
  let relevanceRejected = 0
  const themeText = (t: AggregatedTheme) => `${t.label ?? t.theme}. ${t.description ?? ''}`.trim()
  const keptRefs: string[][] = a.parsed.market_insights.map((mi) => mi.supporting_themes)
  {
    const citedLabels = [...new Set(keptRefs.flat().map((r) => r.toLowerCase().trim()))].filter((l) => themeByLabel.has(l))
    if (citedLabels.length) {
      const miTexts = a.parsed.market_insights.map((mi) => `${mi.title}. ${mi.description}`)
      const vecs = await embedTexts([...miTexts, ...citedLabels.map((l) => themeText(themeByLabel.get(l)!))])
      const themeVec = new Map(citedLabels.map((l, i) => [l, vecs[miTexts.length + i]]))
      keptRefs.forEach((refs, i) => {
        keptRefs[i] = refs.filter((r) => {
          const v = themeVec.get(r.toLowerCase().trim())
          if (!v) return true // unknown ref — resolveThemes counts and drops it
          if (cosine(vecs[i], v) >= CITATION_RELEVANCE_FLOOR) return true
          relevanceRejected++
          return false
        })
      })
    }
  }

  let rejectedRefs = 0
  const resolveThemes = (refs: string[]): string[] => {
    const ids: string[] = []
    for (const r of refs) {
      const theme = themeByLabel.get(r.toLowerCase().trim())
      if (!theme) { rejectedRefs++; continue }
      ids.push(...theme.supportingInsightIds)
    }
    return [...new Set(ids)]
  }
  const resolveCompetitive = (refs: string[]): string[] => {
    const ids: string[] = []
    for (const r of refs) {
      const ci = ciIndex.get(r.toLowerCase().trim())
      if (!ci) { rejectedRefs++; continue }
      ids.push(ci.id)
    }
    return [...new Set(ids)]
  }

  // ---- Say-vs-hear (v5) — validate, floor the audience-side refs, resolve ----
  if (clientClaims.length && a.parsed.say_vs_hear?.length) {
    const items = validateSayVsHear(a.parsed.say_vs_hear, clientClaims)
    const cited = [...new Set(items.flatMap((it) => it.supporting_themes.map((r) => r.toLowerCase().trim())))].filter((l) => themeByLabel.has(l))
    if (cited.length) {
      // Same 0.35 floor as market insights: the audience side of a contrast
      // must be semantically related to the themes cited as its grounding.
      const itemTexts = items.map((it) => `${it.gap} ${it.they_say ?? ''}`.trim())
      const vecs = await embedTexts([...itemTexts, ...cited.map((l) => themeText(themeByLabel.get(l)!))])
      const themeVec = new Map(cited.map((l, i) => [l, vecs[itemTexts.length + i]]))
      items.forEach((it, i) => {
        it.supporting_themes = it.supporting_themes.filter((r) => {
          const v = themeVec.get(r.toLowerCase().trim())
          if (!v) return true // unknown ref — resolveThemes counts and drops it
          if (cosine(vecs[i], v) >= CITATION_RELEVANCE_FLOOR) return true
          relevanceRejected++
          return false
        })
      })
    }
    const entries = items
      .map((it) => ({
        you_say: it.claim.claim,
        your_quote: it.claim.quote,
        audience: it.audience,
        they_say: it.they_say ? stripThemeRefs(it.they_say) : null,
        gap: stripThemeRefs(it.gap),
        supporting_theme_ids: resolveThemes(it.supporting_themes),
      }))
      // The silent contract's other direction: a non-silent verdict whose refs
      // all failed the floor/resolution has NO grounded audience voice left —
      // rendering "they echo it" with zero evidence is exactly the invented-
      // voice failure this feature must never ship. Silent needs no grounding.
      .filter((e) => e.audience === 'silent' || e.supporting_theme_ids.length > 0)
    result.sayVsHear = entries.length ? entries : null
  }

  // Build market_insights rows (M# = 1-based array order).
  const miRows = a.parsed.market_insights.map((mi, i) => ({
    client_id: clientId,
    run_id: runId,
    insight_type: mi.insight_type,
    title: stripThemeRefs(mi.title),
    description: stripThemeRefs(mi.description),
    evidence: {
      supporting_theme_ids: resolveThemes(keptRefs[i]),
      supporting_competitive_insight_ids: resolveCompetitive(mi.supporting_competitive),
    },
    confidence_score: clampScore(mi.confidence_score),
    opportunity_score: clampScore(mi.opportunity_score),
  }))

  const miById: string[] = []
  if (persist) {
    // Idempotent per (client, run) — invariant 6.
    await admin.from('market_insights').delete().eq('client_id', clientId).eq('run_id', runId)
    await admin.from('recommendations').delete().eq('client_id', clientId).eq('run_id', runId)

    if (miRows.length) {
      const { data: insertedMi, error } = await admin
        .from('market_insights')
        .insert(miRows)
        .select('id, insight_type, title, confidence_score, opportunity_score')
      if (error) throw new Error(`persist market_insights: ${error.message}`)
      const inserted = (insertedMi ?? []) as typeof result.marketInsights
      // .insert preserves input order in the returned set.
      inserted.forEach((row) => miById.push(row.id))
      result.marketInsights = inserted
    }
    await logAiCall(admin, {
      clientId, runId, pass: 'pass_d_a', callIndex: 1, model: SYNTHESIS_MODEL, promptVersion: promptVersionA, systemPrompt: systemPromptA, userPrompt: userPromptA,
      response: { market_insights: miRows.length, ci_summary: true, executive_brief: !!brief.brief, brief_leaked: brief.leaked, brief_dropped: brief.dropped, rejected_refs: rejectedRefs, relevance_rejected: relevanceRejected, ...(clientClaims.length ? { say_vs_hear: result.sayVsHear?.length ?? 0 } : {}) },
      error: null, usage: a.usage, durationMs: a.durationMs,
      validationStatus: rejectedRefs > 0 ? 'ref_rejected' : 'ok',
    })
  } else {
    result.marketInsights = miRows.map((m) => ({ id: '(unsaved)', insight_type: m.insight_type, title: m.title, confidence_score: m.confidence_score, opportunity_score: m.opportunity_score }))
  }

  // ---- D-b: recommendations grounded in retrieved verbatim evidence ----
  const bucketById = bucketByInsightId(themes)
  const insightsForB: MarketInsightForB[] = []
  for (let i = 0; i < miRows.length; i++) {
    const row = miRows[i]
    insightsForB.push(await buildInsightForB(admin, `M${i + 1}`, row.title, row.description, row.evidence.supporting_theme_ids, bucketById))
  }

  if (insightsForB.length === 0 && ciIndex.size === 0) return result

  const db = await runDbCall({
    admin, clientId, runId, brandName: opts.brandName, sov,
    insightsForB, miById, ciIndex, persist,
    initialRejectedRefs: rejectedRefs,
  })
  result.recommendations = db.recommendations
  result.promptTokens += db.promptTokens
  result.completionTokens += db.completionTokens
  result.costUsd += db.costUsd
  result.rejectedRefs = db.rejectedRefs
  return result
}

// ---- D-b call proper — shared by runPassD and rerunPassDb --------------------

interface RunDbCallArgs {
  admin: ReturnType<typeof createAdminClient>
  clientId: string
  runId: string
  brandName?: string
  sov?: Record<string, SovEntry>
  insightsForB: MarketInsightForB[]
  /** market_insights UUIDs in M# order (M1 → index 0). */
  miById: string[]
  ciIndex: Map<string, PersistedCompetitiveInsight>
  persist: boolean
  /** Rerun path: clear the run's existing recommendations before inserting
   * (runPassD already cleared them alongside market_insights). */
  replaceExisting?: boolean
  /** Carried over from D-a's reference resolution so the D-b log stays cumulative. */
  initialRejectedRefs?: number
}

interface RunDbCallResult {
  recommendations: RunPassDResult['recommendations']
  rejectedRefs: number
  promptTokens: number
  completionTokens: number
  costUsd: number
}

async function runDbCall(args: RunDbCallArgs): Promise<RunDbCallResult> {
  const { admin, clientId, runId, sov, insightsForB, miById, ciIndex, persist } = args
  let rejectedRefs = args.initialRejectedRefs ?? 0
  const out: RunDbCallResult = { recommendations: [], rejectedRefs, promptTokens: 0, completionTokens: 0, costUsd: 0 }

  const systemPromptB = buildSystemPromptB(args.brandName)
  const userPromptB = buildUserPromptB(insightsForB, ciIndex, sov)

  let b: ParsedCall<PassDbOutput>
  try {
    b = await structuredCall<PassDbOutput>(PassDbSchema, 'pass_d_b', systemPromptB, userPromptB)
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e)
    if (persist) {
      await logAiCall(admin, { clientId, runId, pass: 'pass_d_b', callIndex: 1, model: SYNTHESIS_MODEL, promptVersion: PROMPT_VERSION_B, systemPrompt: systemPromptB, userPrompt: userPromptB, response: null, error, usage: { prompt_tokens: 0, completion_tokens: 0 }, durationMs: 0, validationStatus: 'parse_error' })
    }
    throw new Error(`Pass D-b call failed: ${error}`)
  }
  out.promptTokens = b.usage.prompt_tokens
  out.completionTokens = b.usage.completion_tokens
  out.costUsd = estimateCost(SYNTHESIS_MODEL, b.usage.prompt_tokens, b.usage.completion_tokens)

  if (!b.parsed) {
    if (persist) {
      await logAiCall(admin, { clientId, runId, pass: 'pass_d_b', callIndex: 1, model: SYNTHESIS_MODEL, promptVersion: PROMPT_VERSION_B, systemPrompt: systemPromptB, userPrompt: userPromptB, response: { refusal: true }, error: 'no parsed output', usage: b.usage, durationMs: b.durationMs, validationStatus: 'parse_error' })
    }
    return out
  }

  // hero_quote validation: the model must copy back a quote we actually showed
  // it — never surface a line the customer didn't say. Match on normalised text,
  // store the canonical original. A non-match is dropped (null).
  const norm = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase()
  const shownByNorm = new Map<string, string>()
  for (const mi of insightsForB) for (const q of mi.quotes) shownByNorm.set(norm(q), q)
  const validateQuote = (q: string | null | undefined): string | null => (q ? shownByNorm.get(norm(q)) ?? null : null)

  // Market-insight hero quotes → written onto the already-inserted rows (M# → id).
  const insightHeroUpdates: { id: string; quote: string }[] = []
  for (const h of b.parsed.insight_hero_quotes ?? []) {
    const canonical = validateQuote(h.quote)
    if (!canonical) continue
    const idx = Number(String(h.index).replace(/[^0-9]/g, '')) - 1
    if (Number.isInteger(idx) && idx >= 0 && idx < miById.length) insightHeroUpdates.push({ id: miById[idx], quote: canonical })
  }

  // 'other' persists as the model's own label so novel categories surface as
  // themselves (CategoryChip renders any string); recurring labels are the
  // promote-into-the-enum signal. Falls back to 'other' on an unusable label.
  const slugify = (s: string) =>
    s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40)

  // Recommendations: based_on references M# (D-a's output) and/or C#.
  // priority is positional (calibrated language): output rank → high/medium/low.
  const recRows = b.parsed.recommendations.map((rec, rank) => {
    const ids: string[] = []
    for (const ref of rec.based_on) {
      const key = ref.toLowerCase().trim()
      if (key.startsWith('m')) {
        const idx = Number(key.slice(1)) - 1
        if (Number.isInteger(idx) && idx >= 0 && idx < miById.length) ids.push(miById[idx])
        else rejectedRefs++
      } else if (key.startsWith('c')) {
        const ci = ciIndex.get(key)
        if (ci) ids.push(ci.id)
        else rejectedRefs++
      } else {
        rejectedRefs++
      }
    }
    return {
      client_id: clientId,
      run_id: runId,
      type: (rec.type === 'other' && rec.custom_category && slugify(rec.custom_category)) || rec.type,
      title: stripThemeRefs(rec.title),
      reasoning: stripThemeRefs(rec.reasoning),
      priority: priorityForRank(rank),
      based_on: { insight_ids: [...new Set(ids)] },
      hero_quote: validateQuote(rec.hero_quote),
    }
  })

  if (persist) {
    // Replace only after a successful parse — a failed call leaves the old rows.
    if (args.replaceExisting) {
      const { error } = await admin.from('recommendations').delete().eq('client_id', clientId).eq('run_id', runId)
      if (error) throw new Error(`clear recommendations: ${error.message}`)
    }
    if (recRows.length) {
      const { data: insertedRec, error } = await admin
        .from('recommendations')
        .insert(recRows)
        .select('id, type, title, priority')
      if (error) throw new Error(`persist recommendations: ${error.message}`)
      out.recommendations = (insertedRec ?? []) as RunDbCallResult['recommendations']
    }
    // Hero quote per market insight (the row was inserted by the D-a caller / already exists on rerun).
    for (const u of insightHeroUpdates) {
      const { error } = await admin.from('market_insights').update({ hero_quote: u.quote }).eq('id', u.id)
      if (error) throw new Error(`persist insight hero_quote: ${error.message}`)
    }
    await logAiCall(admin, {
      clientId, runId, pass: 'pass_d_b', callIndex: 1, model: SYNTHESIS_MODEL, promptVersion: PROMPT_VERSION_B, systemPrompt: systemPromptB, userPrompt: userPromptB,
      response: { recommendations: recRows.length, rejected_refs: rejectedRefs },
      error: null, usage: b.usage, durationMs: b.durationMs,
      validationStatus: rejectedRefs > 0 ? 'ref_rejected' : 'ok',
    })
  } else {
    out.recommendations = recRows.map((r) => ({ id: '(unsaved)', type: r.type, title: r.title, priority: r.priority }))
  }

  out.rejectedRefs = rejectedRefs
  return out
}

/**
 * Re-run ONLY D-b for a run whose market/competitive insights are already
 * persisted: regenerate the recommendations in place without re-rolling the
 * rest of the synthesis. The operator tool for recommendation prompt
 * iteration (first use: purging embedded verbatim quotes, pass_d_b_v2).
 */
export async function rerunPassDb(opts: { clientId: string; runId: string; persist?: boolean }): Promise<RunDbCallResult> {
  const { clientId, runId } = opts
  const persist = opts.persist ?? true
  const admin = createAdminClient()

  const [clientRes, miRes, ciRes, rsRes] = await Promise.all([
    admin.from('clients').select('company_name').eq('id', clientId).maybeSingle(),
    admin.from('market_insights').select('id, title, description, evidence')
      .eq('client_id', clientId).eq('run_id', runId)
      .order('opportunity_score', { ascending: false }),
    admin.from('competitive_insights').select('id, category, competitor_name, title, finding, impact_level')
      .eq('client_id', clientId).eq('run_id', runId)
      .order('id', { ascending: true }),
    admin.from('run_summary').select('share_of_voice')
      .eq('client_id', clientId).eq('run_id', runId).maybeSingle(),
  ])
  if (miRes.error) throw new Error(`load market_insights: ${miRes.error.message}`)
  if (ciRes.error) throw new Error(`load competitive_insights: ${ciRes.error.message}`)

  const mi = (miRes.data ?? []) as { id: string; title: string; description: string; evidence: { supporting_theme_ids?: string[] } | null }[]
  const competitive = (ciRes.data ?? []) as PersistedCompetitiveInsight[]
  const sov = (rsRes.data?.share_of_voice ?? undefined) as Record<string, SovEntry> | undefined

  const bucketById = bucketByInsightId(await loadThemes(clientId, runId))
  const insightsForB: MarketInsightForB[] = []
  const miById: string[] = []
  for (let i = 0; i < mi.length; i++) {
    const row = mi[i]
    miById.push(row.id)
    insightsForB.push(await buildInsightForB(admin, `M${i + 1}`, row.title, row.description, row.evidence?.supporting_theme_ids ?? [], bucketById))
  }
  const ciIndex = new Map<string, PersistedCompetitiveInsight>()
  competitive.forEach((ci, i) => ciIndex.set(`c${i + 1}`, ci))

  if (insightsForB.length === 0 && ciIndex.size === 0) {
    return { recommendations: [], rejectedRefs: 0, promptTokens: 0, completionTokens: 0, costUsd: 0 }
  }

  return runDbCall({
    admin, clientId, runId,
    brandName: clientRes.data?.company_name ?? undefined, sov,
    insightsForB, miById, ciIndex, persist, replaceExisting: true,
  })
}
