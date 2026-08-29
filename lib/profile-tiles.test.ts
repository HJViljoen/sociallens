import { describe, expect, it } from 'vitest'
import { normalisePersona, shareOf, platformTotals, platformRows, shareSeries, type Persona, type ProfileHistoryRow } from './profile-tiles'

const persona = (over: Partial<Persona> = {}): Persona => ({
  key: 'p1', name: 'Caregiver', oneLiner: '', scope: 'client', wants: '', blockers: '', triggers: '',
  howTheyTalk: [], who: [], insightIds: [], evidenceCount: 0, sourceVideoCount: 0, prevalence: '',
  ...over,
})

describe('normalisePersona', () => {
  it('drops a row with no name', () => {
    expect(normalisePersona(null)).toBeNull()
    expect(normalisePersona({})).toBeNull()
  })
  it('falls back to name as key, joins legacy bullet arrays into prose', () => {
    const p = normalisePersona({ name: 'Athlete', wants: ['fast', 'light'] as unknown as string })
    expect(p?.key).toBe('Athlete')
    expect(p?.wants).toBe('fast. light')
    expect(p?.scope).toBe('category')
  })
  it('keeps a well-formed row as-is', () => {
    const p = normalisePersona({ key: 'p1', name: 'Caregiver', scope: 'client', sourceVideoCount: 6, evidenceCount: 5, prevalence: 'widespread' })
    expect(p).toMatchObject({ key: 'p1', name: 'Caregiver', scope: 'client', sourceVideoCount: 6, evidenceCount: 5, prevalence: 'widespread' })
  })
})

describe('shareOf', () => {
  it('rounds a persona’s share of the profile total; 0 with no total', () => {
    expect(shareOf({ sourceVideoCount: 6 }, 8)).toBe(75)
    expect(shareOf({ sourceVideoCount: 2 }, 8)).toBe(25)
    expect(shareOf({ sourceVideoCount: 6 }, 0)).toBe(0)
  })
})

describe('platformTotals / platformRows', () => {
  const p1 = persona({ key: 'p1', name: 'Caregiver', insightIds: ['i1', 'i2', 'i3'] })
  const p2 = persona({ key: 'p2', name: 'Athlete', insightIds: ['i4'] })
  const insightRows = [
    { platform: 'tiktok', source_video_id: 'v1' },
    { platform: 'tiktok', source_video_id: 'v2' },
    { platform: 'tiktok', source_video_id: 'v1' }, // same video again — distinct count stays 2
    { platform: 'youtube', source_video_id: 'v3' },
    { platform: null, source_video_id: 'v9' }, // no platform — ignored
    { platform: 'youtube', source_video_id: null }, // no video — ignored
  ]
  const insightMeta = new Map([
    ['i1', { platform: 'tiktok', source_video_id: 'v1' }],
    ['i2', { platform: 'tiktok', source_video_id: 'v2' }],
    ['i3', { platform: 'youtube', source_video_id: 'v3' }],
    ['i4', { platform: 'youtube', source_video_id: 'v3' }],
  ])

  it('counts distinct conversations per platform across the whole cast', () => {
    const totals = platformTotals(insightRows)
    expect([...totals]).toEqual([['tiktok', 2], ['youtube', 1]])
  })

  it('builds one row per persona, in conversations not insights', () => {
    const rows = platformRows([p1, p2], insightMeta)
    expect(rows).toEqual([
      { key: 'p1', name: 'Caregiver', total: 3, counts: { tiktok: 2, youtube: 1 } },
      { key: 'p2', name: 'Athlete', total: 1, counts: { youtube: 1 } },
    ])
  })
})

describe('shareSeries', () => {
  const personas = [persona({ key: 'p1', name: 'Caregiver' }), persona({ key: 'p2', name: 'Athlete' })]
  const history: ProfileHistoryRow[] = [
    { run_date: '2026-07-01', personas: [{ key: 'p1', sourceVideoCount: 2 }, { key: 'p2', sourceVideoCount: 2 }] },
    { run_date: '2026-07-08', personas: [{ key: 'p1', sourceVideoCount: 3 }] }, // p2 absent this update
    { run_date: '2026-07-15', personas: [{ key: 'p1', sourceVideoCount: 6 }, { key: 'p2', sourceVideoCount: 2 }] },
  ]

  it('tracks each persona’s share of ITS OWN update, with a gap where absent', () => {
    expect(shareSeries(personas, history)).toEqual([
      { key: 'p1', name: 'Caregiver', points: [50, 100, 75] },
      { key: 'p2', name: 'Athlete', points: [50, null, 25] },
    ])
  })

  it('is empty with no history', () => {
    expect(shareSeries(personas, [])).toEqual([
      { key: 'p1', name: 'Caregiver', points: [] },
      { key: 'p2', name: 'Athlete', points: [] },
    ])
  })
})
