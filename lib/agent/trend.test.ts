import { describe, it, expect } from 'vitest'
import { movement } from './trend'

const pts = (...counts: number[]) => counts.map((evidenceCount) => ({ evidenceCount }))

describe('movement', () => {
  it('calls a single reading new, never a direction', () => {
    expect(movement(pts(40))).toBe('new')
  })

  it('refuses a direction below the point floor', () => {
    // Two readings is not a trend, however tempting the shape.
    expect(movement(pts(10, 40))).toBe('too_few')
  })

  it('refuses a direction on tiny counts, however large the ratio', () => {
    // 1 → 4 is a quadrupling and it is also nothing.
    expect(movement(pts(1, 1, 4))).toBe('too_few')
  })

  it('reports rising when the latest clears the prior mean by 25%', () => {
    expect(movement(pts(20, 20, 20, 40))).toBe('rising')
  })

  it('reports fading when the latest drops 25% below the prior mean', () => {
    expect(movement(pts(40, 40, 40, 10))).toBe('fading')
  })

  it('reports steady inside the band', () => {
    expect(movement(pts(20, 20, 20, 22))).toBe('steady')
    expect(movement(pts(20, 20, 20, 18))).toBe('steady')
  })

  it('treats the band edges as steady, not as movement', () => {
    // Exactly ±25% is the boundary; only strictly past it counts.
    expect(movement(pts(20, 20, 20, 24))).toBe('steady')
    expect(movement(pts(20, 20, 20, 16))).toBe('steady')
  })

  it('handles a theme appearing after a run of zeroes', () => {
    expect(movement(pts(0, 0, 0, 30))).toBe('rising')
    expect(movement(pts(0, 0, 0, 0))).toBe('too_few')
  })

  it('is empty-safe', () => {
    expect(movement([])).toBe('too_few')
  })
})
