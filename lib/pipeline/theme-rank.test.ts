import { describe, it, expect } from 'vitest'
import { themeRank, compareThemes } from './step-a2'
import type { AggregatedTheme } from './types'

const t = (over: Partial<AggregatedTheme>): AggregatedTheme => ({
  bucket: 'industry-other', category: 'praise', theme: 'a', memberThemes: [],
  supportingVideoIds: [], supportingInsightIds: [], evidenceCount: 0,
  strengthScore: 0, meanStrength: 0, rankScore: 0,
  dominantEmotion: 'x', dominantSentimentImpact: 'positive',
  singleSource: false, sampleDescriptions: [], ...over,
})

describe('themeRank — evidence x share of bucket (Tier 1)', () => {
  it('the measured defect: a 47-video theme now outranks a 3-video one', () => {
    const wide = themeRank(47, 400)
    const narrow = themeRank(3, 400)
    expect(wide).toBeGreaterThan(narrow)
  })

  it('normalises across buckets, so a small competitor bucket is comparable', () => {
    // 6 of a 10-video competitor bucket is a bigger deal than 6 of 400.
    expect(themeRank(6, 10)).toBeGreaterThan(themeRank(6, 400))
  })

  it('keeps volume primary: a dominant tiny bucket does not beat a huge theme', () => {
    // 3 of 3 in a thin bucket vs 104 of 400 in the category.
    expect(themeRank(104, 400)).toBeGreaterThan(themeRank(3, 3))
  })

  it('a theme spanning its whole bucket scores its evidence count', () => {
    expect(themeRank(12, 12)).toBe(12)
  })

  it('is not tripped up by a share above 1 or a zero denominator', () => {
    expect(themeRank(5, 2)).toBe(5)
    expect(themeRank(5, 0)).toBe(5)
    expect(themeRank(0, 100)).toBe(0)
  })
})

describe('compareThemes — the order Pass C and D-a read as salience', () => {
  it('ranks by rankScore, not by the strongest member insight', () => {
    // The live shape: a 3-video theme whose best insight scored 9, against a
    // 47-video theme whose best scored 8.
    const sharp = t({ theme: 'sharp', evidenceCount: 3, strengthScore: 9, rankScore: themeRank(3, 400) })
    const wide = t({ theme: 'wide', evidenceCount: 47, strengthScore: 8, rankScore: themeRank(47, 400) })
    expect([sharp, wide].sort(compareThemes).map((x) => x.theme)).toEqual(['wide', 'sharp'])
  })

  it('breaks a rank tie on mean strength, not max', () => {
    const strong = t({ theme: 'strong', rankScore: 5, meanStrength: 7, strengthScore: 7 })
    const weak = t({ theme: 'weak', rankScore: 5, meanStrength: 4, strengthScore: 10 })
    expect([weak, strong].sort(compareThemes).map((x) => x.theme)).toEqual(['strong', 'weak'])
  })

  it('is stable and total, so two identical themes never reorder run to run', () => {
    const a = t({ theme: 'aaa', rankScore: 5, meanStrength: 5 })
    const b = t({ theme: 'bbb', rankScore: 5, meanStrength: 5 })
    expect([b, a].sort(compareThemes).map((x) => x.theme)).toEqual(['aaa', 'bbb'])
    expect([a, b].sort(compareThemes).map((x) => x.theme)).toEqual(['aaa', 'bbb'])
  })
})
