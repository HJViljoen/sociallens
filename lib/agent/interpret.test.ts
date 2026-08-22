import { describe, it, expect } from 'vitest'
import { normalisePlan, fallbackPlan, buildInterpretPrompt } from './interpret'
import { AGENT_MAX_QUERIES } from '../config'

describe('normalisePlan', () => {
  it('falls back to the question itself when the model returned nothing', () => {
    // Searching the question as typed has worse recall than the expansion, but
    // an empty retrieval reaches the client as "we have nothing on this".
    expect(normalisePlan(null, 'Should we discount in Q4?')).toEqual({
      intent: 'about_customers',
      retrievalQueries: ['Should we discount in Q4?'],
      timeframe: 'current',
    })
  })

  it('keeps the model’s intent and timeframe even when its queries are unusable', () => {
    const out = normalisePlan(
      { intent: 'about_our_metrics', retrieval_queries: ['  ', ''], timeframe: 'trend' },
      'What was our CPA last month?',
    )
    expect(out.retrievalQueries).toEqual(['What was our CPA last month?'])
    expect(out.intent).toBe('about_our_metrics')
    expect(out.timeframe).toBe('trend')
  })

  it('trims, drops blanks and deduplicates', () => {
    const out = normalisePlan(
      { intent: 'about_customers', retrieval_queries: [' price is too high ', 'price is too high', '', 'waiting for a sale'], timeframe: 'current' },
      'q',
    )
    expect(out.retrievalQueries).toEqual(['price is too high', 'waiting for a sale'])
  })

  it('caps the number of angles', () => {
    const many = Array.from({ length: 20 }, (_, i) => `angle ${i}`)
    const out = normalisePlan({ intent: 'about_customers', retrieval_queries: many, timeframe: 'current' }, 'q')
    expect(out.retrievalQueries).toHaveLength(AGENT_MAX_QUERIES)
  })

  it('passes a good plan through unchanged', () => {
    const out = normalisePlan(
      { intent: 'about_customers', retrieval_queries: ['price is too high', 'waiting for a sale'], timeframe: 'current' },
      'Should we discount in Q4?',
    )
    expect(out).toEqual({
      intent: 'about_customers',
      retrievalQueries: ['price is too high', 'waiting for a sale'],
      timeframe: 'current',
    })
  })
})

describe('fallbackPlan', () => {
  it('never returns an empty query for an empty question', () => {
    expect(fallbackPlan('   ').retrievalQueries).toEqual([])
  })
})

describe('buildInterpretPrompt', () => {
  it('names the company and forbids marketing vocabulary in the queries', () => {
    const p = buildInterpretPrompt('Össur')
    expect(p).toContain('Össur')
    expect(p).toContain('campaign')
    expect(p).toContain('about_our_metrics')
  })

  it('tells the model to keep retrieving even on a non-customer intent', () => {
    // A wrong intent call must not silence a good question.
    expect(buildInterpretPrompt('X')).toMatch(/should not silence a good question/)
  })
})
