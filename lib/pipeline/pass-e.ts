import { zodResponseFormat } from 'openai/helpers/zod'
import { openai, samplingParams } from '../openai'
import { selectAll } from '../supabase-admin'
import {
  SYNTHESIS_MODEL,
  estimateCost,
  PERSONA_DIGEST_THEMES,
  PERSONA_MAX,
  PERSONA_MIN_INSIGHTS,
  PERSONA_MIN_VIDEOS,
  PERSONA_QUOTES,
} from '../config'
import { PassESchema, type PassEOutput } from './schemas'
import { CALIBRATED_PROSE_RULE, stripThemeRefs } from './prose-rules'
import { logAiCall } from './ai-log'
import { bucketByAudienceId, createQuotePicker, fetchQuotesByAudience } from '../quotes'
import { carryPersonas, priorFromProfile } from './persona-continuity'
import {
  buildPopulationCounts,
  buildThemeDigest,
  groundPersonas,
  type DroppedPersona,
  type GroundedPersona,
  type ThemeInput,
} from './persona-assembly'

// Pass E — the consumer profile. One call per run, after Pass D.
//
// Everything else in the pipeline analyses WHAT is being said. This answers WHO
// is saying it: a small set of personas over the run's current insight
// population, each one a grouping of counted insights with its own evidence.
//
// Two things it is deliberately NOT. It is not a customer database — no
// commenter identity ever reaches a model (Pass A sends comment text alone), so
// a persona describes the conversation, not people we have identified. And it
// is not a character sheet: the model proposes and cites, code grounds and
// drops (persona-assembly.ts). The product contract bans invented personas, so
// a proposal that cannot be grounded is worth less than one fewer persona.
//
// Non-fatal by construction: the pipeline runs this as its own Inngest step
// with .catch(), so a client's report never dies for a profile.

// v2 (2026-08-19, Heinrich's design review): the personas were named like
// themes ("the identity-led wearer seeking confidence") and the blocks listed
// what people asked for rather than describing what they are like. A profile
// page is a character sketch — the specifics belong on Voice and Market, one
// click away. Names are now short human nouns; blocks are characterisations.
// v3 (2026-08-19): continuity. The cast persists across runs — shown to the
// model as the default answer, and carried by evidence overlap afterwards so it
// holds whether or not the model cooperates.
// v4 (2026-08-19): the blocks are written analysis, not bullets. This page is a
// read, not a dataset — same register as the dashboard's executive brief.
const PROMPT_VERSION = 'pass_e_v4'

/** Language samples shown to the model — enough to hear the register without
 *  crowding out the theme digest. */
const LANGUAGE_SAMPLES = 60
/** Insight ids per persona offered to the quote picker. The picker scores every
 *  candidate, so this bounds work, not quality. */
const QUOTE_POOL_PER_PERSONA = 150

export interface PassEResult {
  profileId: string | null
  costUsd: number
  headline: string
  personas: (GroundedPersona & { quotes: string[] })[]
  /** Proposals the floors rejected, with the counts that failed — the operator
   *  lever prints these, and they are the only signal for tuning the floors. */
  dropped: DroppedPersona[]
}

interface ThemeRow extends ThemeInput {
  id: string
}

interface InsightRow {
  id: string
  category: string | null
  journey_stage: string | null
  emotion: string | null
  theme: string | null
}

