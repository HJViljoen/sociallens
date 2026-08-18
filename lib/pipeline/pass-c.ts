import { zodResponseFormat } from 'openai/helpers/zod'
import { createAdminClient } from '../supabase-admin'
import { openai, samplingParams } from '../openai'
import { SYNTHESIS_MODEL, CITATION_RELEVANCE_FLOOR, COMPETITIVE_MIN_VIDEOS, estimateCost } from '../config'
import { PassCSchema, type PassCOutput } from './schemas'
import { logAiCall } from './ai-log'
import { CALIBRATED_PROSE_RULE, stripThemeRefs } from './prose-rules'
import { embedTexts, cosine } from './cluster'
import type { AggregatedTheme, SovEntry } from './types'
import type { BrandClaim } from './claims'

// Pass C — competitive analysis (Architecture/Analysis-Passes §Pass C). Single
// GPT call over Step A2's bucketed themes (never re-reads raw comments). Finds
// what only emerges from cross-bucket comparison: topic ownership, content gaps,
// competitive threats, sentiment differentials. Themes are presented as short
// indices (T1, T2 …); the model references those, and code maps them back to
// audience_insights UUIDs, rejecting unknown indices (invariant 8). On a
// single-bucket corpus there is nothing to compare, so the model returns [].

// v4 (2026-07-04): calibrated language — prose rule (no intensity/frequency
// words; cross-bucket comparisons stay allowed, they're this pass's job) + an
// anti-inflation guard on impact_level (the 3 Jul run rated 3 of 5 "high").
// v5 (2026-08-08, Step 2b): competitor claims from video transcripts enter as
// CONTEXT (claims block) — findings still cite themes only.
const PROMPT_VERSION = 'pass_c_v5'

export interface TrackingConfig {
  brand_keywords: string[] | null
  competitor_names: string[] | null
  industry_keywords: string[] | null
}

export interface RunPassCOptions {
  clientId: string
  runId: string
  themes: AggregatedTheme[]
  trackingConfig?: TrackingConfig
  /** The client's display name (clients.company_name) — findings name it directly. */
  brandName?: string
  sov?: Record<string, SovEntry>
  /** Named competitors' own video claims (Step 2b) — CONTEXT for findings,
   *  never evidence; findings still cite T# themes only. */
  competitorClaims?: BrandClaim[]
  persist?: boolean
  dryRun?: boolean
}

/** A persisted competitive insight, surfaced to Pass D for C# referencing. */
export interface PersistedCompetitiveInsight {
  id: string
  category: string
  competitor_name: string | null
  title: string
  finding: string
  impact_level: string | null
}

export interface RunPassCResult {
  competitiveInsights: PersistedCompetitiveInsight[]
  themeIndex: { label: string; theme: AggregatedTheme }[]
  inserted: number
  rejectedRefs: number
  promptTokens: number
  completionTokens: number
  costUsd: number
  dryRun: boolean
  skippedReason?: string
}

/** Stable T# index for each theme — the only handle the model gets. */
export function indexThemes(themes: AggregatedTheme[]): { label: string; theme: AggregatedTheme }[] {
  return themes.map((theme, i) => ({ label: `T${i + 1}`, theme }))
}

