import { describe, it, expect } from 'vitest'
import { composeQuestions, marketPhrase, possessive } from './questions'
import { SALES_BRIEF } from './templates'
import { DEFAULT_DOCUMENT_SETTINGS } from './types'
import type { MergedConcern } from './merge'

const concern = (id: string, label: string, total: number, description = ''): MergedConcern => ({
  id, label, description, buckets: [], total, categories: ['pain_point'], rankScore: total, themeIds: [], registryIds: [], insightIds: [], videoIds: [], trajectory: '',
})

const signals = {
  company: 'Ossur',
  industryKeywords: ['amputee', 'prosthetic leg', 'prosthetic arm', '#runningblade', '#prosthetics'],
  competitors: [{ name: 'Ottobock', thin: false }],
  concerns: [
    concern('S1', 'Questions about fit and features', 99, 'Viewers want to know how it fits.'),
    concern('S2', 'Cost puts prosthetics out of reach', 27),
    concern('S3', 'Comfort and durability problems', 43),
    concern('S4', 'Insurance and Medicare barriers', 17),
    concern('S5', 'How it works in water', 15),
    concern('S6', 'Emotional toll of amputation', 25),
  ],
}

describe('marketPhrase', () => {
  it('names the products in the corpus\'s words, hashtags dropped, three at most', () => {
    expect(marketPhrase('Ossur', signals.industryKeywords)).toBe("products like Ossur's (amputee, prosthetic leg, prosthetic arm)")
    expect(possessive('Adidas')).toBe("Adidas'")
    expect(marketPhrase('Dagne Dover', [])).toBe("products like Dagne Dover's")
    expect(possessive('LMNT')).toBe("LMNT's")
  })
})

describe('composeQuestions', () => {
  it('asks the anchors, one per competitor, then the loudest concerns an anchor does not already cover', () => {
    const qs = composeQuestions(SALES_BRIEF, signals, DEFAULT_DOCUMENT_SETTINGS, 8)
    expect(qs.map((q) => q.purpose)).toEqual(['anchor', 'anchor', 'anchor', 'anchor', 'competitor', 'concern', 'concern', 'concern'])
    expect(qs.find((q) => q.purpose === 'competitor')).toMatchObject({ id: 'competitor:ottobock', competitor: 'Ottobock' })
    expect(qs.find((q) => q.purpose === 'competitor')!.text).toContain('Ottobock')
    expect(qs.find((q) => q.purpose === 'competitor')!.text).toContain('Ossur')
    // Cost and insurance are anchored already; fit, comfort and water get the concern slots.
    expect(qs.filter((q) => q.purpose === 'concern').map((q) => q.concernId)).toEqual(['S1', 'S3', 'S5'])
    expect(qs[5].text).toBe('Viewers want to know how it fits. What do people say about this, and what would settle it for them?')
    expect(qs[6].text).toBe('What do people say about comfort and durability problems, and what would settle it for them?')
    for (const q of qs) expect(q.text).not.toMatch(/\{[a-z]+\}/)
  })

  it('adds the register question for professionals and keeps the cap', () => {
    const qs = composeQuestions(SALES_BRIEF, signals, { ...DEFAULT_DOCUMENT_SETTINGS, sellsTo: 'professionals' }, 8)
    expect(qs.filter((q) => q.purpose === 'register')).toHaveLength(1)
    expect(qs.find((q) => q.purpose === 'register')!.text).toMatch(/clinics|professionals/)
    expect(qs).toHaveLength(8)
    expect(qs.filter((q) => q.purpose === 'concern')).toHaveLength(2)
    expect(composeQuestions(SALES_BRIEF, signals, DEFAULT_DOCUMENT_SETTINGS, 5)).toHaveLength(5)
  })

  it('asks about at most two competitors and none when none is tracked', () => {
    const many = { ...signals, competitors: [{ name: 'A', thin: false }, { name: 'B', thin: false }, { name: 'C', thin: true }] }
    expect(composeQuestions(SALES_BRIEF, many, DEFAULT_DOCUMENT_SETTINGS, 10).filter((q) => q.purpose === 'competitor').map((q) => q.competitor)).toEqual(['A', 'B'])
    expect(composeQuestions(SALES_BRIEF, { ...signals, competitors: [] }, DEFAULT_DOCUMENT_SETTINGS, 10).filter((q) => q.purpose === 'competitor')).toHaveLength(0)
  })
})
