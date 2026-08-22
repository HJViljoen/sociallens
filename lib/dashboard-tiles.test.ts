import { describe, it, expect } from 'vitest'
import {
  themeTiers, topThemes, bucketKind, platformSplit, sentimentSplit, shareBreakdown, pointDelta,
  movement, accountSeries, topRecommendation, type HistoryRow,
} from './dashboard-tiles'

describe('themeTiers', () => {
  it('splits confirmed / early / once by Voice’s rule', () => {
    const rows = [
      { single_source: false, strength_score: 9 },
      { single_source: false, strength_score: 3 },
      { single_source: true, strength_score: 7 }, // early (≥6)
      { single_source: true, strength_score: 6 }, // early
      { single_source: true, strength_score: 4 }, // once
      { single_source: null, strength_score: null }, // confirmed (not single-source)
    ]
    expect(themeTiers(rows)).toEqual({ confirmed: 3, early: 2, once: 1 })
    expect(themeTiers([])).toEqual({ confirmed: 0, early: 0, once: 0 })
  })
})

describe('topThemes', () => {
  const row = (label: string, rank: number | null, ev: number, str: number, bucket = 'industry-other', first = false) =>
    ({ label, description: null, category: 'praise', bucket, member_themes: [label], evidence_count: ev, strength_score: str, rank_score: rank, first_seen: first })
  it('orders by rank_score, falls back to evidence × strength, maps buckets', () => {
    const out = topThemes([row('b', 5, 1, 1), row('a', 9, 1, 1, 'client', true), row('c', null, 10, 1, 'competitor:Ottobock')], 2, true)
    expect(out.map((t) => t.label)).toEqual(['c', 'a']) // 10 > 9 > 5
    expect(out[1].bucket).toBe('client')
    expect(out[1].isNew).toBe(true)
    expect(out[0].bucket).toBe('competitor')
  })
  it('hides New badges when there is nothing earlier to compare with', () => {
    expect(topThemes([row('a', 1, 1, 1, 'client', true)], 3, false)[0].isNew).toBe(false)
  })
  it('bucketKind', () => {
    expect(bucketKind('client')).toBe('client')
    expect(bucketKind('competitor:X')).toBe('competitor')
    expect(bucketKind('industry-other')).toBe('category')
    expect(bucketKind(null)).toBe('category')
  })
})

describe('platformSplit', () => {
  it('counts per platform, most first, ignores blanks', () => {
    expect(platformSplit([{ platform: 'tiktok' }, { platform: 'TikTok' }, { platform: 'youtube' }, { platform: null }]))
      .toEqual([{ platform: 'tiktok', count: 2 }, { platform: 'youtube', count: 1 }])
  })
})

describe('sentimentSplit', () => {
  it('reads counts + judged + positive share', () => {
    const s = sentimentSplit({ positive: 85.1, judged: 496, counts: { positive: 422, mixed: 47, neutral: 16, negative: 11 } })
    expect(s?.judged).toBe(496)
    expect(s?.positivePct).toBe(85.1)
    expect(s?.counts.mixed).toBe(47)
  })
  it('derives judged from counts and positive from counts when missing; null on nothing', () => {
    const s = sentimentSplit({ positive: null, judged: 0, counts: { positive: 3, negative: 1 } })
    expect(s?.judged).toBe(4)
    expect(s?.positivePct).toBe(75)
    expect(sentimentSplit(null)).toBeNull()
    expect(sentimentSplit({ positive: null, judged: 0 })).toBeNull()
  })
})

describe('shareBreakdown / pointDelta', () => {
  it('splits client, competitors (by volume), rest, tracked total', () => {
    const b = shareBreakdown({
      client: { videos: 27, pct_videos: 5.8 },
      'competitor:Ottobock': { videos: 75, pct_videos: 16 },
      'competitor:Small': { videos: 2, pct_videos: 0.4 },
      'industry-other': { videos: 366, pct_videos: 78.2 },
    })
    expect(b?.client).toEqual({ pct: 5.8, videos: 27 })
    expect(b?.competitors[0].name).toBe('Ottobock')
    expect(b?.rest?.videos).toBe(366)
    expect(b?.tracked).toBe(470)
    expect(shareBreakdown(null)).toBeNull()
    expect(shareBreakdown({})).toBeNull()
  })
  it('pointDelta', () => {
    expect(pointDelta(5.8, 3.5)).toBe(2.3)
    expect(pointDelta(5.8, null)).toBeNull()
  })
})

