import { describe, expect, it } from 'vitest'
import { selectClaims } from './claims'

const TRACKED = ['Cotopaxi', 'Topo Designs']

const row = (over: Partial<Parameters<typeof selectClaims>[0][number]> = {}) => ({
  run_id: 'run-new',
  source_video_id: 'v1',
  entity: 'competitor',
  competitor_name: 'Cotopaxi',
  claim: 'Lifetime warranty on bags',
  quote: 'They have a lifetime warranty on their bags',
  ...over,
})

describe('selectClaims', () => {
  it('splits client and named-competitor claims', () => {
    const r = selectClaims([
      row({ entity: 'client', competitor_name: null, source_video_id: 'c1', claim: 'Upcycled materials' }),
      row(),
    ], TRACKED)
    expect(r.client).toEqual([{ competitor: null, claim: 'Upcycled materials', quote: row().quote }])
    expect(r.competitors).toEqual([{ competitor: 'Cotopaxi', claim: 'Lifetime warranty on bags', quote: row().quote }])
  })

  it('newest-run-wins per video: older runs\' paraphrase variants vanish entirely', () => {
    const r = selectClaims([
      row({ run_id: 'run-new', claim: 'Democratises shipping rates for all merchants' }),
      row({ run_id: 'run-old', claim: 'Democratises shipping rates so merchants get the same price' }),
      row({ run_id: 'run-old', claim: 'A completely different old claim' }),
    ], TRACKED)
    expect(r.competitors).toHaveLength(1)
    expect(r.competitors[0].claim).toBe('Democratises shipping rates for all merchants')
  })

  it('newest-run-wins is per video — other videos keep their own newest run', () => {
    const r = selectClaims([
      row({ source_video_id: 'v1', run_id: 'run-new' }),
      row({ source_video_id: 'v2', run_id: 'run-old', claim: 'Free People collab collection' }),
    ], TRACKED)
    expect(r.competitors).toHaveLength(2)
  })

  it('drops claims from competitors no longer tracked (fold-compared)', () => {
    const r = selectClaims([
      row({ competitor_name: 'cotopaxi' }),
      row({ competitor_name: 'Patagonia', source_video_id: 'v2' }),
    ], TRACKED)
    expect(r.competitors).toHaveLength(1)
    expect(r.competitors[0].competitor).toBe('cotopaxi')
  })

  it('excludes unnamed competitor claims; client claims unaffected by tracking', () => {
    const r = selectClaims([
      row({ competitor_name: null }),
      row({ competitor_name: 'unknown', source_video_id: 'v2' }),
      row({ entity: 'client', competitor_name: null, source_video_id: 'c1', claim: 'Handmade' }),
    ], [])
    expect(r.competitors).toHaveLength(0)
    expect(r.client).toHaveLength(1)
  })

  it('dedupes same video+normalized claim and caps per entity', () => {
    const dup = selectClaims([row({ quote: 'newest quote' }), row({ claim: ' lifetime   WARRANTY on bags ' })], TRACKED)
    expect(dup.competitors).toHaveLength(1)
    expect(dup.competitors[0].quote).toBe('newest quote')

    const rows = [
      ...Array.from({ length: 4 }, (_, i) => row({ source_video_id: `a${i}`, claim: `claim ${i}` })),
      ...Array.from({ length: 4 }, (_, i) => row({ source_video_id: `b${i}`, claim: `claim ${i}`, competitor_name: 'Topo Designs' })),
      ...Array.from({ length: 4 }, (_, i) => row({ source_video_id: `c${i}`, claim: `claim ${i}`, entity: 'client', competitor_name: null })),
    ]
    const capped = selectClaims(rows, TRACKED, 3)
    expect(capped.competitors.filter((c) => c.competitor === 'Cotopaxi')).toHaveLength(3)
    expect(capped.competitors.filter((c) => c.competitor === 'Topo Designs')).toHaveLength(3)
    expect(capped.client).toHaveLength(3)
  })
})
