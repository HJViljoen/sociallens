import { describe, expect, it } from 'vitest'
import { passAMinComments, PASS_A_MIN_COMMENTS_DEFAULT } from './config'

// Pass A's comment floor is per-platform (Wave 3). One global 5 was tuned for
// TikTok/Instagram; Reddit threads run 3-8 comments but are far denser per
// comment, so the same floor would skip most of the platform. The floor is
// applied at BOTH gates — the plan step (raw counts) and runPassA (kept counts).
describe('passAMinComments', () => {
  it('lowers the floor for Reddit only', () => {
    expect(passAMinComments('reddit')).toBe(3)
    expect(passAMinComments('tiktok')).toBe(5)
    expect(passAMinComments('instagram')).toBe(5)
    expect(passAMinComments('youtube')).toBe(5)
  })

  it('falls back to the default for an unlisted platform', () => {
    expect(passAMinComments('facebook')).toBe(PASS_A_MIN_COMMENTS_DEFAULT)
    expect(PASS_A_MIN_COMMENTS_DEFAULT).toBe(5)
  })

  it('admits a 3-comment Reddit thread and still rejects a 3-comment TikTok one', () => {
    const kept = 3
    expect(kept >= passAMinComments('reddit')).toBe(true)
    expect(kept >= passAMinComments('tiktok')).toBe(false)
  })
})

describe('reddit gather threshold vs Pass A floor', () => {
  it('scrapes comments down to the same depth Pass A will accept', async () => {
    // If the gather threshold sat above the Pass A floor, threads between the
    // two would never be scraped — so the lowered floor could never fire and
    // A5 would be dead letter. They must not drift apart.
    const { reddit } = await import('./gather/platforms/reddit')
    expect(reddit.commentThreshold).toBe(passAMinComments('reddit'))
  })
})

describe('Reddit cost caps', () => {
  it('caps harvest posts per community below the tenant keyword quota', async () => {
    // A harvest ignores keywords, so max_videos (70 for Ossur) would otherwise
    // apply to EVERY active community.
    const { reddit } = await import('./gather/platforms/reddit')
    const cfg = {
      brand_keywords: [], competitor_keywords: [], competitor_names: [], industry_keywords: [],
      platforms: ['reddit'], max_videos: 70, comment_depth: 50, report_period: 'weekly',
      own_handles: {}, subreddits: [],
    }
    expect(reddit.videoSearch!(cfg, ['r/amputee'], 70, { community: 'amputee' }).input.maxPostsCount).toBe(25)
    // A tenant asking for fewer than the cap still gets fewer.
    expect(reddit.videoSearch!(cfg, ['r/amputee'], 10, { community: 'amputee' }).input.maxPostsCount).toBe(10)
  })
})
