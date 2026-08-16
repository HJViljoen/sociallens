import { describe, it, expect } from 'vitest'
import { inWindow, resolveScrapeCap } from './gather'
import { periodWindowDays } from '../config'
import { reddit } from './platforms/reddit'
import { usableTranscript } from '../pipeline/transcript-input'
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

// The Reddit adapter's normalisers — the only Reddit-specific logic (search and
// comment fetching are Apify actor calls). Fixtures below are REAL output from a
// live harshmaur/reddit-scraper run on 2026-08-13, not hand-written: the actor
// renames raw Reddit JSON to camelCase, so these lock the rename. Covers the
// post→video and comment→comment mapping, subreddit-as-account, null
// views/engagement, upvotes→likes, ISO dates, tombstone drop, depth→is_reply,
// and the shared-dataset dataType guard.

const config: GatherConfig = {
  brand_keywords: ['ossur'],
  competitor_keywords: [],
  competitor_names: [],
  industry_keywords: [],
  platforms: ['reddit'],
  max_videos: 25,
  comment_depth: 50,
  report_period: 'weekly',
  own_handles: {}, // Reddit has no owned-profile concept — see lib/gather/owned.ts
  subreddits: [],
}
const ctx: NormaliseCtx = { clientId: 'c1', runId: 'r1', config }
const videoRef: VideoRef = { video_id: '1vln07j', video_url: 'https://www.reddit.com/r/Prosthetics/comments/1vln07j/', comments_count: 16 }

describe('reddit.normaliseVideo', () => {
  // Real item, trimmed to the fields the normaliser reads.
  const post = {
    dataType: 'post',
    id: 't3_1vln07j',
    parsedId: '1vln07j',
    postUrl: 'https://www.reddit.com/r/Prosthetics/comments/1vln07j/wearing_flip_flops/',
    communityName: 'r/Prosthetics',
    subredditSubscribers: 8686,
    authorName: 'ncalor',
    title: 'Wearing flip flops with a prosthetic foot',
    body: 'I am a below knee amputee and i have an ossur foot cover.',
    score: 7,
    upVotes: 7,
    commentsCount: 16,
    createdAt: '2026-08-11T16:52:46.000Z',
    isSelf: true,
    postType: 'text',
  }

  it('maps a post onto a VideoInsert (subreddit as account, null views/engagement)', () => {
    const v = reddit.normaliseVideo(post, ctx)!
    expect(v).not.toBeNull()
    expect(v.platform).toBe('reddit')
    expect(v.video_id).toBe('1vln07j') // bare id, not the t3_ fullname
    expect(v.video_url).toBe('https://www.reddit.com/r/Prosthetics/comments/1vln07j/wearing_flip_flops/')
    expect(v.account_name).toBe('r/Prosthetics') // actor already prefixes it
    expect(v.account_followers).toBe(8686)
    expect(v.caption).toBe('Wearing flip flops with a prosthetic foot\n\nI am a below knee amputee and i have an ossur foot cover.')
    expect(v.hashtags).toEqual([])
    expect(v.content_format).toBe('text')
    expect(v.views).toBeNull()
    expect(v.likes).toBe(7)
    expect(v.shares).toBe(0)
    expect(v.comments_count).toBe(16)
    expect(v.engagement_rate).toBeNull()
    expect(v.upload_date).toBe('2026-08-11') // ISO string, not an epoch
    // brand keyword 'ossur' in the body → client-tagged via tagVideo
    expect(v.is_client).toBe(true)
  })

  it('falls back to stripping t3_ when parsedId is absent (actor drift)', () => {
    const v = reddit.normaliseVideo({ ...post, parsedId: undefined }, ctx)!
    expect(v.video_id).toBe('1vln07j')
  })

  it('returns null for a comment riding along in the same dataset', () => {
    expect(reddit.normaliseVideo({ dataType: 'comment', id: 'p32nf5i' }, ctx)).toBeNull()
  })

  it('returns null when the post has no id', () => {
    expect(reddit.normaliseVideo({ dataType: 'post', postUrl: 'https://reddit.com/x' }, ctx)).toBeNull()
  })
})

