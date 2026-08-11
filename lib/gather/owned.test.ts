import { describe, expect, it } from 'vitest'
import { acceptSnapshot, followerFloorPct, weekOverWeekDelta } from './owned'

describe('acceptSnapshot', () => {
  it('rejects null/zero glitch reads', () => {
    expect(acceptSnapshot(61000, null).ok).toBe(false)
    expect(acceptSnapshot(61000, undefined).ok).toBe(false)
    expect(acceptSnapshot(61000, 0)).toEqual({ ok: false, reason: 'zero-count' })
  })

  it('rejects >20% single-step jumps, accepts normal movement', () => {
    expect(acceptSnapshot(61000, 40000).ok).toBe(false) // -34% — wrong-account/logged-out read
    expect(acceptSnapshot(61000, 80000).ok).toBe(false)
    expect(acceptSnapshot(61000, 62500)).toEqual({ ok: true }) // +2.5% — real growth
  })

  it('accepts any positive first reading (no prior)', () => {
    expect(acceptSnapshot(null, 12500)).toEqual({ ok: true })
  })
})

describe('weekOverWeekDelta', () => {
  const row = (d: string, f: number) => ({ snapshot_date: d, followers: f })

  it('pairs the latest point with the newest point ≥~7 days older, not yesterday', () => {
    const rows = [
      row('2026-08-01', 60000),
      row('2026-08-04', 60500), // 7 days before latest — the anchor
      row('2026-08-10', 61200),
      row('2026-08-11', 61234),
    ]
    const d = weekOverWeekDelta(rows)
    expect(d?.vsDate).toBe('2026-08-04')
    expect(d?.pct).toBeCloseTo(((61234 - 60500) / 60500) * 100, 5)
  })

  it('returns null when the series is too shallow for a weekly comparison', () => {
    expect(weekOverWeekDelta([row('2026-08-10', 61200), row('2026-08-11', 61234)])).toBeNull()
    expect(weekOverWeekDelta([row('2026-08-11', 61234)])).toBeNull()
  })

  it('works on a sparse weekly series (exactly 7 days apart)', () => {
    const d = weekOverWeekDelta([row('2026-08-02', 60000), row('2026-08-09', 61200)])
    expect(d?.vsDate).toBe('2026-08-02')
    expect(d?.pct).toBeCloseTo(2, 1)
  })
})

describe('followerFloorPct', () => {
  it('keeps the base floor for exact-count platforms', () => {
    expect(followerFloorPct('instagram', 61234, 1.5)).toBe(1.5)
    expect(followerFloorPct('tiktok', 23258, 1.5)).toBe(1.5)
  })

  it('raises the YouTube floor so 2 rounding steps cannot fake an event', () => {
    // 12,500 subs → 3-sig-fig rounding step = 100 → floor = 2*100/12500 = 1.6%
    expect(followerFloorPct('youtube', 12500, 1.5)).toBeCloseTo(1.6, 5)
    // 999 subs → 3 digits shown exactly (step 1) → base floor stands
    expect(followerFloorPct('youtube', 999, 1.5)).toBe(1.5)
    // 1M subs → step 10,000 → 2% — rounding dominates even at scale
    expect(followerFloorPct('youtube', 1_000_000, 1.5)).toBeCloseTo(2, 5)
  })
})
