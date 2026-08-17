import { describe, it, expect } from 'vitest'
import { jaccard, matchThemes, dormantIds, matchTally, type RegistryEntry, type IncomingTheme } from './theme-registry'

// Theme-identity invariants worth locking (shape B-lite, 2026-08-17). Every one
// of these is a case measured on the Sealand X→Y pair, where Pass A output was
// byte-identical and 48 of 58 "new" themes were the same theme relabelled:
//  - a theme whose MEMBERS are unchanged keeps its identity no matter what the
//    labeller called it this week (the 48-false-new case)
//  - matching never crosses entity buckets
//  - one registry entry per run: a split continues the larger half and opens a
//    fresh entry for the smaller, rather than two themes claiming one identity
//  - the weak band needs BOTH signals to agree before continuing a time series
//  - dormancy hides, never deletes; a match revives

const entry = (id: string, ids: string[], over: Partial<RegistryEntry> = {}): RegistryEntry => ({
  id,
  bucket: 'industry-other',
  member_insight_ids: ids,
  embedding: null,
  status: 'active',
  canonical_label: `label-${id}`,
  ...over,
})

const theme = (key: string, ids: string[], over: Partial<IncomingTheme> = {}): IncomingTheme => ({
  key,
  bucket: 'industry-other',
  memberInsightIds: ids,
  label: `theme-${key}`,
  embedding: null,
  ...over,
})

/** Stand-in cosine: 1 when the two vectors are identical, else their first element. */
const cos = (a: number[], b: number[]) => (a[0] === b[0] ? 1 : Math.min(a[0], b[0]))

describe('jaccard', () => {
  it('is 1 for identical sets and 0 for disjoint ones', () => {
    expect(jaccard(['a', 'b'], ['a', 'b'])).toBe(1)
    expect(jaccard(['a'], ['b'])).toBe(0)
  })
  it('ignores order and duplicates', () => {
    expect(jaccard(['b', 'a', 'a'], ['a', 'b'])).toBe(1)
  })
  it('scores partial overlap', () => {
    expect(jaccard(['a', 'b', 'c'], ['a', 'b'])).toBeCloseTo(2 / 3)
  })
  it('treats two empty sets as no evidence of identity', () => {
    expect(jaccard([], [])).toBe(0)
  })
})

