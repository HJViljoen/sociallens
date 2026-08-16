import { describe, expect, it } from 'vitest'
import { subredditKey, activeSubreddits, knownSubreddits, parseSubreddits, applyStrikes } from './subreddits'
import type { SubredditEntry } from './types'

// The canonical key is load-bearing: the per-subreddit ROI loop joins stored
// videos (account_name = 'r/Prosthetics') back to config entries, and GPT
// proposes bare names in arbitrary case. A mismatch here silently zeroes a
// subreddit's ROI row rather than failing loudly.
describe('subredditKey', () => {
  it('collapses every shape a name arrives in to one key', () => {
    for (const input of [
      'Prosthetics',
      'r/Prosthetics',
      '/r/Prosthetics',
      'prosthetics',
      'https://www.reddit.com/r/Prosthetics/',
      'https://reddit.com/r/Prosthetics/comments/1vln07j/title/',
      '  r/Prosthetics  ',
    ]) {
      expect(subredditKey(input)).toBe('prosthetics')
    }
  })

  it('rejects user profiles — they are not communities', () => {
    // The actor returns u/… as communityName for profile posts; counting those
    // as subreddits would corrupt per-subreddit ROI.
    expect(subredditKey('u/NeurotechNewsletter')).toBe('')
    expect(subredditKey('/u/someone')).toBe('')
  })

  it('rejects junk rather than inventing a key', () => {
    expect(subredditKey('')).toBe('')
    expect(subredditKey('   ')).toBe('')
    expect(subredditKey('a')).toBe('') // Reddit names are 3-21 chars; 2 is our floor
    expect(subredditKey('not a subreddit!')).toBe('')
    expect(subredditKey('a'.repeat(25))).toBe('')
  })
})

describe('parseSubreddits', () => {
  it('normalises names and defaults an unknown status to candidate', () => {
    const out = parseSubreddits([
      { name: 'r/Amputee', status: 'active', discovered_at: '2026-08-14' },
      { name: 'Prosthetics', status: 'nonsense', discovered_at: '2026-08-14' },
    ])
    expect(out).toEqual([
      { name: 'amputee', status: 'active', discovered_at: '2026-08-14' },
      { name: 'prosthetics', status: 'candidate', discovered_at: '2026-08-14' },
    ])
  })

  it('drops malformed entries and de-dupes on the canonical key', () => {
    const out = parseSubreddits([
      { name: 'amputee', status: 'active', discovered_at: '' },
      { name: 'r/Amputee', status: 'rejected', discovered_at: '' }, // same community
      { name: 'u/someone', status: 'active', discovered_at: '' },
      { nope: true },
      null,
      'amputee',
    ])
    expect(out.map((e) => e.name)).toEqual(['amputee'])
    expect(out[0].status).toBe('active') // first wins
  })

  it('returns [] for a missing or non-array column', () => {
    expect(parseSubreddits(undefined)).toEqual([])
    expect(parseSubreddits({})).toEqual([])
  })

  it('keeps probe evidence when present', () => {
    const out = parseSubreddits([
      { name: 'amputee', status: 'active', discovered_at: '2026-08-14', probe: { sampled: 10, kept: 7, at: '2026-08-14' } },
    ])
    expect(out[0].probe).toEqual({ sampled: 10, kept: 7, at: '2026-08-14' })
  })
})

describe('activeSubreddits / knownSubreddits', () => {
  const entries: SubredditEntry[] = [
    { name: 'amputee', status: 'active', discovered_at: '' },
    { name: 'prosthetics', status: 'candidate', discovered_at: '' },
    { name: 'running', status: 'rejected', discovered_at: '' },
  ]

  it('searches only active subreddits', () => {
    expect(activeSubreddits(entries)).toEqual(['amputee'])
  })

  it('remembers rejected ones so they are not re-proposed forever', () => {
    // The Poler/Patagonia lesson: a community the probe already threw out must
    // not come back every week just because GPT likes the name.
    expect(knownSubreddits(entries)).toEqual(new Set(['amputee', 'prosthetics', 'running']))
  })
})

