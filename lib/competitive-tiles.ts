// Pure shaping for the one-screen Competitive page (the face-off). Everything
// here takes rows the page fetched and returns display-ready numbers — no I/O,
// no React — so it is tested in lib/competitive-tiles.test.ts. The numbers rule
// holds: every figure is a stored count or share (run_summary share_of_voice,
// videos, themes), never re-estimated; model scores only gate and order.

import type { Sov, HistoryRow } from './dashboard-tiles'
import { COMPETITIVE_MIN_VIDEOS } from './config'

// ── who we face ───────────────────────────────────────────────────────────

export interface CompetitorShare { name: string; videos: number; pct: number }

/** Competitor buckets of a share_of_voice map, most videos first. */
export function competitorShares(sov: Sov | null | undefined): CompetitorShare[] {
  if (!sov) return []
  return Object.entries(sov)
    .filter(([k]) => k.startsWith('competitor:'))
    .map(([k, v]) => ({ name: k.slice('competitor:'.length), videos: Number(v?.videos ?? 0), pct: Number(v?.pct_videos ?? 0) }))
    .sort((a, b) => b.videos - a.videos || a.name.localeCompare(b.name))
}

/** The competitor the page faces: the reader's pick (?vs=) when it names a
 *  tracked bucket (case-insensitive), else the one with the most videos in the
 *  latest update — Trends' "lead competitor" rule. Null when none is tracked. */
export function leadCompetitor(sov: Sov | null | undefined, preferred?: string | null): string | null {
  const comps = competitorShares(sov)
  if (comps.length === 0) return null
  if (preferred) {
    const want = preferred.trim().toLowerCase()
    const hit = comps.find((c) => c.name.toLowerCase() === want)
    if (hit) return hit.name
  }
  return comps[0].name
}

export const competitorBucket = (name: string) => `competitor:${name}`

// ── per-bucket stats from this update's videos ────────────────────────────

export interface VideoStatRow {
  is_client: boolean | null
  is_competitor: boolean | null
  competitor_name: string | null
  comments_count: number | null
  engagement_rate: number | null
  sentiment: string | null
  sentiment_source?: string | null
  analyzed_lane?: string | null
}

export interface BucketStats {
  videos: number
  /** platform-reported comments under the bucket's videos */
  comments: number
  /** mean engagement_rate across videos that carry one (the Content page's scoreboard rule) */
  avgEngagement: number | null
  engagementN: number
  /** audience-family sentiment only (how commenters received the video) */
  judged: number
  positive: number
}

/** videos.is_client / is_competitor / competitor_name → the share_of_voice bucket key. */
export function videoBucket(v: Pick<VideoStatRow, 'is_client' | 'is_competitor' | 'competitor_name'>): string {
  if (v.is_client) return 'client'
  if (v.is_competitor) return competitorBucket(v.competitor_name ?? 'unknown')
  return 'industry-other'
}

/** Pass A's audience family: provenance when stamped, else the lane (only the
 *  full lane reads comments) — the same rule run_summary applies. */
export function isAudienceSentiment(v: Pick<VideoStatRow, 'sentiment_source' | 'analyzed_lane'>): boolean {
  if (v.sentiment_source === 'audience') return true
  if (v.sentiment_source === 'framing') return false
  return v.analyzed_lane === 'full'
}

const SENTIMENTS = new Set(['positive', 'negative', 'neutral', 'mixed'])

export function bucketStats(rows: VideoStatRow[]): Map<string, BucketStats> {
  const out = new Map<string, BucketStats>()
  for (const v of rows) {
    const key = videoBucket(v)
    const s = out.get(key) ?? { videos: 0, comments: 0, avgEngagement: null, engagementN: 0, judged: 0, positive: 0 }
    s.videos += 1
    s.comments += Number(v.comments_count ?? 0)
    const eng = Number(v.engagement_rate)
    if (eng > 0) {
      s.avgEngagement = ((s.avgEngagement ?? 0) * s.engagementN + eng) / (s.engagementN + 1)
      s.engagementN += 1
    }
    if (v.sentiment && SENTIMENTS.has(v.sentiment) && isAudienceSentiment(v)) {
      s.judged += 1
      if (v.sentiment === 'positive') s.positive += 1
    }
    out.set(key, s)
  }
  return out
}

