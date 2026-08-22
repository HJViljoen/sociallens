// Pure shaping for the one-screen Dashboard tiles. Everything here takes rows
// the page fetched and returns display-ready numbers — no I/O, no React — so
// it is tested in lib/dashboard-tiles.test.ts. The numbers rule holds: every
// figure is a stored count or share from run_summary / themes / snapshots,
// never re-estimated, and model scores only ever gate or order.

import { CURATION_GATE } from './curation'

// ── themes ────────────────────────────────────────────────────────────────

export interface ThemeTierRow { single_source: boolean | null; strength_score: number | null }

/** Voice's tiering: confirmed = heard in more than one conversation;
 *  early = one source but strong enough to show; the rest was heard once. */
export function themeTiers(rows: ThemeTierRow[]): { confirmed: number; early: number; once: number } {
  const confirmed = rows.filter((t) => !t.single_source).length
  const early = rows.filter((t) => t.single_source && Number(t.strength_score ?? 0) >= CURATION_GATE.earlySignalMinScore).length
  return { confirmed, early, once: rows.length - confirmed - early }
}

export interface ThemeRankRow {
  label: string
  description: string | null
  category: string
  bucket: string
  member_themes: string[] | null
  evidence_count: number
  strength_score: number | null
  rank_score?: number | null
  first_seen: boolean | null
}

export type Bucket = 'client' | 'category' | 'competitor'

/** themes.bucket is 'client' | 'industry-other' | 'competitor:<name>'. */
export function bucketKind(bucket: string | null | undefined): Bucket {
  if (bucket === 'client') return 'client'
  if (bucket?.startsWith('competitor:')) return 'competitor'
  return 'category'
}

/** Top N by rank_score (the ordering key everywhere), falling back to
 *  evidence × strength on rows written before rank_score existed. */
export function topThemes<T extends ThemeRankRow>(rows: T[], n: number, showNew: boolean) {
  const key = (t: ThemeRankRow) => t.rank_score ?? t.evidence_count * Number(t.strength_score ?? 0)
  return [...rows]
    .sort((a, b) => key(b) - key(a))
    .slice(0, n)
    .map((t) => ({
      label: t.label,
      description: t.description ?? '',
      category: t.category,
      bucket: bucketKind(t.bucket),
      memberThemes: t.member_themes ?? [],
      conversations: t.evidence_count,
      isNew: showNew && !!t.first_seen,
    }))
}

// ── platforms ─────────────────────────────────────────────────────────────

/** Videos this update by platform, most first. */
export function platformSplit(rows: { platform: string | null }[]): { platform: string; count: number }[] {
  const m = new Map<string, number>()
  for (const r of rows) {
    const p = (r.platform ?? '').toLowerCase()
    if (!p) continue
    m.set(p, (m.get(p) ?? 0) + 1)
  }
  return [...m.entries()].map(([platform, count]) => ({ platform, count })).sort((a, b) => b.count - a.count)
}

// ── sentiment ─────────────────────────────────────────────────────────────

export interface AudienceSentiment { positive: number | null; judged: number; counts?: Record<string, number> }

export function sentimentSplit(a: AudienceSentiment | null | undefined) {
  if (!a) return null
  const c = a.counts ?? {}
  const counts = {
    positive: Number(c.positive ?? 0),
    mixed: Number(c.mixed ?? 0),
    neutral: Number(c.neutral ?? 0),
    negative: Number(c.negative ?? 0),
  }
  const judged = Number(a.judged ?? 0) || counts.positive + counts.mixed + counts.neutral + counts.negative
  if (judged <= 0) return null
  const positivePct = a.positive != null ? Number(a.positive) : (counts.positive / judged) * 100
  return { counts, judged, positivePct }
}

// ── share of tracked conversation ─────────────────────────────────────────

export type Sov = Record<string, { videos: number; pct_videos: number; analysed_videos?: number }>

export interface ShareBreakdown {
  client: { pct: number; videos: number } | null
  competitors: { name: string; pct: number; videos: number }[]
  rest: { pct: number; videos: number } | null
  tracked: number
}

export function shareBreakdown(sov: Sov | null | undefined): ShareBreakdown | null {
  if (!sov || Object.keys(sov).length === 0) return null
  const client = sov.client ? { pct: Number(sov.client.pct_videos), videos: Number(sov.client.videos) } : null
  const competitors = Object.entries(sov)
    .filter(([k]) => k.startsWith('competitor:'))
    .map(([k, v]) => ({ name: k.slice('competitor:'.length), pct: Number(v.pct_videos), videos: Number(v.videos) }))
    .sort((a, b) => b.videos - a.videos)
  const rest = sov['industry-other'] ? { pct: Number(sov['industry-other'].pct_videos), videos: Number(sov['industry-other'].videos) } : null
  const tracked = Object.values(sov).reduce((t, e) => t + Number(e?.videos ?? 0), 0)
  return { client, competitors, rest, tracked }
}

/** now − prev in points, or null when either side is missing. */
export function pointDelta(now: number | null | undefined, prev: number | null | undefined): number | null {
  if (now == null || prev == null) return null
  return Math.round((now - prev) * 10) / 10
}

// ── movement over updates ─────────────────────────────────────────────────

export interface HistoryRow {
  run_id: string
  run_date: string
  total_comments: number | null
  period_comments: number | null
  share_of_voice: Sov | null
  period_share_of_voice: Sov | null
  period_sentiment_positive: number | null
  audience_sentiment: AudienceSentiment | null
  period_audience_sentiment: AudienceSentiment | null
}

