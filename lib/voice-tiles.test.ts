import { describe, it, expect } from 'vitest'
import {
  squarify, themeTrajectories, themeMovers, movementOf, voiceTiers, pickVoiceCards, categoryTabs, topEmotions, emotionTone,
  categoryChip, shortPhrases,
  type ThemeHistoryRow,
} from './voice-tiles'

describe('squarify', () => {
  const area = (r: { w: number; h: number }) => r.w * r.h
  const overlaps = (a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) =>
    a.x < b.x + b.w - 1e-6 && b.x < a.x + a.w - 1e-6 && a.y < b.y + b.h - 1e-6 && b.y < a.y + a.h - 1e-6

  it('a single value fills the whole rectangle', () => {
    expect(squarify([7], 10, 20, 300, 100)).toEqual([{ x: 10, y: 20, w: 300, h: 100 }])
  })

  it('areas are proportional, sum to the frame, and nothing overlaps or leaks out', () => {
    const values = [64, 46, 46, 22, 19, 18, 16, 15, 15, 14, 12, 12, 11]
    const W = 708, H = 372
    const rects = squarify(values, 0, 0, W, H)
    expect(rects).toHaveLength(values.length)
    const total = values.reduce((a, b) => a + b, 0)
    rects.forEach((r, i) => expect(area(r)).toBeCloseTo((values[i] / total) * W * H, 6))
    expect(rects.reduce((a, r) => a + area(r), 0)).toBeCloseTo(W * H, 6)
    for (const r of rects) {
      expect(r.x).toBeGreaterThanOrEqual(-1e-6)
      expect(r.y).toBeGreaterThanOrEqual(-1e-6)
      expect(r.x + r.w).toBeLessThanOrEqual(W + 1e-6)
      expect(r.y + r.h).toBeLessThanOrEqual(H + 1e-6)
    }
    for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) expect(overlaps(rects[i], rects[j])).toBe(false)
  })

  it('returns rects in input order and keeps blocks squarish', () => {
    const rects = squarify([50, 50], 0, 0, 200, 100)
    expect(rects[0]).toEqual({ x: 0, y: 0, w: 100, h: 100 })
    expect(rects[1]).toEqual({ x: 100, y: 0, w: 100, h: 100 })
  })

  it('handles empty input and zero sizes without throwing', () => {
    expect(squarify([], 0, 0, 100, 100)).toEqual([])
    expect(squarify([0, 0], 0, 0, 100, 100).every((r) => r.w === 0 && r.h === 0)).toBe(true)
  })
})

