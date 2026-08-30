import { cosine } from '../../pipeline/cluster'
import { keywordsOf } from '../../quotes'
import type { Trajectory } from '../../voice-tiles'

/**
 * Concerns across buckets (pure). The dashboard keeps a theme inside its
 * entity bucket, by design: the registry never crosses buckets, Pass C reads
 * them apart. A sales reader does not care whose audience said it: "will
 * insurance cover it" is one concern whether it was heard on the brand's
 * videos, a competitor's, or the category's. This merges the same concern
 * across buckets, greedily from the loudest down, at most one theme per
 * bucket per concern. Two signals, measured on Össur's 30 Aug run: the same
 * concern in two buckets sits at 0.55–0.80 cosine on the stored label +
 * description embeddings (insurance 0.60–0.73, socket pain 0.76, price
 * 0.53–0.65), and above 0.70 every pair was a true merge; between the low
 * and the high bar a shared content word tells the true pairs (insurance,
 * liner, shoes, socket) from the loose ones, as long as words the whole
 * corpus uses ("prosthetic", "questions") do not count. It is a READ for the
 * researcher, not a new analysis: the member themes keep their ids, counts
 * and evidence.
 */

export interface MergeThemeRow {
  id: string
  registryId: string | null
  bucket: string
  category: string
  label: string
  description: string
  evidenceCount: number
  rankScore: number
  strengthScore: number
  singleSource: boolean
  firstSeen: boolean
  embedding: number[] | null
  supportingInsightIds: string[]
  supportingVideoIds: string[]
  dominantEmotion: string | null
  dominantSentimentImpact: string | null
}

/** What a sales reader might hear before or after a sale. Praise is read
 *  elsewhere (proof and competitor strengths); demographic signals are
 *  counted, never quoted. */
export const SALES_CATEGORIES = ['pain_point', 'question', 'purchase_intent', 'switching_signal', 'buying_trigger', 'objection', 'feature_request'] as const

export interface MergedConcern {
  /** S3: the index the writer cites. */
  id: string
  label: string
  description: string
  buckets: { bucket: string; themeId: string; label: string; evidenceCount: number }[]
  total: number
  categories: string[]
  rankScore: number
  themeIds: string[]
  registryIds: string[]
  insightIds: string[]
  videoIds: string[]
  /** "new this update" · "seen 2 updates running" · "rising" · "fading" */
  trajectory: string
}

export interface MergeOptions {
  /** Cosine at or above which two themes merge on the embedding alone. */
  threshold: number
  /** Cosine at or above which they merge when their labels also share a content word. */
  lexicalThreshold?: number
  categories?: readonly string[]
  max?: number
  trajectoryOf?: (t: MergeThemeRow) => string | null
}

/** Content words of a label that carry signal: not the words the whole pool
 *  uses. A word in more than this share of labels (or three labels, whichever
 *  is larger) is the corpus's vocabulary, not a concern's. */
export const COMMON_WORD_SHARE = 0.08

export function signalWords(labels: string[]): (label: string) => Set<string> {
  const df = new Map<string, number>()
  const per = labels.map((l) => keywordsOf(l))
  for (const ks of per) for (const k of ks) df.set(k, (df.get(k) ?? 0) + 1)
  const cap = Math.max(3, Math.ceil(labels.length * COMMON_WORD_SHARE))
  return (label: string) => new Set([...keywordsOf(label)].filter((k) => (df.get(k) ?? 0) <= cap))
}

