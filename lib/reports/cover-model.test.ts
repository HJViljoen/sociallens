import { describe, expect, it } from 'vitest'
import { buildCoverPrompts } from './cover-model'
import type { FigureTable } from './types'

const figures: FigureTable = {
  videos: { label: 'conversations analysed', value: '374', kind: 'count' },
  sentiment_positive_pct: { label: 'positive sentiment', value: '92.7%', kind: 'pct' },
  top_competitor: { label: 'most-talked-about competitor', value: 'Ottobock', kind: 'name' },
}

const args = {
  register: 'leadership' as const,
  title: 'Leadership one-pager',
  company: 'Össur',
  period: 'the week to 23 Aug 2026',
  sectionTitles: ['Dashboard'],
  brief: null,
  figures,
}

describe('buildCoverPrompts', () => {
  it('gives a share figure a predicate template, as a count gets one', () => {
    const { user } = buildCoverPrompts(args)
    const line = user.split('\n').find((l) => l.startsWith('- [[sentiment_positive_pct]]'))
    expect(line).toBeDefined()
    // the value already carries its % sign; the model is told so and shown how it reads
    expect(line).toContain('already written with its % sign')
    expect(line).toContain('"positive sentiment stood at [[sentiment_positive_pct]]"')
    expect(line).toContain('never "is [[sentiment_positive_pct]]"')
    // the count template is unchanged
    expect(user).toContain('write it as "[[videos]] conversations analysed"')
  })

  it('never asks the model for a digit', () => {
    const { system, user } = buildCoverPrompts(args)
    expect(system).toContain('Never type a digit')
    expect(user).not.toMatch(/92\.7|374/)
  })
})
