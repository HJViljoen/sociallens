import type { VideoRow, CommentRow, Step2aMetrics, SovEntry, PlatformSummary } from './types'

// Step 2a — deterministic metrics (Architecture/Analysis-Passes §Step 2a).
// No GPT. Counts/percentages computed here and templated into prompts/outputs
// later (invariant 5: no GPT-generated numbers).

// Platforms with real view counts. Instagram has none — its likes-per-follower
// rate is a different metric and is never mixed into the blended engagement.
const VIEW_PLATFORMS = new Set(['tiktok', 'youtube'])

function videoKey(platform: string, videoId: string): string {
  return `${platform}::${videoId}`
}

function entityOf(v: VideoRow): string {
  if (v.is_client) return 'client'
  if (v.is_competitor) return `competitor:${v.competitor_name ?? 'unknown'}`
  return 'industry-other'
}

function wordCount(s: string): number {
  return s.trim().split(/\s+/).filter(Boolean).length
}

function median(nums: number[]): number {
  if (nums.length === 0) return 0
  const sorted = [...nums].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

/**
 * Deterministic comment quality score, 1–5 (null when <5 comments).
 * Evaluated top-down 1→5, first match wins (Analysis-Passes §quality rule —
 * conditions overlap by design). Note: a deep-but-inquisitive set (high median
 * + moderate question rate) can land at 3 via the `pctQ > 20` clause; that's
 * the documented behaviour. quality_score is a display/weighting signal only.
 */
export function computeQualityScore(comments: CommentRow[]): number | null {
  if (comments.length < 5) return null
  const texts = comments.map((c) => (c.text ?? '').trim())
  const counts = texts.map(wordCount)
  const n = counts.length
  const med = median(counts)
  const pctLe3 = (counts.filter((w) => w <= 3).length / n) * 100
  const pctLe5 = (counts.filter((w) => w <= 5).length / n) * 100
  const pctQ = (texts.filter((t) => t.includes('?')).length / n) * 100

  if (pctLe3 > 80 && pctQ < 10) return 1
  if (pctLe5 > 60 && pctQ < 15) return 2
  if ((med >= 5 && med <= 15) || pctQ > 20) return 3
  if ((med >= 15 && med <= 30) || pctQ > 30) return 4
  if (med > 30 || (med > 15 && pctQ > 30)) return 5
  return 3
}

const round = (n: number, dp: number) => {
  const f = 10 ** dp
  return Math.round(n * f) / f
}

/**
 * Compute the full Step 2a metrics block from a run's videos + comments.
 * Pure: no DB access. The orchestrator persists comment_quality_scores onto
 * videos and holds the rest in memory for Pass A / Step 2b.
 */
export function computeMetrics(
  videos: VideoRow[],
  comments: CommentRow[],
  /** Video ids that produced at least one current insight. Lets share_of_voice
   *  carry what a finding can rest on, not just what we scraped (Tier 1). */
  analysedVideoIds?: Set<string>,
): Step2aMetrics {
  // Index comments by (platform, video_id).
  const commentsByVideo = new Map<string, CommentRow[]>()
  for (const c of comments) {
    const key = videoKey(c.platform, c.video_id)
    const arr = commentsByVideo.get(key)
    if (arr) arr.push(c)
    else commentsByVideo.set(key, [c])
  }

  const total_videos = videos.length
  const total_comments = comments.length
  const client_videos = videos.filter((v) => v.is_client).length
  const competitor_videos = videos.filter((v) => v.is_competitor).length
  const platforms_covered = [...new Set(videos.map((v) => v.platform))].sort()

  // Blended engagement rate over view-bearing platforms only (TT/YT).
  let engSum = 0
  let viewSum = 0
  for (const v of videos) {
    if (!VIEW_PLATFORMS.has(v.platform)) continue
    const views = Number(v.views) || 0
    if (views <= 0) continue
    const engagements = (Number(v.likes) || 0) + (Number(v.comments_count) || 0) + (Number(v.shares) || 0)
    engSum += engagements
    viewSum += views
  }
  const avg_engagement_rate = viewSum > 0 ? round((engSum / viewSum) * 100, 2) : 0

  // Top video by views (IG naturally excluded — null views).
  let top_video_id: string | null = null
  let top_video_views = 0
  let top_video_platform: string | null = null
  for (const v of videos) {
    const views = Number(v.views) || 0
    if (views > top_video_views) {
      top_video_views = views
      top_video_id = v.id
      top_video_platform = v.platform
    }
  }

  // Share of voice by entity bucket.
  const sovRaw: Record<string, { videos: number; views: number; analysed: number }> = {}
  for (const v of videos) {
    const e = entityOf(v)
    if (!sovRaw[e]) sovRaw[e] = { videos: 0, views: 0, analysed: 0 }
    sovRaw[e].videos += 1
    sovRaw[e].views += Number(v.views) || 0
    if (analysedVideoIds?.has(v.id)) sovRaw[e].analysed += 1
  }
  const share_of_voice: Record<string, SovEntry> = {}
  for (const [e, agg] of Object.entries(sovRaw)) {
    share_of_voice[e] = {
      videos: agg.videos,
      views: agg.views,
      pct_videos: total_videos > 0 ? round((agg.videos / total_videos) * 100, 1) : 0,
      ...(analysedVideoIds ? { analysed_videos: agg.analysed } : {}),
    }
  }

  // Per-platform summary.
  const platforms_summary: Record<string, PlatformSummary> = {}
  for (const platform of platforms_covered) {
    const pv = videos.filter((v) => v.platform === platform)
    const pComments = pv.reduce(
      (s, v) => s + (commentsByVideo.get(videoKey(v.platform, v.video_id))?.length ?? 0),
      0,
    )
    const views = pv.reduce((s, v) => s + (Number(v.views) || 0), 0)
    let avg: number | null = null
    if (VIEW_PLATFORMS.has(platform) && views > 0) {
      const eng = pv.reduce(
        (s, v) => s + (Number(v.likes) || 0) + (Number(v.comments_count) || 0) + (Number(v.shares) || 0),
        0,
      )
      avg = round((eng / views) * 100, 2)
    }
    platforms_summary[platform] = { videos: pv.length, comments: pComments, views, avg_engagement_rate: avg }
  }

  // Per-video quality scores.
  const comment_quality_scores: Record<string, number | null> = {}
  for (const v of videos) {
    const vComments = commentsByVideo.get(videoKey(v.platform, v.video_id)) ?? []
    comment_quality_scores[v.id] = computeQualityScore(vComments)
  }

  return {
    total_videos,
    total_comments,
    client_videos,
    competitor_videos,
    platforms_covered,
    avg_engagement_rate,
    top_video_id,
    top_video_views,
    top_video_platform,
    share_of_voice,
    platforms_summary,
    comment_quality_scores,
  }
}