export function mergeAcrossBuckets(themes: MergeThemeRow[], opts: MergeOptions): MergedConcern[] {
  const cats = new Set(opts.categories ?? SALES_CATEGORIES)
  const pool = themes
    .filter((t) => cats.has(t.category) && Array.isArray(t.embedding) && t.embedding.length > 0)
    .sort((a, b) => b.rankScore - a.rankScore || b.evidenceCount - a.evidenceCount || a.id.localeCompare(b.id))
  const lo = opts.lexicalThreshold ?? opts.threshold
  const wordsOf = signalWords(pool.map((t) => t.label))
  const words = new Map(pool.map((t) => [t.id, wordsOf(t.label)]))
  const shareWord = (a: MergeThemeRow, b: MergeThemeRow) => {
    const wa = words.get(a.id)!
    for (const w of words.get(b.id)!) if (wa.has(w)) return true
    return false
  }

  interface Seed { seed: MergeThemeRow; members: MergeThemeRow[] }
  const seeds: Seed[] = []
  for (const t of pool) {
    let best: { s: Seed; sim: number } | null = null
    for (const s of seeds) {
      if (s.members.some((m) => m.bucket === t.bucket)) continue
      const sim = cosine(s.seed.embedding as number[], t.embedding as number[])
      const merges = sim >= opts.threshold || (sim >= lo && shareWord(s.seed, t))
      if (merges && (!best || sim > best.sim)) best = { s, sim }
    }
    if (best) best.s.members.push(t)
    else seeds.push({ seed: t, members: [t] })
  }

  const concerns = seeds.map((s) => {
    const members = s.members
    // The client's own wording leads when the client's audience is among the
    // members: the reader sells that brand. Otherwise the loudest.
    const lead = members.find((m) => m.bucket === 'client') ?? s.seed
    const total = members.reduce((n, m) => n + m.evidenceCount, 0)
    const trajectories = opts.trajectoryOf ? members.map((m) => opts.trajectoryOf!(m)).filter((x): x is string => !!x) : []
    return {
      id: '',
      label: lead.label,
      description: lead.description || s.seed.description,
      buckets: members.map((m) => ({ bucket: m.bucket, themeId: m.id, label: m.label, evidenceCount: m.evidenceCount })),
      total,
      categories: [...new Set(members.map((m) => m.category))],
      rankScore: members.reduce((n, m) => n + m.rankScore, 0),
      themeIds: members.map((m) => m.id),
      registryIds: members.map((m) => m.registryId).filter((x): x is string => !!x),
      insightIds: [...new Set(members.flatMap((m) => m.supportingInsightIds))],
      videoIds: [...new Set(members.flatMap((m) => m.supportingVideoIds))],
      trajectory: pickTrajectory(trajectories),
    }
  })
  concerns.sort((a, b) => b.total - a.total || b.rankScore - a.rankScore || a.label.localeCompare(b.label))
  return concerns.slice(0, opts.max ?? 12).map((c, i) => ({ ...c, id: `S${i + 1}` }))
}

/** One word for a concern's history from its members' words: new beats
 *  rising beats fading beats seen-N. */
function pickTrajectory(words: string[]): string {
  if (words.length === 0) return ''
  if (words.some((w) => w.startsWith('new'))) return 'new this update'
  if (words.some((w) => w === 'rising')) return 'rising'
  if (words.some((w) => w === 'fading')) return 'fading'
  const seen = words.map((w) => /seen (\d+)/.exec(w)?.[1]).filter(Boolean).map(Number)
  if (seen.length) return `seen ${Math.max(...seen)} updates running`
  return words[0]
}

/** A theme's history in words (voice-tiles' trajectories). An arrow needs
 *  three points; before that the honest words are "new this update" or
 *  "seen N updates running". */
export function trajectoryWord(t: Trajectory | null | undefined): string | null {
  if (!t) return null
  const points = t.dates.length
  if (t.movement === 'emerging' || (points === 1 && t.strength.length === 1)) return points <= 1 ? 'new this update' : `seen ${points} updates running`
  if (points >= 3 && t.movement === 'gaining') return 'rising'
  if (points >= 3 && t.movement === 'fading') return 'fading'
  return points <= 1 ? 'new this update' : `seen ${points} updates running`
}

/** Praise and pain lists for a competitor card, from its own bucket. */
export function competitorThemes(themes: MergeThemeRow[], bucket: string): { praise: MergeThemeRow[]; hurt: MergeThemeRow[]; asks: MergeThemeRow[] } {
  const own = themes.filter((t) => t.bucket === bucket)
  const by = (cats: string[]) => own.filter((t) => cats.includes(t.category)).sort((a, b) => b.evidenceCount - a.evidenceCount || b.rankScore - a.rankScore)
  return { praise: by(['praise']).slice(0, 5), hurt: by(['pain_point', 'objection', 'feature_request', 'switching_signal']).slice(0, 6), asks: by(['question', 'purchase_intent']).slice(0, 4) }
}
