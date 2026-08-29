import { describe, expect, it } from 'vitest'
import { figuresFor, mergeFigures } from './figures'

describe('figuresFor', () => {
  it('reads the dashboard numbers the tiles show, in their words', () => {
    const f = figuresFor('dashboard', {
      strip: { videos: { now: 374 }, comments: { now: 4626 }, tiers: { confirmed: 9 }, platformsTracked: ['instagram', 'tiktok', 'youtube'] },
      sentiment: { positivePct: 92.7, judged: 96 },
      share: { client: { pct: 5.1 }, topCompetitor: { name: 'Ottobock', pct: 15 } },
      themes: { rows: [{ label: 'Walking strain', conversations: 41 }] },
      hero: { oneThing: { title: 'Launch the Access Navigator' }, headline: 'x' },
    })
    expect(f.videos).toEqual({ label: 'conversations analysed', value: '374' })
    expect(f.comments.value).toBe('4,626')
    expect(f.platforms.value).toBe('Instagram, TikTok & YouTube')
    expect(f.sentiment_positive_pct.value).toBe('92.7%')
    expect(f.share_of_voice_pct.value).toBe('5.1%')
    expect(f.top_competitor_share_pct.value).toBe('15%')
    expect(f.top_theme.value).toBe('Walking strain')
    expect(f.top_recommendation.value).toBe('Launch the Access Navigator')
  })
  it('offers no share against no competitors, and nothing for empties', () => {
    const f = figuresFor('dashboard', { strip: { videos: { now: null } }, sentiment: null, share: { client: { pct: 100 }, topCompetitor: null }, themes: { rows: [] }, hero: { oneThing: null } })
    expect(Object.keys(f)).toEqual([])
  })
  it('covers competitive, voice, market, content, profile', () => {
    expect(figuresFor('competitive', { standings: { client: { pct: 5.1 }, competitors: [{ name: 'Ottobock', pct: 15 }] }, rail: { insightsCount: 12 } }).lead_competitor.value).toBe('Ottobock')
    expect(figuresFor('voice', { map: { tiersAll: { confirmed: 7 }, blocks: [{ label: 'Stairs', count: 12 }] }, moods: [{ emotion: 'frustration', pct: 40 }], phrases: { total: 120 } }).top_mood_pct.value).toBe('40%')
    expect(figuresFor('market', { rail: { recs: 5, insights: 9, claims: 3, newsTotal: 4 } }).recommendations.value).toBe('5')
    expect(figuresFor('content', { inbox: { total: 8 }, catalog: { total: 300 }, works: { topSound: null } }).videos_in_field.value).toBe('300')
    expect(figuresFor('profile', { personas: [{ name: 'A' }, { name: 'B' }], active: { name: 'A', share: 60 } }).lead_persona_share_pct.value).toBe('60%')
  })
})

describe('mergeFigures', () => {
  it('keeps the first section’s value for a shared key', () => {
    const m = mergeFigures([{ top_theme: { label: 'a', value: 'Dashboard says' } }, { top_theme: { label: 'a', value: 'Voice says' }, phrases: { label: 'p', value: '3' } }])
    expect(m.top_theme.value).toBe('Dashboard says')
    expect(m.phrases.value).toBe('3')
  })
})
