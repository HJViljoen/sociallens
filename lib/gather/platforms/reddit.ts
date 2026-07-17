import type { PlatformAdapter, GatherConfig, VideoRef, RawItem } from '../types'
import { COMMENT_THRESHOLD } from '../../config'
import { num, str, getPath, toDateOnly } from '../util'
import { tagVideo } from '../tagging'

// Reddit adapter — Reddit's free public JSON endpoints (append `.json` to any
// URL), no Apify actor and no OAuth app. Reddit closed self-service API keys
// under the Nov-2025 Responsible Builder Policy (commercial approval is
// enterprise-tier and near-always rejected for small tools), so the read-only
// public JSON path is the free route: /search.json, /comments/{id}.json,
// /api/info.json. A subreddit post maps onto a "video" and its comment tree onto
// `comments`, so the whole gather → gate → Pass A–D spine works unchanged (Reddit
// has no views/shares — those stay null/0 like Instagram). Flow: /search →
// /comments/{id} → /api/info for the delta re-check counts.
//
// Rate limit: unauthenticated public JSON is ~10 requests/minute per IP, so
// requests are throttled to that ceiling and retried on 429. No credentials are
// required; set REDDIT_USER_AGENT to a descriptive string (Reddit asks for one,
// and a generic UA is more block-prone). If Reddit ever blocks server-side public
// access at our volume, the fallback is an Apify Reddit actor (paid) behind these
// same normalisers.

const REDDIT_BASE = 'https://www.reddit.com'

// ~10 req/min ceiling for unauthenticated public JSON. Each request reserves the
// next slot so even parallel Inngest steps within one process stay paced; across
// separate serverless invocations pacing is best-effort and the 429 retry covers
// the overflow.
const MIN_REQUEST_INTERVAL_MS = 6000

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

function userAgent(): string {
  return process.env.REDDIT_USER_AGENT ?? 'web:verbatim-consumer-intel:v1.0 (by /u/verbatim)'
}

// Serialise requests to the rate ceiling: each call reserves the next slot.
let nextAllowedAt = 0
async function throttle(): Promise<void> {
  const now = Date.now()
  const wait = Math.max(0, nextAllowedAt - now)
  nextAllowedAt = Math.max(now, nextAllowedAt) + MIN_REQUEST_INTERVAL_MS
  if (wait > 0) await sleep(wait)
}

/** Throttled fetch with a small retry on 429 / transient 5xx (honours Retry-After
 *  on 429). Non-transient responses are returned as-is for the caller to handle. */
async function redditFetch(url: string): Promise<Response> {
  for (let attempt = 1; ; attempt++) {
    await throttle()
    const res = await fetch(url, { headers: { 'User-Agent': userAgent() } })
    if (res.ok || attempt > 3 || !(res.status === 429 || res.status >= 500)) return res
    const retryAfter = Number(res.headers.get('retry-after'))
    await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : attempt * 1000)
  }
}

/** GET a public JSON endpoint. `path` is the URL path WITHOUT `.json` (added
 *  here). Returns parsed JSON — a Listing object for /search + /api/info, a
 *  two-element array for /comments/{id}. */