/** Themes per bucket for one update. */
export function themeCounts(rows: { bucket: string | null }[]): Map<string, number> {
  const m = new Map<string, number>()
  for (const r of rows) {
    const b = r.bucket ?? 'industry-other'
    m.set(b, (m.get(b) ?? 0) + 1)
  }
  return m
}

// ── the face-off rows ─────────────────────────────────────────────────────

/** Fewer rated videos than this on either side and the sentiment row is
 *  dropped — a share of three videos is not a sentiment. */
export const SENTIMENT_MIN_JUDGED = 5

export interface FaceOffSide { value: number; text: string }

export interface FaceOffRow {
  key: 'videos' | 'comments' | 'share' | 'engagement' | 'sentiment' | 'themes'
  label: string
  you: FaceOffSide
  them: FaceOffSide
  /** bar lengths, 0–100 of the larger of the pair (2 keeps a zero visible) */
  youPct: number
  themPct: number
}

/** Scale a pair to the larger of the two; a zero keeps a 2% sliver so the
 *  reader sees the side exists. Both zero → both slivers. */
export function pairScale(a: number, b: number): { a: number; b: number } {
  const mx = Math.max(a, b)
  const s = (n: number) => (mx > 0 ? Math.max(2, Math.min(100, (n / mx) * 100)) : 2)
  return { a: s(a), b: s(b) }
}

export interface FaceOffInput {
  /** the share map the videos + share rows are read from */
  sov: Sov | null | undefined
  /** which layer that map is — decides the videos row's label */
  layer: 'period' | 'cumulative'
  competitor: string
  /** this update's videos by bucket (null when the update gathered none) */
  stats: Map<string, BucketStats> | null
  /** themes by bucket for the latest themed update (null when none) */
  themes: Map<string, number> | null
  fmtInt: (n: number) => string
  fmtPct: (n: number, decimals?: 0 | 1) => string
}

/**
 * The six butterfly rows, each grounded or dropped — never fabricated:
 * videos + share from share_of_voice; comments, engagement and positive
 * sentiment from this update's videos; themes from the latest themed update.
 */
export function faceOffRows(input: FaceOffInput): FaceOffRow[] {
  const { sov, layer, competitor, stats, themes, fmtInt, fmtPct } = input
  const themKey = competitorBucket(competitor)
  const rows: FaceOffRow[] = []
  const row = (key: FaceOffRow['key'], label: string, a: number, b: number, fa: string, fb: string) => {
    const sc = pairScale(a, b)
    rows.push({ key, label, you: { value: a, text: fa }, them: { value: b, text: fb }, youPct: sc.a, themPct: sc.b })
  }

  const you = sov?.client
  const them = sov?.[themKey]
  if (sov && (you || them)) {
    const a = Number(you?.videos ?? 0), b = Number(them?.videos ?? 0)
    row('videos', layer === 'period' ? 'Videos this update' : 'Videos tracked', a, b, fmtInt(a), fmtInt(b))
  }
  const ys = stats?.get('client'), ts = stats?.get(themKey)
  if (stats && (ys || ts)) {
    const a = ys?.comments ?? 0, b = ts?.comments ?? 0
    row('comments', 'Comments under them', a, b, fmtInt(a), fmtInt(b))
  }
  if (sov && (you || them)) {
    const a = Number(you?.pct_videos ?? 0), b = Number(them?.pct_videos ?? 0)
    row('share', 'Share of tracked conversation', a, b, fmtPct(a), fmtPct(b))
  }
  if (ys?.avgEngagement != null && ts?.avgEngagement != null) {
    row('engagement', 'Engagement per video', ys.avgEngagement, ts.avgEngagement, fmtPct(ys.avgEngagement), fmtPct(ts.avgEngagement))
  }
  if (ys && ts && ys.judged >= SENTIMENT_MIN_JUDGED && ts.judged >= SENTIMENT_MIN_JUDGED) {
    const a = (ys.positive / ys.judged) * 100, b = (ts.positive / ts.judged) * 100
    row('sentiment', 'Positive sentiment', a, b, fmtPct(a, 0), fmtPct(b, 0))
  }
  if (themes && themes.size > 0) {
    const a = themes.get('client') ?? 0, b = themes.get(themKey) ?? 0
    row('themes', 'Themes heard', a, b, fmtInt(a), fmtInt(b))
  }
  return rows
}