/** Exported for tests (v5 claims-block pins). */
export function buildSystemPrompt(tc: TrackingConfig | undefined, brandName?: string, hasClaims = false): string {
  const name = brandName?.trim() || 'the client brand'
  const aliases = (tc?.brand_keywords ?? []).join(', ')
  const competitors = (tc?.competitor_names ?? []).join(', ') || '(none provided)'
  const base = [
    'You are a media-based competitive intelligence analyst working for a brand.',
    '',
    `The brand you work for is ${name}${aliases ? ` (also referred to as: ${aliases})` : ''}.`,
    `Known competitors: ${competitors}`,
    '',
    'You are given audience themes already bucketed by who posted the source videos:',
    `- client      = ${name} itself`,
    '- competitor:X = a named competitor',
    '- industry-other = everyone else in the category',
    '',
    'Find ONLY insights that emerge from comparing buckets against each other:',
    `- topic_ownership: a theme strong in the ${name} bucket and weak elsewhere.`,
    `- content_gap: a theme strong in competitor / industry buckets but missing from ${name}.`,
    `- competitive_threat: a theme positive for a competitor but negative (or absent) for ${name}.`,
    '- sentiment_differential: the same topic with a different emotional tone across buckets.',
    '- notable_account: a high-signal industry account worth tracking.',
    '- engagement_benchmark: a cross-bucket performance contrast.',
    '',
    'Rules:',
    `- When you refer to the brand, always call it by name, "${name}" — never "the client", "the brand", or "our brand".`,
    '- Reference every supporting theme by its bracket index (e.g. "T3"), using ONLY indices present in the input.',
    '- Do NOT invent counts, percentages, or metrics.',
    CALIBRATED_PROSE_RULE,
    `- A finding must rest on a genuine cross-bucket contrast. If only ONE bucket is present (no competitor or ${name} data to compare), return an empty "competitive_insights" array. Do not manufacture comparisons.`,
    `- Buckets marked TOO THIN TO COMPARE hold fewer than ${COMPETITIVE_MIN_VIDEOS} videos. Never rest a finding on one. We barely gathered them, so their quiet says nothing about the brand.`,
    '- impact_level reflects how much the finding should affect the brand’s strategy. "high" is scarce: at most one or two findings per run genuinely demand a strategy response — when in doubt, medium.',
  ]
  if (!hasClaims) return base.join('\n')
  return [
    ...base,
    '',
    'WHAT COMPETITORS SAY: the input includes claims competitors make in their OWN videos (from transcripts). Rules for using them:',
    '- A claim is the competitor\'s marketing voice — context, NEVER audience sentiment and NEVER evidence on its own.',
    `- Use claims to sharpen cross-bucket contrasts: a claimed strength the audience doesn't echo, a competitor pitch that exposes a gap in ${name}'s content, a claim the audience actively contradicts.`,
    '- Findings must still cite audience themes by bracket index for support; a claim can motivate a finding but never substitutes for theme support.',
  ].join('\n')
}

/**
 * Entity buckets too thin to carry a comparison (Tier 1). Returns the bucket
 * keys below the floor, so the prompt can name them and rule them out rather
 * than leaving the model to discover their thinness from a video count it has
 * no instruction about.
 */
/** Videos in a bucket a finding can rest on: the ones that produced an insight,
 *  falling back to the gathered count only on rows written before
 *  analysed_videos existed. */
export function bucketCoverage(entry: SovEntry | undefined): number {
  if (!entry) return 0
  return Number(entry.analysed_videos ?? entry.videos ?? 0)
}

export function thinBuckets(
  sov: Record<string, SovEntry> | undefined,
  floor: number = COMPETITIVE_MIN_VIDEOS,
): string[] {
  if (!sov) return []
  return Object.entries(sov)
    .filter(([, e]) => bucketCoverage(e) < floor)
    .map(([bucket]) => bucket)
    .sort()
}