describe('theme trajectories (registry_id join + label bridge + movement rule)', () => {
  const row = (run_id: string, registry_id: string | null, label: string, strength: number, evidence: number, first_seen = false, bucket = 'industry-other'): ThemeHistoryRow =>
    ({ run_id, registry_id, label, category: 'praise', bucket, strength_score: strength, evidence_count: evidence, first_seen })
  const runDates = new Map([['r1', '2026-08-01'], ['r2', '2026-08-08'], ['r3', '2026-08-15']])

  it('joins on registry_id even when the label churns, and shows the latest label', () => {
    const { trajectories } = themeTrajectories([
      row('r1', 'reg-a', 'Cost worries', 5, 6),
      row('r2', 'reg-a', 'Prosthetic cost and affordability', 7, 11),
      row('r3', 'reg-a', 'Cost and affordability', 8, 18),
    ], runDates)
    expect(trajectories).toHaveLength(1)
    const t = trajectories[0]
    expect(t.key).toBe('reg-a')
    expect(t.label).toBe('Cost and affordability')
    expect(t.evidence).toEqual([6, 11, 18])
    expect(t.movement).toBe('gaining')
    expect(t.strengthDelta).toBe(3)
    expect(t.evidenceDelta).toBe(7)
  })

  it('bridges pre-registry rows onto the identity by label, but never joins two registry ids by label', () => {
    const { trajectories, keyOf } = themeTrajectories([
      row('r1', null, 'Socket fit', 6, 5), // written before the registry
      row('r2', 'reg-s', 'Socket fit', 6, 8),
      row('r3', 'reg-s', 'Socket fit and limb changes', 6, 12),
      row('r1', null, 'Cost', 5, 2), // pre-registry, but the label is shared by two identities later
      row('r2', 'reg-c1', 'Cost', 5, 3),
      row('r2', 'reg-c2', 'Cost', 3, 1),
    ], runDates)
    expect(trajectories.find((t) => t.key === 'reg-s')!.evidence).toEqual([5, 8, 12])
    expect(trajectories.find((t) => t.key === 'reg-c1')!.evidence).toEqual([3])
    expect(trajectories.find((t) => t.key === 'reg-c2')!.evidence).toEqual([1])
    expect(trajectories.find((t) => t.key === 'label:Cost')!.evidence).toEqual([2])
    expect(keyOf({ registry_id: 'reg-s', label: 'whatever' })).toBe('reg-s')
    expect(keyOf({ registry_id: null, label: 'Socket fit' })).toBe('reg-s')
    expect(keyOf({ registry_id: null, label: 'Never seen' })).toBe('label:Never seen')
  })

  it('classifies emerging / gaining / fading / steady by the ±1 strength rule', () => {
    expect(movementOf([5, 6], false)).toBe('gaining')
    expect(movementOf([5, 5.9], false)).toBe('steady')
    expect(movementOf([7, 6], false)).toBe('fading')
    expect(movementOf([7, 6.5], false)).toBe('steady')
    expect(movementOf([3, 9], true)).toBe('emerging')
    const { trajectories } = themeTrajectories([
      row('r2', 'reg-n', 'Encouragement', 6, 9, true), // arrived after the first update, flagged new
      row('r3', 'reg-n', 'Encouragement', 7, 15),
      row('r1', 'reg-o', 'Old hand', 6, 9, true), // first update: first_seen means nothing there
      row('r2', 'reg-o', 'Old hand', 6, 9),
    ], runDates)
    expect(trajectories.find((t) => t.key === 'reg-n')!.movement).toBe('emerging')
    expect(trajectories.find((t) => t.key === 'reg-o')!.movement).toBe('steady')
  })

  it('ignores rows from updates not in the date map and orders movers first', () => {
    const { trajectories } = themeTrajectories([
      row('r1', 'a', 'A', 5, 4), row('r2', 'a', 'A', 7, 9), // gaining +2
      row('r1', 'b', 'B', 8, 9), row('r2', 'b', 'B', 7, 5), // fading −1
      row('r1', 'c', 'C', 6, 6), row('r2', 'c', 'C', 6, 6), // steady
      row('r2', 'd', 'D', 6, 3, true), row('r3', 'd', 'D', 6, 4), // emerging
      row('r1', 'e', 'E', 6, 3), // single point — not a mover
      row('running', 'a', 'A', 9, 99), // in-flight update: ignored
    ], runDates)
    expect(trajectories.find((t) => t.key === 'a')!.evidence).toEqual([4, 9])
    const movers = themeMovers(trajectories)
    expect(movers.map((t) => t.key)).toEqual(['a', 'b', 'd', 'c'])
  })
})

describe('voiceTiers', () => {
  it('splits confirmed / early / heard once by the early-signal bar, preserving order', () => {
    const rows = [
      { id: 1, single_source: false, strength_score: 2 },
      { id: 2, single_source: true, strength_score: 7 },
      { id: 3, single_source: true, strength_score: 6 },
      { id: 4, single_source: true, strength_score: 5 },
      { id: 5, single_source: null, strength_score: null },
    ]
    const t = voiceTiers(rows)
    expect(t.confirmed.map((r) => r.id)).toEqual([1, 5])
    expect(t.early.map((r) => r.id)).toEqual([2, 3])
    expect(t.heardOnce.map((r) => r.id)).toEqual([4])
  })
})