// ── "praised for …" ───────────────────────────────────────────────────────

export interface PraiseThemeRow {
  bucket: string | null
  category: string
  label: string
  evidence_count: number | null
  strength_score: number | null
  rank_score?: number | null
}

/** The bucket's top praise theme by rank_score (evidence × strength before
 *  rank_score existed) — a counted "praised for", not a sentence a model wrote
 *  about the comparison. Null when the bucket has no praise theme. */
export function praisedFor(rows: PraiseThemeRow[], bucket: string): string | null {
  const key = (t: PraiseThemeRow) => t.rank_score ?? Number(t.evidence_count ?? 0) * Number(t.strength_score ?? 0)
  const top = rows
    .filter((t) => t.bucket === bucket && t.category === 'praise' && t.label)
    .sort((a, b) => key(b) - key(a))[0]
  return top ? top.label : null
}

// ── share of tracked conversation over time ───────────────────────────────

export interface ShareSeries {
  /** ONE layer for the whole series — period when every row carries it, else cumulative */
  layer: 'period' | 'cumulative'
  dates: string[]
  you: number[]
  them: number[] | null
  /** first → last, in points */
  youDelta: number
  themDelta: number | null
}

const hasKeys = (o: Sov | null | undefined) => !!o && Object.keys(o).length > 0

/** You vs the faced competitor across every update (Trends' series rule, ported):
 *  null below two updates — nothing to draw. */
export function shareSeries(history: Pick<HistoryRow, 'run_date' | 'share_of_voice' | 'period_share_of_voice'>[], competitor: string | null): ShareSeries | null {
  if (history.length < 2) return null
  const allPeriod = history.every((s) => hasKeys(s.period_share_of_voice))
  const sovOf = (s: (typeof history)[number]) => (allPeriod ? s.period_share_of_voice : s.share_of_voice) ?? {}
  const you = history.map((s) => Number(sovOf(s).client?.pct_videos ?? 0))
  const them = competitor ? history.map((s) => Number(sovOf(s)[competitorBucket(competitor)]?.pct_videos ?? 0)) : null
  const delta = (arr: number[]) => Math.round((arr[arr.length - 1] - arr[0]) * 10) / 10
  return {
    layer: allPeriod ? 'period' : 'cumulative',
    dates: history.map((s) => s.run_date),
    you,
    them,
    youDelta: delta(you),
    themDelta: them ? delta(them) : null,
  }
}

// ── the findings ──────────────────────────────────────────────────────────

/** Reading order: lead with strength, then threats, gaps, tone; anything the
 *  model files elsewhere comes last. */
export const CATEGORY_ORDER = ['topic_ownership', 'competitive_threat', 'content_gap', 'sentiment_differential', 'engagement_benchmark', 'notable_account', 'organic_vs_paid'] as const

export type KindTone = 'lead' | 'threat' | 'gap' | 'tone' | 'other'

export interface Kind { label: string; tone: KindTone; blurb: string }