/** Exported for tests (v5 claims-block pins). */
export function buildUserPrompt(
  themeIndex: { label: string; theme: AggregatedTheme }[],
  sov: Record<string, SovEntry> | undefined,
  competitorClaims: BrandClaim[] = [],
): string {
  const lines: string[] = []
  const thin = thinBuckets(sov)
  if (sov && Object.keys(sov).length) {
    lines.push('SHARE OF VOICE (by bucket):')
    for (const [bucket, e] of Object.entries(sov)) {
      const mark = thin.includes(bucket) ? '  [TOO THIN TO COMPARE]' : ''
      lines.push(`- ${bucket}: ${e.videos} videos gathered, ${bucketCoverage(e)} analysed (${e.pct_videos}% of corpus)${mark}`)
    }
    lines.push('')
  }
  if (thin.length) {
    lines.push(
      `THIN BUCKETS (under ${COMPETITIVE_MIN_VIDEOS} videos): ${thin.join(', ')}. ` +
        'Do not build a finding whose contrast depends on one of these. Absence of ' +
        'conversation about an entity we barely gathered is not evidence about that entity.',
      '',
    )
  }
  if (competitorClaims.length) {
    lines.push('WHAT COMPETITORS SAY IN THEIR OWN VIDEOS (from transcripts):')
    for (const c of competitorClaims) {
      lines.push(`- [${c.competitor}] ${c.claim} — "${c.quote}"`)
    }
    lines.push('')
  }
  lines.push(`THEMES (${themeIndex.length})`)
  for (const { label, theme } of themeIndex) {
    // Evidence and share, not `strength`: that was the strongest SINGLE member
    // insight and said nothing about how widely a theme was heard, while being
    // the only salience number the model saw (Tier 1).
    // The same denominator the rank used, so the prompt's share and the order
    // it arrives in cannot disagree (they read 12% vs 85% for one live theme).
    const bucketVideos = bucketCoverage(sov?.[theme.bucket])
    const share = bucketVideos > 0 ? ` (${Math.round((theme.evidenceCount / bucketVideos) * 100)}% of its bucket)` : ''
    lines.push(
      `[${label}] bucket=${theme.bucket} category=${theme.category} "${theme.label ?? theme.theme}" ` +
        `· heard in ${theme.evidenceCount} videos${share} ` +
        `· ${theme.dominantEmotion}/${theme.dominantSentimentImpact}`,
    )
  }
  return lines.join('\n')
}

