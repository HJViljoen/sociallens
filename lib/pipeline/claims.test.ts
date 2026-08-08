import { describe, expect, it } from 'vitest'
import { dedupeAndCap } from './claims'

const row = (over: Partial<Parameters<typeof dedupeAndCap>[0][number]> = {}) => ({
  source_video_id: 'v1',
  entity: 'competitor',
  competitor_name: 'Cotopaxi',
  claim: 'Lifetime warranty on bags',
  quote: 'They have a lifetime warranty on their bags',
  ...over,
})

describe('dedupeAndCap', () => {
  it('splits client and named-competitor claims', () => {
    const r = dedupeAndCap([
      row({ entity: 'client', competitor_name: null, source_video_id: 'c1', claim: 'Upcycled materials' }),
      row(),
    ])
    expect(r.client).toEqual([{ competitor: null, claim: 'Upcycled materials', quote: row().quote }])
    expect(r.competitors).toEqual([{ competitor: 'Cotopaxi', claim: 'Lifetime warranty on bags', quote: row().quote }])
  })

  it('dedupes the same video+claim across runs, keeping the newest (first) row', () => {
    const r = dedupeAndCap([
      row({ quote: 'newest quote' }),
      row({ quote: 'older duplicate', claim: '  lifetime   WARRANTY on bags ' }),
    ])
    expect(r.competitors).toHaveLength(1)
    expect(r.competitors[0].quote).toBe('newest quote')
  })

  it('keeps the same claim from different videos (repeated messaging is signal)', () => {
    const r = dedupeAndCap([row({ source_video_id: 'v1' }), row({ source_video_id: 'v2' })])
    expect(r.competitors).toHaveLength(2)
  })

  it('excludes unnamed competitor claims', () => {
    const r = dedupeAndCap([
      row({ competitor_name: null }),
      row({ competitor_name: 'unknown', source_video_id: 'v2' }),
      row({ competitor_name: '  ', source_video_id: 'v3' }),
    ])
    expect(r.competitors).toHaveLength(0)
  })

  it('caps per entity independently', () => {
    const rows = [
      ...Array.from({ length: 4 }, (_, i) => row({ source_video_id: `a${i}`, claim: `claim ${i}` })),
      ...Array.from({ length: 4 }, (_, i) => row({ source_video_id: `b${i}`, claim: `claim ${i}`, competitor_name: 'Topo' })),
      ...Array.from({ length: 4 }, (_, i) => row({ source_video_id: `c${i}`, claim: `claim ${i}`, entity: 'client', competitor_name: null })),
    ]
    const r = dedupeAndCap(rows, 3)
    expect(r.competitors.filter((c) => c.competitor === 'Cotopaxi')).toHaveLength(3)
    expect(r.competitors.filter((c) => c.competitor === 'Topo')).toHaveLength(3)
    expect(r.client).toHaveLength(3)
  })
})
