import { runActor } from './apify'
import { createAdminClient } from '../supabase-admin'
import { APIFY_ACTORS, COMMENT_THRESHOLD, transcriptsEnabled } from '../config'
import { instagram } from './platforms/instagram'
import type { RawItem, VideoInsert } from './types'
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

/** Platforms with a meaningful "the client's own account" to read.
 *
 *  Reddit is deliberately absent (Wave 3). A subreddit is a community, not a
 *  brand-owned account — nobody's follower count on r/amputee belongs to Össur,
 *  and Reddit presence is other people talking ABOUT the brand, which is the
 *  discovered corpus by definition. So an own_handles.reddit entry is a
 *  known-unsupported key, not an error: callers filter on this and log a skip.
 *  fetchOwnProfile still throws for a genuinely unknown platform — that is a
 *  programming error and should stay loud. */
export const OWNED_PROFILE_PLATFORMS = ['tiktok', 'youtube', 'instagram'] as const

export function supportsOwnedProfile(platform: string): boolean {
  return (OWNED_PROFILE_PLATFORMS as readonly string[]).includes(platform)
}

/** One platform's profile read: the snapshot numbers + recent own posts
 *  (already shaped as VideoInsert rows, WITHOUT source — the orchestrator
 *  stamps source:'owned' + is_client:true on write). */