export interface MovementRow {
  key: 'yourShare' | 'compShare' | 'positive' | 'volume' | 'themes'
  label: string
  series: number[]
  value: number
  /** vs the previous update */
  delta: number | null
}

export interface Movement {
  dates: string[]
  leadCompetitor: string | null
  /** period layer when every row has it, else cumulative — never mixed */
  layer: 'period' | 'cumulative'
  rows: MovementRow[]
}

/**
 * Trends' series logic, kept to its rules: a whole series comes from ONE layer
 * (period when every row carries it, else cumulative); the sentiment series
 * exists only when every row has the audience family; themes confirmed per
 * update is passed in (counted by the page). Deltas are vs the previous
 * update. Returns null below two updates — nothing to compare.
 */
export function movement(summaries: HistoryRow[], themesConfirmedByRun: Map<string, number>): Movement | null {
  if (summaries.length < 2) return null
  const allPeriod = summaries.every((s) => s.period_comments != null && s.period_share_of_voice != null && s.period_sentiment_positive != null)
  const sovOf = (s: HistoryRow) => (allPeriod ? s.period_share_of_voice : s.share_of_voice) ?? {}
  const last = summaries[summaries.length - 1]
  const comps = (s: HistoryRow) =>
    Object.entries(sovOf(s)).filter(([k]) => k.startsWith('competitor:')).map(([k, v]) => ({ name: k.slice('competitor:'.length), pct: Number(v?.pct_videos ?? 0) }))
  const leadCompetitor = comps(last).sort((a, b) => b.pct - a.pct)[0]?.name ?? null

  const yourShare = summaries.map((s) => Number(sovOf(s).client?.pct_videos ?? 0))
  const compShare = leadCompetitor ? summaries.map((s) => comps(s).find((c) => c.name === leadCompetitor)?.pct ?? 0) : null
  const audienceOf = (s: HistoryRow) => (allPeriod ? s.period_audience_sentiment : s.audience_sentiment) ?? s.audience_sentiment
  const hasSentiment = summaries.every((s) => audienceOf(s)?.positive != null)
  const positive = hasSentiment ? summaries.map((s) => Number(audienceOf(s)?.positive ?? 0)) : null
  const volume = summaries.map((s) => Number((allPeriod ? s.period_comments : s.total_comments) ?? 0))
  const themes = summaries.every((s) => themesConfirmedByRun.has(s.run_id)) ? summaries.map((s) => themesConfirmedByRun.get(s.run_id) ?? 0) : null

  const row = (key: MovementRow['key'], label: string, series: number[] | null): MovementRow | null => {
    if (!series) return null
    const n = series.length
    return { key, label, series, value: series[n - 1], delta: n >= 2 ? Math.round((series[n - 1] - series[n - 2]) * 10) / 10 : null }
  }
  const rows = [
    row('yourShare', 'Your share', yourShare),
    compShare ? row('compShare', `${leadCompetitor}’s share`, compShare) : null,
    row('positive', 'Positive sentiment', positive),
    row('volume', 'Conversations', volume),
    row('themes', 'Themes confirmed', themes),
  ].filter((r): r is MovementRow => r != null)

  return { dates: summaries.map((s) => s.run_date), leadCompetitor, layer: allPeriod ? 'period' : 'cumulative', rows }
}

// ── owned accounts ────────────────────────────────────────────────────────

export interface SnapshotRow { platform: string; snapshot_date: string; followers: number | null }

export interface AccountSeries {
  platform: string
  /** oldest → newest, within the window */
  values: number[]
  latest: number
  /** change over the window (first → last), in followers */
  delta: number
  deltaPct: number
}

/** Per-platform follower series over the last `windowDays` snapshots (one per
 *  day), platforms with ≥2 points only, most followers first. */
export function accountSeries(snaps: SnapshotRow[], windowDays = 30): AccountSeries[] {
  const by = new Map<string, SnapshotRow[]>()
  for (const s of snaps) {
    if (s.followers == null) continue
    const arr = by.get(s.platform) ?? []
    arr.push(s)
    by.set(s.platform, arr)
  }
  const out: AccountSeries[] = []
  for (const [platform, rows] of by) {
    const sorted = [...rows].sort((a, b) => a.snapshot_date.localeCompare(b.snapshot_date)).slice(-windowDays)
    if (sorted.length < 2) continue
    const values = sorted.map((r) => Number(r.followers))
    const first = values[0], latest = values[values.length - 1]
    out.push({ platform, values, latest, delta: latest - first, deltaPct: first > 0 ? ((latest - first) / first) * 100 : 0 })
  }
  return out.sort((a, b) => b.latest - a.latest)
}

// ── recommendations ───────────────────────────────────────────────────────

const PRIORITY_RANK: Record<string, number> = { high: 0, medium: 1, low: 2 }

/** Top priority first, then best-grounded (most cited insights). */
export function topRecommendation<T extends { priority: string | null; based_on: { insight_ids?: string[] } | null }>(recs: T[]): T | null {
  return [...recs].sort(
    (a, b) =>
      (PRIORITY_RANK[a.priority ?? 'low'] ?? 3) - (PRIORITY_RANK[b.priority ?? 'low'] ?? 3) ||
      (b.based_on?.insight_ids?.length ?? 0) - (a.based_on?.insight_ids?.length ?? 0),
  )[0] ?? null
}
