import { describe, expect, it } from 'vitest'
import { freezeQuotes } from '../../renderables/quotes-freeze'
import type { ResearchAnswer } from './research'

// C1 (review, 2026-08-31): the research step's output is memoised by Inngest,
// so no comment's words may leave the step. The step freezes its answers;
// this pins the shape so a new field carrying text does not slip through.
describe('the research step output carries no comment text', () => {
  it('freezeQuotes strips every quote text from a ResearchAnswer', () => {
    const answer: ResearchAnswer = {
      question: { id: 'anchor.stops', text: 'What stops people?', purpose: 'anchor' },
      answer: 'Model prose.',
      outcome: 'answered',
      grounded: [{
        id: 'G1', text: 'People hesitate over fit.', insightIds: ['i1'], themeLabels: ['fit'],
        conversationCount: 12, questionId: 'anchor.stops',
        quotes: [{ ref: 'e:abc', text: 'the actual comment words', commentId: 'c1', videoId: 'v1' }],
      }],
      judgement: [], silent: false, conversationCount: 12, costUsd: 0.05, ms: 100,
    }
    const frozen = freezeQuotes([answer]).data
    const texts = frozen.flatMap((a) => a.grounded.flatMap((g) => g.quotes.map((q) => q.text))).filter(Boolean)
    expect(texts).toEqual([])
    expect(frozen[0].grounded[0].quotes[0].ref).toBe('e:abc')
    expect(frozen[0].grounded[0].text).toBe('People hesitate over fit.')
  })
})