describe('pickVoiceCards', () => {
  const pool = [['a1', 'a2', 'a3'], [], ['c1'], ['d1', 'd2']]
  it('round-robins across themes and rotates by seed', () => {
    expect(pickVoiceCards(pool, 0, 5)).toEqual({
      cards: [
        { themeIndex: 0, quote: 'a1' }, { themeIndex: 2, quote: 'c1' }, { themeIndex: 3, quote: 'd1' },
        { themeIndex: 0, quote: 'a2' }, { themeIndex: 3, quote: 'd2' },
      ],
      total: 6,
    })
    expect(pickVoiceCards(pool, 1, 5).cards.map((c) => c.quote)).toEqual(['a3', 'a1', 'c1', 'd1', 'a2'])
    expect(pickVoiceCards(pool, 2, 5).cards.map((c) => c.quote)).toEqual(['d2', 'a3', 'a1', 'c1', 'd1'])
  })
  it('never repeats a quote within one draw when the pool is smaller than n', () => {
    const { cards, total } = pickVoiceCards([['x'], ['y']], 3, 5)
    expect(total).toBe(2)
    expect(cards.map((c) => c.quote).sort()).toEqual(['x', 'y'])
    expect(pickVoiceCards([], 0)).toEqual({ cards: [], total: 0 })
  })
})

describe('labels and mood', () => {
  it('orders tabs by the design order, then count', () => {
    const tabs = categoryTabs(new Map([['objection', 30], ['praise', 41], ['pain_point', 18], ['feature_request', 2], ['question', 22]]))
    expect(tabs.map((t) => t.label)).toEqual(['Pain points', 'Questions', 'Praise', 'Objections', 'Feature requests'])
  })
  it('counts emotions and gives each its share of everything counted', () => {
    const top = topEmotions(['hopeful', 'hopeful', 'frustrated', null, 'curious', 'hopeful', 'frustrated'], 2)
    expect(top.map((e) => [e.emotion, e.count])).toEqual([['hopeful', 3], ['frustrated', 2]])
    expect(top[0].pct).toBeCloseTo(50)
    expect(top[0].total).toBe(6)
    expect(emotionTone('frustrated')).toBe('negative')
    expect(emotionTone('hopeful')).toBe('positive')
    expect(emotionTone('neutral')).toBe('neutral')
  })
})

describe('category chips and short phrases', () => {
  it('maps every category onto a green / warm-red / gold / neutral family, never a hashed hue', () => {
    expect(categoryChip('praise')).toBe(categoryChip('purchase_intent'))
    expect(categoryChip('buying_trigger')).toMatch(/positive/)
    expect(categoryChip('pain_point')).toBe(categoryChip('objection'))
    expect(categoryChip('switching_signal')).toMatch(/negative/)
    expect(categoryChip('question')).toBe(categoryChip('feature_request'))
    expect(categoryChip('question')).toMatch(/warning/)
    expect(categoryChip('demographic_signal')).toBe(categoryChip('something_new'))
    expect(categoryChip('demographic_signal')).toMatch(/muted/)
    for (const c of ['praise', 'pain_point', 'question', 'demographic_signal']) expect(categoryChip(c)).not.toMatch(/plum|slate|pine|ochre|#/)
  })

  it('keeps only short phrases, shortest first, de-duplicated, capped at n', () => {
    const rows = [
      { phrase: 'this one is a full sentence that runs on and on for far too long' },
      { phrase: 'So worth it' },
      { phrase: 'game changer' },
      { phrase: 'so worth it ' },
      { phrase: 'ok' },
      { phrase: 'eight words exactly is the cut off here' },
      { phrase: 'nine words is one too many for this chip' },
      { phrase: '' },
    ]
    expect(shortPhrases(rows).map((r) => r.phrase)).toEqual(['ok', 'So worth it', 'game changer', 'eight words exactly is the cut off here'])
    expect(shortPhrases(rows, 2).map((r) => r.phrase)).toEqual(['ok', 'So worth it'])
  })
})
