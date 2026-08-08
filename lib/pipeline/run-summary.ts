import { createAdminClient } from '../supabase-admin'
import type { CiSummary, ExecutiveBrief, SayVsHearEntry } from './schemas'
import type { VideoRow, Step2aMetrics } from './types'

// run_summary writer. The table existed unwritten since v4.1; the pipeline back
// half now populates one row per run (Redesign Spec §8): deterministic corpus
// metrics (Step 2a), the video-sentiment distribution, and Pass D-a's
// consumer_intelligence_summary. Consecutive rows are the data source for the
// weekly-email delta block (§7) and the dashboard's state snapshot (§2).

export interface WriteRunSummaryArgs {
  clientId: string
  runId: string
  metrics: Step2aMetrics
  /** The corpus videos — sentiment distribution comes from Pass A's per-video sentiment. */
  videos: VideoRow[]
  /** Metrics over ONLY this run's gathered rows (period_* columns — the honest
   *  week-over-week layer; Teardown 2026-07-09). Optional: CLI callers that
   *  predate the split may omit it and period columns stay null. */
  periodMetrics?: Step2aMetrics
  /** This run's videos (run_id = current) — period sentiment distribution. */
  periodVideos?: VideoRow[]
  ciSummary: CiSummary | null
  /** Pass D-a's woven dashboard hero brief (already sanitised), or null. */
  executiveBrief?: ExecutiveBrief | null
  /** Pass D-a v5's say-vs-hear entries (claims resolved), or null. */
  sayVsHear?: SayVsHearEntry[] | null
  /** tracking_configs.report_period ('weekly' | 'monthly' | …), if known. */
  period?: string | null
}

const round1 = (n: number) => Math.round(n * 10) / 10

/** Pass-A video-sentiment distribution. 'mixed' counts toward the denominator
 *  but gets no share — the three shares deliberately don't sum to 100. */
function sentimentShares(videos: VideoRow[]) {
  const counts = { positive: 0, neutral: 0, negative: 0, mixed: 0 }
  let judged = 0
  for (const v of videos) {
    if (v.sentiment && v.sentiment in counts) {
      counts[v.sentiment as keyof typeof counts]++
      judged++
    }
  }
  const share = (n: number) => (judged > 0 ? round1((n / judged) * 100) : null)
  return { counts, judged, share }
}

export async function writeRunSummary(args: WriteRunSummaryArgs): Promise<void> {
  const { clientId, runId, metrics, videos, periodMetrics, periodVideos, ciSummary, executiveBrief, sayVsHear, period } = args
  const admin = createAdminClient()

  // Corpus (all-time) distribution — the market-map state; raw counts live in
  // sentiment_drivers for the honest breakdown.
  const { counts, judged, share } = sentimentShares(videos)
  // Period distribution — this run's videos only.
  const p = periodVideos ? sentimentShares(periodVideos) : null

  const { error: delErr } = await admin.from('run_summary').delete().eq('client_id', clientId).eq('run_id', runId)
  if (delErr) throw new Error(`clear run_summary: ${delErr.message}`)

  const { error } = await admin.from('run_summary').insert({
    client_id: clientId,
    run_id: runId,
    total_videos: metrics.total_videos,
    total_comments: metrics.total_comments,
    client_videos: metrics.client_videos,
    competitor_videos: metrics.competitor_videos,
    platforms_covered: metrics.platforms_covered,
    avg_engagement_rate: metrics.avg_engagement_rate,
    top_video_id: metrics.top_video_id,
    top_video_views: metrics.top_video_views,
    top_video_platform: metrics.top_video_platform,
    share_of_voice: metrics.share_of_voice,
    platforms_summary: metrics.platforms_summary,
    overall_sentiment_positive: share(counts.positive),
    overall_sentiment_neutral: share(counts.neutral),
    overall_sentiment_negative: share(counts.negative),
    sentiment_drivers: { video_sentiment_counts: counts, videos_judged: judged },
    period_videos: periodMetrics?.total_videos ?? null,
    period_comments: periodMetrics?.total_comments ?? null,
    period_client_videos: periodMetrics?.client_videos ?? null,
    period_competitor_videos: periodMetrics?.competitor_videos ?? null,
    period_avg_engagement_rate: periodMetrics?.avg_engagement_rate ?? null,
    period_share_of_voice: periodMetrics?.share_of_voice ?? null,
    period_sentiment_positive: p ? p.share(p.counts.positive) : null,
    period_sentiment_neutral: p ? p.share(p.counts.neutral) : null,
    period_sentiment_negative: p ? p.share(p.counts.negative) : null,
    period_sentiment_drivers: p ? { video_sentiment_counts: p.counts, videos_judged: p.judged } : null,
    consumer_intelligence_summary: ciSummary,
    executive_brief: executiveBrief ?? null,
    say_vs_hear: sayVsHear ?? null,
    period: period ?? null,
    run_date: new Date().toISOString(),
  })
  if (error) throw new Error(`persist run_summary: ${error.message}`)
}
