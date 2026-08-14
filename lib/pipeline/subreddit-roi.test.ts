import { describe, expect, it } from 'vitest'
import { computeSubredditRoi, dropCandidates, type RoiVideo } from './subreddit-roi'

const v = (id: string, account_name: string | null, comments: number, platform = 'reddit'): RoiVideo => ({
  id, platform, account_name, comments,
})

describe('computeSubredditRoi', () => {
  it('aggregates posts, comments and insights per community', () => {
    const videos = [v('1', 'r/amputee', 10), v('2', 'r/amputee', 4), v('3', 'r/Prosthetics', 8)]
    const insights = [{ source_video_id: '1' }, { source_video_id: '1' }, { source_video_id: '3' }]
    const rows = computeSubredditRoi(videos, insights, 3)
    const amputee = rows.find((r) => r.subreddit === 'amputee')!
    expect(amputee).toMatchObject({ posts: 2, comments: 14, insights: 2, yield: 1 })
    expect(rows.find((r) => r.subreddit === 'prosthetics')).toMatchObject({ posts: 1, insights: 1 })
  })

  it('counts eligible against the Reddit Pass A floor, not the post count', () => {
    // 'eligible' must mean "earned a GPT call", otherwise yield is measured
    // against posts that were never analysed.
    const rows = computeSubredditRoi([v('1', 'r/amputee', 5), v('2', 'r/amputee', 2)], [], 3)
    expect(rows[0].posts).toBe(2)
    expect(rows[0].eligible).toBe(1)
  })

  it('folds name variants into one row', () => {
    const rows = computeSubredditRoi([v('1', 'r/Amputee', 5), v('2', 'amputee', 5)], [], 3)
    expect(rows).toHaveLength(1)
    expect(rows[0].posts).toBe(2)
  })

  it('ignores user profiles and non-Reddit videos', () => {
    const rows = computeSubredditRoi(
      [v('1', 'u/someone', 9), v('2', '@brand', 9, 'tiktok'), v('3', null, 9)],
      [{ source_video_id: '1' }],
      3,
    )
    expect(rows).toEqual([])
  })

  it('ignores insights whose video is not in the set', () => {
    const rows = computeSubredditRoi([v('1', 'r/amputee', 9)], [{ source_video_id: 'ghost' }, { source_video_id: null }], 3)
    expect(rows[0].insights).toBe(0)
  })

  it('sorts worst yield first — the pruning view', () => {
    const videos = [v('1', 'r/good', 9), v('2', 'r/bad', 9)]
    const rows = computeSubredditRoi(videos, [{ source_video_id: '1' }], 3)
    expect(rows.map((r) => r.subreddit)).toEqual(['bad', 'good'])
  })
})

describe('dropCandidates', () => {
  it('needs a real sample before zero insights means anything', () => {
    const rows = computeSubredditRoi(
      Array.from({ length: 20 }, (_, i) => v(`x${i}`, 'r/dead', 9)),
      [],
      3,
    )
    expect(dropCandidates(rows).map((r) => r.subreddit)).toEqual(['dead'])
  })

  it('does not flag a community that is merely quiet this week', () => {
    const rows = computeSubredditRoi([v('1', 'r/small', 9), v('2', 'r/small', 9)], [], 3)
    expect(dropCandidates(rows)).toEqual([])
  })

  it('never flags a community that produced insights', () => {
    const rows = computeSubredditRoi(
      Array.from({ length: 20 }, (_, i) => v(`x${i}`, 'r/alive', 9)),
      [{ source_video_id: 'x0' }],
      3,
    )
    expect(dropCandidates(rows)).toEqual([])
  })
})
