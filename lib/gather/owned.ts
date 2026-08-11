import { runActor } from './apify'
import { createAdminClient } from '../supabase-admin'
import { APIFY_ACTORS, COMMENT_THRESHOLD } from '../config'
import type { GatherConfig, RawItem, VideoInsert } from './types'
import { getPath, first, num, str } from './util'

// Owned-account scrape interim (Wave 2, 2026-08-11). Official platform APIs
// need Business Verification we don't have, so the client's OWN public
// profiles are scraped like any other account — with guards, because scraped
// numbers glitch in ways analytics APIs don't. Verified live 2026-08-11:
//   IG  flagship actor, resultsType 'details' → exact followersCount/postsCount
//       + latestPosts[12]
//   TT  clockworks actor, startUrls profile mode + maxItems → channel.followers
//       (exact int) + recent videos
//   YT  free Data API: channels.list → uploads playlist → playlistItems →
//       videos.list (all ~1 quota unit; subscriberCount ROUNDS to 3 sig figs)
// Pure guards below are tested in owned.test.ts; fetchers are I/O.

/** One platform's profile read: the snapshot numbers + recent own posts
 *  (already shaped as VideoInsert rows, WITHOUT source — the orchestrator
 *  stamps source:'owned' + is_client:true on write). */
export interface OwnProfile {
  handle: string
  followers: number | null
  postsCount: number | null
  recentPosts: VideoInsert[]
}

/** How many recent own posts a profile read pulls (weekly own-post ingestion
 *  window — a brand posting more than this weekly is not our segment). */
export const OWN_POSTS_LIMIT = 12

// ---- Snapshot sanity guards (pure) ------------------------------------------

/**
 * Accept or reject a freshly scraped follower count against the previous
 * snapshot. Scraper glitches read as 0/null (blocked page) or wild jumps
 * (logged-out variant, wrong account); a real brand account does not gain or
 * lose 20% of its followers in one step. Rejected reads keep the prior point
 * — a missing day is honest, a fake cliff is not.
 */
export function acceptSnapshot(
  prev: number | null,
  next: number | null | undefined,
): { ok: boolean; reason?: string } {
  if (next == null || !Number.isFinite(next)) return { ok: false, reason: 'no-count' }
  if (next <= 0) return { ok: false, reason: 'zero-count' }
  if (prev != null && prev > 0) {
    const step = Math.abs(next - prev) / prev
    if (step > 0.2) return { ok: false, reason: `jump-${(step * 100).toFixed(0)}pct` }
  }
  return { ok: true }
}

/**
 * Week-over-week follower delta from a daily (or sparser) series: latest
 * point vs the newest point at least ~6.5 days older. Daily deltas must NOT
 * feed the event floor (1.5% per WEEK) — at daily cadence that floor would
 * be nonsense. Returns null until the series is deep enough.
 */
export function weekOverWeekDelta(
  rows: { snapshot_date: string; followers: number }[],
): { pct: number; vsDate: string } | null {
  if (rows.length < 2) return null
  const sorted = [...rows].sort((a, b) => a.snapshot_date.localeCompare(b.snapshot_date))
  const latest = sorted[sorted.length - 1]
  const latestT = Date.parse(latest.snapshot_date)
  const anchor = [...sorted]
    .reverse()
    .find((r) => latestT - Date.parse(r.snapshot_date) >= 6.5 * 86_400_000)
  if (!anchor || anchor.followers <= 0) return null
  return {
    pct: ((latest.followers - anchor.followers) / anchor.followers) * 100,
    vsDate: anchor.snapshot_date,
  }
}

/**
 * Platform-aware minimum % floor for a follower event. YouTube's public
 * subscriberCount rounds to 3 significant figures, so one rounding step on a
 * small channel can fake a move — the floor must clear TWO rounding steps.
 * Exact-count platforms (IG/TT scrapes) keep the base floor.
 */
export function followerFloorPct(platform: string, followers: number, basePct: number): number {
  if (platform !== 'youtube' || followers <= 0) return basePct
  const magnitude = Math.pow(10, Math.max(0, Math.floor(Math.log10(followers)) - 2))
  return Math.max(basePct, (2 * magnitude * 100) / followers)
}

// ---- Per-platform profile fetchers (I/O) ------------------------------------