describe('reddit.normaliseComment', () => {
  it('maps a top-level comment (upvotes→likes, depth 0 → not a reply)', () => {
    const c = reddit.normaliseComment(
      {
        dataType: 'comment', id: 'p32nf5i', postId: 't3_1vln07j', parentId: 't3_1vln07j',
        authorName: 'rickinmcchickin', body: 'Velcro strip on the bottom of your foot soft part.',
        score: 5, depth: 0, commentCreatedAt: '2026-08-11T17:08:31.000Z',
      },
      videoRef,
      ctx,
    )!
    expect(c).not.toBeNull()
    expect(c.platform).toBe('reddit')
    expect(c.video_id).toBe('1vln07j')
    expect(c.comment_id).toBe('p32nf5i')
    expect(c.text).toBe('Velcro strip on the bottom of your foot soft part.')
    expect(c.author).toBe('rickinmcchickin')
    expect(c.likes).toBe(5)
    expect(c.reply_count).toBe(0) // actor flattens the tree — placeholder, not a measurement
    expect(c.is_reply).toBe(false)
    expect(c.comment_date).toBe('2026-08-11')
  })

  it('flags a nested reply via depth', () => {
    const c = reddit.normaliseComment(
      {
        dataType: 'comment', id: 'p33hcwd', postId: 't3_1vln07j', parentId: 't1_p32nf5i',
        authorName: 'eml_raleigh', body: 'I have not tried this.', score: 2, depth: 1,
        commentCreatedAt: '2026-08-11T19:14:25.000Z',
      },
      videoRef,
      ctx,
    )!
    expect(c.is_reply).toBe(true)
  })

  it('drops the post that rides along in the comment dataset', () => {
    expect(reddit.normaliseComment({ dataType: 'post', id: '1vln07j', body: 'post body' }, videoRef, ctx)).toBeNull()
  })

  it('drops removed/deleted tombstones', () => {
    expect(reddit.normaliseComment({ dataType: 'comment', id: 'a', body: '[deleted]', depth: 0 }, videoRef, ctx)).toBeNull()
    expect(reddit.normaliseComment({ dataType: 'comment', id: 'b', body: '[removed]', depth: 0 }, videoRef, ctx)).toBeNull()
  })
})

describe('reddit.commentScrape', () => {
  it('caps comment depth so one fat thread cannot run up the bill', () => {
    // config.comment_depth is 50; the Reddit cap is 40.
    const { input } = reddit.commentScrape!(videoRef, config)
    expect(input.maxCommentsPerPost).toBe(40)
    expect(input.startUrls).toEqual([{ url: videoRef.video_url }])
  })

  it('respects a tenant depth below the cap', () => {
    const { input } = reddit.commentScrape!(videoRef, { ...config, comment_depth: 10 })
    expect(input.maxCommentsPerPost).toBe(10)
  })
})

describe('reddit.videoSearch', () => {
  it('does not buy comments during search — the gate sits in between', () => {
    const { input } = reddit.videoSearch!(config, ['ossur prosthetic'], 50)
    expect(input.crawlCommentsPerPost).toBe(false)
    expect(input.searchTerms).toEqual(['ossur prosthetic'])
    expect(input.maxPostsCount).toBe(50)
    expect(input.searchTime).toBe('week') // weekly report period
  })
})

