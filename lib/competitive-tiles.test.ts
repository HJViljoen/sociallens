import { describe, it, expect } from 'vitest'
import {
  competitorShares, leadCompetitor, videoBucket, isAudienceSentiment, bucketStats, themeCounts, pairScale,
  faceOffRows, praisedFor, shareSeries, kindOf, orderInsights, groupByKind, coverageOf, coverageText, competitiveHref,
  SENTIMENT_MIN_JUDGED,
} from './competitive-tiles'

const fmtInt = (n: number) => String(Math.round(n))
const fmtPct = (n: number, d: 0 | 1 = 1) => `${d === 0 ? Math.round(n) : Math.round(n * 10) / 10}%`

const sov = {
  client: { videos: 27, pct_videos: 5.8, analysed_videos: 20 },
  'competitor:Ottobock': { videos: 75, pct_videos: 16, analysed_videos: 40 },
  'competitor:Blatchford': { videos: 4, pct_videos: 0.9, analysed_videos: 2 },
  'industry-other': { videos: 366, pct_videos: 78 },
}

describe('leadCompetitor', () => {
  it('ranks competitor buckets by videos and honours a ?vs= pick case-insensitively', () => {
    expect(competitorShares(sov).map((c) => c.name)).toEqual(['Ottobock', 'Blatchford'])
    expect(leadCompetitor(sov)).toBe('Ottobock')
    expect(leadCompetitor(sov, 'blatchford')).toBe('Blatchford')
    expect(leadCompetitor(sov, 'Nobody')).toBe('Ottobock')
    expect(leadCompetitor(null)).toBeNull()
    expect(leadCompetitor({ client: { videos: 3, pct_videos: 100 } })).toBeNull()
  })
})

describe('bucketStats', () => {
  const rows = [
    { is_client: true, is_competitor: false, competitor_name: null, comments_count: 10, engagement_rate: 4, sentiment: 'positive', sentiment_source: 'audience' },
    { is_client: true, is_competitor: false, competitor_name: null, comments_count: 5, engagement_rate: 0, sentiment: 'negative', sentiment_source: null, analyzed_lane: 'full' },
    { is_client: true, is_competitor: false, competitor_name: null, comments_count: null, engagement_rate: 2, sentiment: 'positive', sentiment_source: 'framing' }, // framing: not judged
    { is_client: false, is_competitor: true, competitor_name: 'Ottobock', comments_count: 100, engagement_rate: 3, sentiment: 'mixed', sentiment_source: 'audience' },
    { is_client: false, is_competitor: false, competitor_name: null, comments_count: 1, engagement_rate: null, sentiment: null },
  ]
  it('buckets videos like share_of_voice and reads the audience family only', () => {
    expect(videoBucket(rows[0])).toBe('client')
    expect(videoBucket(rows[3])).toBe('competitor:Ottobock')
    expect(videoBucket(rows[4])).toBe('industry-other')
    expect(isAudienceSentiment({ sentiment_source: null, analyzed_lane: 'full' })).toBe(true)
    expect(isAudienceSentiment({ sentiment_source: null, analyzed_lane: 'claims_only' })).toBe(false)
    const s = bucketStats(rows)
    expect(s.get('client')).toEqual({ videos: 3, comments: 15, avgEngagement: 3, engagementN: 2, judged: 2, positive: 1 })
    expect(s.get('competitor:Ottobock')).toEqual({ videos: 1, comments: 100, avgEngagement: 3, engagementN: 1, judged: 1, positive: 0 })
    expect(s.get('industry-other')?.avgEngagement).toBeNull()
  })
  it('counts themes per bucket', () => {
    const m = themeCounts([{ bucket: 'client' }, { bucket: 'client' }, { bucket: 'competitor:Ottobock' }, { bucket: null }])
    expect(m.get('client')).toBe(2)
    expect(m.get('competitor:Ottobock')).toBe(1)
    expect(m.get('industry-other')).toBe(1)
  })
})

