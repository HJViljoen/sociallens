import { describe, expect, it } from 'vitest'
import { freezeQuotes, resolveQuotes } from '../renderables/quotes-freeze'
import { agentThreadSlides, documentPages, type AgentThreadData } from './agent-thread'

const base: AgentThreadData = {
  threadId: 't1', kind: 'question', title: 'Why do people hesitate before buying a liner?', brand: 'Sealand', createdAt: '2026-08-22T10:00:00Z',
  turns: [{
    question: 'Why do people hesitate before buying a liner?', askedAt: '2026-08-22T10:00:00Z', prose: null, outcome: 'answered',
    answer: {
      answer: 'Comfort and fit come up before price.', silent: false, nearest: [], judgement: [{ text: 'Lead with fit.', basedOn: ['G1'] }], runId: 'r', costUsd: 0.02,
      grounded: [{ id: 'G1', text: 'People worry about skin irritation.', insightIds: ['i1', 'i2'], themeRefs: [], conversationCount: 2,
        quotes: [{ ref: 'c:c1', text: 'my skin gets so irritated', commentId: 'c1', videoId: null, n: 1 }, { ref: 'v:v1', text: 'fit was the deciding thing', commentId: null, videoId: 'v1', n: 2 }] }],
    },
  }],
  citations: [
    { n: 1, ref: 'c:c1', text: 'my skin gets so irritated', platform: 'youtube', date: '2026-07-01', href: 'https://youtu.be/x?lc=1', commentLevel: true },
    { n: 2, ref: 'v:v1', text: 'fit was the deciding thing', platform: 'tiktok', date: null, href: null, commentLevel: false },
  ],
  silentQuestions: [], document: null,
  method: { company: 'Sealand', period: 'Asked Sat 22 Aug', platforms: ['youtube', 'tiktok'], videos: null, comments: 2, note: 'x' },
}

describe('agent thread data', () => {
  it('freezes every quoted voice (answer and appendix share refs) and resolves back', () => {
    const { data: frozen, refs } = freezeQuotes(base)
    expect(refs.sort()).toEqual(['c:c1', 'v:v1'])
    expect(JSON.stringify(frozen)).not.toContain('irritated')
    const thawed = resolveQuotes(frozen, new Map([['c:c1', 'my skin gets so irritated'], ['v:v1', 'fit was the deciding thing']]))
    expect(thawed).toEqual(base)
  })

  it('drops an erased voice from both the answer and the appendix', () => {
    const { data: frozen } = freezeQuotes(base)
    const thawed = resolveQuotes(frozen, new Map([['v:v1', 'fit was the deciding thing']]))
    expect(thawed.turns[0].answer!.grounded[0].quotes.map((q) => q.n)).toEqual([2])
    expect(thawed.citations.map((c) => c.n)).toEqual([2])
    expect(thawed.citations[0].text).toBe('fit was the deciding thing')
  })

  it('paginates: one slide per turn, the appendix, and the silent list', () => {
    const slides = agentThreadSlides({ ...base, silentQuestions: ['Is price the main thing?'] })
    expect(slides.map((s) => s.keys[0])).toEqual(['agent.turn:0:0', 'agent.turn:0:more', 'agent.citations:0', 'agent.silent'])
    const many = { ...base, turns: [{ ...base.turns[0], answer: { ...base.turns[0].answer!, grounded: Array.from({ length: 6 }, (_, i) => ({ ...base.turns[0].answer!.grounded[0], id: `G${i}` })), judgement: [], nearest: [] } }] }
    expect(agentThreadSlides(many).map((s) => s.keys[0])).toEqual(['agent.turn:0:0', 'agent.turn:0:1', 'agent.turn:0:2', 'agent.citations:0'])
  })

  it('splits a document into slide-sized runs without cutting a span', () => {
    const segs = [{ text: 'a'.repeat(1500), ref: null }, { text: 'claim one', ref: 'C1' }, { text: 'b'.repeat(1500), ref: null }, { text: 'c'.repeat(100), ref: null }]
    expect(documentPages(segs, 2600)).toEqual([[0, 3], [3, 4]])
    expect(documentPages([], 2600)).toEqual([[0, 0]])
  })
})
