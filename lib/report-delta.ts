import type { createAdminClient } from './supabase-admin'
import type { CiSummary } from './pipeline/schemas'
import { proportionDelta, SENTIMENT_BAND, SHARE_BAND, type DeltaVerdict } from './report-bands'

// Week-over-week delta for the report's "what changed" block (Redesign Spec §7).
// Computed from consecutive run_summary rows — no genealogy: the previous row is
// simply the latest one dated before the current run's. Every field degrades to
// null independently, so a first report (no previous row) or a metric missing on
// either side hides just that line, never the report.

type Admin = ReturnType<typeof createAdminClient>

interface SovEntry {
  videos: number
  views: number
  pct_videos: number
}

/** One sentiment family as run_summary stores it (T0-8). */
export interface SentimentFamilyRow {
  positive: number | null
  neutral: number | null
  negative: number | null
  judged: number
}

export interface RunSummaryRow {
  run_id: string
  run_date: string
  period: string | null
  total_videos: number | null
  total_comments: number | null
  overall_sentiment_positive: string | number | null
  share_of_voice: Record<string, SovEntry> | null
  /** Period (this-run-only) metrics — preferred for deltas since 2026-07-09:
   *  diffing the cumulative columns compared all-time stocks, which damped
   *  toward zero as the corpus grew. Null on rows written before the split. */
  period_videos: number | null
  period_comments: number | null
  period_sentiment_positive: string | number | null
  period_share_of_voice: Record<string, SovEntry> | null
  /** Audience sentiment (Pass A full lane only) — the only family a client
   *  number may come from. Null on rows written before 2026-08-18, whose
   *  overall_sentiment_* blended audience with classify-meta framing. */
  audience_sentiment: SentimentFamilyRow | null
  period_audience_sentiment: SentimentFamilyRow | null
  consumer_intelligence_summary: CiSummary | null
}

const SUMMARY_COLS =
  'run_id, run_date, period, total_videos, total_comments, overall_sentiment_positive, share_of_voice, period_videos, period_comments, period_sentiment_positive, period_share_of_voice, audience_sentiment, period_audience_sentiment, consumer_intelligence_summary'

export interface ShareSide {
  /** Client's share of tracked videos, %. */
  client: number
  /** Videos in the client's own bucket — the numerator, for the floor. */
  clientVideos: number
  /** Videos in the whole tracked set — the denominator, for the floor and label. */
  totalVideos: number
  /** Largest tracked competitor by share, if any competitor is tracked. */
  competitor: { name: string; pct: number } | null
}

export interface RunDelta {
  prevRunDate: string
  /** Audience-sentiment share, now vs the previous update, with the verdict
   *  that decides whether it may be shown as movement (T0-8). `judged` are the
   *  denominators the verdict rests on. */
  sentiment: { now: number; prev: number; verdict: DeltaVerdict; nowJudged: number; prevJudged: number } | null
  share: { now: ShareSide; prev: ShareSide; verdict: DeltaVerdict } | null
  /** Confirmed (multi-source) themes genuinely new this update. Null until the
   *  theme registry holds at least MIN_REGISTRY_OBSERVATIONS observations for
   *  the client — before that "new" is ~83-88% relabelling, not new themes. */
  newThemes: { count: number; labels: string[] } | null
  conversations: { now: number; prev: number } | null
}

/** A client needs this many registry observations before "N new themes" means
 *  anything: with one observation every theme is trivially first-seen, and the
 *  pre-registry label-embedding rule flagged 48 of 58 "new" themes that were
 *  relabels of existing ones. Seeded on the first run under THEME_REGISTRY, so
 *  the honest count starts at the second (Össur: 30 Aug). */
export const MIN_REGISTRY_OBSERVATIONS = 2

