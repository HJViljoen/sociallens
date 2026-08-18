import { describe, it, expect } from 'vitest'
import { evidenceOf } from './calibration'

describe('evidenceOf — every number carries its denominator (Tier 1)', () => {
  it('renders the shape this module promised and never shipped', () => {
    expect(evidenceOf(21, 36)).toBe('21 of 36 conversations')
  })

  it('takes a noun, because not everything is a conversation', () => {
    expect(evidenceOf(3, 120, 'mentions')).toBe('3 of 120 mentions')
  })

  it('omits a denominator rather than inventing one', () => {
    expect(evidenceOf(5, null)).toBe('5 conversations')
    expect(evidenceOf(5, 0)).toBe('5 conversations')
    expect(evidenceOf(5, undefined)).toBe('5 conversations')
  })

  it('refuses a denominator smaller than the count instead of printing nonsense', () => {
    // "7 of 3" would be worse than no denominator at all.
    expect(evidenceOf(7, 3)).toBe('7 conversations')
  })

  it('groups thousands so a big corpus stays readable', () => {
    expect(evidenceOf(1204, 18440)).toBe('1,204 of 18,440 conversations')
  })
})