describe('movement', () => {
  const sov = (c: number, o: number) => ({ client: { videos: 1, pct_videos: c }, 'competitor:Ottobock': { videos: 2, pct_videos: o }, 'industry-other': { videos: 3, pct_videos: 100 - c - o } })
  const row = (id: string, date: string, c: number, o: number, comments: number, pos: number | null, period = true): HistoryRow => ({
    run_id: id, run_date: date,
    total_comments: comments * 3, period_comments: period ? comments : null,
    share_of_voice: sov(c + 1, o + 1), period_share_of_voice: period ? sov(c, o) : null,
    period_sentiment_positive: period ? pos : null,
    audience_sentiment: pos == null ? null : { positive: pos + 1, judged: 400 },
    period_audience_sentiment: pos == null ? null : { positive: pos, judged: 400 },
  })
  it('needs two updates', () => {
    expect(movement([row('a', '2026-08-09', 3.5, 10.7, 5059, 81)], new Map())).toBeNull()
  })
  it('uses the period layer when every row has it; deltas vs previous update', () => {
    const m = movement([row('a', '2026-08-02', 3.9, 10.1, 3600, 83), row('b', '2026-08-09', 3.5, 10.7, 5059, 81), row('c', '2026-08-16', 5.8, 16, 6163, 85)], new Map([['a', 88], ['b', 104], ['c', 120]]))
    expect(m?.layer).toBe('period')
    expect(m?.leadCompetitor).toBe('Ottobock')
    const by = Object.fromEntries(m!.rows.map((r) => [r.key, r]))
    expect(by.yourShare.series).toEqual([3.9, 3.5, 5.8])
    expect(by.yourShare.delta).toBe(2.3)
    expect(by.compShare.delta).toBe(5.3)
    expect(by.positive.value).toBe(85)
    expect(by.positive.delta).toBe(4)
    expect(by.volume.series).toEqual([3600, 5059, 6163])
    expect(by.themes.series).toEqual([88, 104, 120])
  })
  it('falls back to cumulative when any row lacks the period layer and drops sentiment when any row lacks the audience family', () => {
    const m = movement([row('a', '2026-08-02', 3.9, 10.1, 3600, null, false), row('b', '2026-08-09', 3.5, 10.7, 5059, 81)], new Map([['a', 1]]))
    expect(m?.layer).toBe('cumulative')
    const keys = m!.rows.map((r) => r.key)
    expect(keys).not.toContain('positive')
    expect(keys).not.toContain('themes') // not every run counted
    expect(m!.rows.find((r) => r.key === 'yourShare')!.series).toEqual([4.9, 4.5])
    expect(m!.rows.find((r) => r.key === 'volume')!.series).toEqual([10800, 15177])
  })
})

describe('accountSeries', () => {
  it('builds per-platform windows, most followers first, drops single points', () => {
    const snaps = [
      { platform: 'tiktok', snapshot_date: '2026-08-10', followers: 23000 },
      { platform: 'tiktok', snapshot_date: '2026-08-12', followers: 23263 },
      { platform: 'instagram', snapshot_date: '2026-08-12', followers: 61234 },
      { platform: 'instagram', snapshot_date: '2026-08-10', followers: 60000 },
      { platform: 'youtube', snapshot_date: '2026-08-12', followers: 12500 },
      { platform: 'reddit', snapshot_date: '2026-08-12', followers: null },
    ]
    const out = accountSeries(snaps)
    expect(out.map((s) => s.platform)).toEqual(['instagram', 'tiktok'])
    expect(out[0].values).toEqual([60000, 61234])
    expect(out[0].delta).toBe(1234)
    expect(Math.round(out[0].deltaPct * 10) / 10).toBe(2.1)
  })
  it('windows by date, not by count', () => {
    const day = (i: number) => { const d = new Date('2026-07-01T00:00:00Z'); d.setUTCDate(d.getUTCDate() + i); return d.toISOString().slice(0, 10) }
    const snaps = Array.from({ length: 40 }, (_, i) => ({ platform: 'x', snapshot_date: day(i), followers: 100 + i }))
    const out = accountSeries(snaps, 30)
    expect(out[0].values.length).toBe(30)
    expect(out[0].values[0]).toBe(110)
    // a gap in collection narrows the line instead of reaching further back
    const gappy = [{ platform: 'x', snapshot_date: '2026-05-01', followers: 1 }, { platform: 'x', snapshot_date: '2026-08-10', followers: 5 }, { platform: 'x', snapshot_date: '2026-08-12', followers: 7 }]
    expect(accountSeries(gappy, 30)[0].values).toEqual([5, 7])
  })
})

describe('topRecommendation', () => {
  it('prefers priority, then grounding', () => {
    const recs = [
      { id: 'a', priority: 'medium', based_on: { insight_ids: ['1', '2', '3'] } },
      { id: 'b', priority: 'high', based_on: { insight_ids: ['1'] } },
      { id: 'c', priority: 'high', based_on: { insight_ids: ['1', '2'] } },
      { id: 'd', priority: null, based_on: null },
    ]
    expect(topRecommendation(recs)?.id).toBe('c')
    expect(topRecommendation([])).toBeNull()
  })
})
