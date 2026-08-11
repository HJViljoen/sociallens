import { describe, expect, it } from 'vitest'
import { detectAccountEvents, weeklyAnchors } from './owned-events'

const snap = (d: string, followers: number, platform = 'instagram') => ({
  platform,
  snapshot_date: d,
  followers,
})

describe('weeklyAnchors', () => {
  it('is the identity on an already-weekly series', () => {
    const series = [snap('2026-07-20', 60000), snap('2026-07-27', 60400), snap('2026-08-03', 60800)]
    expect(weeklyAnchors(series)).toEqual(series)
  })

  it('compresses a daily series to ~weekly points anchored at the latest', () => {
    const daily = Array.from({ length: 15 }, (_, i) =>
      snap(`2026-08-${String(i + 1).padStart(2, '0')}`, 60000 + i * 50),
    )
    const picked = weeklyAnchors(daily)
    expect(picked[picked.length - 1].snapshot_date).toBe('2026-08-15')
    expect(picked.map((p) => p.snapshot_date)).toEqual(['2026-08-01', '2026-08-08', '2026-08-15'])
  })
})

describe('detectAccountEvents on a daily series', () => {
  it('judges week-over-week, so gradual daily growth does not fire', () => {
    // 22 daily points, +0.1%/day ≈ +0.7%/week — under the 1.5% floor.
    const daily = Array.from({ length: 22 }, (_, i) =>
      snap(`2026-07-${String(i + 1).padStart(2, '0')}`, Math.round(60000 * Math.pow(1.001, i))),
    )
    const events = detectAccountEvents({
      snapshots: daily,
      ownedVideos: [],
      runDates: new Map(),
      windowStart: '2026-07-15T06:00:00Z',
      windowEnd: '2026-07-22T06:00:00Z',
    })
    expect(events.filter((e) => e.metric === 'followers')).toHaveLength(0)
  })

  it('a real weekly spike on a daily series fires with an honest week label', () => {
    // 3 flat weeks then +4% in the final week, delivered as daily points.
    const rows = []
    for (let i = 0; i < 22; i++) {
      const base = 60000 + Math.round(i / 7) * 60 // ~0.1%/week baseline drift
      const spike = i >= 15 ? Math.round(60000 * 0.04 * ((i - 14) / 7)) : 0
      rows.push(snap(`2026-07-${String(i + 1).padStart(2, '0')}`, base + spike))
    }
    const events = detectAccountEvents({
      snapshots: rows,
      ownedVideos: [],
      runDates: new Map(),
      windowStart: '2026-07-15T06:00:00Z',
      windowEnd: '2026-07-22T06:00:00Z',
    })
    const follower = events.filter((e) => e.metric === 'followers')
    expect(follower).toHaveLength(1)
    expect(follower[0].magnitudePct).toBeGreaterThan(1.5)
    expect(follower[0].magnitudeLabel).toContain('in a week')
  })

  it('YouTube rounding floor suppresses a one-step rounding artifact', () => {
    // 12,400 → 12,500 "jump" = one 3-sig-fig rounding step (+0.8%) — would
    // clear a naive 0.2-typical baseline ×3 but must not clear the YT floor.
    const rows = [
      snap('2026-07-06', 12400, 'youtube'),
      snap('2026-07-13', 12400, 'youtube'),
      snap('2026-07-20', 12400, 'youtube'),
      snap('2026-07-27', 12500, 'youtube'),
    ]
    const events = detectAccountEvents({
      snapshots: rows,
      ownedVideos: [],
      runDates: new Map(),
      windowStart: '2026-07-20T06:00:00Z',
      windowEnd: '2026-07-27T06:00:00Z',
    })
    expect(events.filter((e) => e.metric === 'followers')).toHaveLength(0)
  })
})
