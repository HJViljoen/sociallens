import { describe, expect, it } from 'vitest'
import { freezeQuotes, resolveQuotes } from '../renderables/quotes-freeze'
import { marketHref, parseMarketSelection, type MarketData } from './market'

// The loader is I/O and is not tested here (AGENTS.md: pure logic only). What
// is pinned: the selection helpers say what they say, and the tile-ready
// shape survives a freeze → resolve round trip with the quote text gone in
// between.

describe('market selection', () => {
  it('reads group + filter from the URL, defaulting to recs/all', () => {
    expect(parseMarketSelection({})).toEqual({ group: 'recs', filter: 'all' })
    expect(parseMarketSelection({ group: 'insights', f: 'strong' })).toEqual({ group: 'insights', filter: 'strong' })
  })

  it('maps the legacy ?detail=<group> onto the group, but ?group= wins', () => {
    expect(parseMarketSelection({ detail: 'claims' })).toEqual({ group: 'claims', filter: 'all' })
    expect(parseMarketSelection({ detail: 'claims', group: 'about' })).toEqual({ group: 'about', filter: 'all' })
    // 'legend' and 'news' aren't rail groups — they fall through to the default.
    expect(parseMarketSelection({ detail: 'legend' })).toEqual({ group: 'recs', filter: 'all' })
    expect(parseMarketSelection({ detail: 'news' })).toEqual({ group: 'recs', filter: 'all' })
  })

  it('ignores a bad filter value', () => {
    expect(parseMarketSelection({ f: 'bogus' })).toEqual({ group: 'recs', filter: 'all' })
  })
})

describe('marketHref', () => {
  it('builds a group href, adding the filter and item only when present', () => {
    expect(marketHref('recs')).toBe('/dashboard/market?group=recs')
    expect(marketHref('insights', 'mi-1')).toBe('/dashboard/market?group=insights&item=mi-1')
    expect(marketHref('recs', 'rec-1', 'strong')).toBe('/dashboard/market?group=recs&f=strong&item=rec-1')
    // the default filter never appears in the URL
    expect(marketHref('claims', undefined, 'all')).toBe('/dashboard/market?group=claims')
  })
})

const fixture: MarketData = {
  brand: 'Sealand', runDate: '2026-08-23', context: 'What should we do? · Sealand · Sun 23 Aug',
  selection: { group: 'recs', itemId: 'rec-1', filter: 'all' },
  legendItems: ['conversations', 'say_vs_hear'],
  rail: { recs: 4, insights: 12, claims: 6, about: 2, newsTotal: 9 },
  list: {
    group: 'recs', total: 4, filterCounts: { strong: 2, early: 1 },
    rows: [{ id: 'rec-1', rank: 0, title: 'Launch an access pathway', reasoning: 'Because.', type: 'campaign', tier: 'confirmed', conversations: 12 }],
  },
  detail: {
    kind: 'rec', id: 'rec-1', rank: 0, total: 4, title: 'Launch an access pathway', reasoning: 'Because.', type: 'campaign', tier: 'confirmed', conversations: 12,
    voices: 5, platforms: [{ label: 'TikTok', count: 3 }],
    themes: ['comfort'],
    quotes: [{ ref: 'h:recommendations:rec-1', text: 'What a brilliant attitude' }, { ref: 'e:ev-2', text: 'where are you from I need this' }],
  },
  shortRead: [{ key: 'top_unmet_needs', items: ['Comfort in daily wear'] }],
  news: { items: [{ title: 'A headline', url: 'https://example.com', sourceRef: '@source', publishedAt: '2026-08-20', ring: 0 }], total: 9 },
  singleSourceThemes: [{ label: 'Weight', description: null }],
  singleSourceTotal: 3,
  method: { company: 'Sealand', period: 'Update of Sun 23 Aug', platforms: ['tiktok'], videos: null, comments: null, note: 'x' },
}

describe('market data', () => {
  it('freezes to ids only and resolves back to the same data', () => {
    const { data: frozen, refs } = freezeQuotes(fixture)
    expect(refs.sort()).toEqual(['e:ev-2', 'h:recommendations:rec-1'])
    expect(JSON.stringify(frozen)).not.toContain('brilliant attitude')
    expect((frozen.detail as { quotes: { text: string }[] }).quotes.map((q) => q.text)).toEqual(['', ''])
    const texts = new Map([['h:recommendations:rec-1', 'What a brilliant attitude'], ['e:ev-2', 'where are you from I need this']])
    expect(resolveQuotes(frozen, texts)).toEqual(fixture)
  })

  it('drops an erased voice on resolve and keeps every number', () => {
    const { data: frozen } = freezeQuotes(fixture)
    const thawed = resolveQuotes(frozen, new Map([['e:ev-2', 'where are you from I need this']]))
    expect((thawed.detail as { quotes: { ref: string; text: string }[] }).quotes).toEqual([{ ref: 'e:ev-2', text: 'where are you from I need this' }])
    expect(thawed.rail).toEqual(fixture.rail)
    expect((thawed.detail as { voices: number }).voices).toBe(5)
  })
})