export function buildSystemPrompt(companyName: string): string {
  return [
    `You build a CONSUMER PROFILE for ${companyName} from public conversation their category is having on social video.`,
    '',
    'You are given: counts over the whole current insight population, a digest of the run\'s themes (each with a [T#] handle, its entity bucket, category and dominant emotion), and real phrasings people used.',
    '',
    'Return a small set of PERSONAS. A persona is a KIND OF PERSON in this conversation — the sort of person a colleague could picture from the name alone.',
    '',
    'THE NAME IS THE HARDEST PART. It must be the word a person would actually use for this kind of person: one to three plain words, a noun, no verb, no adjective doing marketing work.',
    '  Good shape: "Caretaker". "New amputee". "Researcher". "Long-term user". "Gift buyer". "First-time buyer".',
    '  Wrong shape: "The identity-led wearer seeking confidence" (a description, not a name) · "Value-conscious Val" (a persona-deck cliché) · "Cost and access barriers" (a theme label, not a person) · "The evaluator checking fit and commitment" (a sentence).',
    '  If the name needs a verb or a clause to make sense, you have written a description. Cut it back to the noun.',
    '',
    'THE BLOCKS ARE ANALYSIS, NOT LISTS. Each one is a short written read — two or three plain sentences, the way a good analyst briefs a busy decision-maker. A bullet list is a data point wearing a sentence\'s clothes; the reader wants to understand this person, not scan them. Never write lists, fragments, or labels — write prose.',
    '  one_liner: who this person is and where they are in their story. Two or three sentences.',
    '  wants: what DRIVES them — the underlying motivation, and what they are really trying to get. Explain the why, not just the what.',
    '  blockers: what STOPS them — what holds this kind of person back, and why it bites. Name the tension, not the obstacle list.',
    '  triggers: what WORKS on them — what actually moves this person, and why it lands where other things do not.',
    '  Answer "what is this kind of person like?" — never "what did they ask for?". If a sentence names a product feature, a channel, or a piece of information, it belongs on another page, not here.',
    '',
    'CONTINUITY. If a standing cast is shown below, those people are already in this client\'s profile and are the default answer. Return them again — same names — when the conversation still contains them, even if this run\'s themes are worded differently. Introduce a new persona only when a genuinely different kind of person has appeared, and leave one out only when the conversation no longer contains them at all. A profile that renames its people every week is unreadable; the point is that what they want moves while they stay the same.',
    '',
    'Other rules:',
    '- Every persona MUST cite the [T#] themes it rests on. A persona you cannot cite is worth less than one fewer persona: the product forbids invented personas, and citations are how the product proves it.',
    '- Personas must differ in BEHAVIOUR, not in wording. Two personas that would act the same way are one persona.',
    '- scope: "category" for the conversation at large (people the brand has not necessarily won); "client" only for personas built from themes in the client bucket. Prefer category — for most brands the client bucket is thin.',
    '- one_liner: one plain sentence on who they are and where they are in their story. Still about the person, not their shopping list.',
    '- how_they_talk: phrases taken from the language samples shown. Do not invent phrasing.',
    '- Never infer who someone is from a name, a platform, or a stereotype, and never quote a person to evidence a demographic. Where the conversation states a condition, life stage or use-case, the product counts it and renders the count itself — you do not describe it.',
    '- Do not state how many people a persona represents. The product counts that from your citations and renders it.',
    CALIBRATED_PROSE_RULE,
    '',
    'Also return a headline: one plain sentence naming who is talking in this category. No numbers.',
  ].join('\n')
}

export function buildUserPrompt(args: {
  companyName: string
  counts: ReturnType<typeof buildPopulationCounts>
  themeLines: string[]
  phrases: string[]
  maxPersonas: number
  prior?: string[]
}): string {
  const { counts, themeLines, phrases, maxPersonas } = args
  const rec = (r: Record<string, number>) =>
    Object.entries(r)
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `${k}: ${v}`)
      .join(', ')
  return [
    `COMPANY: ${args.companyName}`,
    '',
    `POPULATION — ${counts.total} current insights`,
    `by kind — ${rec(counts.byCategory)}`,
    `by buying stage — ${rec(counts.byJourneyStage)}`,
    `by feeling — ${rec(counts.byEmotion)}`,
    `by whose audience — ${rec(counts.byBucket)}`,
    '',
    'THEMES',
    ...themeLines,
    '',
    'HOW PEOPLE PHRASE THINGS',
    ...phrases.map((p) => `- ${p}`),
    '',
    ...(args.prior?.length
      ? ['STANDING CAST — already in this profile, keep them unless the conversation no longer contains them', ...args.prior.map((n) => `- ${n}`), '']
      : []),
    `Return at most ${maxPersonas} personas per scope. Fewer, well-grounded personas beat more.`,
  ].join('\n')
}

/**
 * Run Pass E for a completed run.
 *
 * `persist: false` runs the model call without writing anything (the operator
 * script's --dry-run), which is how the floors get tuned without spending a
 * profile row on every experiment.
 */