describe('reddit.extractTranscript', () => {
  // Selftext-as-transcript: a post body is the OP's own words, so it rides the
  // existing transcript machinery (Pass A grounding, claims, evidence) unchanged.
  it('promotes a real selftext to an ok transcript', () => {
    const t = reddit.extractTranscript!({
      dataType: 'post',
      body: 'I am a below knee amputee and i have an ossur foot cover. i have so many issues with flip flops.',
    })!
    expect(t.status).toBe('ok')
    expect(t.source).toBe('reddit_selftext')
    expect(t.text).toContain('ossur foot cover')
    expect(t.whisperMinutes).toBeUndefined() // free — nothing to bill
  })

  it('marks a link/image post no_speech rather than faking an empty transcript', () => {
    // usableTranscript() only accepts status 'ok', so this is what keeps empty
    // bodies out of Pass A instead of grounding it on nothing.
    for (const body of ['', 'nice', undefined]) {
      const t = reddit.extractTranscript!({ dataType: 'post', body })!
      expect(t.status).toBe('no_speech')
      expect(t.text).toBe('')
      expect(t.source).toBeNull()
    }
  })

  it('ignores comments riding along in the same dataset', () => {
    expect(reddit.extractTranscript!({ dataType: 'comment', body: 'a'.repeat(80) })).toBeNull()
  })

  it('lands on the right side of usableTranscript — the gate Pass A actually reads', () => {
    const ok = reddit.extractTranscript!({ dataType: 'post', body: 'My Ossur foot cover frays every few months and I keep replacing it.' })!
    const stub = reddit.extractTranscript!({ dataType: 'post', body: '' })!
    // usableTranscript is what stands between a transcript and Pass A grounding.
    expect(usableTranscript({ transcript: ok.text, transcript_status: ok.status })).toContain('Ossur foot cover')
    expect(usableTranscript({ transcript: stub.text, transcript_status: stub.status })).toBeNull()
  })
})

describe('reddit caption vs transcript duplication', () => {
  it('caps the selftext carried in caption — Pass A prints both', () => {
    // The body is stored as the transcript too, so every char in caption is
    // paid twice per video. Reddit selftexts run to tens of thousands of chars.
    const long = 'x'.repeat(5000)
    const v = reddit.normaliseVideo({ dataType: 'post', parsedId: 'p1', postUrl: 'https://reddit.com/r/x/comments/p1/', communityName: 'r/x', title: 'T', body: long }, ctx)!
    expect(v.caption.length).toBeLessThan(700)
    // …but the full body still reaches analysis, via the transcript.
    expect(reddit.extractTranscript!({ dataType: 'post', body: long })!.text).toHaveLength(5000)
  })

  it('still tags a brand mentioned in the body', () => {
    // tagVideo reads caption, so the body cannot vanish from it entirely.
    const v = reddit.normaliseVideo({ dataType: 'post', parsedId: 'p2', postUrl: 'https://reddit.com/r/x/comments/p2/', communityName: 'r/x', title: 'Foot covers', body: 'i have an ossur foot cover and it frays' }, ctx)!
    expect(v.is_client).toBe(true)
  })
})

describe('resolveScrapeCap', () => {
  // videoLimit is a COST-CONTROL lever. On the one platform carrying its own
  // ceiling it must only ever tighten — otherwise an operator capping a TikTok
  // test would silently raise Reddit's guard.
  it('caps Reddit by default and leaves other platforms uncapped', () => {
    expect(resolveScrapeCap('reddit')).toBe(25)
    expect(resolveScrapeCap('tiktok')).toBeNull()
    expect(resolveScrapeCap('instagram')).toBeNull()
  })

  it('lets an explicit limit tighten Reddit but never loosen it', () => {
    expect(resolveScrapeCap('reddit', 10)).toBe(10)
    expect(resolveScrapeCap('reddit', 60)).toBe(25) // not 60
  })

  it('honours an explicit limit on uncapped platforms', () => {
    expect(resolveScrapeCap('tiktok', 60)).toBe(60)
  })

  it('treats an explicit 0 as "scrape nothing", not "uncapped"', () => {
    expect(resolveScrapeCap('reddit', 0)).toBe(0)
    expect(resolveScrapeCap('tiktok', 0)).toBe(0)
  })
})
