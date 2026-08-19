import { describe, expect, it } from 'vitest'
import { carryPersonas, overlap, priorFromProfile, type PriorPersona } from './persona-continuity'
import type { GroundedPersona } from './persona-assembly'

// A profile is not a weekly report. The cast should still be the same cast in
// three months; what moves underneath is what those people want and how loud
// they are. These tests are that promise.

const persona = (over: Partial<GroundedPersona> = {}): GroundedPersona => ({
  key: 'daily-wearer',
  name: 'Daily wearer',
  oneLiner: '',
  scope: 'category',
  wants: [],
  blockers: [],
  triggers: [],
  howTheyTalk: [],
  who: [],
  themeIds: [],
  registryIds: [],
  insightIds: ['i1', 'i2', 'i3', 'i4'],
  evidenceCount: 4,
  sourceVideoCount: 3,
  bucketMix: {},
  prevalence: 'Recurring',
  unknownRefs: [],
  ...over,
})

const prior = (over: Partial<PriorPersona> = {}): PriorPersona => ({
  key: 'long-term-user',
  name: 'Long-term user',
  insightIds: ['i1', 'i2', 'i3', 'i5'],
  ...over,
})

describe('overlap', () => {
  it('is the shared share of the combined evidence', () => {
    expect(overlap(['a', 'b'], ['a', 'b'])).toBe(1)
    expect(overlap(['a', 'b'], ['c', 'd'])).toBe(0)
    expect(overlap(['a', 'b'], ['b', 'c'])).toBeCloseTo(1 / 3)
  })

  it('is zero rather than NaN when a side is empty', () => {
    expect(overlap([], ['a'])).toBe(0)
    expect(overlap(['a'], [])).toBe(0)
  })
})

describe('carryPersonas', () => {
  it('keeps the name and key already in use when the evidence is the same person', () => {
    // The model proposed "Daily wearer" for the people previously called
    // "Long-term user". Same evidence, so the client keeps reading the same
    // name — renaming a persona every run is exactly the churn this prevents.
    const [out] = carryPersonas([persona()], [prior()])
    expect(out.name).toBe('Long-term user')
    expect(out.key).toBe('long-term-user')
    expect(out.carried).toBe(true)
  })

  it('records the model’s proposal when it drifts, instead of discarding it', () => {
    // A name that keeps drifting run after run is the early signal that the
    // persona is genuinely changing; an operator should be able to see it
    // before the product renames anyone.
    const [out] = carryPersonas([persona()], [prior()])
    expect(out.proposedName).toBe('Daily wearer')
  })

  it('leaves a genuinely new persona alone', () => {
    const fresh = persona({ key: 'caregiver', name: 'Caregiver', insightIds: ['x1', 'x2', 'x3'] })
    const [out] = carryPersonas([fresh], [prior()])
    expect(out).toMatchObject({ key: 'caregiver', name: 'Caregiver', carried: false })
    expect(out.proposedName).toBeUndefined()
  })

  it('does not let two personas claim the same predecessor', () => {
    // Otherwise one history is split in half and both halves look continuous.
    const a = persona({ key: 'a', name: 'A', insightIds: ['i1', 'i2', 'i3', 'i4'] })
    const b = persona({ key: 'b', name: 'B', insightIds: ['i1', 'i2', 'i3'] })
    const out = carryPersonas([a, b], [prior()])
    expect(out.filter((p) => p.carried)).toHaveLength(1)
    // The stronger overlap wins, not the first in the list.
    expect(out.find((p) => p.carried)?.proposedName).toBe('B')
  })

  it('does not carry across a genuine shift', () => {
    // "unless there is a massive shift": when the evidence no longer overlaps,
    // this is a different kind of person and gets its own identity.
    const shifted = persona({ key: 'new', name: 'New amputee', insightIds: ['z1', 'z2', 'z3', 'z4'] })
    expect(carryPersonas([shifted], [prior()])[0].carried).toBe(false)
  })

  it('respects the matching floor', () => {
    const weak = persona({ insightIds: ['i1', 'q1', 'q2', 'q3', 'q4', 'q5'] })
    expect(carryPersonas([weak], [prior()], 0.9)[0].carried).toBe(false)
    expect(carryPersonas([weak], [prior()], 0.05)[0].carried).toBe(true)
  })

  it('is deterministic — a re-run cannot reshuffle who matched whom', () => {
    const a = persona({ key: 'a', name: 'A', insightIds: ['i1', 'i2'] })
    const b = persona({ key: 'b', name: 'B', insightIds: ['i1', 'i2'] })
    const first = carryPersonas([a, b], [prior()]).map((p) => p.carried)
    const again = carryPersonas([a, b], [prior()]).map((p) => p.carried)
    expect(first).toEqual(again)
  })

  it('passes everything through untouched on a client’s first profile', () => {
    const out = carryPersonas([persona()], [])
    expect(out[0]).toMatchObject({ key: 'daily-wearer', name: 'Daily wearer', carried: false })
  })
})

describe('priorFromProfile', () => {
  it('reads the standing cast out of a stored row', () => {
    expect(priorFromProfile([{ key: 'k', name: 'N', insightIds: ['a'] }])).toEqual([
      { key: 'k', name: 'N', insightIds: ['a'] },
    ])
  })

  it('survives a malformed or missing row rather than throwing', () => {
    expect(priorFromProfile(null)).toEqual([])
    expect(priorFromProfile('nonsense')).toEqual([])
    expect(priorFromProfile([{ name: 'no key' }, { key: 'k', name: 'N' }])).toEqual([
      { key: 'k', name: 'N', insightIds: [] },
    ])
  })
})
