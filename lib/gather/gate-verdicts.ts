import type { createAdminClient } from '../supabase-admin'
import type { RelevanceCandidate, RelevanceVerdict } from './relevance'

// Recording what the relevance gate decides (Tier 1, 2026-08-18).
//
// The gate discards 38-61% of every run's gathered videos and, until now, kept
// nothing: a dropped video is filtered out before the `videos` upsert so it
// leaves no row, and the reasons go to a console line that ages out within the
// hour. That makes the gate simultaneously the most consequential and the least
// inspectable decision in the pipeline — you cannot tune what you cannot see,
// and any "improved" gate would be another unverifiable change.

type Admin = ReturnType<typeof createAdminClient>

/** Enough caption to judge the judgement, not enough to duplicate the corpus. */
const CAPTION_EXCERPT_CHARS = 200

export interface GateVerdictRow {
  client_id: string
  run_id: string | null
  platform: string
  video_id: string
  account_name: string | null
  caption_excerpt: string | null
  keyword: string | null
  kept: boolean
  reason: string | null
  source: 'heuristic' | 'gpt' | 'default'
}

/**
 * Shape one row per judged candidate. Pure, so the mapping is testable without
 * a database — including the case that matters most: a candidate NO verdict
 * covers. The gate fails open in three separate ways (a batch that threw, a
 * short verdict array, an out-of-range index), and every one of them silently
 * keeps the video. Those land here as source 'default', which makes accidental
 * keeps countable for the first time.
 */
export function buildGateVerdictRows(
  clientId: string,
  runId: string | null,
  platform: string,
  candidates: RelevanceCandidate[],
  verdicts: Map<string, RelevanceVerdict>,
  keywordFor?: (videoId: string) => string | null,
): GateVerdictRow[] {
  return candidates.map((c) => {
    const v = verdicts.get(c.video_id)
    const caption = (c.caption ?? '').trim()
    return {
      client_id: clientId,
      run_id: runId,
      platform,
      video_id: c.video_id,
      account_name: c.account_name ?? null,
      caption_excerpt: caption ? caption.slice(0, CAPTION_EXCERPT_CHARS) : null,
      keyword: keywordFor?.(c.video_id) ?? null,
      // Matches the live rule at gather.ts: anything not explicitly dropped is kept.
      kept: v?.relevant !== false,
      reason: v?.reason ?? 'no verdict returned (gate failed open)',
      source: v?.source ?? 'default',
    }
  })
}

/** Persist the verdicts. Non-fatal by contract: losing the record of a gather
 *  must never lose the gather. Chunked — a big platform judges ~460 candidates. */
export async function recordGateVerdicts(admin: Admin, rows: GateVerdictRow[]): Promise<number> {
  if (!rows.length) return 0
  let written = 0
  for (let i = 0; i < rows.length; i += 200) {
    // Upsert, not insert: this runs inside a step that can replay (the
    // attribution call and two upserts after it can each fail), and a
    // re-insert would double every survival rate the table exists to measure.
    const { error } = await admin
      .from('gate_verdicts')
      .upsert(rows.slice(i, i + 200), { onConflict: 'client_id,run_id,platform,video_id' })
    if (error) throw new Error(`record gate verdicts: ${error.message}`)
    written += Math.min(200, rows.length - i)
  }
  return written
}
