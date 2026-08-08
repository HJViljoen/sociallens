import type { PlatformAdapter } from '../types'
import { APIFY_ACTORS, COMMENT_THRESHOLD, periodToTikTokRange } from '../../config'
import { num, str, first, getPath, toDateOnly, engagementRate } from '../util'
import { tagVideo } from '../tagging'

// TikTok adapter. Field paths reflect what the real actor returns (confirmed
// against the n8n normalise code + live DB rows): the video id is regex-pulled
// from the URL, not a clean field; account/audio live under nested objects.
// Fallback chains tolerate actor-version drift.

function detectFormat(caption: string): string {
  const c = caption.toLowerCase()
  if (c.includes('#duet')) return 'duet'
  if (c.includes('#stitch')) return 'stitch'
  return 'original'
}

export const tiktok: PlatformAdapter = {
  platform: 'tiktok',

  videoSearch(config, terms, limit) {
    return {
      actor: APIFY_ACTORS.tiktok.video,
      input: {
        keywords: terms,
        dateRange: periodToTikTokRange(config.report_period),
        maxItems: limit,
        sortType: 'RELEVANCE',
        includeSearchKeywords: false,
        customMapFunction: '(object) => { return {...object} }',
      },
    }
  },

  normaliseVideo(raw, ctx) {
    const v = raw as Record<string, unknown>

    const video_url = str(first(v.postPage, v.shareUrl, v.url, getPath(v, ['video', 'url'])))
    if (!video_url) return null

    const video_id = video_url.match(/video\/(\d+)/)?.[1] ?? str(first(v.id, getPath(v, ['video', 'id'])))
    if (!video_id) return null

    const account_name = str(
      first(getPath(v, ['channel', 'name']), getPath(v, ['authorMeta', 'name']), v.author),
    )
    const caption = str(first(v.caption, v.title, v.text, v.description))
    const views = num(first(v.playCount, v.views, getPath(v, ['stats', 'playCount'])))
    const likes = num(first(v.diggCount, v.likes, getPath(v, ['stats', 'diggCount'])))
    const shares = num(first(v.shareCount, v.shares, getPath(v, ['stats', 'shareCount'])))
    const comments_count = num(first(v.comments, v.commentCount, getPath(v, ['stats', 'commentCount'])))

    const rawTags = Array.isArray(v.hashtags) ? v.hashtags : Array.isArray(v.tags) ? v.tags : []
    const hashtags = rawTags
      .map((h: unknown) => (typeof h === 'string' ? h : str(getPath(h, ['name']))))
      .filter(Boolean)

    return {
      client_id: ctx.clientId,
      run_id: ctx.runId,
      platform: 'tiktok',
      video_id,
      video_url,
      account_name,
      account_followers: num(first(getPath(v, ['channel', 'followers']), getPath(v, ['authorMeta', 'fans']))),
      caption,
      hashtags,
      content_format: detectFormat(caption),
      views,
      likes,
      shares,
      comments_count,
      engagement_rate: engagementRate(views, likes, shares, comments_count),
      upload_date: toDateOnly(v.uploadedAtFormatted, v.createTimeISO, v.createTime),
      audio_name: str(first(getPath(v, ['song', 'title']), getPath(v, ['musicMeta', 'musicName']))),
      is_sponsored: Boolean(first(v.isAd, v.isSponsored, false)),
      duration_seconds: Math.round(num(first(getPath(v, ['video', 'duration']), v.duration))),
      ...tagVideo({ account_name, caption, hashtags }, ctx.config),
    }
  },

  // Transcript sources (Step 1): the actor returns a direct CDN mp4 at
  // `video.url` and, WHEN the video has captions, a `subtitleInformation` array
  // of auto-generated WebVTT tracks (each with a direct, expiring URL). Verified
  // on real data 2026-07-23 (see Architecture/Video-Transcripts).
  extractMedia(raw) {
    const v = raw as Record<string, unknown>
    const mediaUrl = str(getPath(v, ['video', 'url'])) || null
    const rawSubs = v.subtitleInformation
    const tracks = Array.isArray(rawSubs)
      ? rawSubs
          .map((s) => {
            const t = s as Record<string, unknown>
            const url = str(first(t.url, Array.isArray(t.url_list) ? t.url_list[0] : undefined))
            return url ? { url, lang: str(first(t.language_code, t.lang)) || null, isAuto: Boolean(t.is_auto_generated) } : null
          })
          .filter((t): t is { url: string; lang: string | null; isAuto: boolean } => t !== null)
      : []
    return { mediaUrl, subtitleTracks: tracks.length ? tracks : null }
  },

  commentScrape(video, config) {
    return {
      actor: APIFY_ACTORS.tiktok.comment,
      input: {
        startUrls: [video.video_url],
        maxItems: config.comment_depth,
        includeReplies: false,
        customMapFunction: '(object) => { return {...object} }',
      },
    }
  },

  normaliseComment(raw, video, ctx) {
    const c = raw as Record<string, unknown>
    const comment_id = str(first(c.cid, c.id, getPath(c, ['comment', 'id'])))
    const text = str(first(c.text, c.comment))
    if (!comment_id || !text) return null

    return {
      client_id: ctx.clientId,
      run_id: ctx.runId,
      platform: 'tiktok',
      video_id: video.video_id,
      comment_id,
      author: str(first(getPath(c, ['user', 'username']), c.uniqueId, c.nickname, c.username)),
      text,
      likes: num(first(c.diggCount, c.likeCount, c.likes)),
      reply_count: num(first(c.replyCommentTotal, c.replyCount)),
      is_reply: Boolean(first(c.replyId, c.isReply, false)),
      comment_date: toDateOnly(c.createdAt, c.createTimeISO, c.createTime),
    }
  },

  commentThreshold: COMMENT_THRESHOLD,
}
