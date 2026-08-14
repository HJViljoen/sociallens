import { describe, expect, it } from 'vitest'
import { subredditKey, activeSubreddits, knownSubreddits, parseSubreddits } from './subreddits'
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
