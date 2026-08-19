// Pass E support — the pure half of the consumer profile.
//
// The model proposes personas and cites the themes each one rests on; this file
// turns those citations into counted grounding and then enforces the evidence
// floors. It is deliberately separate from pass-e.ts so the rule that matters
// most — a persona is a grouping of counted insights, never a character — is
// pure logic with tests rather than something buried in an I/O function.
//
// The product contract (.agents/product-marketing.md) bans invented personas.
// So a proposal that cannot be grounded is dropped WITH ITS REASON rather than
// shown thin: "we found nothing" and "we found it and dropped it" are different
// facts, and the operator tuning the floors needs to tell them apart.

import { PREVALENCE_LABEL, prevalenceTier } from '../calibration'
import { normForMatch } from './quote-match'

/** Keep only phrases that really were said.
 *
 *  The model is shown validated language samples and asked to reuse them, but
 *  "asked to" is not a guarantee: a paraphrase rendered under a quote icon is
 *  an invented verbatim, which is the one thing this feature must never do.
 *  Matching is normalised (case, curly quotes, emoji, whitespace) exactly as
 *  Pass A validates evidence. */
export function filterToRealPhrases(phrases: string[], valid: Set<string> | undefined): string[] {
  if (!valid?.size) return []
  const index = [...valid].map((v) => normForMatch(v)).filter(Boolean)
  return phrases.filter((p) => {
    const n = normForMatch(p)
    return n.length > 0 && index.some((v) => v.includes(n) || n.includes(v))
  })
}

/** Bracket refs come back in whatever surface form the model felt like:
 *  `T12`, `[T12]`, `t12 `. Every other pass normalises the same way
 *  (pass-d.ts:80 does it for [S#]), because a ref that fails to resolve on
 *  punctuation silently un-grounds a whole finding — which is exactly what it
 *  did here on the second real Ossur run: five good personas, zero resolved. */
