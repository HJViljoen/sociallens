// Keyword attribution (2026-08-10). Fills keyword_performance.insights_contributed —
// the "did this keyword produce intelligence, not just surviving videos" half of
// keyword ROI (the refinement hook noted at keywordValueScore, lib/gather/gather.ts).
//
// Semantics:
//   - An insight credits EVERY keyword on its source video, full credit each.
//     Videos are routinely found by several keywords; splitting credit would
//     understate all of them for what is a ranking signal, not an invoice.
//   - Platform comes from the video row (authoritative), not the insight.
//   - Join by the insight's source_video_id (videos.id uuid). Never join through
//     videos.run_id — gather restamps it to the newest run on every upsert, so
//     it does not identify the run a video was analysed in.
//
// Pure function — the pipeline step and the backfill script supply the rows and
// write the results. Tested in keyword-attribution.test.ts.

import { selectAll } from '../supabase-admin'
import type { SupabaseClient } from '@supabase/supabase-js'

/** The audience_insights slice attribution needs. */
export interface AttributionInsight {
  source_video_id: string | null
}

/** The videos slice attribution needs (id = uuid PK, not the platform-native video_id). */
export interface AttributionVideo {
  id: string
  platform: string
  source_keywords: string[] | null
}

/**
 * Count insights per (platform, keyword). Key format `${platform}::${keyword}`,
 * matching keyword_performance's (platform, keyword) row identity.
 * Insights with no source video, or whose video is not in the map, are skipped.
 */
export function computeKeywordAttribution(
  insights: AttributionInsight[],
  videos: AttributionVideo[],
): Map<string, number> {
  const byId = new Map(videos.map((v) => [v.id, v]))
  const counts = new Map<string, number>()
  for (const insight of insights) {
    if (!insight.source_video_id) continue
    const video = byId.get(insight.source_video_id)
    if (!video) continue
    // Defensive dedupe: a keyword must credit once per insight even if it
    // appears twice on the video row.
    for (const keyword of new Set(video.source_keywords ?? [])) {
      const key = `${video.platform}::${keyword}`
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
  }
  return counts
}

/**
 * Compute and persist insights_contributed for one run's keyword_performance
 * rows. Rows whose (platform, keyword) produced nothing get an explicit 0 —
 * "measured zero", distinct from the pre-attribution null. Used by the
 * keyword-attribution pipeline step and the backfill script.
 */
export async function attributeRunKeywords(
  admin: SupabaseClient,
  clientId: string,
  runId: string,
  opts: { persist?: boolean } = {},
): Promise<{ insights: number; videos: number; kpRows: number; attributed: number }> {
  const insights = await selectAll<AttributionInsight>(() =>
    admin
      .from('audience_insights')
      .select('source_video_id')
      .eq('client_id', clientId)
      .eq('run_id', runId)
      .order('id'),
  )

  // Insights may cite videos from earlier gathers (Pass A plans over the whole
  // client corpus), so fetch by id — chunked to keep the .in() filter sane.
  const videoIds = [...new Set(insights.map((i) => i.source_video_id).filter(Boolean))] as string[]
  const videos: AttributionVideo[] = []
  for (let i = 0; i < videoIds.length; i += 200) {
    const { data, error } = await admin
      .from('videos')
      .select('id, platform, source_keywords')
      .in('id', videoIds.slice(i, i + 200))
    if (error) throw new Error(`attribution videos fetch: ${error.message}`)
    videos.push(...((data ?? []) as AttributionVideo[]))
  }

  const counts = computeKeywordAttribution(insights, videos)

  const { data: kpData, error: kpError } = await admin
    .from('keyword_performance')
    .select('id, platform, keyword, insights_contributed')
    .eq('client_id', clientId)
    .eq('run_id', runId)
  if (kpError) throw new Error(`attribution kp fetch: ${kpError.message}`)
  const kpRows = kpData ?? []

  let attributed = 0
  if (opts.persist !== false) {
    for (const row of kpRows) {
      const n = counts.get(`${row.platform}::${row.keyword}`) ?? 0
      if (n > 0) attributed++
      const { error } = await admin
        .from('keyword_performance')
        .update({ insights_contributed: n })
        .eq('id', row.id)
      if (error) throw new Error(`attribution kp update: ${error.message}`)
    }
  } else {
    attributed = kpRows.filter((r) => (counts.get(`${r.platform}::${r.keyword}`) ?? 0) > 0).length
  }

  return { insights: insights.length, videos: videos.length, kpRows: kpRows.length, attributed }
}
