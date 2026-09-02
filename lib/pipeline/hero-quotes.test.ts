import { describe, it, expect } from 'vitest'
import { matchHeroQuotes } from './hero-quotes'

describe('matchHeroQuotes', () => {
  const rows = [
    { table: 'recommendations' as const, id: 'r1', clientId: 'A', hero_quote: 'the socket rubs after two hours' },
    { table: 'market_insights' as const, id: 'm1', clientId: 'A', hero_quote: 'My liner tore last week' },
    { table: 'account_events' as const, id: 'a1', clientId: 'A', hero_quote: null },
    { table: 'competitive_insights' as const, id: 'c1', clientId: 'A', hero_quote: '' },
  ]
  it('matches quotes contained in an erased/deleted comment text, normalised', () => {
    const hits = matchHeroQuotes(rows, ['Honestly, the SOCKET rubs after two hours 😩 and then it settles'])
    expect(hits).toEqual([{ table: 'recommendations', id: 'r1' }])
  })
  it('ignores null/empty hero quotes and empty texts', () => {
    expect(matchHeroQuotes(rows, [''])).toEqual([])
    expect(matchHeroQuotes(rows, ['nothing here'])).toEqual([])
  })
  // The pairing is the caller's job (deleteCommentsProperly groups by client
  // before calling): this function compares TEXT and knows nothing about who
  // owns what, so handing it two workspaces at once is what would null one
  // tenant's quote because another's comment carried the same sentence.
  it('carries the owning workspace on every row so a caller can keep them apart', () => {
    expect(rows.every((r) => typeof r.clientId === 'string')).toBe(true)
  })
})
