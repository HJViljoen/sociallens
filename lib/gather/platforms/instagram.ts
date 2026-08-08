import type { PlatformAdapter } from '../types'
import { APIFY_ACTORS, COMMENT_THRESHOLD } from '../../config'
import { num, str, first, getPath, toDateOnly, cleanHashtag } from '../util'
import { tagVideo } from '../tagging'

// Instagram adapter. Quirks from Technical.md: the search input uses `hashtags`
// (alphanumeric only) / `resultsLimit` / `resultsType`, not the TikTok shape;
// IG exposes neither views nor shares; the id is the post shortcode.
//
// Comments (2026-07-05): moved off apify/instagram-comment-scraper (returned 0
// for every video) to the flagship apify/instagram-scraper in `comments` mode —
// far more used/maintained, same output field names. Root-cause suspect for the
// 0s: that actor only accepts POST urls (/p/…), and the hashtag scraper hands us
// /reel/… urls — so commentScrape now builds the canonical /p/{shortcode}/ form
// from the shortcode. ⚠️ Not yet re-run live (Apify was over-quota) — smoke-test
// one IG video's comments on the next paid run before trusting it.

export const instagram: PlatformAdapter = {
  platform: 'instagram',

  videoSearch(config, terms, limit) {
    // This actor applies resultsLimit PER hashtag. The orchestrator now searches
    // one keyword at a time (terms is a single hashtag), so resultsLimit is that
    // keyword's quota — matching TT/YT and removing the old per-hashtag volume skew.
    // (cleanHashtag strips '#'/spaces/punctuation — required.)
    const hashtags = terms.map(cleanHashtag).filter(Boolean)
    return {
      actor: APIFY_ACTORS.instagram.video,
      input: {
        hashtags,
        resultsLimit: limit,
        // Reels (not photo posts) for V1: positioning is "media-based" (we analyse
        // the comments, not the video), so this is a comment-signal/consistency
        // call — reels are comment-dense and keep IG consistent with the other two
        // short-form-video V1 platforms. Revisit "all posts" if IG volume is thin.
        // Confirm the exact value the actor expects (could be 'reels' / 'clips').
        resultsType: 'reels',
        keywordSearch: false,
      },
    }
  },

  normaliseVideo(raw, ctx) {
    const v = raw as Record<string, unknown>

    const video_url = str(first(v.url, v.postUrl, v.inputUrl))
    const shortCode =
      str(first(v.shortCode, v.shortcode, v.code)) ||
      video_url.match(/\/(?:p|reel|tv)\/([^/?]+)/)?.[1] ||
      ''
    if (!shortCode) return null

    const account_name = str(first(v.ownerUsername, getPath(v, ['owner', 'username'])))
    const likes = num(first(v.likesCount, v.likes))
    const comments_count = num(first(v.commentsCount, v.commentCount))

    const rawTags = Array.isArray(v.hashtags) ? v.hashtags : []
    const hashtags = rawTags.map((t: unknown) => str(t)).filter(Boolean)
    const caption = str(first(v.caption, v.text))

    return {
      client_id: ctx.clientId,
      run_id: ctx.runId,
      platform: 'instagram',
      video_id: shortCode,
      video_url: video_url || `https://www.instagram.com/p/${shortCode}/`,
      account_name,
      account_followers: num(first(v.ownerFollowers, getPath(v, ['owner', 'followers']))),
      caption,
      hashtags,
      content_format: str(first(v.type, v.productType)) || 'Reel',
      views: 0, // IG doesn't expose view counts; 0 per the schema's count convention (engagement_rate stays null)
      likes,
      shares: 0,
      comments_count,
      engagement_rate: null, // no views → no blended engagement
      upload_date: toDateOnly(v.timestamp, v.takenAt),
      audio_name: str(first(getPath(v, ['musicInfo', 'song_name']), v.musicName)),
      is_sponsored: Boolean(first(v.isSponsored, v.isPaidPartnership, false)),
      duration_seconds: Math.round(num(first(v.videoDuration, v.duration))),
      ...tagVideo({ account_name, caption, hashtags }, ctx.config),
    }
  },

  // Verified live 2026-08-08: the flagship actor in `posts` mode returns the
  // same `videoUrl`/`audioUrl` pair the hashtag scraper does, so extractMedia
  // reads a refetched item unchanged. resultsLimit is PER url — 1 each.
  refetchByUrl(videoUrls) {
    return {
      actor: APIFY_ACTORS.instagram.post,
      input: {
        directUrls: videoUrls,
        resultsType: 'posts',
        resultsLimit: 1,
        addParentData: false,
      },
    }
  },

  // Transcript source (Step 1): the item carries a separate audio-only stream at
  // `audioUrl` alongside the full mp4 at `videoUrl` — no caption field, so IG is
  // always Whisper. Verified on real data 2026-07-23.
  //
  // audioUrl FIRST (2026-08-08): Whisper only ever hears the audio, and the mp4
  // blew the 25MB cap on 7 of 60 backfilled videos (one was 110MB) and returned
  // undecodable bytes on 5 more. Pulling the audio track alone fixes both and
  // cuts the download by an order of magnitude. videoUrl stays as the fallback.
  extractMedia(raw) {
    const v = raw as Record<string, unknown>
    return { mediaUrl: str(first(v.audioUrl, v.videoUrl)) || null, subtitleTracks: null }
  },

  commentScrape(video, config) {
    return {
      actor: APIFY_ACTORS.instagram.comment,
      input: {
        // Flagship apify/instagram-scraper, comments mode. It only accepts POST
        // urls (/p/…), not /reel/… — build the canonical form from the shortcode
        // (video_id) rather than passing the hashtag scraper's /reel/ url.
        directUrls: [`https://www.instagram.com/p/${video.video_id}/`],
        resultsType: 'comments',
        resultsLimit: config.comment_depth,
      },
    }
  },

  normaliseComment(raw, video, ctx) {
    const c = raw as Record<string, unknown>
    const comment_id = str(first(c.id, c.commentId, c.pk))
    const text = str(first(c.text, c.comment))
    if (!comment_id || !text) return null

    return {
      client_id: ctx.clientId,
      run_id: ctx.runId,
      platform: 'instagram',
      video_id: video.video_id,
      comment_id,
      author: str(first(c.ownerUsername, getPath(c, ['owner', 'username']))),
      text,
      likes: num(first(c.likesCount, c.likeCount)),
      reply_count: num(first(c.repliesCount, c.replyCount)), // flagship exposes repliesCount
      is_reply: false,
      comment_date: toDateOnly(c.timestamp, c.createdAt),
    }
  },

  // null = scrape comments for every IG video found (don't gate on comments_count).
  // Proven working on the 2026-07-09 Sealand run (5,840 comments), so the
  // no-gate re-validation stance is retired. Same bar as TikTok: on that run a
  // ≥5 gate skips ~35% of IG comment scrapes (the cost driver — one paid actor
  // run per video) while losing ~2.5% of comments.
  commentThreshold: COMMENT_THRESHOLD,
}
