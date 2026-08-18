import { describe, it, expect } from 'vitest'
import { deriveCompetitorKeywords } from './onboarding-config'

describe('deriveCompetitorKeywords', () => {
  it('turns the competitors you named into the terms we search for', () => {
    expect(deriveCompetitorKeywords(['Ottobock', 'Blatchford'])).toEqual(['Ottobock', 'Blatchford'])
  })
  it('drops names too short to search on (they still tag)', () => {
    expect(deriveCompetitorKeywords(['On', 'Hoka'])).toEqual(['Hoka'])
  })
  it('normalises whitespace and de-duplicates case-insensitively', () => {
    expect(deriveCompetitorKeywords(['  Topo   Designs ', 'topo designs'])).toEqual(['Topo Designs'])
  })
  it('respects the 15-keyword ceiling the CHECK constraint enforces', () => {
    const many = Array.from({ length: 20 }, (_, i) => `Brand${i}`)
    expect(deriveCompetitorKeywords(many)).toHaveLength(15)
  })
  it('an empty list stays empty', () => {
    expect(deriveCompetitorKeywords([])).toEqual([])
  })
})