describe('subredditKey — user profiles in actor form', () => {
  it('rejects the underscore profile form Reddit actually returns', () => {
    // Reddit exposes profiles as 'u/spez' in URLs but 'u_spez' as the real
    // subreddit name in API/actor output — the underscore form is the one that
    // reaches us, so matching only 'u/' would miss every real case and report
    // fake communities in per-subreddit ROI.
    expect(subredditKey('u_spez')).toBe('')
    expect(subredditKey('r/u_spez')).toBe('')
    expect(subredditKey('U_SomeUser')).toBe('')
  })

  it('does not over-reject real communities starting with u', () => {
    expect(subredditKey('unitedkingdom')).toBe('unitedkingdom')
    expect(subredditKey('r/UpliftingNews')).toBe('upliftingnews')
  })
})

// Dead-community detection. The hard part is that "this community died" and
// "our scraper broke" look identical from here — so the guard, not the counter,
// is what these tests are really pinning.
describe('applyStrikes', () => {
  const active = (name: string, strikes?: number): SubredditEntry => ({
    name, status: 'active', discovered_at: '2026-08-01', ...(strikes ? { strikes } : {}),
  })
  const LIMIT = 3

  it('strikes a barren community when another Reddit source worked', () => {
    const y = new Map([['r/amputee', 0], ['ossur', 12]])
    const out = applyStrikes([active('amputee')], y, LIMIT)
    expect(out.entries[0].strikes).toBe(1)
    expect(out.entries[0].status).toBe('active')
    expect(out.struck).toEqual(['amputee'])
  })

  it('strikes NOBODY when everything failed — that is our scraper, not their death', () => {
    // The config-wiping scenario: actor breaks, every community returns zero.
    const y = new Map([['r/amputee', 0], ['r/prosthetics', 0], ['ossur', 0]])
    const out = applyStrikes([active('amputee'), active('prosthetics')], y, LIMIT)
    expect(out.struck).toEqual([])
    expect(out.demoted).toEqual([])
    expect(out.entries.every((e) => !e.strikes)).toBe(true)
  })

  it('a productive run clears history — failures must be consecutive', () => {
    const y = new Map([['r/amputee', 4], ['ossur', 1]])
    const out = applyStrikes([active('amputee', 2)], y, LIMIT)
    expect(out.entries[0].strikes).toBe(0)
    expect(out.struck).toEqual([])
  })

  it('demotes to candidate at the limit — never to rejected', () => {
    // 'rejected' is permanent (never re-proposed), so one bad month would lose a
    // good community for good. A candidate gets re-probed and can come back.
    const y = new Map([['r/amputee', 0], ['ossur', 9]])
    const out = applyStrikes([active('amputee', 2)], y, LIMIT)
    expect(out.entries[0].status).toBe('candidate')
    expect(out.entries[0].strikes).toBe(0)
    expect(out.demoted).toEqual(['amputee'])
  })

  it('treats a missing row as barren — a harvest that never ran yielded nothing', () => {
    const y = new Map([['ossur', 5]])
    expect(applyStrikes([active('amputee')], y, LIMIT).entries[0].strikes).toBe(1)
  })

  it('leaves candidates and rejects alone', () => {
    const entries: SubredditEntry[] = [
      { name: 'a1', status: 'candidate', discovered_at: '' },
      { name: 'b2', status: 'rejected', discovered_at: '' },
    ]
    const out = applyStrikes(entries, new Map([['ossur', 3]]), LIMIT)
    expect(out.entries).toEqual(entries)
  })

  it('does nothing without gather history', () => {
    const entries = [active('amputee')]
    expect(applyStrikes(entries, null, LIMIT).entries).toBe(entries)
    expect(applyStrikes(entries, new Map(), LIMIT).entries).toBe(entries)
  })

  it('demotion frees a slot, which un-converges discovery', () => {
    // The recovery path: falling below target makes discoveryConverged false,
    // so the next proposal tops the tenant back up. No extra machinery.
    const five = ['a1', 'b2', 'c3', 'd4', 'e5'].map((n) => active(n, 2))
    // Only a1 is barren; the rest are producing, which is also what makes them
    // the sibling evidence that a1's silence is a1's own problem.
    const y = new Map<string, number>([
      ['ossur', 7], ['r/a1', 0], ['r/b2', 3], ['r/c3', 2], ['r/d4', 5], ['r/e5', 1],
    ])
    const out = applyStrikes(five, y, LIMIT)
    expect(out.demoted).toEqual(['a1'])
    expect(out.entries.filter((e) => e.status === 'active')).toHaveLength(4)
    // …and the survivors' strike history is cleared by their productive run.
    expect(out.entries.filter((e) => e.strikes).length).toBe(0)
  })
})
