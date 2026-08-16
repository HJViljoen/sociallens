import { describe, expect, it } from 'vitest'
import { probeVerdict, buildProbeInput } from './subreddit-probe'
import { SUBREDDIT_PROBE_SAMPLE } from '../config'

// The probe is what stands between a GPT guess and a subreddit being searched on
// real runs. Its job is to reject plausible-sounding communities that aren't
// actually on-category — the Poler/Patagonia failure, structurally prevented.
describe('probeVerdict', () => {
  it('accepts a community where a solid minority of posts are on-category', () => {
    // A genuinely useful community still carries lots of off-category daily
    // chatter around the product talk, so the bar is not a majority.
    expect(probeVerdict(12, 5).status).toBe('active')
    expect(probeVerdict(12, 12).status).toBe('active')
  })

  it('rejects a community that is mostly off-category', () => {
    const v = probeVerdict(12, 3)
    expect(v.status).toBe('rejected')
    expect(v.reason).toContain('25%')
  })

  it('rejects on the absolute floor even when the ratio looks fine', () => {
    // 2 of 4 is 50% and proves nothing — ratio alone is gameable by a small
    // or half-empty sample.
    const v = probeVerdict(4, 2)
    expect(v.status).toBe('rejected')
    expect(v.reason).toContain('floor 3')
  })

  it('treats an unreadable community as a rejection, not a pass', () => {
    const v = probeVerdict(0, 0)
    expect(v.status).toBe('rejected')
    expect(v.reason).toBe('no posts returned')
  })

  it('reports the evidence in the reason either way', () => {
    expect(probeVerdict(12, 8).reason).toContain('8/12')
    expect(probeVerdict(12, 1).reason).toContain('1/12')
  })

  it('honours explicit thresholds', () => {
    expect(probeVerdict(10, 4, { minRatio: 0.5, minKept: 1 }).status).toBe('rejected')
    expect(probeVerdict(10, 5, { minRatio: 0.5, minKept: 1 }).status).toBe('active')
  })
})

describe('buildProbeInput', () => {
  it('samples the community itself and never pays for comments', () => {
    const input = buildProbeInput('amputee')
    expect(input.subredditUrls).toEqual(['amputee'])
    expect(input.maxPostsCount).toBe(SUBREDDIT_PROBE_SAMPLE)
    expect(input.crawlCommentsPerPost).toBe(false)
  })

  it('accepts an explicit sample size', () => {
    expect(buildProbeInput('amputee', 5).maxPostsCount).toBe(5)
  })
})

describe('community harvest input', () => {
  it('pulls a whole community rather than running a keyword search', async () => {
    // The reason Reddit is worth having: the conversation people have when they
    // are NOT using our keywords. A keyword search cannot see it.
    const { reddit } = await import('./platforms/reddit')
    const config = {
      brand_keywords: ['ossur'], competitor_keywords: [], competitor_names: [], industry_keywords: [],
      platforms: ['reddit'], max_videos: 50, comment_depth: 50, report_period: 'weekly',
      own_handles: {}, subreddits: [],
    }
    const { input } = reddit.videoSearch!(config, ['r/amputee'], 50, { community: 'amputee' })
    expect(input.subredditUrls).toEqual(['amputee'])
    expect(input.searchTerms).toBeUndefined() // not a keyword search
    expect(input.crawlCommentsPerPost).toBe(false) // gate first, buy comments later

    // …and without a community it is still the ordinary keyword search.
    const plain = reddit.videoSearch!(config, ['ossur'], 50, {})
    expect(plain.input.searchTerms).toEqual(['ossur'])
    expect(plain.input.subredditUrls).toBeUndefined()
  })
})