describe('matchThemes', () => {
  it('keeps identity when only the LABEL changed — the 48-false-new case', () => {
    const reg = [entry('r1', ['i1', 'i2', 'i3'], { canonical_label: 'Is the lodge easy to reach' })]
    const [m] = matchThemes([theme('t1', ['i1', 'i2', 'i3'], { label: 'Access road and trail questions' })], reg)
    expect(m).toEqual({ key: 't1', themeId: 'r1', kind: 'exact', score: 1 })
  })

  it('opens a new entry when nothing overlaps', () => {
    const [m] = matchThemes([theme('t1', ['x1'])], [entry('r1', ['i1', 'i2'])])
    expect(m.themeId).toBeNull()
    expect(m.kind).toBe('new')
  })

  it('never matches across entity buckets', () => {
    const reg = [entry('r1', ['i1', 'i2'], { bucket: 'competitor:Patagonia' })]
    const [m] = matchThemes([theme('t1', ['i1', 'i2'], { bucket: 'client' })], reg)
    expect(m.themeId).toBeNull()
  })

  it('matches on strong overlap below an exact set', () => {
    const [m] = matchThemes([theme('t1', ['i1', 'i2', 'i3'])], [entry('r1', ['i1', 'i2', 'i3', 'i4'])])
    expect(m.kind).toBe('strong')
    expect(m.themeId).toBe('r1')
    expect(m.score).toBeCloseTo(0.75)
  })

  it('a split continues the larger half and opens a fresh entry for the smaller', () => {
    const reg = [entry('r1', ['i1', 'i2', 'i3', 'i4'])]
    const res = matchThemes([theme('big', ['i1', 'i2', 'i3']), theme('small', ['i4'])], reg)
    const big = res.find((r) => r.key === 'big')!
    const small = res.find((r) => r.key === 'small')!
    expect(big.themeId).toBe('r1')
    expect(small.themeId).toBeNull()
    expect(small.kind).toBe('new')
    expect(small.splitFrom).toBe('r1')
  })

  it('a merge keeps one identity and reports the absorbed entry', () => {
    const reg = [entry('r1', ['i1', 'i2', 'i3']), entry('r2', ['i4'])]
    const [m] = matchThemes([theme('t1', ['i1', 'i2', 'i3', 'i4'])], reg)
    expect(m.themeId).toBe('r1')
    expect(m.mergedFrom).toEqual(['r2'])
  })

  it('one registry entry is claimed at most once per run', () => {
    const reg = [entry('r1', ['i1', 'i2'])]
    const res = matchThemes([theme('a', ['i1', 'i2']), theme('b', ['i1', 'i2'])], reg)
    expect(res.filter((r) => r.themeId === 'r1')).toHaveLength(1)
    expect(res.filter((r) => r.themeId === null)).toHaveLength(1)
  })

  it('the weak band needs BOTH membership and label agreement', () => {
    const reg = [entry('r1', ['i1', 'i2', 'i3', 'i4', 'i5', 'i6', 'i7'], { embedding: [0.9] })]
    const incoming = [theme('t1', ['i1', 'i2'], { embedding: [0.9] })] // jaccard ≈ 0.29
    expect(matchThemes(incoming, reg, { cosine: cos })[0].kind).toBe('weak')
    // same membership, labels that disagree → no match
    const apart = [theme('t1', ['i1', 'i2'], { embedding: [0.1] })]
    expect(matchThemes(apart, reg, { cosine: cos })[0].themeId).toBeNull()
    // and without a cosine function the weak band is never entered
    expect(matchThemes(incoming, reg)[0].themeId).toBeNull()
  })

  it('matching a dormant entry revives it', () => {
    const reg = [entry('r1', ['i1', 'i2'], { status: 'dormant' })]
    expect(matchThemes([theme('t1', ['i1', 'i2'])], reg)[0].kind).toBe('revived')
  })

  it('is deterministic when two entries tie', () => {
    const reg = [entry('rB', ['i1', 'i2']), entry('rA', ['i1', 'i2'])]
    const once = matchThemes([theme('t1', ['i1', 'i2'])], reg)[0].themeId
    const twice = matchThemes([theme('t1', ['i1', 'i2'])], [...reg].reverse())[0].themeId
    expect(once).toBe(twice)
  })
})

describe('dormantIds', () => {
  const reg = [
    { id: 'a', last_seen_run_id: 'r3', status: 'active' },
    { id: 'b', last_seen_run_id: 'r1', status: 'active' },
    { id: 'c', last_seen_run_id: null, status: 'active' },
    { id: 'd', last_seen_run_id: 'r1', status: 'dormant' },
  ]
  it('marks entries unseen across the window, skipping already-dormant ones', () => {
    expect(dormantIds(reg, ['r3', 'r2', 'r1x'], 3)).toEqual(['b', 'c'])
  })
  it('keeps an entry seen anywhere in the window', () => {
    expect(dormantIds(reg, ['r3', 'r2', 'r1'], 3)).toEqual(['c'])
  })
})

describe('matchTally', () => {
  it('counts every kind, including zeros', () => {
    const t = matchTally([
      { key: '1', themeId: 'r1', kind: 'exact', score: 1 },
      { key: '2', themeId: null, kind: 'new', score: 0 },
      { key: '3', themeId: 'r2', kind: 'exact', score: 1 },
    ])
    expect(t).toEqual({ exact: 2, strong: 0, weak: 0, new: 1, revived: 0 })
  })
})
