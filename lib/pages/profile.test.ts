import { describe, expect, it } from 'vitest'
import { freezeQuotes, resolveQuotes } from '../renderables/quotes-freeze'
import type { ProfileData } from './profile'

const fixture: ProfileData = {
  brand: 'Sealand',
  runDate: '2026-08-16',
  personas: [{ key: 'p1', name: 'Caregiver' }, { key: 'p2', name: 'Athlete' }],
  activeKey: 'p1',
  active: {
    key: 'p1', name: 'Caregiver', oneLiner: 'Buys for someone else', scope: 'client',
    wants: 'wants comfort', blockers: 'straps that dig in', triggers: 'a return policy',
    sourceVideoCount: 12, prevalence: 'widespread', share: 60,
    drivesQuote: { ref: 'e:ev-1', text: 'the buckle hurts my wrist' },
    stopsQuote: { ref: 'e:ev-2', text: 'too heavy after an hour' },
    worksQuote: null,
  },
  isStale: false,
  staleRunDate: null,
  platformMix: { rows: [], platforms: [] },
  shareOverTime: { dates: [], series: [] },
  method: { company: 'Sealand', period: 'Update of Sun 16 Aug', platforms: [], videos: null, comments: null, note: null },
}

describe('profile quotes freeze', () => {
  it('strips the persona’s block voices to refs and restores them', () => {
    const { data: frozen, refs } = freezeQuotes(fixture)
    expect(refs.sort()).toEqual(['e:ev-1', 'e:ev-2'])
    expect(JSON.stringify(frozen)).not.toContain('buckle')
    expect(frozen.active.worksQuote).toBeNull()

    const texts = new Map([['e:ev-1', 'the buckle hurts my wrist']]) // ev-2 erased
    const thawed = resolveQuotes(frozen, texts)
    expect(thawed.active.drivesQuote).toEqual({ ref: 'e:ev-1', text: 'the buckle hurts my wrist' })
    expect(thawed.active.stopsQuote).toBeNull()
    expect(thawed.active.share).toBe(60)
    expect(thawed.personas).toEqual(fixture.personas)
  })

  it('freezes and restores every quote inside a `full`-export persona list too', () => {
    const withFull = { ...fixture, full: [fixture.active, { ...fixture.active, key: 'p2', drivesQuote: { ref: 'e:ev-3', text: 'I need this' } }] }
    const { refs } = freezeQuotes(withFull)
    expect(refs.sort()).toEqual(['e:ev-1', 'e:ev-2', 'e:ev-3'])
  })
})