export async function runPassE(
  admin: ReturnType<typeof import('../supabase-admin').createAdminClient>,
  args: {
    clientId: string
    runId: string
    runDate: string
    companyName: string
    persist?: boolean
  },
): Promise<PassEResult> {
  const { clientId, runId, runDate, companyName } = args
  const persist = args.persist !== false
  const empty: PassEResult = { profileId: null, costUsd: 0, headline: '', personas: [], dropped: [] }

  // 1. This run's themes — the citable grounding. Own query rather than
  // loadThemes(): that helper selects neither `id` nor `registry_id`, and both
  // are the whole point here (registry_id is the cross-run key the drift layer
  // will join on; themes.id must never be used for that).
  const themes = await selectAll<ThemeRow>(() =>
    admin
      .from('themes')
      .select(
        'id, registry_id, bucket, category, label, description, dominant_emotion, dominant_sentiment_impact, evidence_count, supporting_insight_ids, supporting_video_ids',
      )
      .eq('client_id', clientId)
      .eq('run_id', runId)
      .order('evidence_count', { ascending: false, nullsFirst: false })
      .order('id', { ascending: true }),
  )
  if (!themes.length) return empty

  // 2. The population. The VIEW, never eq('run_id') — insights belong to videos,
  // not runs (incremental Pass A), so filtering by run would drop every
  // untouched video's still-current insight and undercount the whole profile.
  const insights = await selectAll<InsightRow>(() =>
    admin
      .from('audience_insights_current')
      .select('id, category, journey_stage, emotion, theme')
      .eq('client_id', clientId)
      .order('id', { ascending: true }),
  )
  const phrases = (
    await selectAll<{ phrase: string | null }>(() =>
      admin
        .from('language_samples_current')
        .select('phrase')
        .eq('client_id', clientId)
        .order('id', { ascending: true }),
    )
  )
    .map((r) => r.phrase)
    .filter((p): p is string => Boolean(p && p.trim()))

  // An insight carries no entity bucket of its own — it is a property of the
  // source video, reconstructed by walking the themes' membership.
  const bucketById = bucketByAudienceId(
    themes.map((t) => ({ bucket: t.bucket ?? 'industry-other', supporting_insight_ids: t.supporting_insight_ids ?? [] })),
  )
  const counts = buildPopulationCounts(
    insights,
    insights.map((i) => bucketById.get(i.id) ?? null),
  )

  // Demographic signals, counted from the data rather than asked of the model.
  // Pass A already isolates them as their own category, and the retention rule
  // strips their quotes — so a count is all they can honestly be.
  const demographicsByInsightId = new Map<string, string>()
  for (const i of insights) {
    if (i.category === 'demographic_signal' && i.theme?.trim()) {
      demographicsByInsightId.set(i.id, i.theme.trim().replace(/_/g, ' '))
    }
  }

  // The standing cast. A profile is not a weekly report: the same people should
  // still be there next month, with what they want moving underneath. Shown to
  // the model so it keeps them, and enforced afterwards regardless.
  //
  // The newest profile the client HAS, including this run's own earlier
  // attempt. Excluding the current run looked right — it is what the plan-check
  // re-evaluation must do, because diffing a run against itself erases the
  // diff — but a profile carries identity rather than computing a difference,
  // and the row about to be overwritten is the best predecessor there is. With
  // it excluded, re-profiling the same run threw the cast away: an Inngest
  // retry could hand a client a different set of people than attempt 1 did,
  // and re-running the pass after a prompt change renamed everyone.
  const { data: priorRow } = await admin
    .from('consumer_profiles')
    .select('personas')
    .eq('client_id', clientId)
    .order('run_date', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  const prior = priorFromProfile((priorRow as { personas?: unknown } | null)?.personas)

  const { rows: digest, byRef } = buildThemeDigest(themes, { maxThemes: PERSONA_DIGEST_THEMES })
  if (!digest.length) return empty

  const themeLines = digest.map(
    (d) =>
      `[${d.ref}] (${d.bucket} · ${d.category}${d.emotion ? ` · ${d.emotion}` : ''}) ${d.label}${d.description ? ` — ${d.description}` : ''}`,
  )
  const systemPrompt = buildSystemPrompt(companyName)
  const userPrompt = buildUserPrompt({
    companyName,
    counts,
    themeLines,
    phrases: phrases.slice(0, LANGUAGE_SAMPLES),
    maxPersonas: PERSONA_MAX,
    prior: prior.map((p) => p.name),
  })

  // 3. The call. Same shape as every other synthesis pass: one parse call, log
  // on every branch, no retry loop (the Inngest step retries).
  const startedAt = Date.now()
  let parsed: PassEOutput | null = null
  let usage = { prompt_tokens: 0, completion_tokens: 0 }
  try {
    const completion = await openai.chat.completions.parse({
      model: SYNTHESIS_MODEL,
      ...samplingParams(SYNTHESIS_MODEL),
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      response_format: zodResponseFormat(PassESchema, 'pass_e'),
    })
    parsed = completion.choices[0]?.message?.parsed ?? null
    if (completion.usage) {
      usage = { prompt_tokens: completion.usage.prompt_tokens, completion_tokens: completion.usage.completion_tokens }
    }
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e)
    if (persist) {
      await logAiCall(admin, { clientId, runId, pass: 'pass_e', callIndex: 1, model: SYNTHESIS_MODEL, promptVersion: PROMPT_VERSION, systemPrompt, userPrompt, response: null, error, usage, durationMs: Date.now() - startedAt, validationStatus: 'parse_error' })
    }
    throw new Error(`Pass E call failed: ${error}`)
  }

  const durationMs = Date.now() - startedAt
  const costUsd = estimateCost(SYNTHESIS_MODEL, usage.prompt_tokens, usage.completion_tokens)

  if (!parsed) {
    if (persist) {
      await logAiCall(admin, { clientId, runId, pass: 'pass_e', callIndex: 1, model: SYNTHESIS_MODEL, promptVersion: PROMPT_VERSION, systemPrompt, userPrompt, response: { refusal: true }, error: 'no parsed output', usage, durationMs, validationStatus: 'parse_error' })
    }
    return { ...empty, costUsd }
  }

  // 4. Ground and floor. This is where a proposal becomes a finding or a
  // recorded rejection.
  const { kept, dropped } = groundPersonas(parsed.personas ?? [], byRef, {
    minInsights: PERSONA_MIN_INSIGHTS,
    minVideos: PERSONA_MIN_VIDEOS,
    maxPersonas: PERSONA_MAX,
    demographicsByInsightId,
    livePopulationIds: new Set(insights.map((i) => i.id)),
    validPhrases: new Set(phrases),
  })

  // Identity carried by EVIDENCE, not by the model cooperating.
  const carried = carryPersonas(kept, prior)

  if (persist) {
    await logAiCall(admin, { clientId, runId, pass: 'pass_e', callIndex: 1, model: SYNTHESIS_MODEL, promptVersion: PROMPT_VERSION, systemPrompt, userPrompt, response: parsed, error: null, usage, durationMs, validationStatus: kept.length ? 'ok' : 'empty' })
  }

  // 5. Evidence. The picker de-duplicates across personas, so no two personas
  // lead with the same voice; redacted (demographic) evidence never reaches it.
  // The picker's theme bonus splits on '_', so it needs Pass A's snake_case
  // slug (audience_insights.theme) — feeding it the Pass B prose label made the
  // bonus silently always zero and picked quotes on readability alone.
  const themeSlugById = new Map<string, string>()
  for (const i of insights) if (i.theme) themeSlugById.set(i.id, i.theme)
  const poolIds = [...new Set(carried.flatMap((p) => p.insightIds.slice(0, QUOTE_POOL_PER_PERSONA)))]
  const quotesByAudience = poolIds.length ? await fetchQuotesByAudience(admin, poolIds) : new Map()
  // A pool that resolves to nothing is a schema/permission problem, not an
  // absence of good voices — fetchQuotesByAudience swallows its query error and
  // returns an empty map, so without this the personas would just look quiet.
  if (poolIds.length && quotesByAudience.size === 0) {
    console.warn(`[pass-e] ${poolIds.length} insight ids resolved 0 evidence rows — check insight_evidence reachability`)
  }
  const pick = createQuotePicker(quotesByAudience, themeSlugById)
  const withQuotes = carried.map((p) => ({
    ...p,
    name: stripThemeRefs(p.name),
    oneLiner: stripThemeRefs(p.oneLiner),
    wants: stripThemeRefs(p.wants),
    blockers: stripThemeRefs(p.blockers),
    triggers: stripThemeRefs(p.triggers),
    howTheyTalk: p.howTheyTalk.map(stripThemeRefs),
    quotes: pick(
      p.insightIds.slice(0, QUOTE_POOL_PER_PERSONA),
      PERSONA_QUOTES,
      [p.name, p.oneLiner, p.wants, p.blockers].join('. '),
    ),
  }))

  const headline = stripThemeRefs(parsed.headline ?? '')
  if (!persist) {
    return { profileId: null, costUsd, headline, personas: withQuotes, dropped }
  }

  // 6. One profile per run: replace rather than accumulate, so a re-run of the
  // same run overwrites instead of doubling (the pattern themes/run_summary use).
  // Nothing to store is not a reason to destroy what is stored. A replay of
  // this step that grounds nothing would otherwise blank a good profile — and
  // under the offline operating mode that is the likely case, not the rare one.
  if (!withQuotes.length) {
    return { profileId: null, costUsd, headline, personas: [], dropped }
  }

  // Quote TEXT is deliberately not persisted. A verbatim copy in a new table is
  // a copy that erasure and the YouTube retention refresh do not know about —
  // exactly the class of leak scripts/erase-commenter.ts already has to chase
  // across four hero_quote columns. The persona carries insight ids; the page
  // resolves the voices live from insight_evidence, so a deleted comment is
  // gone everywhere at once.
  const personasToStore = withQuotes.map((p) => {
    const stored: Record<string, unknown> = { ...p }
    delete stored.quotes
    return stored
  })
  const { data, error } = await admin
    .from('consumer_profiles')
    .upsert(
      {
        client_id: clientId,
        run_id: runId,
        run_date: runDate,
        headline,
        personas: personasToStore,
        insight_population: counts.total,
        theme_population: themes.length,
        dropped,
        prompt_version: PROMPT_VERSION,
      },
      { onConflict: 'client_id,run_id' },
    )
    .select('id')
    .single()
  if (error) throw new Error(`Pass E write failed: ${(error as { message?: string }).message ?? String(error)}`)

  return { profileId: (data as { id: string } | null)?.id ?? null, costUsd, headline, personas: withQuotes, dropped }
}
