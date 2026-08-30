import { describe, it, expect } from 'vitest'
import { competitorThemes, mergeAcrossBuckets, trajectoryWord, type MergeThemeRow } from './merge'
import type { Trajectory } from '../../voice-tiles'

const row = (o: Partial<MergeThemeRow> & { id: string; bucket: string; embedding: number[] }): MergeThemeRow => ({
  registryId: null, category: 'pain_point', label: o.id, description: '', evidenceCount: 1, rankScore: 1, strengthScore: 5,
  singleSource: false, firstSeen: false, supportingInsightIds: [`i-${o.id}`], supportingVideoIds: [`v-${o.id}`],
  dominantEmotion: null, dominantSentimentImpact: null, ...o,
})

// Unit vectors: insurance-ish points cluster, comfort points cluster, one stray.
const INS = [1, 0, 0]
const INS2 = [0.97, 0.24, 0]
const COMFORT = [0, 1, 0]
const STRAY = [0, 0, 1]

describe('mergeAcrossBuckets', () => {
  it('merges the same concern across buckets and keeps buckets apart inside one concern', () => {
    const themes = [
      row({ id: 'cat-ins', bucket: 'industry-other', label: 'Insurance blocks needed care', evidenceCount: 8, rankScore: 3, embedding: INS }),
      row({ id: 'you-ins', bucket: 'client', label: 'Insurance and Medicare barriers', evidenceCount: 2, rankScore: 1, embedding: INS2 }),
      row({ id: 'them-ins', bucket: 'competitor:Ottobock', label: 'Insurance fights for devices', category: 'question', evidenceCount: 6, rankScore: 2, embedding: INS2 }),
      row({ id: 'cat-ins-2', bucket: 'industry-other', label: 'Cost puts prosthetics out of reach', evidenceCount: 23, rankScore: 4, embedding: INS2 }),
      row({ id: 'cat-comfort', bucket: 'industry-other', label: 'Painful sockets', evidenceCount: 40, rankScore: 7, embedding: COMFORT }),
      row({ id: 'stray', bucket: 'industry-other', label: 'Politics', category: 'objection', evidenceCount: 1, rankScore: 0.1, embedding: STRAY }),
      row({ id: 'praise', bucket: 'client', label: 'Praise', category: 'praise', evidenceCount: 30, rankScore: 9, embedding: INS }),
    ]
    const out = mergeAcrossBuckets(themes, { threshold: 0.9 })
    expect(out.map((c) => c.id)).toEqual(['S1', 'S2', 'S3', 'S4'])
    const ins = out.find((c) => c.buckets.some((b) => b.themeId === 'you-ins'))!
    // Greedy from the loudest: the competitor and client themes join the
    // highest-ranked compatible seed (the category's cost theme); the second
    // category theme cannot join it (one theme per bucket) and stands alone.
    // The client's wording leads the merged concern.
    expect(ins.label).toBe('Insurance and Medicare barriers')
    expect(ins.buckets.map((b) => b.bucket).sort()).toEqual(['client', 'competitor:Ottobock', 'industry-other'])
    expect(ins.themeIds.sort()).toEqual(['cat-ins-2', 'them-ins', 'you-ins'])
    expect(ins.total).toBe(23 + 6 + 2)
    expect(ins.categories.sort()).toEqual(['pain_point', 'question'])
    expect(out.find((c) => c.themeIds.includes('cat-ins'))!.buckets).toHaveLength(1)
    // Loudest first; praise never enters; the stray stays alone.
    expect(out[0].themeIds).toEqual(['cat-comfort'])
    expect(out.flatMap((c) => c.themeIds)).not.toContain('praise')
    expect(out.find((c) => c.themeIds.includes('stray'))!.buckets).toHaveLength(1)
  })

  it('merges on a shared content word between the two bars, never on a word the whole pool uses', () => {
    const MID = [0.8, 0.6, 0] // cosine with INS = 0.8, with COMFORT = 0.6
    const themes = [
      row({ id: 'a', bucket: 'client', label: 'Insurance and Medicare barriers', embedding: INS, rankScore: 5 }),
      row({ id: 'b', bucket: 'industry-other', label: 'Insurance blocks needed care', embedding: MID, rankScore: 4 }),
      row({ id: 'c', bucket: 'competitor:X', label: 'Prosthetic weight worries', embedding: MID, rankScore: 3 }),
      row({ id: 'd', bucket: 'industry-other', label: 'Prosthetic socks confusion', embedding: COMFORT, rankScore: 2 }),
      row({ id: 'e', bucket: 'client', label: 'Prosthetic jewellery covers', embedding: [0, 0.7, 0.7], rankScore: 1 }),
      row({ id: 'f', bucket: 'competitor:X', label: 'Prosthetic hair care', embedding: COMFORT, rankScore: 1 }),
    ]
    // a~b sit at 0.8, under the 0.9 bar, and merge on the shared "insurance" word at lo 0.75; c sits at 0.8 to a
    // and shares nothing; e sits at 0.7 to d and shares only "prosthetic", which four of six labels carry, so not a signal.
    const out = mergeAcrossBuckets(themes, { threshold: 0.9, lexicalThreshold: 0.75 })
    const ab = out.find((c) => c.themeIds.includes('a'))!
    expect(ab.themeIds.sort()).toEqual(['a', 'b'])
    expect(out.find((c) => c.themeIds.includes('c'))!.themeIds).toEqual(['c'])
    expect(out.find((c) => c.themeIds.includes('e'))!.themeIds).toEqual(['e'])
  })

  it('needs an embedding, respects max, and takes trajectory words', () => {
    const themes = [
      row({ id: 'a', bucket: 'client', embedding: INS, evidenceCount: 5 }),
      row({ id: 'b', bucket: 'industry-other', embedding: COMFORT, evidenceCount: 4 }),
      row({ id: 'no-vec', bucket: 'industry-other', embedding: [] as number[], evidenceCount: 99 }),
    ]
    const out = mergeAcrossBuckets(themes, { threshold: 0.9, max: 1, trajectoryOf: (t) => (t.id === 'a' ? 'new this update' : null) })
    expect(out).toHaveLength(1)
    expect(out[0].themeIds).toEqual(['a'])
    expect(out[0].trajectory).toBe('new this update')
  })
})

