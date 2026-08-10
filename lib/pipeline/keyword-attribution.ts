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