describe('pairScale', () => {
  it('scales to the larger of the pair and keeps a sliver for zero', () => {
    expect(pairScale(27, 75)).toEqual({ a: 36, b: 100 })
    expect(pairScale(0, 10)).toEqual({ a: 2, b: 100 })
    expect(pairScale(0, 0)).toEqual({ a: 2, b: 2 })
  })
})

describe('faceOffRows', () => {
  const stats = new Map([
    ['client', { videos: 27, comments: 410, avgEngagement: 4.1, engagementN: 20, judged: 10, positive: 9 }],
    ['competitor:Ottobock', { videos: 75, comments: 1180, avgEngagement: 3.2, engagementN: 60, judged: 30, positive: 24 }],
  ])
  const themes = new Map([['client', 11], ['competitor:Ottobock', 14]])
  it('grounds all six rows when every source is there', () => {
    const rows = faceOffRows({ sov, layer: 'period', competitor: 'Ottobock', stats, themes, fmtInt, fmtPct })
    expect(rows.map((r) => r.key)).toEqual(['videos', 'comments', 'share', 'engagement', 'sentiment', 'themes'])
    expect(rows[0].label).toBe('Videos this update')
    expect(rows[0].you).toEqual({ value: 27, text: '27' })
    expect(rows[0].them).toEqual({ value: 75, text: '75' })
    expect(rows[0].themPct).toBe(100)
    expect(rows[2].you.text).toBe('5.8%')
    expect(rows[4].you.text).toBe('90%')
    expect(rows[4].them.text).toBe('80%')
    expect(rows[5].them.value).toBe(14)
  })
  it('labels the cumulative layer honestly', () => {
    const rows = faceOffRows({ sov, layer: 'cumulative', competitor: 'Ottobock', stats, themes, fmtInt, fmtPct })
    expect(rows[0].label).toBe('Videos tracked')
  })
  it('drops rows it cannot ground instead of inventing them', () => {
    const thin = new Map([
      ['client', { videos: 2, comments: 3, avgEngagement: null, engagementN: 0, judged: SENTIMENT_MIN_JUDGED - 1, positive: 1 }],
      ['competitor:Ottobock', { videos: 75, comments: 1180, avgEngagement: 3.2, engagementN: 60, judged: 30, positive: 24 }],
    ])
    const rows = faceOffRows({ sov, layer: 'period', competitor: 'Ottobock', stats: thin, themes: null, fmtInt, fmtPct })
    expect(rows.map((r) => r.key)).toEqual(['videos', 'comments', 'share'])
    expect(faceOffRows({ sov: null, layer: 'period', competitor: 'Ottobock', stats: null, themes: null, fmtInt, fmtPct })).toEqual([])
  })
  it('faces a competitor with no videos this update as zeros, not blanks', () => {
    const rows = faceOffRows({ sov, layer: 'period', competitor: 'Nobody', stats, themes, fmtInt, fmtPct })
    expect(rows[0].them).toEqual({ value: 0, text: '0' })
    expect(rows[0].themPct).toBe(2)
  })
})

describe('praisedFor', () => {
  it('picks the bucket’s top praise theme by rank_score, else nothing', () => {
    const rows = [
      { bucket: 'client', category: 'praise', label: 'Quality and trust', evidence_count: 5, strength_score: 8, rank_score: 9 },
      { bucket: 'client', category: 'praise', label: 'Looks good', evidence_count: 9, strength_score: 9, rank_score: 4 },
      { bucket: 'client', category: 'pain_point', label: 'Price', evidence_count: 30, strength_score: 9, rank_score: 30 },
      { bucket: 'competitor:Ottobock', category: 'praise', label: 'Freedom', evidence_count: 3, strength_score: 7, rank_score: null },
    ]
    expect(praisedFor(rows, 'client')).toBe('Quality and trust')
    expect(praisedFor(rows, 'competitor:Ottobock')).toBe('Freedom')
    expect(praisedFor(rows, 'industry-other')).toBeNull()
  })
})

