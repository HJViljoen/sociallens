import { describe, expect, it } from 'vitest'
import { toCandidates, buildDiscoveryUserPrompt, MAX_PROPOSALS } from './subreddit-discovery'
import type { GatherConfig, SubredditEntry } from './types'

const config: GatherConfig = {
  brand_keywords: ['ossur'],
  competitor_keywords: [],
  competitor_names: ['Ottobock'],
  industry_keywords: ['prosthetic', 'amputee'],
  platforms: ['reddit'],
  max_videos: 25,
  comment_depth: 50,
  report_period: 'weekly',
  own_handles: {},
  subreddits: [],
}

// Proposal is a shortlist to TEST, never a decision — the live relevance probe
// promotes candidates. These tests pin the filtering that sits between the model
// and a paid probe, since every surviving candidate costs an Apify run.
describe('toCandidates', () => {
  it('normalises names and marks everything a candidate, never active', () => {
    const out = toCandidates(
      { subreddits: [{ name: 'r/Amputee', reason: 'x' }, { name: 'Prosthetics', reason: 'y' }] },
      [],
      '2026-08-14',
    )
    expect(out).toEqual([
      { name: 'amputee', status: 'candidate', discovered_at: '2026-08-14' },
      { name: 'prosthetics', status: 'candidate', discovered_at: '2026-08-14' },
    ])
  })

  it('never re-proposes a community the probe already rejected', () => {
    // The Poler/Patagonia lesson: without this, a plausible-sounding but wrong
    // community comes back every week and is re-probed every week.
    const existing: SubredditEntry[] = [
      { name: 'patagonia', status: 'rejected', discovered_at: '2026-08-01' },
      { name: 'amputee', status: 'active', discovered_at: '2026-08-01' },
    ]
    const out = toCandidates(
      { subreddits: [{ name: 'Patagonia', reason: 'x' }, { name: 'r/amputee', reason: 'y' }, { name: 'prosthetics', reason: 'z' }] },
      existing,
      '2026-08-14',
    )
    expect(out.map((c) => c.name)).toEqual(['prosthetics'])
  })

  it('drops junk, user profiles and duplicates', () => {
    const out = toCandidates(
      {
        subreddits: [
          { name: 'u/someguy', reason: '' },
          { name: 'not a subreddit!', reason: '' },
          { name: '', reason: '' },
          { name: 'amputee', reason: '' },
          { name: 'r/Amputee', reason: '' },
        ],
      },
      [],
      '2026-08-14',
    )
    expect(out.map((c) => c.name)).toEqual(['amputee'])
  })

  it('caps the shortlist — every extra candidate costs a paid probe', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ name: `sub${i}test`, reason: '' }))
    expect(toCandidates({ subreddits: many }, [], '2026-08-14')).toHaveLength(MAX_PROPOSALS)
  })

  it('survives an unparsed response', () => {
    expect(toCandidates(null, [], '2026-08-14')).toEqual([])
  })
})

describe('buildDiscoveryUserPrompt', () => {
  it('tells the model what not to propose again', () => {
    const p = buildDiscoveryUserPrompt(config, new Set(['patagonia', 'amputee']))
    expect(p).toContain('do NOT propose these again')
    expect(p).toContain('amputee, patagonia')
  })

  it('omits the exclusion block on a first run', () => {
    expect(buildDiscoveryUserPrompt(config, new Set())).not.toContain('do NOT propose')
  })

  it('carries brand, competitors and industry', () => {
    const p = buildDiscoveryUserPrompt(config, new Set())
    expect(p).toContain('ossur')
    expect(p).toContain('Ottobock')
    expect(p).toContain('prosthetic, amputee')
  })
})