function igProfile(handle: string, raw: RawItem[], ctx: Ctx): OwnProfile {
  const p = (raw[0] ?? {}) as RawItem
  const posts = (Array.isArray(p.latestPosts) ? p.latestPosts : []) as RawItem[]
  const recentPosts: VideoInsert[] = []
  for (const post of posts.slice(0, OWN_POSTS_LIMIT)) {
    const shortCode = str(first(post.shortCode, post.shortcode, post.code))
    if (!shortCode) continue
    const likes = num(first(post.likesCount, post.likes))
    const comments = num(first(post.commentsCount, post.commentCount))
    recentPosts.push({
      client_id: ctx.clientId,
      run_id: ctx.runId,
      platform: 'instagram' as const,
      video_id: shortCode,
      video_url: str(post.url) || `https://www.instagram.com/p/${shortCode}/`,
      account_name: handle,
      account_followers: num(p.followersCount),
      caption: str(first(post.caption, post.text) ?? ''),
      hashtags: (Array.isArray(post.hashtags) ? post.hashtags : []).map(String),
      content_format: str(first(post.productType, post.type)),
      views: num(post.videoViewCount),
      likes,
      shares: 0,
      comments_count: comments,
      engagement_rate: null,
      upload_date: str(post.timestamp).slice(0, 10) || null,
      audio_name: '',
      is_sponsored: Boolean(post.paidPartnership),
      duration_seconds: 0,
      is_client: true,
      is_competitor: false,
      competitor_name: null,
    })
  }
  return {
    handle,
    followers: p.followersCount == null ? null : num(p.followersCount),
    postsCount: p.postsCount == null ? null : num(p.postsCount),
    recentPosts,
  }
}

function ttProfile(handle: string, raw: RawItem[], ctx: Ctx): OwnProfile {
  const channel = (raw[0] as RawItem | undefined)?.channel as RawItem | undefined
  const recentPosts: VideoInsert[] = []
  for (const item of raw.slice(0, OWN_POSTS_LIMIT)) {
    const v = item as RawItem
    const id = str(v.id)
    const url = str(getPath(v, ['postPage']))
    if (!id || !url) continue
    const views = num(v.views)
    const likes = num(v.likes)
    const comments = num(v.comments)
    const shares = num(v.shares)
    recentPosts.push({
      client_id: ctx.clientId,
      run_id: ctx.runId,
      platform: 'tiktok' as const,
      video_id: id,
      video_url: url,
      account_name: handle,
      account_followers: num(getPath(v, ['channel', 'followers'])),
      caption: str(v.title),
      hashtags: (Array.isArray(v.hashtags) ? v.hashtags : []).map((h) => str((h as RawItem)?.name ?? h) ?? '').filter(Boolean),
      content_format: '',
      views,
      likes,
      shares,
      comments_count: comments,
      engagement_rate: views > 0 ? Number((((likes + comments + shares) / views) * 100).toFixed(2)) : null,
      upload_date: str(v.uploadedAtFormatted).slice(0, 10) || null,
      audio_name: str(getPath(v, ['song', 'title'])),
      is_sponsored: false,
      duration_seconds: num(getPath(v, ['video', 'duration'])),
      is_client: true,
      is_competitor: false,
      competitor_name: null,
    })
  }
  const followers = channel?.followers == null ? null : num(channel.followers)
  return {
    handle,
    followers,
    postsCount: channel?.videos == null ? null : num(channel.videos),
    recentPosts,
  }
}

interface Ctx {
  clientId: string
  runId: string
}

async function ytProfile(channelId: string, ctx: Ctx): Promise<OwnProfile> {
  const key = process.env.YOUTUBE_API_KEY
  if (!key) throw new Error('YOUTUBE_API_KEY not set')
  const base = 'https://www.googleapis.com/youtube/v3'
  const chRes = await fetch(`${base}/channels?part=statistics,contentDetails&id=${channelId}&key=${key}`)
  if (!chRes.ok) throw new Error(`yt channels.list ${chRes.status}`)
  const ch = (await chRes.json()) as { items?: RawItem[] }
  const channel = ch.items?.[0]
  if (!channel) throw new Error(`yt channel not found: ${channelId}`)
  const stats = channel.statistics as RawItem
  const uploads = str(getPath(channel, ['contentDetails', 'relatedPlaylists', 'uploads']))

  const recentPosts: VideoInsert[] = []
  if (uploads) {
    const plRes = await fetch(`${base}/playlistItems?part=contentDetails&playlistId=${uploads}&maxResults=${OWN_POSTS_LIMIT}&key=${key}`)
    if (plRes.ok) {
      const pl = (await plRes.json()) as { items?: RawItem[] }
      const videoIds = (pl.items ?? [])
        .map((i) => str(getPath(i, ['contentDetails', 'videoId'])))
        .filter(Boolean) as string[]
      if (videoIds.length) {
        const vRes = await fetch(`${base}/videos?part=snippet,statistics,contentDetails&id=${videoIds.join(',')}&key=${key}`)
        if (vRes.ok) {
          const vs = (await vRes.json()) as { items?: RawItem[] }
          for (const v of vs.items ?? []) {
            const id = str(v.id)
            if (!id) continue
            const vStats = (v.statistics ?? {}) as RawItem
            const snippet = (v.snippet ?? {}) as RawItem
            const views = num(vStats.viewCount)
            const likes = num(vStats.likeCount)
            const comments = num(vStats.commentCount)
            recentPosts.push({
              client_id: ctx.clientId,
              run_id: ctx.runId,
              platform: 'youtube' as const,
              video_id: id,
              video_url: `https://www.youtube.com/watch?v=${id}`,
              account_name: str(snippet.channelTitle) || channelId,
              account_followers: num(stats.subscriberCount),
              caption: [str(snippet.title), str(snippet.description)].filter(Boolean).join('\n\n'),
              hashtags: [],
              content_format: '',
              views,
              likes,
              shares: 0,
              comments_count: comments,
              engagement_rate: views > 0 ? Number((((likes + comments) / views) * 100).toFixed(2)) : null,
              upload_date: str(getPath(snippet, ['publishedAt'])).slice(0, 10) || null,
              audio_name: '',
              is_sponsored: false,
              duration_seconds: 0,
              is_client: true,
              is_competitor: false,
              competitor_name: null,
            })
          }
        }
      }
    }
  }
  return {
    handle: channelId,
    followers: stats.subscriberCount == null ? null : num(stats.subscriberCount),
    postsCount: stats.videoCount == null ? null : num(stats.videoCount),
    recentPosts,
  }
}

