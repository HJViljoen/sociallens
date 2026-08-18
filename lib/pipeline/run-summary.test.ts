import { describe, it, expect } from 'vitest'
import { sentimentFamily } from './run-summary'
import type { VideoRow } from './types'

const v = (sentiment: string | null, source: string | null): VideoRow =>
  ({ id: 'x', sentiment, sentiment_source: source } as unknown as VideoRow)

describe('sentimentFamily — audience vs framing never blend (T0-8)', () => {
  const corpus = [
    v('positive', 'audience'), v('negative', 'audience'), v('positive', 'audience'), v('mixed', 'audience'),
    v('positive', 'framing'), v('positive', 'framing'), v('neutral', 'framing'),
    v('positive', null), // pre-backfill row: conservative → framing
    v(null, null),
  ]
  it('audience counts only Pass A full-lane rows', () => {
    const a = sentimentFamily(corpus, 'audience')
    expect(a.judged).toBe(4)
    expect(a.positive).toBe(50)
    expect(a.negative).toBe(25)
    expect(a.counts.mixed).toBe(1)
  })
  it('framing counts classify-meta rows plus unprovenanced ones', () => {
    const f = sentimentFamily(corpus, 'framing')
    expect(f.judged).toBe(4)
    expect(f.positive).toBe(75)
  })
  it('an empty family reports null shares, not 0', () => {
    const a = sentimentFamily([v('positive', 'framing')], 'audience')
    expect(a.judged).toBe(0)
    expect(a.positive).toBeNull()
  })
})
