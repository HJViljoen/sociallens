import { subredditKey } from '../gather/subreddits'

// Per-subreddit ROI (Wave 3) — "is this community producing intelligence, or
// just costing Apify runs?"
//
// Deliberately NOT a new keyword_performance-style table. That table exists
// because gate-DROPPED videos are never stored, so per-keyword survival can only
// be captured at gather time. Per-subreddit survival is already captured
// elsewhere: the discovery probe measures on-category rate per community and
// records it in tracking_configs.subreddits[].probe. What's left — did this
// community's posts actually yield insights — is fully derivable from rows we
// already keep, so this computes it post-hoc instead of adding a table, a
// migration and a gather-time write.
//
// The subreddit comes from videos.account_name ('r/amputee'), canonicalised
// through subredditKey so 'r/Amputee' and 'amputee' are one row.
//
// Pure. The script supplies rows and prints; nothing here decides anything —
// like keyword-roi.ts, this REPORTS drop candidates and never prunes. Dropping a
// data source on one run's numbers is exactly the confounder trap flagged in the
// Wave 1 keyword work.

export interface RoiVideo {
  id: string
  platform: string
  account_name: string | null
  /** Comment count for this video, already resolved by the caller. */
  comments: number
}

export interface RoiInsight {
  source_video_id: string | null
}

export interface SubredditRoiRow {
  subreddit: string
  posts: number
  /** Posts that cleared the Pass A floor, i.e. earned a GPT call. */
  eligible: number
  comments: number
  insights: number
  /** Insights per post — the ranking signal. */
  yield: number
}

/**
 * Aggregate stored Reddit videos + their insights per community.
 *
 * `minComments` is the Pass A floor for Reddit, so `eligible` means "posts that
 * were actually worth a GPT call" rather than "posts we happened to store".
 */
export function computeSubredditRoi(
  videos: RoiVideo[],
  insights: RoiInsight[],
  minComments: number,
): SubredditRoiRow[] {
  const byId = new Map<string, RoiVideo>()
  const acc = new Map<string, SubredditRoiRow>()

  for (const v of videos) {
    if (v.platform !== 'reddit') continue
    const subreddit = subredditKey(v.account_name ?? '')
    if (!subreddit) continue // user profiles and junk are not communities
    byId.set(v.id, v)
    const row = acc.get(subreddit) ?? { subreddit, posts: 0, eligible: 0, comments: 0, insights: 0, yield: 0 }
    row.posts++
    row.comments += v.comments
    if (v.comments >= minComments) row.eligible++
    acc.set(subreddit, row)
  }

  for (const i of insights) {
    if (!i.source_video_id) continue
    const v = byId.get(i.source_video_id)
    if (!v) continue
    const subreddit = subredditKey(v.account_name ?? '')
    const row = acc.get(subreddit)
    if (row) row.insights++
  }

  return [...acc.values()]
    .map((r) => ({ ...r, yield: r.posts ? Math.round((r.insights / r.posts) * 100) / 100 : 0 }))
    .sort((a, b) => a.yield - b.yield || b.posts - a.posts) // worst first, like keyword-roi
}

/** Communities worth an operator's attention. Conservative on purpose: a
 *  community needs a real sample behind it before zero insights means anything,
 *  since a quiet week is not a dead subreddit. */
export function dropCandidates(rows: SubredditRoiRow[], minPosts = 15): SubredditRoiRow[] {
  return rows.filter((r) => r.posts >= minPosts && r.insights === 0)
}
