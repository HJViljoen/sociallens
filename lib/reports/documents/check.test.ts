import { describe, expect, it } from 'vitest'
import { applyCheck } from './check'
import type { WriterOutput } from './write'

const finding = (headline: string): WriterOutput['findings'][number] => ({
  headline, saw: 'What we saw.', means: 'What it means.', practice: [], sure_note: '', based_on: ['G1'], quote_from: null, continued_from: null,
})
const written: WriterOutput = {
  in_short: { summary: 'Summary.' },
  findings: [finding('Comfort decides the long-term user'), finding('Price never comes up'), finding('The clinic decides the sale')],
  competitors: [], persona_lines: [], care: [], not_sure_yet: [],
}

describe('applyCheck', () => {
  it('drops the contradicted finding with the reason, keeps the rest in order, flags the build', () => {
    const out = applyCheck(written, [
      { headline: 'Comfort decides the long-term user', verdict: 'echoes', theySay: null },
      { headline: 'Price never comes up', verdict: 'contradicts', theySay: 'price is raised in most purchase threads' },
      { headline: 'The clinic decides the sale', verdict: 'silent', theySay: null },
    ])
    expect(out.written.findings.map((f) => f.headline)).toEqual(['Comfort decides the long-term user', 'The clinic decides the sale'])
    expect(out.dropped).toEqual([{ headline: 'Price never comes up', reason: 'the conversation contradicts it: price is raised in most purchase threads' }])
    expect(out.flagged).toBe(true)
  })
  it('silence and echoes drop nothing and do not flag', () => {
    const out = applyCheck(written, written.findings.map((f) => ({ headline: f.headline, verdict: 'silent' as const, theySay: null })))
    expect(out.written.findings).toHaveLength(3)
    expect(out.flagged).toBe(false)
  })
})
