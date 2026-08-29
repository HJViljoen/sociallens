import { describe, expect, it } from 'vitest'
import { freezeQuotes, resolveQuotes } from '../renderables/quotes-freeze'
import { competitiveFindingHref, type CompetitiveData, type FindingDetail } from './competitive'

describe('competitiveFindingHref', () => {
  it('keeps only the set keys, in vs/kind/about/item order, with an optional hash', () => {
    expect(competitiveFindingHref({})).toBe('/dashboard/competitive')
    expect(competitiveFindingHref({ vs: 'Ottobock' })).toBe('/dashboard/competitive?vs=Ottobock')
    expect(competitiveFindingHref({ vs: 'Ottobock', kind: 'competitive_threat', about: null, item: 'ci-1' }))
      .toBe('/dashboard/competitive?vs=Ottobock&kind=competitive_threat&item=ci-1')
    expect(competitiveFindingHref({ vs: 'Ottobock', about: 'Ottobock' }, 'findings')).toBe('/dashboard/competitive?vs=Ottobock&about=Ottobock#findings')
  })

  it('drops null and empty-string values', () => {
    expect(competitiveFindingHref({ vs: null, kind: '', about: undefined, item: 'ci-1' })).toBe('/dashboard/competitive?item=ci-1')
  })
})

describe('competitive quotes freeze', () => {
  const finding: FindingDetail = {
    id: 'ci-1', category: 'competitive_threat', title: 'Ottobock leads on comfort', competitorName: 'Ottobock',
    coverage: { text: '18 videos', thin: false }, impact: 'high impact', finding: 'Their audience praises the fit.',
    quotes: [{ ref: 'h:competitive_insights:ci-1', text: 'Way more comfortable than mine' }, { ref: 'e:ev-9', text: 'the straps never dig in' }],
    voices: 12, platforms: [{ label: 'TikTok', count: 8 }], support: ['comfort'], faceOffTarget: null,
  }
  const data: Pick<CompetitiveData, 'detail' | 'allFindings'> = { detail: finding, allFindings: [finding] }

  it('strips the finding and full-export quotes to refs and restores them', () => {
    const { data: frozen, refs } = freezeQuotes(data)
    expect(refs.sort()).toEqual(['e:ev-9', 'h:competitive_insights:ci-1'])
    expect(JSON.stringify(frozen)).not.toContain('comfortable')
    expect(JSON.stringify(frozen)).not.toContain('straps')
    expect(frozen.detail!.quotes.map((q) => q.text)).toEqual(['', ''])

    const texts = new Map([['h:competitive_insights:ci-1', 'Way more comfortable than mine'], ['e:ev-9', 'the straps never dig in']])
    const thawed = resolveQuotes(frozen, texts)
    expect(thawed).toEqual(data)
  })

  it('drops an erased voice on resolve and keeps every count', () => {
    const { data: frozen } = freezeQuotes(data)
    const thawed = resolveQuotes(frozen, new Map([['e:ev-9', 'the straps never dig in']]))
    expect(thawed.detail!.quotes).toEqual([{ ref: 'e:ev-9', text: 'the straps never dig in' }])
    expect(thawed.detail!.voices).toBe(12)
    expect(thawed.allFindings![0].support).toEqual(['comfort'])
  })
})