describe('trajectoryWord', () => {
  const traj = (o: Partial<Trajectory>): Trajectory => ({ key: 'k', label: 'l', category: 'pain_point', bucket: 'client', dates: ['2026-08-23'], strength: [5], evidence: [3], latestEvidence: 3, movement: 'steady', strengthDelta: 0, evidenceDelta: null, ...o })
  it('says new, then seen N, and arrows only from three points', () => {
    expect(trajectoryWord(traj({}))).toBe('new this update')
    expect(trajectoryWord(traj({ dates: ['a', 'b'], strength: [5, 7], movement: 'gaining' }))).toBe('seen 2 updates running')
    expect(trajectoryWord(traj({ dates: ['a', 'b', 'c'], strength: [5, 6, 7], movement: 'gaining' }))).toBe('rising')
    expect(trajectoryWord(traj({ dates: ['a', 'b', 'c'], strength: [7, 6, 5], movement: 'fading' }))).toBe('fading')
    expect(trajectoryWord(null)).toBeNull()
  })
})

describe('competitorThemes', () => {
  it('splits a bucket into praise, hurt and asks, loudest first', () => {
    const themes = [
      row({ id: 'p1', bucket: 'competitor:X', category: 'praise', evidenceCount: 12, embedding: INS }),
      row({ id: 'h1', bucket: 'competitor:X', category: 'pain_point', evidenceCount: 9, embedding: INS }),
      row({ id: 'h2', bucket: 'competitor:X', category: 'objection', evidenceCount: 1, embedding: INS }),
      row({ id: 'q1', bucket: 'competitor:X', category: 'question', evidenceCount: 13, embedding: INS }),
      row({ id: 'other', bucket: 'client', category: 'praise', evidenceCount: 99, embedding: INS }),
    ]
    const c = competitorThemes(themes, 'competitor:X')
    expect(c.praise.map((t) => t.id)).toEqual(['p1'])
    expect(c.hurt.map((t) => t.id)).toEqual(['h1', 'h2'])
    expect(c.asks.map((t) => t.id)).toEqual(['q1'])
  })
})