const num = (v: string | number | null | undefined): number | null => {
  if (v == null) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

export async function loadRunSummary(
  admin: Admin,
  clientId: string,
  runId: string,
): Promise<RunSummaryRow | null> {
  const { data } = await admin
    .from('run_summary')
    .select(SUMMARY_COLS)
    .eq('client_id', clientId)
    .eq('run_id', runId)
    .maybeSingle()
  return (data as RunSummaryRow | null) ?? null
}

/** Client + top-competitor share out of a share_of_voice map. `totalVideos`
 *  is the map's own denominator (every bucket summed), so the label can state
 *  the n the share is out of and the band can apply a floor to it. */
export function readShare(sov: Record<string, SovEntry> | null): ShareSide | null {
  if (!sov || !sov.client) return null
  let competitor: ShareSide['competitor'] = null
  let totalVideos = 0
  for (const [key, entry] of Object.entries(sov)) {
    totalVideos += Number(entry?.videos ?? 0)
    if (!key.startsWith('competitor:')) continue
    const pct = num(entry?.pct_videos)
    if (pct == null) continue
    if (!competitor || pct > competitor.pct) competitor = { name: key.slice('competitor:'.length), pct }
  }
  const client = num(sov.client.pct_videos)
  if (client == null) return null
  return { client, clientVideos: Number(sov.client.videos ?? 0), totalVideos, competitor }
}

/** The sentiment family a row may be reported from: audience only, period
 *  layer when both sides have it. Null when either side predates the split —
 *  those rows blended framing into the number and are not comparable. */
function audienceSides(current: RunSummaryRow, prev: RunSummaryRow):
  { now: SentimentFamilyRow; prev: SentimentFamilyRow } | null {
  const usePeriod = current.period_audience_sentiment != null && prev.period_audience_sentiment != null
  const nowRow = usePeriod ? current.period_audience_sentiment : current.audience_sentiment
  const prevRow = usePeriod ? prev.period_audience_sentiment : prev.audience_sentiment
  if (!nowRow || !prevRow) return null
  if (nowRow.positive == null || prevRow.positive == null) return null
  return { now: nowRow, prev: prevRow }
}

export async function computeRunDelta(
  admin: Admin,
  clientId: string,
  current: RunSummaryRow,
): Promise<RunDelta | null> {
  const { data: prev } = await admin
    .from('run_summary')
    .select(SUMMARY_COLS)
    .eq('client_id', clientId)
    .lt('run_date', current.run_date)
    .order('run_date', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (!prev) return null
  const prevRow = prev as RunSummaryRow

  // Sentiment: audience family only, period layer when both sides carry it.
  // A verdict, not a raw difference — floors (>= 100 judged per side) and a
  // 2xSE band keep re-judgment jitter and population changes out of the arrow.
  const sides = audienceSides(current, prevRow)
  const sentiment = sides
    ? {
        now: sides.now.positive as number,
        prev: sides.prev.positive as number,
        nowJudged: sides.now.judged,
        prevJudged: sides.prev.judged,
        verdict: proportionDelta(
          {
            nowPct: sides.now.positive as number, nowN: sides.now.judged,
            prevPct: sides.prev.positive as number, prevN: sides.prev.judged,
          },
          SENTIMENT_BAND,
        ),
      }
    : null

  const usePeriodShare = current.period_share_of_voice != null && prevRow.period_share_of_voice != null
  const shareNow = readShare(usePeriodShare ? current.period_share_of_voice : current.share_of_voice)
  const sharePrev = readShare(usePeriodShare ? prevRow.period_share_of_voice : prevRow.share_of_voice)

  // "New themes" is only honest once theme identity is durable. Two gates:
  // the previous run must have had themes at all, AND the registry must hold
  // MIN_REGISTRY_OBSERVATIONS observations for this client — the pre-registry
  // label-match rule counted relabels as new (48 of 58 measured).
  let newThemes: RunDelta['newThemes'] = null
  const [{ data: prevTheme }, observed] = await Promise.all([
    admin.from('themes').select('id')
      .eq('client_id', clientId).eq('run_id', prevRow.run_id).limit(1).maybeSingle(),
    countRegistryObservations(admin, clientId),
  ])
  if (prevTheme && observed >= MIN_REGISTRY_OBSERVATIONS) {
    const { data: fresh } = await admin
      .from('themes')
      .select('label')
      .eq('client_id', clientId)
      .eq('run_id', current.run_id)
      .eq('first_seen', true)
      .eq('single_source', false)
      .order('strength_score', { ascending: false })
    const rows = (fresh ?? []) as { label: string }[]
    newThemes = { count: rows.length, labels: rows.slice(0, 2).map((r) => r.label) }
  }

  const usePeriodConv = current.period_comments != null && prevRow.period_comments != null
  const convNow = num(usePeriodConv ? current.period_comments : current.total_comments)
  const convPrev = num(usePeriodConv ? prevRow.period_comments : prevRow.total_comments)

  return {
    prevRunDate: prevRow.run_date,
    sentiment,
    share:
      shareNow && sharePrev
        ? {
            now: shareNow, prev: sharePrev,
            verdict: proportionDelta(
              {
                nowPct: shareNow.client, nowN: shareNow.totalVideos, nowK: shareNow.clientVideos,
                prevPct: sharePrev.client, prevN: sharePrev.totalVideos, prevK: sharePrev.clientVideos,
              },
              SHARE_BAND,
            ),
          }
        : null,
    newThemes,
    conversations: convNow != null && convPrev != null ? { now: convNow, prev: convPrev } : null,
  }
}

/** Distinct runs the client's theme registry has observed. Counts runs, not
 *  rows: one run writes one observation per theme. Registry off / table empty
 *  reads 0, which keeps "new themes" hidden — the safe direction. */
async function countRegistryObservations(admin: Admin, clientId: string): Promise<number> {
  const { data } = await admin
    .from('theme_observations')
    .select('run_id')
    .eq('client_id', clientId)
    .not('run_id', 'is', null)
    .limit(1000)
  const runs = new Set(((data ?? []) as { run_id: string }[]).map((r) => r.run_id))
  return runs.size
}
