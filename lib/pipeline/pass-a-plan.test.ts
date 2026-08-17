import { describe, it, expect } from 'vitest'
import { decideAnalysis, growthThreshold, staleInsightIds, type VideoAnalysisState } from './pass-a-plan'

// Incremental Pass A invariants worth locking (2026-08-17):
//  - flag off ⇒ today's behaviour exactly (every eligible video re-read)
//  - a video is re-read only when something the prompt sees changed: new /
//    comment growth past the rule / transcript landed / lane changed / prompt
//    version bumped / operator force
//  - growth is measured against the count AT LAST ANALYSIS (cumulative), and
//    only for the full lane (the claims lane sends no comments)
//  - the same run never re-reads a video it already produced (resume safety)
//  - staleness = "not the row the video's pointer names"

const state = (over: Partial<VideoAnalysisState> = {}): VideoAnalysisState => ({
  analyzed_run_id: 'run-1',
  analyzed_comment_count: 20,
  analyzed_prompt_version: 'pass_a_v4',
  analyzed_lane: 'full',
  analyzed_with_transcript: false,
  ...over,
})

const base = {
  laneNow: 'full' as const,
  storedComments: 20,
  transcriptUsableNow: false,
  promptVersion: 'pass_a_v4',
  incremental: true,
  force: false,
  runId: 'run-2',
}

describe('growthThreshold', () => {
  it('is min(3, ceil(20%)) with a floor of 1', () => {
    expect(growthThreshold(0)).toBe(1)
    expect(growthThreshold(5)).toBe(1)   // 20% of 5 = 1
    expect(growthThreshold(10)).toBe(2)  // 20% of 10 = 2
    expect(growthThreshold(14)).toBe(3)  // ceil(2.8) = 3
    expect(growthThreshold(15)).toBe(3)
    expect(growthThreshold(100)).toBe(3) // capped by PASS_A_RECHECK_MIN
  })
})

describe('decideAnalysis', () => {
  it('never selects a video that is not analysable now (skip lane), in either mode', () => {
    expect(decideAnalysis({ ...base, state: state(), laneNow: 'skip' })).toEqual({ select: false, reason: 'unchanged' })
    expect(decideAnalysis({ ...base, state: state(), laneNow: 'skip', incremental: false })).toEqual({ select: false, reason: 'unchanged' })
  })

  it('flag off ⇒ every eligible video is re-read (today\'s corpus-wide behaviour)', () => {
    expect(decideAnalysis({ ...base, state: state(), incremental: false })).toEqual({ select: true, reason: 'flag_off' })
    expect(decideAnalysis({ ...base, state: state({ analyzed_run_id: null }), incremental: false })).toEqual({ select: true, reason: 'flag_off' })
  })

  it('never re-reads a video this same run already produced (analysis-only resume)', () => {
    const s = state({ analyzed_run_id: 'run-2' })
    expect(decideAnalysis({ ...base, state: s })).toEqual({ select: false, reason: 'unchanged' })
    expect(decideAnalysis({ ...base, state: s, incremental: false })).toEqual({ select: false, reason: 'unchanged' })
    expect(decideAnalysis({ ...base, state: s, force: true })).toEqual({ select: false, reason: 'unchanged' })
  })

  it('force re-reads everything eligible', () => {
    expect(decideAnalysis({ ...base, state: state(), force: true })).toEqual({ select: true, reason: 'forced' })
  })

  it('a never-analysed video (or a dangling pointer) is new', () => {
    expect(decideAnalysis({ ...base, state: state({ analyzed_run_id: null }) })).toEqual({ select: true, reason: 'new' })
  })

  it('unchanged video is reused', () => {
    expect(decideAnalysis({ ...base, state: state() })).toEqual({ select: false, reason: 'unchanged' })
  })

  it('comment growth past the rule re-reads — cumulative since last analysis', () => {
    expect(decideAnalysis({ ...base, state: state({ analyzed_comment_count: 100 }), storedComments: 103 })).toEqual({ select: true, reason: 'grew' })
    expect(decideAnalysis({ ...base, state: state({ analyzed_comment_count: 100 }), storedComments: 102 })).toEqual({ select: false, reason: 'unchanged' })
    // small video: +1 on 5 is a 20% change of the whole prompt input
    expect(decideAnalysis({ ...base, state: state({ analyzed_comment_count: 5 }), storedComments: 6 })).toEqual({ select: true, reason: 'grew' })
    // +2 on 20 sits under both bars (3 and 20% = 4)
    expect(decideAnalysis({ ...base, state: state({ analyzed_comment_count: 20 }), storedComments: 22 })).toEqual({ select: false, reason: 'unchanged' })
    // shrinkage (comments deleted) is not growth
    expect(decideAnalysis({ ...base, state: state({ analyzed_comment_count: 20 }), storedComments: 12 })).toEqual({ select: false, reason: 'unchanged' })
  })

  it('a usable transcript landing after the last read re-reads', () => {
    expect(decideAnalysis({ ...base, state: state({ analyzed_with_transcript: false }), transcriptUsableNow: true })).toEqual({ select: true, reason: 'transcript' })
    expect(decideAnalysis({ ...base, state: state({ analyzed_with_transcript: true }), transcriptUsableNow: true })).toEqual({ select: false, reason: 'unchanged' })
  })

  it('a lane change re-reads (claims_only → full after crossing the floor)', () => {
    expect(decideAnalysis({ ...base, state: state({ analyzed_lane: 'claims_only', analyzed_with_transcript: true }), transcriptUsableNow: true }))
      .toEqual({ select: true, reason: 'lane' })
    // a bookkept skip that now qualifies for full is a lane change too
    expect(decideAnalysis({ ...base, state: state({ analyzed_lane: 'skip', analyzed_comment_count: 3 }), storedComments: 6 }))
      .toEqual({ select: true, reason: 'lane' })
  })

  it('claims lane ignores comment growth below the floor', () => {
    const s = state({ analyzed_lane: 'claims_only', analyzed_comment_count: 1, analyzed_with_transcript: true })
    expect(decideAnalysis({ ...base, state: s, laneNow: 'claims_only', storedComments: 4, transcriptUsableNow: true }))
      .toEqual({ select: false, reason: 'unchanged' })
  })

  it('a prompt-version bump re-reads once (full re-analysis on the next run)', () => {
    expect(decideAnalysis({ ...base, state: state({ analyzed_prompt_version: 'pass_a_v3' }) })).toEqual({ select: true, reason: 'version' })
  })
})

describe('staleInsightIds', () => {
  const videos = [
    { id: 'v1', analyzed_run_id: 'run-2' },
    { id: 'v2', analyzed_run_id: null },
  ]
  it('keeps rows the pointer names and flags everything else', () => {
    const rows = [
      { id: 'a', run_id: 'run-2', source_video_id: 'v1' }, // current
      { id: 'b', run_id: 'run-1', source_video_id: 'v1' }, // superseded by run-2
      { id: 'c', run_id: 'run-1', source_video_id: 'v2' }, // video has no pointer
      { id: 'd', run_id: null, source_video_id: 'v1' },    // its run was deleted
      { id: 'e', run_id: 'run-2', source_video_id: null }, // no source video
      { id: 'f', run_id: 'run-2', source_video_id: 'v9' }, // unknown video
    ]
    expect(staleInsightIds(videos, rows)).toEqual(['b', 'c', 'd', 'e', 'f'])
  })
  it('returns nothing when everything is current', () => {
    expect(staleInsightIds(videos, [{ id: 'a', run_id: 'run-2', source_video_id: 'v1' }])).toEqual([])
  })
})