export function normaliseRef(ref: string): string {
  return String(ref ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')
}

/** One theme as the synthesis prompt sees it: a bracket ref the model can cite,
 *  plus the grounding that ref resolves back to. */
export interface ThemeDigestRow {
  ref: string
  themeId: string
  registryId: string | null
  bucket: string
  category: string
  label: string
  description: string
  emotion: string | null
  sentimentImpact: string | null
  evidenceCount: number
  insightIds: string[]
  videoIds: string[]
}

/** A theme row as it comes out of the `themes` table (only the fields used). */
export interface ThemeInput {
  id: string
  registry_id?: string | null
  bucket?: string | null
  category?: string | null
  label?: string | null
  description?: string | null
  dominant_emotion?: string | null
  dominant_sentiment_impact?: string | null
  evidence_count?: number | null
  supporting_insight_ids?: string[] | null
  supporting_video_ids?: string[] | null
}

/** What the model returns per persona, before grounding. */
export interface RawPersona {
  key: string
  name: string
  one_liner: string
  scope: string
  theme_refs: string[]
  wants: string
  blockers: string
  triggers: string
  how_they_talk: string[]
}

export type PersonaScope = 'category' | 'client'

export interface GroundedPersona {
  key: string
  name: string
  oneLiner: string
  scope: PersonaScope
  wants: string
  blockers: string
  triggers: string
  howTheyTalk: string[]
  /** Demographic signals COUNTED from this persona's own demographic_signal
   *  insights — never model-supplied, never quoted (counts-not-quotes). */
  who: { signal: string; count: number }[]
  themeIds: string[]
  registryIds: string[]
  insightIds: string[]
  evidenceCount: number
  sourceVideoCount: number
  bucketMix: Record<string, number>
  /** Calibrated word, never a score (lib/calibration.ts). */
  prevalence: string
  unknownRefs: string[]
}

export interface DroppedPersona {
  name: string
  reason: 'no-themes' | 'no-content' | 'below-insight-floor' | 'below-video-floor' | 'over-cap'
  evidenceCount: number
  sourceVideoCount: number
}

export interface GroundOptions {
  minInsights: number
  minVideos: number
  maxPersonas: number
  /** insight id -> its demographic_signal theme slug, for the counted `who`
   *  block. Only demographic_signal insights belong in here. */
  demographicsByInsightId?: Map<string, string>
  /** Ids of insights that still exist. Cited evidence is intersected with this
   *  so a persona can never be counted on rows a later run pruned. */
  livePopulationIds?: Set<string>
  /** Phrases Pass A already validated as exact copies of real comments. A
   *  `how_they_talk` entry that is not one of these is model prose, and the
   *  page presents that block as things people said. */
  validPhrases?: Set<string>
}

/** Floor for a demographic signal to be shown at all.
 *
 *  Pass A writes demographic_signal insights with free-text slugs, and on real
 *  Ossur data those slugs are near-duplicates at slug level — "amputee swimming
 *  experience", "amputee water users", "amputee beach users" are three slugs
 *  for one fact, so counting by slug produces a long tail of 1s. Until those
 *  are clustered, a signal seen once is noise dressed as a statistic. Showing
 *  nothing is the honest state, and the page renders it as such. */
export const WHO_MIN_COUNT = 2

/** Count the demographic signals a persona's own evidence actually reveals.
 *
 *  This is code, not prompt, on purpose: the first real run had the model
 *  return `count: 1` for every signal it named. A count the model chose is a
 *  guess wearing a number, and the page renders these as facts. */
export function countDemographics(
  insightIds: string[],
  byInsightId: Map<string, string> | undefined,
  minCount = WHO_MIN_COUNT,
): { signal: string; count: number }[] {
  if (!byInsightId?.size) return []
  const tally = new Map<string, number>()
  for (const id of insightIds) {
    const signal = byInsightId.get(id)
    if (!signal) continue
    tally.set(signal, (tally.get(signal) ?? 0) + 1)
  }
  return [...tally.entries()]
    .filter(([, count]) => count >= minCount)
    .map(([signal, count]) => ({ signal, count }))
    .sort((a, b) => b.count - a.count || a.signal.localeCompare(b.signal))
}

/** Calibrated prevalence, assigned AFTER the floors so the denominator is the
 *  profiled population rather than the whole corpus.
 *
 *  Against the corpus every persona read "Recurring" on the first real run —
 *  a word that cannot discriminate is decoration. Relative to the people the
 *  profile actually describes, the ladder separates them. */
export function assignPrevalence(kept: GroundedPersona[]): GroundedPersona[] {
  const denom = new Set(kept.flatMap((p) => p.insightIds)).size
  return kept.map((p) => ({
    ...p,
    prevalence: PREVALENCE_LABEL[prevalenceTier(p.evidenceCount, Math.max(1, denom))],
  }))
}

/**
 * Build the theme digest the prompt shows the model.
 *
 * Themes are ordered by evidence so that when a run has more themes than the
 * prompt can carry, the ones dropped are the weakest — a large run loses its
 * tail, never its spine. Themes with no supporting insights are skipped
 * outright: they cannot ground anything, so offering them as citable refs only
 * invites a persona that resolves to nothing.
 */
export function buildThemeDigest(
  themes: ThemeInput[],
  opts: { maxThemes: number },
): { rows: ThemeDigestRow[]; byRef: Map<string, ThemeDigestRow> } {
  const usable = themes.filter((t) => (t.supporting_insight_ids?.length ?? 0) > 0)
  const ordered = [...usable].sort(
    (a, b) => (b.evidence_count ?? 0) - (a.evidence_count ?? 0) || String(a.id).localeCompare(String(b.id)),
  )
  const rows: ThemeDigestRow[] = ordered.slice(0, Math.max(0, opts.maxThemes)).map((t, i) => ({
    ref: `T${i + 1}`,
    themeId: t.id,
    registryId: t.registry_id ?? null,
    bucket: t.bucket ?? 'industry-other',
    category: t.category ?? 'unknown',
    label: t.label ?? '',
    description: t.description ?? '',
    emotion: t.dominant_emotion ?? null,
    sentimentImpact: t.dominant_sentiment_impact ?? null,
    evidenceCount: t.evidence_count ?? 0,
    insightIds: t.supporting_insight_ids ?? [],
    videoIds: t.supporting_video_ids ?? [],
  }))
  const byRef = new Map(rows.map((r) => [normaliseRef(r.ref), r]))
  return { rows, byRef }
}

export interface PopulationCounts {
  byCategory: Record<string, number>
  byJourneyStage: Record<string, number>
  byEmotion: Record<string, number>
  byBucket: Record<string, number>
  total: number
}

/** Insight row shape used for the population counts (only the fields used). */
export interface InsightInput {
  category?: string | null
  journey_stage?: string | null
  emotion?: string | null
}

/**
 * Aggregate counts the prompt shows alongside the themes, so the model reasons
 * about the shape of the whole population rather than only the themes that fit.
 *
 * `bucketOf` is passed in because an insight does not carry its entity bucket —
 * it is a property of the source video (lib/pipeline/step-a2.ts), reconstructed
 * by the caller. Insights with no known bucket are counted as unattributed
 * rather than silently assigned to the category bucket.
 */
export function buildPopulationCounts(
  insights: InsightInput[],
  buckets: (string | null)[] = [],
): PopulationCounts {
  const counts: PopulationCounts = {
    byCategory: {},
    byJourneyStage: {},
    byEmotion: {},
    byBucket: {},
    total: insights.length,
  }
  const bump = (rec: Record<string, number>, key: string | null | undefined, fallback: string) => {
    const k = key && key.trim() ? key : fallback
    rec[k] = (rec[k] ?? 0) + 1
  }
  insights.forEach((ins, i) => {
    bump(counts.byCategory, ins.category, 'unknown')
    bump(counts.byJourneyStage, ins.journey_stage, 'unstated')
    bump(counts.byEmotion, ins.emotion, 'unknown')
    bump(counts.byBucket, buckets[i], 'unattributed')
  })
  return counts
}

const SCOPES: PersonaScope[] = ['category', 'client']

function normaliseScope(scope: string): PersonaScope {
  return SCOPES.includes(scope as PersonaScope) ? (scope as PersonaScope) : 'category'
}

/** The key is a URL selector and a React key. The model supplies it, so it can
 *  be empty or repeated; either breaks the switcher silently. */
function safeKey(key: string, name: string, index: number): string {
  const base = String(key ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  if (base) return base
  const fromName = String(name ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  return fromName || `persona-${index + 1}`
}

function uniq(values: string[]): string[] {
  return [...new Set(values.filter((v) => typeof v === 'string' && v.length > 0))]
}

/**
 * Resolve each persona's theme citations into counted grounding, then apply the
 * evidence floors.
 *
 * Unknown refs are dropped and recorded, never thrown on — the same lenient
 * contract every other pass uses for bracket refs (pass-c/pass-d resolve refs
 * post-parse and count what they could not match). A persona left with no
 * resolvable theme is dropped: it is a character, not a finding.
 *
 * The cap applies per scope, so a strong client persona is never squeezed out
 * by five category ones.
 */
export function groundPersonas(
  raw: RawPersona[],
  byRef: Map<string, ThemeDigestRow>,
  opts: GroundOptions,
): { kept: GroundedPersona[]; dropped: DroppedPersona[] } {
  const kept: GroundedPersona[] = []
  const dropped: DroppedPersona[] = []

  const grounded = raw.map((p, index) => {
    // Dedupe AFTER normalising: "T1", "[T1]" and "t1" are three strings for one
    // theme, and counting them three times inflated bucketMix and themeIds.
    const refs = uniq(p.theme_refs ?? [])
    const seenRefs = new Set<string>()
    const hits: ThemeDigestRow[] = []
    for (const r of refs) {
      const norm = normaliseRef(r)
      if (seenRefs.has(norm)) continue
      const hit = byRef.get(norm)
      if (!hit) continue
      seenRefs.add(norm)
      hits.push(hit)
    }
    const unknownRefs = refs.filter((r) => !byRef.has(normaliseRef(r)))
    // Intersect with the population that still EXISTS. themes rows outlive the
    // insights they cite — prune-stale-analysis deletes superseded
    // audience_insights after each run — so profiling an older run (the
    // documented offline mode) would otherwise count evidence that is gone.
    const live = opts.livePopulationIds
    const cited = uniq(hits.flatMap((h) => h.insightIds))
    const insightIds = live ? cited.filter((id) => live.has(id)) : cited
    const videoIds = uniq(hits.flatMap((h) => h.videoIds))
    const kept = new Set(insightIds)
    const bucketMix: Record<string, number> = {}
    for (const h of hits) {
      const n = h.insightIds.filter((id) => kept.has(id)).length
      if (n > 0) bucketMix[h.bucket] = (bucketMix[h.bucket] ?? 0) + n
    }
    const evidenceCount = insightIds.length
    const persona: GroundedPersona = {
      key: safeKey(p.key, p.name, index),
      name: p.name,
      oneLiner: p.one_liner,
      scope: normaliseScope(p.scope),
      wants: p.wants ?? '',
      blockers: p.blockers ?? '',
      triggers: p.triggers ?? '',
      howTheyTalk: filterToRealPhrases(p.how_they_talk ?? [], opts.validPhrases),
      who: countDemographics(insightIds, opts.demographicsByInsightId),
      themeIds: hits.map((h) => h.themeId),
      registryIds: hits.map((h) => h.registryId).filter((v): v is string => Boolean(v)),
      insightIds,
      evidenceCount,
      sourceVideoCount: videoIds.length,
      bucketMix,
      // Placeholder — assignPrevalence sets the real word once the floors have
      // decided who is in the profile (the denominator depends on that).
      prevalence: '',
      unknownRefs,
    }
    return { persona, hitCount: hits.length }
  })

  const survivors: GroundedPersona[] = []
  const usedKeys = new Set<string>()
  for (const { persona, hitCount } of grounded) {
    if (usedKeys.has(persona.key)) persona.key = `${persona.key}-${usedKeys.size + 1}`
    usedKeys.add(persona.key)
    if (hitCount === 0) {
      dropped.push({ name: persona.name, reason: 'no-themes', evidenceCount: 0, sourceVideoCount: 0 })
      continue
    }
    // A persona with nothing to say is a drawing with a name on it. The floors
    // below check evidence; this checks that the evidence produced content.
    if (!persona.wants.length && !persona.blockers.length && !persona.triggers.length) {
      dropped.push({ name: persona.name, reason: 'no-content', evidenceCount: persona.evidenceCount, sourceVideoCount: persona.sourceVideoCount })
      continue
    }
    if (persona.evidenceCount < opts.minInsights) {
      dropped.push({
        name: persona.name,
        reason: 'below-insight-floor',
        evidenceCount: persona.evidenceCount,
        sourceVideoCount: persona.sourceVideoCount,
      })
      continue
    }
    if (persona.sourceVideoCount < opts.minVideos) {
      dropped.push({
        name: persona.name,
        reason: 'below-video-floor',
        evidenceCount: persona.evidenceCount,
        sourceVideoCount: persona.sourceVideoCount,
      })
      continue
    }
    survivors.push(persona)
  }

  for (const scope of SCOPES) {
    const inScope = survivors
      .filter((p) => p.scope === scope)
      .sort((a, b) => b.evidenceCount - a.evidenceCount || a.key.localeCompare(b.key))
    kept.push(...inScope.slice(0, opts.maxPersonas))
    for (const over of inScope.slice(opts.maxPersonas)) {
      dropped.push({
        name: over.name,
        reason: 'over-cap',
        evidenceCount: over.evidenceCount,
        sourceVideoCount: over.sourceVideoCount,
      })
    }
  }

  return { kept: assignPrevalence(kept), dropped }
}