describe('shareSeries', () => {
  const h = (date: string, client: number, otto: number, period: boolean) => ({
    run_date: date,
    share_of_voice: { client: { videos: 1, pct_videos: client + 1 }, 'competitor:Ottobock': { videos: 1, pct_videos: otto + 1 } },
    period_share_of_voice: period ? { client: { videos: 1, pct_videos: client }, 'competitor:Ottobock': { videos: 1, pct_videos: otto } } : null,
  })
  it('draws one layer across every update and gates on two', () => {
    expect(shareSeries([h('2026-08-09', 3, 9, true)], 'Ottobock')).toBeNull()
    const s = shareSeries([h('2026-08-09', 3.1, 9.2, true), h('2026-08-16', 5.8, 16, true)], 'Ottobock')!
    expect(s.layer).toBe('period')
    expect(s.you).toEqual([3.1, 5.8])
    expect(s.them).toEqual([9.2, 16])
    expect(s.youDelta).toBe(2.7)
    expect(s.themDelta).toBe(6.8)
    expect(s.dates).toEqual(['2026-08-09', '2026-08-16'])
  })
  it('falls back to cumulative for the WHOLE series when one row lacks the period layer', () => {
    const s = shareSeries([h('2026-08-09', 3, 9, false), h('2026-08-16', 5, 16, true)], 'Ottobock')!
    expect(s.layer).toBe('cumulative')
    expect(s.you).toEqual([4, 6])
    expect(s.them).toEqual([10, 17])
  })
  it('has no competitor line without a competitor', () => {
    const s = shareSeries([h('2026-08-09', 3, 9, true), h('2026-08-16', 5, 16, true)], null)!
    expect(s.them).toBeNull()
    expect(s.themDelta).toBeNull()
  })
})

describe('findings', () => {
  it('maps categories to reader kinds and orders lead → threat → gap → tone → other, impact first within a kind', () => {
    expect(kindOf('topic_ownership').label).toBe('Where you lead')
    expect(kindOf('competitive_threat').tone).toBe('threat')
    expect(kindOf('made_up_thing').label).toBe('Made up thing')
    const ins = [
      { id: 'a', category: 'sentiment_differential', impact_level: 'high' },
      { id: 'b', category: 'content_gap', impact_level: 'low' },
      { id: 'c', category: 'topic_ownership', impact_level: 'medium' },
      { id: 'd', category: 'content_gap', impact_level: 'high' },
      { id: 'e', category: 'weird', impact_level: null },
      { id: 'f', category: 'competitive_threat', impact_level: 'medium' },
    ]
    expect(orderInsights(ins).map((i) => i.id)).toEqual(['c', 'f', 'd', 'b', 'a', 'e'])
    expect(groupByKind(ins).map((g) => `${g.kind.label}:${g.items.length}`)).toEqual(['Where you lead:1', 'Threat:1', 'Content gap:2', 'Sentiment differential:1', 'Weird:1'])
  })
  it('reads coverage from the named bucket, null on a name mismatch, thin under the floor', () => {
    expect(coverageOf(sov, 'Ottobock')).toBe(40)
    expect(coverageOf(sov, 'ottobock ')).toBe(40)
    expect(coverageOf(sov, 'Ottobock GmbH')).toBeNull()
    expect(coverageOf(sov, null)).toBeNull()
    expect(coverageOf({ 'competitor:X': { videos: 7, pct_videos: 1 } }, 'X')).toBe(7)
    expect(coverageText(40)).toEqual({ text: '40 videos', thin: false })
    expect(coverageText(2)).toEqual({ text: '2 videos · thin', thin: true })
    expect(coverageText(1)).toEqual({ text: '1 video · thin', thin: true })
    expect(coverageText(null)).toBeNull()
  })
})

describe('competitiveHref', () => {
  it('keeps the ?vs= pick alongside a drawer id', () => {
    expect(competitiveHref(null)).toBe('/dashboard/competitive')
    expect(competitiveHref('Ottobock', 'field')).toBe('/dashboard/competitive?vs=Ottobock&detail=field')
    expect(competitiveHref('Össur Iceland')).toBe('/dashboard/competitive?vs=%C3%96ssur%20Iceland')
    expect(competitiveHref(null, 'findings')).toBe('/dashboard/competitive?detail=findings')
  })
})
