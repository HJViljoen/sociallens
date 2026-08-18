import { describe, it, expect } from 'vitest'
import { buildGateVerdictRows } from './gate-verdicts'
import type { RelevanceCandidate, RelevanceVerdict } from './relevance'

const cand = (video_id: string, over: Partial<RelevanceCandidate> = {}): RelevanceCandidate =>
  ({ video_id, account_name: 'acct', caption: 'a caption', hashtags: [], ...over } as RelevanceCandidate)

const CLIENT = 'c1'
const RUN = 'r1'

describe('buildGateVerdictRows (Tier 1)', () => {
  it('records the dropped video, which today leaves no trace anywhere', () => {
    const verdicts = new Map<string, RelevanceVerdict>([
      ['v1', { relevant: false, reason: 'off-market term "cosplay"', source: 'heuristic' }],
    ])
    const [row] = buildGateVerdictRows(CLIENT, RUN, 'tiktok', [cand('v1')], verdicts)
    expect(row).toMatchObject({ kept: false, source: 'heuristic', reason: 'off-market term "cosplay"', platform: 'tiktok' })
  })

  it('marks a candidate NOBODY judged as a fail-open keep', () => {
    // The gate fails open three ways: a batch that threw, a short verdict
    // array, an out-of-range index. All of them silently keep the video, and
    // none of them was countable before.
    const [row] = buildGateVerdictRows(CLIENT, RUN, 'tiktok', [cand('v9')], new Map())
    expect(row.kept).toBe(true)
    expect(row.source).toBe('default')
    expect(row.reason).toContain('failed open')
  })

  it('matches the live keep rule: anything not explicitly dropped is kept', () => {
    const verdicts = new Map<string, RelevanceVerdict>([
      ['v1', { relevant: true, reason: 'on-market', source: 'gpt' }],
    ])
    const rows = buildGateVerdictRows(CLIENT, RUN, 'tiktok', [cand('v1'), cand('v2')], verdicts)
    expect(rows.map((r) => r.kept)).toEqual([true, true])
    expect(rows.map((r) => r.source)).toEqual(['gpt', 'default'])
  })

  it('truncates the caption rather than duplicating the corpus', () => {
    const [row] = buildGateVerdictRows(CLIENT, RUN, 'tiktok', [cand('v1', { caption: 'x'.repeat(500) })], new Map())
    expect(row.caption_excerpt).toHaveLength(200)
  })

  it('carries the surfacing keyword so survival can be read per keyword', () => {
    // `freitag` survives at 16.2% and `sealandgear` — the client's own handle —
    // at 16.1%; per-keyword attribution is how that gets diagnosed.
    const [row] = buildGateVerdictRows(CLIENT, RUN, 'tiktok', [cand('v1')], new Map(), () => 'freitag')
    expect(row.keyword).toBe('freitag')
  })

  it('tolerates a missing caption and a null run', () => {
    const [row] = buildGateVerdictRows(CLIENT, null, 'reddit', [cand('v1', { caption: null })], new Map())
    expect(row.caption_excerpt).toBeNull()
    expect(row.run_id).toBeNull()
  })
})
