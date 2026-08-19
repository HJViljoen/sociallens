import { describe, expect, it } from 'vitest'
import { buildExtractPrompt, buildJudgePrompt, buildVerdictPrompt, clipInput } from './engine'
import { dayStartIso, evaluateQuota } from './quota'

// The prompts carry rules nothing downstream can re-check — whether the model
// keeps the author's wording, whether it treats silence as a real answer,
// whether the judgement call knows it is judgement. Only these assertions catch
// one being edited away.

describe('buildExtractPrompt', () => {
  it('forbids improving the author’s claims', () => {
    // A silently sharpened claim gets marked Contradicted and the user cannot
    // see that it was reworded.
    expect(buildExtractPrompt('plan')).toContain('Do not sharpen, correct, or improve')
  })

  it('excludes things consumer conversation cannot test', () => {
    expect(buildExtractPrompt('plan')).toContain('budgets, timelines, staffing')
  })
})

describe('buildVerdictPrompt', () => {
  const p = buildVerdictPrompt('Acme')

  it('makes silence a real answer rather than a failure to fill', () => {
    expect(p).toContain('SILENT IS A REAL ANSWER')
    expect(p).toContain('never stretch a loosely-related theme')
  })

  it('warns that the shortlist is proximity, not relevance', () => {
    expect(p).toContain('closest is not the same as relevant')
  })

  it('bars advice from the evidence register', () => {
    expect(p).toContain('Do not advise, propose, or recommend here')
  })
})

describe('buildJudgePrompt', () => {
  it('tells the model its output is labelled as judgement, so it may reason freely', () => {
    // The counterpart to the verdict prompt's restraint: this register exists
    // so the product can still be useful beyond what the data settles.
    expect(buildJudgePrompt('Acme')).toContain('shown to the reader as your judgement')
  })

  it('asks it to cite the claims it reasons from', () => {
    expect(buildJudgePrompt('Acme')).toContain('based_on_refs')
  })
})

describe('clipInput', () => {
  it('leaves a short document alone', () => {
    expect(clipInput('short', 100)).toEqual({ text: 'short', clipped: false })
  })

  it('reports when it clipped, so the reader can be told', () => {
    const out = clipInput('abcdefghij', 4)
    expect(out).toEqual({ text: 'abcd', clipped: true })
  })

  it('does not split a surrogate pair', () => {
    // String.slice would cut an emoji in half and produce a lone surrogate,
    // which PostgreSQL rejects — failing the insert after all three model calls
    // have been paid for.
    const out = clipInput('👩‍🔬🦿🧬', 2)
    expect(out.clipped).toBe(true)
    expect(() => JSON.stringify(out.text)).not.toThrow()
    expect([...out.text]).toHaveLength(2)
  })
})

describe('evaluateQuota', () => {
  it('allows a tenant under the limit', () => {
    expect(evaluateQuota(3, 25)).toEqual({ ok: true, used: 3 })
  })

  it('refuses at the limit with a message rather than a silent bill', () => {
    const out = evaluateQuota(25, 25)
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.message).toContain('daily limit')
  })
})

describe('dayStartIso', () => {
  it('anchors to the start of the UTC day', () => {
    expect(dayStartIso(new Date('2026-08-19T23:59:59Z'))).toBe('2026-08-19T00:00:00.000Z')
    expect(dayStartIso(new Date('2026-08-19T00:00:00Z'))).toBe('2026-08-19T00:00:00.000Z')
  })
})
