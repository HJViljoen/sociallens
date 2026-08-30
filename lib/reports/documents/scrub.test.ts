import { describe, it, expect } from 'vitest'
import { calibrateSure, capText, noDashes, resolveIndices, scrubLine, scrubText } from './scrub'
import type { FigureTable } from '../types'

const figures: FigureTable = {
  conversations: { label: 'conversations', value: '3,270', kind: 'count' },
  g3_conversations: { label: 'conversations behind G3', value: '11', kind: 'count' },
}

describe('noDashes', () => {
  it('turns dashes between clauses into commas and leaves hyphenated words alone', () => {
    expect(noDashes('Comfort decides it — not the knee')).toBe('Comfort decides it, not the knee')
    expect(noDashes('Comfort decides it – not the knee - really')).toBe('Comfort decides it, not the knee, really')
    expect(noDashes('a long-term user')).toBe('a long-term user')
    expect(noDashes('It holds —')).toBe('It holds.')
  })
})

describe('scrubText', () => {
  it('drops a sentence with an unknown key or a typed digit, strips magnitude words, caps the block', () => {
    const r = scrubText('Price leads, heard in [[g3_conversations]] conversations. Most people say 90% of the time it hurts. Comfort is [[unknown]] wide. This is a very real thing — still.', figures, 500)
    expect(r.text).toBe('Price leads, heard in [[g3_conversations]] conversations. This is a real thing, still.')
    expect(r.dropped).toBe(2)
    expect(r.leaked).toBe(true)
  })
  it('never lets a bracket handle through', () => {
    expect(scrubText('People hesitate on price [G3] and on fit (S1, S2).', figures, 200).text).toBe('People hesitate on price and on fit.')
  })
  it('caps at a sentence end', () => {
    const long = 'One sentence here. Another sentence that is longer than the first one. A third.'
    expect(capText(long, 45)).toBe('One sentence here.')
    expect(capText('no sentence end in this long run of words at all', 20)).toBe('no sentence end in.')
    expect(scrubText(long, figures, 45).text).toBe('One sentence here.')
  })
  it('a headline loses its full stop', () => {
    expect(scrubLine('The sale is decided at the clinic, not on the knee.', figures, 90, { headline: true }).text).toBe('The sale is decided at the clinic, not on the knee')
  })
})

describe('resolveIndices', () => {
  it('keeps known indices once, in order, and counts the rest', () => {
    expect(resolveIndices(['G3', 'g1', 'G3', 'G99', 'S2'], new Set(['G1', 'G3', 'S2']))).toEqual({ ok: ['G3', 'G1', 'S2'], rejected: 1 })
    expect(resolveIndices(null, new Set())).toEqual({ ok: [], rejected: 0 })
  })
})

describe('calibrateSure', () => {
  it('decides from the evidence, not the model', () => {
    expect(calibrateSure([{ conversationCount: 11 }, { conversationCount: 9 }]).sure).toBe('solid')
    expect(calibrateSure([{ conversationCount: 20 }]).sure).toBe('reasonable')
    expect(calibrateSure([{ conversationCount: 3 }, { conversationCount: 1 }]).sure).toBe('thin')
    expect(calibrateSure([]).sure).toBe('thin')
  })
})
