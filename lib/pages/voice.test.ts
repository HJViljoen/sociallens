import { describe, expect, it } from 'vitest'
import { freezeQuotes, resolveQuotes } from '../renderables/quotes-freeze'
import { parseVoiceFilters, voiceHref, type ThemeDetail, type VoiceCardData } from './voice'

describe('voice filters and hrefs', () => {
  it('reads the params and pins a numeric seed', () => {
    const f = parseVoiceFilters({ entity: 'client', type: 'pain_point', stage: 'consideration', min: '4', seed: '3', theme: 't1', themes: 'a,b' })
    expect(f).toMatchObject({ entity: 'client', type: 'pain_point', stage: 'consideration', min: 4, seed: 3, theme: 't1', deepLinked: true })
  })

  it('draws a random seed only when none is given', () => {
    const a = parseVoiceFilters({})
    expect(Number.isInteger(a.seed)).toBe(true)
    expect(parseVoiceFilters({ seed: '12' }).seed).toBe(12)
    expect(parseVoiceFilters({ seed: 'x' }).seed).not.toBe(NaN)
  })

  it('builds hrefs that preserve the view and drop nulled keys', () => {
    const f = parseVoiceFilters({ entity: 'client', seed: '1', theme: 't1' })
    expect(voiceHref(f)).toBe('/dashboard/voice?entity=client&seed=1&theme=t1')
    expect(voiceHref(f, { theme: null, detail: 'list' })).toBe('/dashboard/voice?entity=client&seed=1&detail=list')
    expect(voiceHref(f, { entity: null, seed: '2' })).toBe('/dashboard/voice?seed=2&theme=t1')
    expect(voiceHref(parseVoiceFilters({ seed: '0' }), { seed: null })).toBe('/dashboard/voice')
  })
})

describe('voice quotes freeze', () => {
  it('strips ribbon and theme-pane voices to refs and restores them', () => {
    const theme: ThemeDetail = {
      id: 't1', label: 'Comfort', bucket: 'client', bucketName: 'Your audience', groupName: 'Sealand', kind: 'client', category: 'pain_point', prevalence: 'recurring',
      emotion: 'frustration', isNew: false, description: null, count: 12, denom: 100, pct: 12, history: null,
      quotes: [{ ref: 'e:ev-1', text: 'the straps hurt' }, { ref: 'e:ev-2', text: 'too heavy after an hour' }], withheld: 1, memberThemes: ['comfort'],
    }
    const cards: VoiceCardData[] = [{ themeId: 't1', themeLabel: 'Comfort', themeCategory: 'pain_point', quote: { ref: 'e:ev-3', text: 'I need this' }, who: 'TikTok' }]
    const data = { theme, ribbon: { cards, total: 9 } }
    const { data: frozen, refs } = freezeQuotes(data)
    expect(refs.sort()).toEqual(['e:ev-1', 'e:ev-2', 'e:ev-3'])
    expect(JSON.stringify(frozen)).not.toContain('straps')
    const texts = new Map([['e:ev-1', 'the straps hurt'], ['e:ev-3', 'I need this']])
    const thawed = resolveQuotes(frozen, texts)
    expect(thawed.theme.quotes).toEqual([{ ref: 'e:ev-1', text: 'the straps hurt' }])
    expect(thawed.theme.withheld).toBe(1)
    expect(thawed.ribbon.cards[0].quote.text).toBe('I need this')
    expect(thawed.ribbon.total).toBe(9)
  })
})