/** Fetch one platform's own-profile read. Throws on hard failure — callers
 *  decide non-fatality. */
export async function fetchOwnProfile(
  platform: string,
  handle: string,
  ctx: Ctx,
): Promise<OwnProfile> {
  if (platform === 'youtube') return ytProfile(handle, ctx)
  if (platform === 'instagram') {
    const raw = await runActor(APIFY_ACTORS.instagram.post, {
      directUrls: [`https://www.instagram.com/${handle}/`],
      resultsType: 'details',
      resultsLimit: 1,
    }, { timeoutSecs: 120 })
    return igProfile(handle, raw, ctx)
  }
  if (platform === 'tiktok') {
    const raw = await runActor(APIFY_ACTORS.tiktok.video, {
      startUrls: [`https://www.tiktok.com/@${handle}`],
      maxItems: OWN_POSTS_LIMIT,
    }, { timeoutSecs: 180 })
    return ttProfile(handle, raw, ctx)
  }
  throw new Error(`no own-profile fetcher for platform: ${platform}`)
}

/** Platforms the owned layer supports, intersected with the tenant's config. */
export function ownedPlatforms(config: GatherConfig): { platform: string; handle: string }[] {
  return Object.entries(config.own_handles)
    .filter(([platform, handle]) => handle && ['instagram', 'tiktok', 'youtube'].includes(platform))
    .map(([platform, handle]) => ({ platform, handle }))
}

/** Own posts new/fresh enough to be worth a paid comment scrape this run:
 *  in the report window (or undated), above the comment threshold. Pure. */
export function ownedCommentRefs(
  posts: VideoInsert[],
  opts: { windowStart: string | null; threshold: number | null },
): { video_id: string; video_url: string; comments_count: number }[] {
  return posts
    .filter((p) => {
      if (opts.threshold != null && p.comments_count < opts.threshold) return false
      if (!opts.windowStart) return true
      return !p.upload_date || p.upload_date >= opts.windowStart.slice(0, 10)
    })
    .map((p) => ({ video_id: p.video_id, video_url: p.video_url, comments_count: p.comments_count }))
}

/**
 * Weekly own-post ingestion for one platform (pipeline step body): profile
 * read → upsert recent posts stamped source:'owned' (sticky — a discovered
 * re-gather never touches the column) → return the refs worth a comment
 * scrape this window. YouTube's comment fetch is quota-cheap, so it takes
 * every commented post; TT/IG apply the paid-scrape threshold.
 */
export async function ingestOwnedPosts(opts: {
  clientId: string
  runId: string
  platform: string
  handle: string
  windowStart: string | null
}): Promise<{ video_id: string; video_url: string; comments_count: number }[]> {
  const profile = await fetchOwnProfile(opts.platform, opts.handle, {
    clientId: opts.clientId,
    runId: opts.runId,
  })
  if (profile.recentPosts.length) {
    const admin = createAdminClient()
    const rows = profile.recentPosts.map((p) => ({ ...p, source: 'owned' as const }))
    const { error } = await admin
      .from('videos')
      .upsert(rows, { onConflict: 'client_id,platform,video_id' })
    if (error) throw new Error(`owned posts upsert (${opts.platform}): ${error.message}`)
  }
  return ownedCommentRefs(profile.recentPosts, {
    windowStart: opts.windowStart,
    threshold: opts.platform === 'youtube' ? 1 : COMMENT_THRESHOLD,
  })
}
