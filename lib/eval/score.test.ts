import { describe, it, expect } from 'vitest'
import { scorePredictions, agreement, formatScorecard } from './score'
import { checkGrounding, reportGrounding } from './grounding'

describe('scorePredictions (Tier 1)', () => {
  it('scores a perfect classifier at 1', () => {
    const s = scorePredictions([
      { id: '1', predicted: 'praise', actual: 'praise' },
      { id: '2', predicted: 'objection', actual: 'objection' },
    ])
    expect(s.macroF1).toBe(1)
    expect(s.accuracy).toBe(1)
  })

  it('separates precision from recall on a one-sided mistake', () => {
    // Predicts praise for everything: perfect recall on praise, poor precision.
    const s = scorePredictions([
      { id: '1', predicted: 'praise', actual: 'praise' },
      { id: '2', predicted: 'praise', actual: 'objection' },
      { id: '3', predicted: 'praise', actual: 'objection' },
    ])
    const praise = s.perClass.find((c) => c.label === 'praise')!
    const objection = s.perClass.find((c) => c.label === 'objection')!
    expect(praise.recall).toBe(1)
    expect(praise.precision).toBeCloseTo(0.333, 3)
    expect(objection.recall).toBe(0)
    expect(objection.support).toBe(2)
  })

  it('macro F1 refuses to let a common class hide a failing rare one', () => {
    // 9 praise right, misinformation entirely missed. Accuracy flatters; the
    // rare class is the one that matters (a missed misinformation flag is the
    // expensive error), so macroF1 must fall well below accuracy.
    const items = [
      ...Array.from({ length: 9 }, (_, i) => ({ id: `p${i}`, predicted: 'praise', actual: 'praise' })),
      { id: 'm1', predicted: 'praise', actual: 'misinformation' },
    ]
    const s = scorePredictions(items)
    expect(s.accuracy).toBe(0.9)
    expect(s.macroF1).toBeLessThan(0.55)
  })

  it('ignores classes with no support when averaging', () => {
    const s = scorePredictions([{ id: '1', predicted: 'praise', actual: 'praise' }])
    expect(s.perClass.filter((c) => c.support > 0)).toHaveLength(1)
    expect(s.macroF1).toBe(1)
  })

  it('an empty set scores zero rather than NaN', () => {
    const s = scorePredictions([])
    expect(s.macroF1).toBe(0)
    expect(s.accuracy).toBe(0)
    expect(Number.isNaN(s.macroF1)).toBe(false)
  })

  it('renders a scorecard a terminal can read', () => {
    const out = formatScorecard('categories', scorePredictions([{ id: '1', predicted: 'praise', actual: 'praise' }]))
    expect(out).toContain('categories  (n=1)')
    expect(out).toContain('MACRO F1')
  })
})

describe('agreement — stability, which is not accuracy', () => {
  it('two runs can agree perfectly and both be wrong', () => {
    const a = new Map([['v1', 'praise'], ['v2', 'praise']])
    const b = new Map([['v1', 'praise'], ['v2', 'praise']])
    expect(agreement(a, b)).toEqual({ agreed: 2, compared: 2, rate: 1 })
    // ...and the label could still be wrong in both — hence scorePredictions.
  })

  it('compares only the items both runs judged', () => {
    const a = new Map([['v1', 'praise'], ['v2', 'objection']])
    const b = new Map([['v1', 'objection']])
    expect(agreement(a, b)).toEqual({ agreed: 0, compared: 1, rate: 0 })
  })

  it('no overlap is rate 0, not a crash', () => {
    expect(agreement(new Map([['a', 'x']]), new Map([['b', 'y']])).rate).toBe(0)
  })
})

describe('checkGrounding — the ground truth Verbatim already had', () => {
  it('accepts a quote that appears verbatim', () => {
    expect(checkGrounding({ id: '1', quote: 'it hurt putting it on', commentText: 'honestly it hurt putting it on every day' })).toBe('grounded')
  })

  it('uses production normalisation: case, curly quotes, emoji, whitespace', () => {
    expect(checkGrounding({ id: '1', quote: "IT'S  great 🫶", commentText: 'honestly it’s great, really' })).toBe('grounded')
  })

  it('rejects a quote the comment does not contain', () => {
    expect(checkGrounding({ id: '1', quote: 'never said this', commentText: 'something else entirely' })).toBe('not_found')
  })

  it('distinguishes an orphaned row from a failing one', () => {
    // Retention deletes uncited stale YouTube comments; a cited one keeps its
    // text. An orphan is a bookkeeping fact, not a grounding failure.
    expect(checkGrounding({ id: '1', quote: 'anything', commentText: null })).toBe('orphaned')
    expect(checkGrounding({ id: '1', quote: '   ', commentText: 'x' })).toBe('empty')
  })

  it('reports a rate over what is actually checkable, and shows failures', () => {
    const r = reportGrounding([
      { id: '1', quote: 'abc', commentText: 'xx abc yy' },
      { id: '2', quote: 'nope', commentText: 'xx abc yy' },
      { id: '3', quote: 'zzz', commentText: null },
    ])
    expect(r.total).toBe(3)
    expect(r.grounded).toBe(1)
    expect(r.notFound).toBe(1)
    expect(r.orphaned).toBe(1)
    expect(r.rate).toBe(0.5) // orphans excluded from the denominator
    expect(r.failures[0].id).toBe('2')
  })
})
