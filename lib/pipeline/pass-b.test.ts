import { describe, it, expect } from 'vitest'
import { chunkThemesForLabelling, humaniseSlug } from './pass-b'
import type { AggregatedTheme } from './types'

const theme = (bucket: string, i: number): AggregatedTheme =>
  ({ bucket, category: 'c', theme: `t_${i}`, memberThemes: [], sampleDescriptions: [] } as unknown as AggregatedTheme)

const indexed = (specs: [string, number][]) => {
  const out: { label: string; theme: AggregatedTheme }[] = []
  let n = 0
  for (const [bucket, count] of specs) {
    for (let i = 0; i < count; i++) out.push({ label: `T${++n}`, theme: theme(bucket, n) })
  }
  return out
}

describe('chunkThemesForLabelling (T0-5)', () => {
  it('keeps a small run in one call', () => {
    const chunks = chunkThemesForLabelling(indexed([['client', 10], ['industry-other', 20]]), 120)
    // One per bucket: themes that compete to be distinct stay together.
    expect(chunks).toHaveLength(2)
  })

  it('splits the bucket that actually dominates, not every bucket evenly', () => {
    // The measured shape: industry-other carries most of a 550-theme run.
    const chunks = chunkThemesForLabelling(indexed([['client', 30], ['industry-other', 470], ['competitor:x', 50]]), 120)
    expect(chunks).toHaveLength(1 + 4 + 1)
    expect(Math.max(...chunks.map((c) => c.length))).toBeLessThanOrEqual(120)
  })

  it('never loses or duplicates a theme', () => {
    const input = indexed([['a', 55], ['b', 130], ['c', 7]])
    const chunks = chunkThemesForLabelling(input, 120)
    const labels = chunks.flat().map((c) => c.label)
    expect(labels).toHaveLength(input.length)
    expect(new Set(labels).size).toBe(input.length)
  })

  it('indices stay globally unique across chunks, so one lookup map serves them all', () => {
    const chunks = chunkThemesForLabelling(indexed([['a', 200]]), 120)
    const all = chunks.flat().map((c) => c.label)
    expect(new Set(all).size).toBe(all.length)
  })

  it('an empty run produces no calls', () => {
    expect(chunkThemesForLabelling([], 120)).toEqual([])
  })
})

describe('humaniseSlug', () => {
  it('is the fallback label every theme leaves the pass with', () => {
    expect(humaniseSlug('cost_and_insurance')).toBe('Cost and insurance')
  })
})