async function redditGet(path: string, params: URLSearchParams): Promise<unknown> {
  params.set('raw_json', '1')
  const res = await redditFetch(`${REDDIT_BASE}${path}.json?${params.toString()}`)
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Reddit ${path} ${res.status}: ${body.slice(0, 200)}`)
  }
  return res.json()
}

/** The `children` array of a Listing (or [] for anything else — '' / missing). */
function listingChildren(listing: unknown): RawItem[] {
  const children = getPath(listing, ['data', 'children'])
  return Array.isArray(children) ? (children as RawItem[]) : []
}

/** report_period → Reddit search time filter. */
function periodToTimeFilter(period: string): string {
  return period === 'daily' ? 'day' : period === 'monthly' ? 'month' : 'week'
}

/** Post type → a coarse content_format label. */
function postFormat(raw: RawItem): string {
  if (getPath(raw, ['is_self'])) return 'text'
  if (getPath(raw, ['is_video'])) return 'video'
  const hint = str(getPath(raw, ['post_hint']))
  if (hint === 'image') return 'image'
  if (hint.includes('video')) return 'video'
  return 'link'
}

export const reddit: PlatformAdapter = {
  platform: 'reddit',

  async fetchVideos(config: GatherConfig, terms: string[], limit: number): Promise<RawItem[]> {
    const keyword = terms[0] ?? ''
    if (!keyword) return []
    const t = periodToTimeFilter(config.report_period)

    // Site-wide post search, paginated with `after` (100/page max) up to `limit`.
    const out: RawItem[] = []
    let after = ''
    while (out.length < limit) {
      const params = new URLSearchParams({
        q: keyword,
        sort: 'relevance',
        t,
        type: 'link', // posts only (not subreddits/users)
        limit: String(Math.min(100, limit - out.length)),
      })
      if (after) params.set('after', after)
      const listing = await redditGet('/search', params)
      const children = listingChildren(listing)
      for (const c of children) {
        if (str(getPath(c, ['kind'])) === 't3') out.push(getPath(c, ['data']) as RawItem)
      }
      after = str(getPath(listing, ['data', 'after']))
      if (!after || !children.length) break
    }
    return out
  },

  normaliseVideo(raw, ctx) {
    const video_id = str(getPath(raw, ['id']))
    if (!video_id) return null
    const permalink = str(getPath(raw, ['permalink']))
    const video_url = permalink ? `https://www.reddit.com${permalink}` : str(getPath(raw, ['url']))
    if (!video_url) return null

    // The subreddit is the useful "account" for consumer intelligence — it says
    // WHERE the conversation lives (r/amputee vs r/prosthetics) — more than the
    // individual poster does. Its subscriber count is the reach proxy.
    const subreddit = str(getPath(raw, ['subreddit']))
    const account_name = subreddit ? `r/${subreddit}` : str(getPath(raw, ['author']))
    const title = str(getPath(raw, ['title']))
    const selftext = str(getPath(raw, ['selftext']))
    const caption = [title, selftext].filter(Boolean).join('\n\n')
    const hashtags: string[] = [] // Reddit has no hashtags

    return {
      client_id: ctx.clientId,
      run_id: ctx.runId,
      platform: 'reddit',
      video_id,
      video_url,
      account_name,
      account_followers: num(getPath(raw, ['subreddit_subscribers'])),
      caption,
      hashtags,
      content_format: postFormat(raw),
      views: null, // Reddit doesn't expose per-post views
      likes: num(getPath(raw, ['score'])), // net upvotes
      shares: 0, // no share metric
      comments_count: num(getPath(raw, ['num_comments'])),
      engagement_rate: null, // no views → no blended engagement (same as Instagram)
      upload_date: toDateOnly(Math.floor(num(getPath(raw, ['created_utc'])))),
      audio_name: '',
      is_sponsored: Boolean(getPath(raw, ['promoted'])),
      duration_seconds: Math.round(num(getPath(raw, ['media', 'reddit_video', 'duration']))),
      ...tagVideo({ account_name, caption, hashtags }, ctx.config),
    }
  },

  async fetchCommentCounts(videoIds: string[]): Promise<Map<string, number>> {
    // Free current comment counts for stored posts (delta re-check). /api/info
    // takes up to 100 fullnames (t3_<id>) per call and returns num_comments.
    const out = new Map<string, number>()
    for (let i = 0; i < videoIds.length; i += 100) {
      const ids = videoIds.slice(i, i + 100).map((id) => `t3_${id}`).join(',')
      const listing = await redditGet('/api/info', new URLSearchParams({ id: ids }))
      for (const c of listingChildren(listing)) {
        const id = str(getPath(c, ['data', 'id']))
        if (id) out.set(id, num(getPath(c, ['data', 'num_comments'])))
      }
    }
    return out
  },

  async fetchComments(video: VideoRef, config: GatherConfig): Promise<RawItem[]> {
    // /comments/{id} returns [postListing, commentsListing]. Walk the tree
    // depth-first, collecting t1 (comment) nodes up to comment_depth; skip the
    // "more" placeholders (we don't expand collapsed threads for V1).
    const res = await redditGet(
      `/comments/${video.video_id}`,
      new URLSearchParams({ sort: 'top', limit: String(config.comment_depth) }),
    )
    const commentsListing = Array.isArray(res) ? res[1] : undefined

    const out: RawItem[] = []
    const walk = (children: RawItem[]) => {
      for (const c of children) {
        if (out.length >= config.comment_depth) return
        if (str(getPath(c, ['kind'])) !== 't1') continue // skip 'more' / non-comments
        const data = getPath(c, ['data']) as RawItem | undefined
        if (!data) continue
        out.push(data)
        const replies = getPath(data, ['replies'])
        if (replies && typeof replies === 'object') walk(listingChildren(replies))
      }
    }
    walk(listingChildren(commentsListing))
    return out
  },

  normaliseComment(raw, video, ctx) {
    const comment_id = str(getPath(raw, ['id']))
    const text = str(getPath(raw, ['body']))
    if (!comment_id || !text) return null
    if (text === '[deleted]' || text === '[removed]') return null // Reddit tombstones carry no signal

    const parent_id = str(getPath(raw, ['parent_id']))
    const replies = getPath(raw, ['replies'])
    return {
      client_id: ctx.clientId,
      run_id: ctx.runId,
      platform: 'reddit',
      video_id: video.video_id,
      comment_id,
      author: str(getPath(raw, ['author'])),
      text,
      likes: num(getPath(raw, ['score'])),
      reply_count: replies && typeof replies === 'object' ? listingChildren(replies).length : 0,
      is_reply: parent_id.startsWith('t1_'), // t3_ = reply to the post; t1_ = reply to a comment
      comment_date: toDateOnly(Math.floor(num(getPath(raw, ['created_utc'])))),
    }
  },

  // Reddit reports num_comments reliably (unlike YouTube), so gate like TikTok/IG:
  // skip the comment fetch on threads under 5 comments (a wasted round-trip here,
  // and thin threads carry little signal). COMMENT_THRESHOLD = 5.
  commentThreshold: COMMENT_THRESHOLD,
}
