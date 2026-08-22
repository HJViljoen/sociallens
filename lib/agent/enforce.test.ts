import { describe, it, expect } from 'vitest'
import { enforceRegisters, SILENCE_SENTENCE, type RawAnswer } from './enforce'
import { outcomeOf } from './types'
import type { RetrievedInsight } from './retrieve'

function insight(id: string, videoId: string | null, quotes = 1): RetrievedInsight {
  return {
    id,
    theme: 'price_sensitivity',
    description: 'People weigh cost against comfort.',
    emotion: 'frustration',
    journeyStage: 'consideration',
    videoId,
    bucket: 'industry-other',
    themeRef: { themeId: `t-${id}`, registryId: `r-${id}`, label: 'Price', bucket: 'industry-other' },
    similarity: 0.7,
    quotes: Array.from({ length: quotes }, (_, i) => ({
      quote: `quote ${i} for ${id}`,
      rank: i,
      commentId: `c-${id}-${i}`,
      videoId,
    })),
  }
}

const opts = { allowNearest: true, runId: 'run-1', costUsd: 0.01 }

describe('enforceRegisters', () => {
  it('keeps a point whose ids resolve and which has a quotable comment', () => {
    const raw: RawAnswer = {
      answer: 'Cost is the barrier.',
      grounded: [{ text: 'Price comes up constantly.', insightIds: ['a'] }],
    }
    const out = enforceRegisters(raw, [insight('a', 'v1')], opts)
    expect(out.silent).toBe(false)
    expect(out.grounded).toHaveLength(1)
    expect(out.grounded[0].quotes).toHaveLength(1)
    expect(out.answer).toBe('Cost is the barrier.')
  })

  it('DEMOTES a point with invented ids rather than dropping it', () => {
    const raw: RawAnswer = {
      answer: 'Cost is the barrier.',
      grounded: [
        { text: 'Price comes up constantly.', insightIds: ['a'] },
        { text: 'Shipping is also a worry.', insightIds: ['does-not-exist'] },
      ],
    }
    const out = enforceRegisters(raw, [insight('a', 'v1')], opts)
    expect(out.grounded).toHaveLength(1)
    // The claim survives — as the agent's own reasoning, honestly labelled.
    expect(out.judgement.map((j) => j.text)).toContain('Shipping is also a worry.')
  })

  it('demotes a point that resolves but has no quotable comment behind it', () => {
    // Structurally grounded, but the sentence would sit under an evidence badge
    // with nothing quotable beneath it — the defect the 08-19 review caught.
    const raw: RawAnswer = {
      answer: 'Cost is the barrier.',
      grounded: [{ text: 'Price comes up constantly.', insightIds: ['a'] }],
    }
    const out = enforceRegisters(raw, [insight('a', 'v1', 0)], opts)
    expect(out.grounded).toHaveLength(0)
    expect(out.judgement.map((j) => j.text)).toContain('Price comes up constantly.')
    // NOT silence: real analysis was reached, it just could not be quoted.
    // Reporting "nothing relates to this" here would be false.
    expect(out.silent).toBe(false)
    expect(outcomeOf(out)).toBe('partial')
  })

  it('separates true silence from an unquotable answer', () => {
    const nothingResolved = enforceRegisters(
      { answer: 'x', grounded: [{ text: 'Unsupported.', insightIds: ['ghost'] }] },
      [insight('a', 'v1')],
      opts,
    )
    expect(nothingResolved.silent).toBe(true)
    expect(outcomeOf(nothingResolved)).toBe('silent')

    const resolvedButUnquotable = enforceRegisters(
      { answer: 'x', grounded: [{ text: 'Real but unquotable.', insightIds: ['a'] }] },
      [insight('a', 'v1', 0)],
      opts,
    )
    expect(resolvedButUnquotable.silent).toBe(false)
    expect(resolvedButUnquotable.answer).toBe('x')
  })

  it('ignores ids that were never retrieved, even if they look real', () => {
    const raw: RawAnswer = {
      grounded: [{ text: 'A point.', insightIds: ['a', 'b-not-retrieved'] }],
    }
    const out = enforceRegisters(raw, [insight('a', 'v1')], opts)
    expect(out.grounded[0].insightIds).toEqual(['a'])
  })

  it('recomputes conversationCount from cited rows, never from the model', () => {
    const raw: RawAnswer = {
      grounded: [{ text: 'A point.', insightIds: ['a', 'b', 'c'] }],
    }
    // Three insights, two distinct videos.
    const out = enforceRegisters(
      raw,
      [insight('a', 'v1'), insight('b', 'v1'), insight('c', 'v2')],
      opts,
    )
    expect(out.grounded[0].conversationCount).toBe(2)
  })

  it('strips judgement references that point at nothing surviving', () => {
    const raw: RawAnswer = {
      grounded: [{ text: 'Real.', insightIds: ['a'] }],
      judgement: [{ text: 'So discount in Q4.', basedOn: ['G1', 'G9'] }],
    }
    const out = enforceRegisters(raw, [insight('a', 'v1')], opts)
    const j = out.judgement.find((x) => x.text === 'So discount in Q4.')
    expect(j?.basedOn).toEqual(['G1'])
  })

  it('never lets a proposal into the grounded register', () => {
    const raw: RawAnswer = {
      grounded: [{ text: 'Real.', insightIds: ['a'] }],
      judgement: [{ text: 'A proposal.', basedOn: ['G1'] }],
    }
    const out = enforceRegisters(raw, [insight('a', 'v1')], opts)
    expect(out.grounded.map((g) => g.text)).not.toContain('A proposal.')
  })

  it('goes silent with the fixed sentence when nothing grounds, and drops the padding', () => {
    const raw: RawAnswer = {
      answer: 'Here is a confident answer anyway.',
      grounded: [{ text: 'Unsupported.', insightIds: [] }],
      judgement: [{ text: 'And here is what I reckon.', basedOn: [] }],
    }
    const out = enforceRegisters(raw, [insight('a', 'v1')], opts)
    expect(out.silent).toBe(true)
    expect(out.answer).toBe(SILENCE_SENTENCE)
    expect(out.judgement).toEqual([])
  })

  it('keeps the nearest thing alongside silence in question mode', () => {
    const raw: RawAnswer = {
      grounded: [],
      nearest: [{ text: 'Closest is warranty confusion.', insightIds: ['a'] }],
    }
    const out = enforceRegisters(raw, [insight('a', 'v1')], opts)
    expect(out.silent).toBe(true)
    expect(out.nearest).toHaveLength(1)
    expect(out.nearest[0].conversationCount).toBe(1)
  })

  it('NEVER offers a nearest thing in document mode', () => {
    const raw: RawAnswer = {
      grounded: [],
      nearest: [{ text: 'Closest is warranty confusion.', insightIds: ['a'] }],
    }
    const out = enforceRegisters(raw, [insight('a', 'v1')], { ...opts, allowNearest: false })
    expect(out.nearest).toEqual([])
  })

  it('drops a nearest thing that resolves to nothing', () => {
    const raw: RawAnswer = {
      grounded: [],
      nearest: [{ text: 'Something adjacent.', insightIds: ['ghost'] }],
    }
    const out = enforceRegisters(raw, [insight('a', 'v1')], opts)
    expect(out.nearest).toEqual([])
  })

  it('survives a model returning junk shapes', () => {
    const raw = {
      answer: null,
      grounded: [{ text: '   ', insightIds: 'not-an-array' }, null],
      judgement: 'nope',
      nearest: undefined,
    } as unknown as RawAnswer
    const out = enforceRegisters(raw, [insight('a', 'v1')], opts)
    expect(out.silent).toBe(true)
    expect(out.answer).toBe(SILENCE_SENTENCE)
    expect(out.grounded).toEqual([])
  })

  it('deduplicates repeated ids so counts cannot be inflated', () => {
    const raw: RawAnswer = {
      grounded: [{ text: 'A point.', insightIds: ['a', 'a', 'a'] }],
    }
    const out = enforceRegisters(raw, [insight('a', 'v1')], opts)
    expect(out.grounded[0].insightIds).toEqual(['a'])
    expect(out.grounded[0].conversationCount).toBe(1)
  })
})
