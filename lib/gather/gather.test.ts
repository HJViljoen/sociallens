import { describe, it, expect } from 'vitest'
import { inWindow } from './gather'
import { periodWindowDays } from '../config'
import { reddit } from './platforms/reddit'
import type { GatherConfig, NormaliseCtx, VideoRef } from './types'

// The baseline-vs-flow window rule (teardown §Run 1, defect 6). The invariant
// worth locking: only content KNOWN older than the window is excluded — null
// dates always stay, and a null window (baseline run) keeps everything.

describe('inWindow', () => {
  it('keeps everything on a baseline run (no window)', () => {
    expect(inWindow('2020-01-01', null)).toBe(true)
    expect(inWindow(null, null)).toBe(true)
  })

  it('drops content known older than the window', () => {
    expect(inWindow('2026-07-01', '2026-07-04')).toBe(false)
  })

  it('keeps content inside the window, boundary inclusive', () => {
    expect(inWindow('2026-07-04', '2026-07-04')).toBe(true)
    expect(inWindow('2026-07-09', '2026-07-04')).toBe(true)
  })

  it('keeps null/unknown dates — a patchy platform must never be blanked', () => {
    expect(inWindow(null, '2026-07-04')).toBe(true)
    expect(inWindow(undefined, '2026-07-04')).toBe(true)
  })
})

describe('periodWindowDays', () => {
  it('maps report periods to the shared window lengths', () => {
    expect(periodWindowDays('daily')).toBe(1)
    expect(periodWindowDays('weekly')).toBe(7)
    expect(periodWindowDays('monthly')).toBe(30)
    expect(periodWindowDays('anything-else')).toBe(7) // weekly is the default
  })
})

// The Reddit adapter's normalisers — the only Reddit-specific logic (search /
// comment fetching is thin HTTP over the official API). Locks the post→video and
// comment→comment field mapping: subreddit as the "account", null views/engagement,
// upvotes→likes, epoch→date, tombstone drop, and parent_id→is_reply.

const config: GatherConfig = {
  brand_keywords: ['sealand'],
  competitor_keywords: [],
  competitor_names: [],
  industry_keywords: [],
  platforms: ['reddit'],
  max_videos: 25,
  comment_depth: 50,
  report_period: 'weekly',
  own_handles: {}, // Reddit has no owned-profile concept — see lib/gather/owned.ts
}
const ctx: NormaliseCtx = { clientId: 'c1', runId: 'r1', config }
const videoRef: VideoRef = { video_id: 'abc123', video_url: 'https://www.reddit.com/r/x/comments/abc123/', comments_count: 57 }

describe('reddit.normaliseVideo', () => {
  const post = {
    id: 'abc123',
    permalink: '/r/BuyItForLife/comments/abc123/great_bag/',
    url: 'https://www.reddit.com/r/BuyItForLife/comments/abc123/great_bag/',
    subreddit: 'BuyItForLife',
    subreddit_subscribers: 21000,
    author: 'someuser',
    title: 'This Sealand bag has lasted me 5 years',
    selftext: 'Bought it in 2021 and it still looks new.',
    score: 342,
    num_comments: 57,
    created_utc: 1700000000,
    is_self: true,
  }

  it('maps a post onto a VideoInsert (subreddit as account, null views/engagement)', () => {
    const v = reddit.normaliseVideo(post, ctx)!
    expect(v).not.toBeNull()
    expect(v.platform).toBe('reddit')
    expect(v.video_id).toBe('abc123')
    expect(v.video_url).toBe('https://www.reddit.com/r/BuyItForLife/comments/abc123/great_bag/')
    expect(v.account_name).toBe('r/BuyItForLife')
    expect(v.account_followers).toBe(21000)
    expect(v.caption).toBe('This Sealand bag has lasted me 5 years\n\nBought it in 2021 and it still looks new.')
    expect(v.hashtags).toEqual([])
    expect(v.content_format).toBe('text')
    expect(v.views).toBeNull()
    expect(v.likes).toBe(342)
    expect(v.shares).toBe(0)
    expect(v.comments_count).toBe(57)
    expect(v.engagement_rate).toBeNull()
    expect(v.upload_date).toBe('2023-11-14')
    // brand keyword 'sealand' in the caption → client-tagged via tagVideo
    expect(v.is_client).toBe(true)
  })

  it('returns null when the post has no id', () => {
    expect(reddit.normaliseVideo({ permalink: '/r/x/comments//' }, ctx)).toBeNull()
  })
})

describe('reddit.normaliseComment', () => {
  it('maps a top-level comment (upvotes→likes, parent t3_→not a reply)', () => {
    const c = reddit.normaliseComment(
      { id: 'def456', body: 'Holds up great on trails.', author: 'hiker22', score: 12, created_utc: 1700100000, parent_id: 't3_abc123', replies: '' },
      videoRef,
      ctx,
    )!
    expect(c).not.toBeNull()
    expect(c.platform).toBe('reddit')
    expect(c.video_id).toBe('abc123')
    expect(c.comment_id).toBe('def456')
    expect(c.text).toBe('Holds up great on trails.')
    expect(c.author).toBe('hiker22')
    expect(c.likes).toBe(12)
    expect(c.reply_count).toBe(0)
    expect(c.is_reply).toBe(false)
    expect(c.comment_date).toBe('2023-11-16')
  })

  it('flags replies via parent_id and counts nested replies', () => {
    const c = reddit.normaliseComment(
      {
        id: 'ghi789', body: 'Same here.', author: 'u2', score: 3, created_utc: 1700100000, parent_id: 't1_def456',
        replies: { kind: 'Listing', data: { children: [{ kind: 't1', data: { id: 'x' } }] } },
      },
      videoRef,
      ctx,
    )!
    expect(c.is_reply).toBe(true)
    expect(c.reply_count).toBe(1)
  })

  it('drops removed/deleted tombstones', () => {
    expect(reddit.normaliseComment({ id: 'a', body: '[deleted]', parent_id: 't3_abc123' }, videoRef, ctx)).toBeNull()
    expect(reddit.normaliseComment({ id: 'b', body: '[removed]', parent_id: 't3_abc123' }, videoRef, ctx)).toBeNull()
  })
})
