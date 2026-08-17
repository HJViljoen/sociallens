import { PASS_A_RECHECK_MIN, PASS_A_RECHECK_SHARE } from '../config'

// Incremental Pass A — the pure decision logic (Theme Registry shape A,
// 2026-08-17). No I/O: plan-pass-a (inngest/functions/pipeline.ts) loads the
// rows and calls decideAnalysis per video; the prune step calls
// staleInsightIds. Kept pure so the selection rule is unit-tested and the
// pipeline step stays glue.
//
// THE INVARIANT this serves: videos.analyzed_run_id points at the run that
// produced a video's authoritative Pass A output; a video's current insights
// are the rows with run_id = analyzed_run_id (the *_current views). A video is
// re-read only when something the prompt sees has changed since that run.

export type AnalysisLane = 'full' | 'claims_only' | 'skip'

/** The per-video bookkeeping columns written by persistVideo (lib/pipeline/pass-a.ts). */
export interface VideoAnalysisState {
  analyzed_run_id: string | null
  analyzed_comment_count: number | null
  analyzed_prompt_version: string | null
  analyzed_lane: string | null
  analyzed_with_transcript: boolean | null
}

/** Why a video was (or wasn't) selected — surfaced in the plan-pass-a step
 *  result so a run log shows exactly what drove the re-reads. */
export type SelectReason =
  | 'flag_off'   // incremental selection disabled → today's corpus-wide re-read
  | 'forced'     // options.forcePassA (operator lever, e.g. after a prompt change)
  | 'new'        // never analysed (or the pointer dangles after a run deletion)
  | 'grew'       // stored comment rows grew past the growth rule
  | 'transcript' // a usable transcript exists now and wasn't in the last read
  | 'lane'       // lane changed (e.g. claims_only → full after crossing the floor)
  | 'version'    // Pass A prompt version bumped → one-off full re-read
  | 'unchanged'  // nothing the prompt sees has changed → reuse the stored analysis

export interface DecideAnalysisArgs {
  state: VideoAnalysisState
  /** Lane the video qualifies for NOW (passALane on raw stored counts). */
  laneNow: AnalysisLane
  /** Stored comment rows for the video now (the plan step's in-memory count). */
  storedComments: number
  transcriptUsableNow: boolean
  /** Current Pass A prompt version (v3/v4 by the transcripts flag). */
  promptVersion: string
  incremental: boolean
  force: boolean
  runId: string
}

/** Growth (in stored comment rows) that re-selects a video, given the count at
 *  its last analysis: min(PASS_A_RECHECK_MIN, ceil(share × prev)), never below
 *  1. Small videos re-read on +1/+2 (a ≥20% change of the prompt input),
 *  ≥15-comment videos on +3. See lib/config.ts for the measurement. */
export function growthThreshold(prevCount: number): number {
  const share = Math.ceil(PASS_A_RECHECK_SHARE * Math.max(0, prevCount))
  return Math.max(1, Math.min(PASS_A_RECHECK_MIN, share))
}

export function decideAnalysis(a: DecideAnalysisArgs): { select: boolean; reason: SelectReason } {
  // Not analysable at all — same as today's plan filter, regardless of mode.
  if (a.laneNow === 'skip') return { select: false, reason: 'unchanged' }
  const s = a.state
  // Already produced by THIS run (analysis-only resume of the same run id, or a
  // replayed plan): the stored output is this run's — never redo it.
  if (s.analyzed_run_id === a.runId) return { select: false, reason: 'unchanged' }
  if (!a.incremental) return { select: true, reason: 'flag_off' }
  if (a.force) return { select: true, reason: 'forced' }
  if (!s.analyzed_run_id) return { select: true, reason: 'new' }
  if (s.analyzed_prompt_version !== a.promptVersion) return { select: true, reason: 'version' }
  if (s.analyzed_lane !== a.laneNow) return { select: true, reason: 'lane' }
  if (a.transcriptUsableNow && !s.analyzed_with_transcript) return { select: true, reason: 'transcript' }
  // Comment growth only matters to the full lane — the claims lane sends zero
  // comments, so growth below the floor changes nothing it sees (crossing the
  // floor is a lane change, caught above).
  if (a.laneNow === 'full') {
    const prev = s.analyzed_comment_count ?? 0
    if (a.storedComments - prev >= growthThreshold(prev)) return { select: true, reason: 'grew' }
  }
  return { select: false, reason: 'unchanged' }
}

/** Ids of insight/language-sample rows that are no longer any video's current
 *  analysis: their run_id differs from the video's pointer, the video pointer
 *  is unset, the row has no source video, or the row's run was deleted
 *  (run_id null). Called at successful close-run only — never mid-run, so the
 *  displayed run's quotes keep resolving until the dashboard has flipped. */
export function staleInsightIds(
  videos: { id: string; analyzed_run_id: string | null }[],
  rows: { id: string; run_id: string | null; source_video_id: string | null }[],
): string[] {
  const pointer = new Map<string, string | null>()
  for (const v of videos) pointer.set(v.id, v.analyzed_run_id)
  const stale: string[] = []
  for (const r of rows) {
    if (!r.source_video_id || !r.run_id) { stale.push(r.id); continue }
    const p = pointer.get(r.source_video_id)
    if (!p || p !== r.run_id) stale.push(r.id)
  }
  return stale
}

/** Tally helper for the plan-pass-a step result. */
export function emptyReasonTally(): Record<SelectReason, number> {
  return { flag_off: 0, forced: 0, new: 0, grew: 0, transcript: 0, lane: 0, version: 0, unchanged: 0 }
}
