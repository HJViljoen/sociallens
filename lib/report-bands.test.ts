import { describe, it, expect } from 'vitest'
import { proportionDelta, SENTIMENT_BAND, SHARE_BAND } from './report-bands'

describe('proportionDelta — floors and bands (T0-8)', () => {
  it('the sent "+6.2" (n=129 vs n=414, z≈1.7) sits inside the band → no clear change', () => {
    const v = proportionDelta({ nowPct: 65.2, nowN: 414, prevPct: 59.0, prevN: 129 }, SENTIMENT_BAND)
    expect(v.state).toBe('no_clear_change')
    expect(v.change).toBe(6.2)
    expect(v.band).toBeGreaterThan(6.2) // ≈ 9.8 pts at these n
  })

  it('under 100 judged on either side is too little data, whatever the shift', () => {
    const v = proportionDelta({ nowPct: 70, nowN: 414, prevPct: 50, prevN: 80 }, SENTIMENT_BAND)
    expect(v.state).toBe('too_little_data')
  })

  it('a 6.2 pt shift with 1000 judged on both sides clears the band', () => {
    const v = proportionDelta({ nowPct: 65.2, nowN: 1000, prevPct: 59.0, prevN: 1000 }, SENTIMENT_BAND)
    expect(v.state).toBe('moved')
    expect(v.band).toBeGreaterThan(2) // ≈ 4.3 pts, computed, not the floor
    expect(v.band).toBeLessThan(6.2)
  })

  it('a 1.7 pt jitter (LLM re-judgment noise) never clears the 2 pt floor', () => {
    const v = proportionDelta({ nowPct: 61.7, nowN: 5000, prevPct: 60.0, prevN: 5000 }, SENTIMENT_BAND)
    expect(v.state).toBe('no_clear_change')
    expect(v.band).toBe(2)
  })

  it('share of tracked videos needs ≥ 10 of the entity on both sides', () => {
    const v = proportionDelta({ nowPct: 12, nowN: 400, nowK: 48, prevPct: 6, prevN: 400, prevK: 8 }, SHARE_BAND)
    expect(v.state).toBe('too_little_data')
  })

  it('a real share move with enough of everything → moved with sign', () => {
    const v = proportionDelta({ nowPct: 22, nowN: 500, nowK: 110, prevPct: 12, prevN: 500, prevK: 60 }, SHARE_BAND)
    expect(v.state).toBe('moved')
    expect(v.change).toBe(10)
  })

  it('zero denominators are too little data, not a crash', () => {
    const v = proportionDelta({ nowPct: 0, nowN: 0, prevPct: 0, prevN: 0 }, SENTIMENT_BAND)
    expect(v.state).toBe('too_little_data')
    expect(Number.isFinite(v.band)).toBe(true)
  })
})
