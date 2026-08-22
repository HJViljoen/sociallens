import { describe, it, expect } from 'vitest'
import { fuseHits, countConversations } from './rank'

describe('fuseHits', () => {
  it('returns [] for no queries and for queries that all missed', () => {
    expect(fuseHits([])).toEqual([])
    expect(fuseHits([[], []])).toEqual([])
  })

  it('preserves a single query’s order', () => {
    const out = fuseHits([[
      { id: 'a', similarity: 0.9 },
      { id: 'b', similarity: 0.8 },
      { id: 'c', similarity: 0.7 },
    ]])
    expect(out.map((h) => h.id)).toEqual(['a', 'b', 'c'])
  })

  it('ranks agreement across queries above one query’s single best hit', () => {
    // 'agreed' is 2nd on both queries; 'spike' is 1st on one and absent from
    // the other. This is the whole point of fusing rather than taking the max:
    // the phrasing that happens to match theme labels must not decide the answer.
    const out = fuseHits([
      [{ id: 'spike', similarity: 0.95 }, { id: 'agreed', similarity: 0.60 }],
      [{ id: 'other', similarity: 0.70 }, { id: 'agreed', similarity: 0.61 }],
    ])
    expect(out[0].id).toBe('agreed')
    expect(out[0].matchedQueries).toBe(2)
  })

  it('keeps the best similarity seen, not the last', () => {
    const out = fuseHits([
      [{ id: 'a', similarity: 0.42 }],
      [{ id: 'a', similarity: 0.88 }],
    ])
    expect(out[0].bestSimilarity).toBe(0.88)
    expect(out[0].matchedQueries).toBe(2)
  })

  it('deduplicates an insight matched by several queries', () => {
    const out = fuseHits([
      [{ id: 'a', similarity: 0.5 }],
      [{ id: 'a', similarity: 0.5 }],
      [{ id: 'a', similarity: 0.5 }],
    ])
    expect(out).toHaveLength(1)
  })

  it('is deterministic — same input, same order, twice', () => {
    const input = [
      [{ id: 'zzz', similarity: 0.5 }, { id: 'aaa', similarity: 0.5 }],
      [{ id: 'aaa', similarity: 0.5 }, { id: 'zzz', similarity: 0.5 }],
    ]
    expect(fuseHits(input)).toEqual(fuseHits(input))
    // Fully tied pairs fall back to id order rather than insertion order.
    expect(fuseHits(input).map((h) => h.id)).toEqual(['aaa', 'zzz'])
  })

  it('applies the limit after fusing, never before', () => {
    const out = fuseHits(
      [
        [{ id: 'a', similarity: 0.9 }, { id: 'b', similarity: 0.5 }],
        [{ id: 'b', similarity: 0.5 }, { id: 'c', similarity: 0.9 }],
      ],
      { limit: 2 },
    )
    expect(out).toHaveLength(2)
    // 'b' is 2nd on both queries and must survive a limit that a per-query
    // truncation would have dropped it from.
    expect(out.map((h) => h.id)).toContain('b')
  })
})

describe('countConversations', () => {
  it('counts distinct videos, not evidence rows', () => {
    expect(countConversations([
      { videoId: 'v1' }, { videoId: 'v1' }, { videoId: 'v2' },
    ])).toBe(2)
  })

  it('ignores insights with no video behind them', () => {
    expect(countConversations([{ videoId: null }, { videoId: 'v1' }])).toBe(1)
    expect(countConversations([{ videoId: null }])).toBe(0)
  })

  it('is 0 for an empty set', () => {
    expect(countConversations([])).toBe(0)
  })
})
