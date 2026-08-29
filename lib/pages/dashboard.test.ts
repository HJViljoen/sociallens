import { describe, expect, it } from 'vitest'
import { freezeQuotes, resolveQuotes } from '../renderables/quotes-freeze'
import { priorityLabel, verdictDelta, type DashboardData } from './dashboard'

// The loader is I/O and is not tested here (AGENTS.md: pure logic only). What
// is pinned: the tile-ready shape survives a freeze → resolve round trip with
// the quote text gone in between, and the small pure helpers say what they say.

const fixture: DashboardData = {
  brand: 'Sealand', brandShort: 'Sealand', runId: 'run-1', runDate: '2026-08-23', updatesCount: 3, nextUpdate: 'next update Sunday',
  context: 'Sealand · updated Sun 23 Aug · next update Sunday',
  strip: {
    termTotal: 7, termCounts: { brand: 1, competitor: 1, category: 5 }, platformsTracked: ['tiktok', 'youtube'], cadence: 'weekly, Sundays',
    videos: { now: 87, prev: 51, series: [30, 51, 87], period: true, allTime: 494 },
    comments: { now: 400, prev: 250, series: [100, 250, 400], period: true, allTime: 4950 },
    historyLabels: ['9 Aug', '16 Aug', '23 Aug'], tiers: { confirmed: 17, early: 22, once: 105 }, registryCount: 444,
    platforms: [{ platform: 'instagram', count: 235 }, { platform: 'youtube', count: 150 }],
  },
  hero: {
    show: true, headline: 'Commenters ask practical questions.', beats: [{ metric: 'top_theme', before: 'Heard across ', figure: '167', after: ' conversations.' }], fallback: false,
    oneThing: { id: 'rec-1', title: 'Launch an access pathway', reasoning: 'Because.', priority: 'high' },
    quotes: [{ ref: 'h:recommendations:rec-1', text: 'What a brilliant attitude' }, { ref: 'e:ev-2', text: 'where are you from I need this' }],
    voices: 421, platforms: [{ label: 'Instagram', count: 300 }, { label: 'TikTok', count: 121 }],
  },
  sentiment: { positivePct: 89, judged: 155, deltaText: null, tierLabel: 'Strongly positive', segments: [{ label: 'Positive', count: 138, pct: 89, color: 'bg-positive' }] },
  share: { usePeriodShare: false, segments: [{ label: 'Sealand', value: 56, pct: 11.3, color: 'var(--you)', delta: null, good: 'up' }], client: { videos: 56, pct: 11.3 }, topCompetitor: { name: 'Ottobock', videos: 82, pct: 16.6 }, rest: { videos: 356, pct: 72.1 } },
  themes: { rows: [{ label: 'Everyday questions', description: '', category: 'question', bucket: 'category', memberThemes: ['t1'], conversations: 167, isNew: false }], max: 167, analysedConversations: 494, confirmed: 17, topCompetitorName: 'Ottobock' },
  movement: null,
  accounts: { series: [], topEvent: null },
  legendItems: ['conversations', 'sentiment'],
  funnel: [{ n: 7, label: 'search terms tracked across TikTok, YouTube' }],
  method: { company: 'Sealand', period: 'Update of Sun 23 Aug', platforms: ['tiktok', 'youtube'], videos: 494, comments: 4950, note: 'x' },
}

describe('dashboard data', () => {
  it('freezes to ids only and resolves back to the same data', () => {
    const { data: frozen, refs } = freezeQuotes(fixture)
    expect(refs.sort()).toEqual(['e:ev-2', 'h:recommendations:rec-1'])
    expect(JSON.stringify(frozen)).not.toContain('brilliant attitude')
    expect(frozen.hero.quotes.map((q) => q.text)).toEqual(['', ''])
    const texts = new Map([['h:recommendations:rec-1', 'What a brilliant attitude'], ['e:ev-2', 'where are you from I need this']])
    expect(resolveQuotes(frozen, texts)).toEqual(fixture)
  })

  it('drops an erased voice on resolve and keeps every number', () => {
    const { data: frozen } = freezeQuotes(fixture)
    const thawed = resolveQuotes(frozen, new Map([['e:ev-2', 'where are you from I need this']]))
    expect(thawed.hero.quotes).toEqual([{ ref: 'e:ev-2', text: 'where are you from I need this' }])
    expect(thawed.hero.voices).toBe(421)
    expect(thawed.share).toEqual(fixture.share)
  })

  it('words the stored priority and the band verdicts as the client reads them', () => {
    expect(priorityLabel('high')).toBe('Act now')
    expect(priorityLabel('medium')).toBe('Plan next')
    expect(priorityLabel(null)).toBe('Worth considering')
    expect(verdictDelta({ state: 'moved', change: 2.34 } as never)).toEqual({ text: '+2.3 pt since last update', good: true })
    expect(verdictDelta({ state: 'moved', change: -1 } as never)).toEqual({ text: '−1 pt since last update', good: false })
    expect(verdictDelta({ state: 'no_clear_change', change: 0.4 } as never)).toEqual({ text: 'no clear change since last update', good: null })
    expect(verdictDelta({ state: 'too_little_data', change: 0 } as never)).toBeNull()
    expect(verdictDelta(null)).toBeNull()
  })
})