const KINDS: Record<string, Kind> = {
  topic_ownership: { label: 'Where you lead', tone: 'lead', blurb: 'themes your audience raises that the others’ don’t' },
  competitive_threat: { label: 'Threat', tone: 'threat', blurb: 'where a competitor has an edge, momentum or controversy' },
  content_gap: { label: 'Content gap', tone: 'gap', blurb: 'what competitors’ audiences care about that yours doesn’t hear from you' },
  sentiment_differential: { label: 'Sentiment differential', tone: 'tone', blurb: 'the same topic, a different emotional tone across brands' },
  engagement_benchmark: { label: 'Engagement benchmark', tone: 'other', blurb: 'a cross-brand performance contrast' },
  notable_account: { label: 'Account to watch', tone: 'other', blurb: 'a high-signal account in the category' },
  organic_vs_paid: { label: 'Organic vs paid', tone: 'other', blurb: 'how the conversation splits between earned and paid' },
}

export function kindOf(category: string | null | undefined): Kind {
  if (category && KINDS[category]) return KINDS[category]
  const label = (category ?? 'finding').replace(/_/g, ' ')
  return { label: label.charAt(0).toUpperCase() + label.slice(1), tone: 'other', blurb: '' }
}

const IMPACT_RANK: Record<string, number> = { high: 0, medium: 1, low: 2 }

/** Kinds in CATEGORY_ORDER, highest impact first within a kind — the same
 *  order on the tile (capped) and in the drawer (everything). */
export function orderInsights<T extends { category: string; impact_level: string | null }>(insights: T[]): T[] {
  const rank = (c: string) => { const i = (CATEGORY_ORDER as readonly string[]).indexOf(c); return i < 0 ? CATEGORY_ORDER.length : i }
  return [...insights].sort((a, b) =>
    rank(a.category) - rank(b.category) ||
    (IMPACT_RANK[a.impact_level ?? 'low'] ?? 3) - (IMPACT_RANK[b.impact_level ?? 'low'] ?? 3),
  )
}

/** Group ordered insights by kind, for the drawer. */
export function groupByKind<T extends { category: string; impact_level: string | null }>(insights: T[]): { category: string; kind: Kind; items: T[] }[] {
  const groups: { category: string; kind: Kind; items: T[] }[] = []
  for (const ci of orderInsights(insights)) {
    const g = groups.find((x) => x.category === ci.category)
    if (g) g.items.push(ci)
    else groups.push({ category: ci.category, kind: kindOf(ci.category), items: [ci] })
  }
  return groups
}

/** How much conversation a finding's named competitor rests on: the videos in
 *  its bucket that produced something readable (analysed_videos, falling back to
 *  the gathered count). NULL — not 0 — when the model's name matches no tracked
 *  bucket ("Ottobock GmbH" vs a bucket called "Ottobock"), so a mismatch says
 *  nothing rather than "thin: 0 videos". */
export function coverageOf(sov: Sov | null | undefined, competitorName: string | null | undefined): number | null {
  if (!sov || !competitorName) return null
  const want = competitorBucket(competitorName.trim()).toLowerCase()
  const hit = Object.entries(sov).find(([k]) => k.toLowerCase() === want)
  if (!hit) return null
  const e = hit[1]
  return Number(e?.analysed_videos ?? e?.videos ?? 0)
}

/** The coverage chip: the thin rule Pass C is held to, shown to the reader. */
export function coverageText(coverage: number | null): { text: string; thin: boolean } | null {
  if (coverage == null) return null
  const thin = coverage < COMPETITIVE_MIN_VIDEOS
  const n = `${coverage} video${coverage === 1 ? '' : 's'}`
  return { text: thin ? `${n} · thin` : n, thin }
}

// ── links ─────────────────────────────────────────────────────────────────

/** The page's own path with its ?vs= pick kept, plus an optional drawer id. */
export function competitiveHref(vs: string | null, detail?: string): string {
  const q: string[] = []
  if (vs) q.push(`vs=${encodeURIComponent(vs)}`)
  if (detail) q.push(`detail=${detail}`)
  return `/dashboard/competitive${q.length ? `?${q.join('&')}` : ''}`
}