export async function runPassC(opts: RunPassCOptions): Promise<RunPassCResult> {
  const { clientId, runId, themes, trackingConfig, sov } = opts
  const dryRun = opts.dryRun ?? false
  const persist = opts.persist ?? !dryRun
  const admin = createAdminClient()

  const themeIndex = indexThemes(themes)
  const byLabel = new Map(themeIndex.map((t) => [t.label.toLowerCase(), t.theme]))
  const competitorClaims = opts.competitorClaims ?? []
  const systemPrompt = buildSystemPrompt(trackingConfig, opts.brandName, competitorClaims.length > 0)
  const userPrompt = buildUserPrompt(themeIndex, sov, competitorClaims)

  const base: RunPassCResult = {
    competitiveInsights: [],
    themeIndex,
    inserted: 0,
    rejectedRefs: 0,
    promptTokens: 0,
    completionTokens: 0,
    costUsd: 0,
    dryRun,
  }

  // Idempotent per (client, run) — invariant 6. Clear BEFORE any early return so a
  // run that has lost its competitor data doesn't leave stale competitive insights.
  if (persist) {
    await admin.from('competitive_insights').delete().eq('client_id', clientId).eq('run_id', runId)
  }

  // Distinct buckets present — with <2 there is nothing to compare; skip the call.
  const buckets = new Set(themes.map((t) => t.bucket))
  if (buckets.size < 2) {
    return { ...base, skippedReason: `only ${buckets.size} bucket present — no cross-bucket comparison` }
  }
  if (dryRun) return base

  const startedAt = Date.now()
  let parsed: PassCOutput | null = null
  let usage = { prompt_tokens: 0, completion_tokens: 0 }
  try {
    const completion = await openai.chat.completions.parse({
      model: SYNTHESIS_MODEL,
      ...samplingParams(SYNTHESIS_MODEL),
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      response_format: zodResponseFormat(PassCSchema, 'pass_c'),
    })
    parsed = completion.choices[0]?.message?.parsed ?? null
    if (completion.usage) {
      usage = { prompt_tokens: completion.usage.prompt_tokens, completion_tokens: completion.usage.completion_tokens }
    }
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e)
    if (persist) {
      await logAiCall(admin, { clientId, runId, pass: 'pass_c', callIndex: 1, model: SYNTHESIS_MODEL, promptVersion: PROMPT_VERSION, systemPrompt, userPrompt, response: null, error, usage, durationMs: Date.now() - startedAt, validationStatus: 'parse_error' })
    }
    throw new Error(`Pass C call failed: ${error}`)
  }

  const durationMs = Date.now() - startedAt
  const costUsd = estimateCost(SYNTHESIS_MODEL, usage.prompt_tokens, usage.completion_tokens)
  base.promptTokens = usage.prompt_tokens
  base.completionTokens = usage.completion_tokens
  base.costUsd = costUsd

  if (!parsed) {
    if (persist) {
      await logAiCall(admin, { clientId, runId, pass: 'pass_c', callIndex: 1, model: SYNTHESIS_MODEL, promptVersion: PROMPT_VERSION, systemPrompt, userPrompt, response: { refusal: true }, error: 'no parsed output', usage, durationMs, validationStatus: 'parse_error' })
    }
    return base
  }

  // Citation-relevance floor, same treatment as Pass D-a (defect 1): a cited
  // theme must be semantically related to the finding, not merely exist —
  // the 2026-07-11 padding check found ~12% of Sealand's C refs below the
  // floor. One embedding call covers all findings + cited themes; a failure
  // throws (Inngest retries) — never fail-open into unvalidated refs.
  let relevanceRejected = 0
  const themeText = (t: AggregatedTheme) => `${t.label ?? t.theme}. ${t.description ?? ''}`.trim()
  const keptRefs: string[][] = parsed.competitive_insights.map((ci) => ci.supporting_themes)
  {
    const citedLabels = [...new Set(keptRefs.flat().map((r) => r.toLowerCase().trim()))].filter((l) => byLabel.has(l))
    if (citedLabels.length) {
      const ciTexts = parsed.competitive_insights.map((ci) => `${ci.title}. ${ci.finding}`)
      const vecs = await embedTexts([...ciTexts, ...citedLabels.map((l) => themeText(byLabel.get(l)!))])
      const themeVec = new Map(citedLabels.map((l, i) => [l, vecs[ciTexts.length + i]]))
      keptRefs.forEach((refs, i) => {
        keptRefs[i] = refs.filter((r) => {
          const v = themeVec.get(r.toLowerCase().trim())
          if (!v) return true // unknown ref — counted and dropped below
          if (cosine(vecs[i], v) >= CITATION_RELEVANCE_FLOOR) return true
          relevanceRejected++
          return false
        })
      })
    }
  }

  // Map T# refs to audience_insights UUIDs; count and drop unknown indices.
  let rejectedRefs = 0
  const rows = parsed.competitive_insights.map((ci, i) => {
    const supportingIds: string[] = []
    for (const ref of keptRefs[i]) {
      const theme = byLabel.get(ref.toLowerCase().trim())
      if (!theme) {
        rejectedRefs++
        continue
      }
      supportingIds.push(...theme.supportingInsightIds)
    }
    return {
      client_id: clientId,
      run_id: runId,
      category: ci.category,
      competitor_name: ci.competitor_name,
      title: stripThemeRefs(ci.title),
      finding: stripThemeRefs(ci.finding),
      evidence: { supporting_theme_ids: [...new Set(supportingIds)] },
      impact_level: ci.impact_level,
    }
  })
  base.rejectedRefs = rejectedRefs

  if (persist) {
    if (rows.length) {
      const { data: inserted, error } = await admin
        .from('competitive_insights')
        .insert(rows)
        .select('id, category, competitor_name, title, finding, impact_level')
      if (error) throw new Error(`persist competitive_insights: ${error.message}`)
      base.competitiveInsights = (inserted ?? []) as PersistedCompetitiveInsight[]
      base.inserted = base.competitiveInsights.length
    }
    await logAiCall(admin, {
      clientId, runId, pass: 'pass_c', callIndex: 1, model: SYNTHESIS_MODEL, promptVersion: PROMPT_VERSION, systemPrompt, userPrompt,
      response: { insights: rows.length, rejected_refs: rejectedRefs, relevance_rejected: relevanceRejected },
      error: null, usage, durationMs,
      validationStatus: rejectedRefs > 0 ? 'ref_rejected' : 'ok',
    })
  } else {
    // No-persist: still surface the would-be insights (without ids) for inspection.
    base.competitiveInsights = rows.map((r) => ({ id: '(unsaved)', category: r.category, competitor_name: r.competitor_name, title: r.title, finding: r.finding, impact_level: r.impact_level }))
    base.inserted = rows.length
  }

  return base
}
