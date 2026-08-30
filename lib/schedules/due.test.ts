import { describe, expect, it } from 'vitest'
import { monthKey, scheduleDue } from './due'

const run = '2026-09-06T04:05:00Z' // Sunday 06:05 SAST

describe('scheduleDue', () => {
  it('an inactive schedule never fires', () => {
    expect(scheduleDue({ cadence: 'every_update', active: false }, null, run)).toBe(false)
    expect(scheduleDue({ cadence: 'monthly', active: false }, null, run)).toBe(false)
  })
  it('every update: fires whenever the update did', () => {
    expect(scheduleDue({ cadence: 'every_update', active: true }, null, run)).toBe(true)
    expect(scheduleDue({ cadence: 'every_update', active: true }, '2026-09-05T04:05:00Z', run)).toBe(true)
  })
  it('monthly: the first update of a month fires, the second does not', () => {
    const s = { cadence: 'monthly' as const, active: true }
    expect(scheduleDue(s, null, run)).toBe(true)
    expect(scheduleDue(s, '2026-08-30T05:10:00Z', run)).toBe(true) // last month
    expect(scheduleDue(s, '2026-09-06T05:10:00Z', '2026-09-13T04:05:00Z')).toBe(false) // same month
  })
  it('months are read in SAST, not UTC', () => {
    // 23:30 UTC on 31 Aug is 01:30 SAST on 1 Sep
    expect(monthKey('2026-08-31T23:30:00Z', 'Africa/Johannesburg')).toBe('2026-09')
    expect(monthKey('2026-08-31T23:30:00Z', 'UTC')).toBe('2026-08')
    expect(scheduleDue({ cadence: 'monthly', active: true }, '2026-08-30T05:10:00Z', '2026-08-31T23:30:00Z')).toBe(true)
  })
})
