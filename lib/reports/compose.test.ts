import { describe, expect, it } from 'vitest'
import { deckSlides, isStaticKey, sectionSlides } from './compose'
import type { ReportSection } from './types'
import type { Slide } from '../renderables/types'

const mod = {
  slides: (_d: unknown, variant: 'default' | 'full'): Slide[] => {
    const base: Slide[] = [
      { title: 'Where you stand', keys: ['x.standings', 'x.faceoff'], layout: 'grid' },
      { title: 'Share and table', keys: ['x.shareLine', 'x.table'], layout: 'grid' },
      { title: 'The selected finding', keys: ['x.finding'], layout: 'single' },
    ]
    return variant === 'full' ? [...base, { title: 'Finding 1', keys: ['x.item:0'], layout: 'single' }] : base
  },
}
const section = (over: Partial<ReportSection>): ReportSection => ({ id: 's1', page: 'competitive', params: {}, ...over })

describe('sectionSlides', () => {
  it('keeps every slide when no keys are named', () => {
    expect(sectionSlides(mod, section({}), {}).map((s) => s.title)).toEqual(['Where you stand', 'Share and table', 'The selected finding'])
  })
  it('filters tiles and drops emptied slides, keeping layouts', () => {
    const out = sectionSlides(mod, section({ keys: ['x.faceoff', 'x.finding'] }), {})
    expect(out).toEqual([
      { title: 'Where you stand', keys: ['x.faceoff'], layout: 'grid' },
      { title: 'The selected finding', keys: ['x.finding'], layout: 'single' },
    ])
  })
  it('lets per-item keys through only with the full variant', () => {
    expect(sectionSlides(mod, section({ keys: ['x.table'], variant: 'full' }), {}).map((s) => s.title)).toEqual(['Share and table', 'Finding 1'])
    expect(sectionSlides(mod, section({ keys: ['x.table'] }), {}).map((s) => s.title)).toEqual(['Share and table'])
  })
})

describe('deckSlides', () => {
  it('numbers the cover and every section slide once, marks first slides, skips unknown pages', () => {
    const deck = deckSlides(
      { sections: [
        { section: section({ keys: ['x.faceoff', 'x.table'] }), title: 'A', context: 'A', data: {} },
        { section: section({ id: 's2', page: 'agent' }), title: 'B', context: 'B', data: {} },
        { section: section({ id: 's3', keys: ['x.finding'] }), title: 'C', context: 'C', data: {} },
      ] },
      (page) => (page === 'competitive' ? mod : null),
    )
    expect(deck.map((s) => s.kind === 'cover' ? 'cover' : `${s.n}:${s.sectionIndex}:${s.first ? 'first' : ''}`)).toEqual([
      'cover', '2:0:first', '3:0:', '4:2:first',
    ])
  })
})

describe('isStaticKey', () => {
  it('accepts page.tile, rejects computed keys', () => {
    expect(isStaticKey('dashboard.strip')).toBe(true)
    expect(isStaticKey('voice.theme:3')).toBe(false)
    expect(isStaticKey('agent.turn:0:more')).toBe(false)
  })
})