export interface OwnProfile {
  handle: string
  followers: number | null
  postsCount: number | null
  recentPosts: VideoInsert[]
  /** Raw item per recent post (video_id → item), for the transcript layer
   *  (Brand Voice, 2026-08-16). Own posts used to bypass `video_raw` and so
   *  were never transcribed on any platform — the client's own words were
   *  invisible to say-vs-hear. YT: the Data API item · TT: the profile item
   *  (media/caption fields kept via customMapFunction) · IG: the full post
   *  from a posts-mode refetch (the profile read returns summaries only). */
  raws?: Record<string, RawItem>
  /** Non-fatal problems worth a run error (e.g. the IG transcript refetch failed). */
  warnings?: string[]
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
 * Did a profile read come back empty because the account IS empty, or because
 * the scrape glitched?
 *
 * The IG details actor intermittently returns a live profile (followers present)
 * with `latestPosts: []`. That reads as "no recent posts", so the step writes
 * nothing, raises nothing, and the week's owned layer silently vanishes — which
 * is what happened on 2026-08-16.
 *
 * The glitch does NOT present consistently: on the failed run the same handle
 * reported postsCount 1,494 with no posts; an hour later it returned 12 posts;
 * an hour after that, postsCount null with no posts. So postsCount cannot be
 * the tell — it is itself part of what glitches (a known Wave 2 finding: IG
 * details-mode postsCount is nullable).
 *
 * Hence the rule is inverted: zero recent posts is a glitch UNLESS the platform
 * explicitly says the account has zero posts. Only `postsCount === 0` is real
 * emptiness; null is a scrape that didn't answer the question and gets retried.
 * The cost of being wrong is a non-fatal step error on a genuinely empty
 * account — loud and recorded, which beats losing a week of owned data silently.
 */
export function emptyProfileIsGlitch(postsCount: number | null, recentPosts: number): boolean {
  if (recentPosts > 0) return false
  return postsCount !== 0
}

/**
 * Give EVERY owned-post row an explicit `source`, preserving what a already-known
 * post already had.
 *
 * Two constraints collide here. (a) A client post the keyword gather already
 * discovered must stay 'discovered' — it has been in the SoV series since it was
 * found, and flipping it out would fake a share decline (metric continuity beats
 * layer purity); a post already stored as 'owned' must likewise stay 'owned'.
 * (b) PostgREST takes the UNION of keys across a bulk upsert and sends NULL for
 * any row missing one — it does not fall back to the column default. So the old
 * "omit source on known rows" approach sent `source: NULL` the moment one row in
 * the batch carried the key, and the NOT NULL constraint rejected the whole
 * statement (23502, YouTube, 2026-08-16 — 2 of 12 posts already known).
 *
 * Setting every row explicitly satisfies both: known rows echo their stored
 * value back unchanged, new rows get 'owned'.
 */
export function stampOwnedSource<T extends { video_id: string }>(
  posts: T[],
  existing: { video_id: string; source: string | null }[],
): (T & { source: string })[] {
  const stored = new Map(existing.map((r) => [r.video_id, r.source]))
  return posts.map((p) => ({ ...p, source: stored.get(p.video_id) ?? 'owned' }))
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
  const raws: Record<string, RawItem> = {}
  for (const item of raw.slice(0, OWN_POSTS_LIMIT)) {
    const v = item as RawItem
    const id = str(v.id)
    const url = str(getPath(v, ['postPage']))
    if (!id || !url) continue
    raws[id] = v
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
      // Math.round, matching the discovered path (platforms/tiktok.ts): TikTok
      // reports fractional seconds (35.029) and videos.duration_seconds is an
      // integer column. Sending the float rejected the whole upsert with 22P02
      // on every retry — the deterministic half of the 2026-08-16 failure.
      duration_seconds: Math.round(num(getPath(v, ['video', 'duration']))),
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
    raws,
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

  const raws: Record<string, RawItem> = {}
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
            raws[id] = v
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
    raws,
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
    const profile = igProfile(handle, raw, ctx)
    // The details read returns post SUMMARIES (no media url). For the
    // transcript layer, refetch the recent posts in posts mode — the same
    // by-URL call the backfill uses — and key the full items by shortcode.
    // Best-effort: a refetch failure costs this week's own transcripts, not
    // the owned layer — but it is REPORTED (profile.warnings → run errors), so
    // a week with zero own-voice claims never passes as a clean run.
    if (transcriptsEnabled() && profile.recentPosts.length) {
      try {
        const { actor, input } = instagram.refetchByUrl!(profile.recentPosts.map((p) => p.video_url))
        const full = await runActor(actor, input, { timeoutSecs: 180 })
        profile.raws = igRawsByShortcode(full)
        const filed = profile.recentPosts.filter((p) => profile.raws![p.video_id]).length
        if (filed === 0) profile.warnings = [`instagram refetch returned no matching posts (${full.length} items for ${profile.recentPosts.length} posts)`]
      } catch (e) {
        profile.warnings = [`instagram refetch for transcripts failed: ${e instanceof Error ? e.message : String(e)}`]
      }
    }
    return profile
  }
  if (platform === 'tiktok') {
    const raw = await runActor(APIFY_ACTORS.tiktok.video, {
      startUrls: [`https://www.tiktok.com/@${handle}`],
      maxItems: OWN_POSTS_LIMIT,
      // Keep the media + caption fields — without the passthrough the actor
      // trims them and the transcript layer has nothing to resolve.
      customMapFunction: '(object) => { return {...object} }',
    }, { timeoutSecs: 180 })
    return ttProfile(handle, raw, ctx)
  }
  throw new Error(`no own-profile fetcher for platform: ${platform}`)
}

/** Posts-mode items keyed by shortcode (the IG video_id). Pure; exported for tests. */
export function igRawsByShortcode(items: RawItem[]): Record<string, RawItem> {
  const out: Record<string, RawItem> = {}
  for (const it of items) {
    if (!it || typeof it !== 'object') continue
    const code = str(first(it.shortCode, it.shortcode, it.code)) || (str(it.url).match(/\/(?:p|reel|tv)\/([^/?]+)/)?.[1] ?? '')
    if (code && !out[code]) out[code] = it
  }
  return out
}

/** video_raw rows for this run's own posts that have a raw item — the pool
 *  the transcribe planner reads. Pure; exported for tests. */
export function ownedRawRows(
  posts: VideoInsert[],
  raws: Record<string, RawItem> | undefined,
  ctx: Ctx,
): { client_id: string; run_id: string; platform: string; video_id: string; raw: RawItem }[] {
  if (!raws) return []
  return posts
    .filter((p) => raws[p.video_id])
    .map((p) => ({ client_id: ctx.clientId, run_id: ctx.runId, platform: p.platform, video_id: p.video_id, raw: raws[p.video_id] }))
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
}): Promise<{
  refs: { video_id: string; video_url: string; comments_count: number }[]
  /** Non-fatal degradations the caller should count as run errors. */
  warnings: string[]
}> {
  const profile = await fetchOwnProfile(opts.platform, opts.handle, {
    clientId: opts.clientId,
    runId: opts.runId,
  })
  const warnings: string[] = [...(profile.warnings ?? [])]
  if (emptyProfileIsGlitch(profile.postsCount, profile.recentPosts.length)) {
    throw new Error(
      `owned profile (${opts.platform} @${opts.handle}) returned 0 recent posts but reports ${profile.postsCount} posts — scrape glitch, retrying`,
    )
  }
  if (profile.recentPosts.length) {
    const admin = createAdminClient()
    // A client post the keyword gather ALREADY discovered stays 'discovered' —
    // it has been part of the SoV series since it was found, and flipping it
    // out would fake a share decline (metric continuity beats layer purity).
    // Only posts new to us get source:'owned'.
    const { data: existing, error: exErr } = await admin
      .from('videos')
      .select('video_id, source')
      .eq('client_id', opts.clientId)
      .eq('platform', opts.platform)
      .in('video_id', profile.recentPosts.map((p) => p.video_id))
    if (exErr) throw new Error(`owned posts existing check (${opts.platform}): ${exErr.message}`)
    const rows = stampOwnedSource(
      profile.recentPosts,
      (existing ?? []) as { video_id: string; source: string | null }[],
    )
    const { error } = await admin
      .from('videos')
      .upsert(rows, { onConflict: 'client_id,platform,video_id' })
    if (error) throw new Error(`owned posts upsert (${opts.platform}): ${error.message}`)

    // Transcript layer (Brand Voice): file the raw items so this run's
    // transcribe planner picks the own posts up like any kept video (the
    // owned block runs BEFORE plan-transcribe for exactly this reason). Own
    // posts already known as 'discovered' are included too — harmless upsert,
    // and their NULL status makes them eligible if never transcribed.
    // NON-FATAL (like gather.ts's own video_raw write): a transcript-layer
    // hiccup must never take the owned comment layer down with it.
    if (transcriptsEnabled()) {
      const rawRows = ownedRawRows(profile.recentPosts, profile.raws, { clientId: opts.clientId, runId: opts.runId })
      if (rawRows.length) {
        const { error: rawErr } = await admin
          .from('video_raw')
          .upsert(rawRows, { onConflict: 'client_id,platform,video_id,run_id' })
        if (rawErr) warnings.push(`video_raw upsert failed: ${rawErr.message}`)
      }
      console.log(`[owned-posts:${opts.platform}] transcript raws filed: ${rawRows.length}/${profile.recentPosts.length}`)
    }
  }
  return {
    refs: ownedCommentRefs(profile.recentPosts, {
      windowStart: opts.windowStart,
      threshold: opts.platform === 'youtube' ? 1 : COMMENT_THRESHOLD,
    }),
    warnings,
  }
}
