import { createHash } from 'crypto'

/**
 * Single-flight guard for pipeline runs (Tier 0, 2026-08-18).
 *
 * "One run per client at a time" used to be enforced by the Inngest function's
 * `concurrency: { limit: 1, key: clientId }`. That option limits concurrent
 * STEPS, not runs — so every "parallel" wave in the pipeline (search, comment,
 * transcribe, Pass A, classify, themes) executed one step at a time for its
 * whole life; an interval sweep over ai_call_log found zero overlapping calls
 * in any run. The step limit is now the wave ceiling, and single-flight lives
 * here: open-run refuses to open a second run while one is in flight, and a
 * partial unique index (`pipeline_runs_one_running_per_client`) backs it in
 * the database for the race the pre-check cannot see.
 *
 * Pure decision so it can be tested without a database.
 */

/** A `running` row for the same client that is older than this is treated as
 *  abandoned (function died without reaching onFailure) and closed as failed
 *  rather than blocking the client forever. Runs take ~3 h serial today and
 *  should be under an hour once waves fan out; 6 h leaves a wide margin. */
export const RUN_STALE_AFTER_HOURS = 6

export interface RunningRow {
  id: string
  started_at: string
}

export type OpenRunDecision =
  | { action: 'skip'; blockingRunId: string }
  | { action: 'open'; staleRunIds: string[] }

/**
 * Given the client's rows currently at status 'running' (excluding the row an
 * analysis-only resume is about to reopen), decide whether a new run may open.
 * Any live row → skip. Stale rows never block; the caller marks them failed.
 */
export function decideOpenRun(
  running: RunningRow[],
  now: Date = new Date(),
  staleAfterHours: number = RUN_STALE_AFTER_HOURS,
): OpenRunDecision {
  const staleBefore = now.getTime() - staleAfterHours * 60 * 60 * 1000
  const live = running.find((r) => new Date(r.started_at).getTime() >= staleBefore)
  if (live) return { action: 'skip', blockingRunId: live.id }
  return { action: 'open', staleRunIds: running.map((r) => r.id) }
}

/** Postgres unique-violation code, raised by the unique index when two
 *  open-run steps race past the pre-check. */
export const PG_UNIQUE_VIOLATION = '23505'

/**
 * A run id derived from the triggering event, so a RETRY of the open-run step
 * recognises the row its own previous attempt inserted (fresh-eyes review,
 * 2026-08-18).
 *
 * With `randomUUID()` the sequence was: attempt 1 inserts the row, its response
 * is lost ("fetch failed" appears five times in this codebase's comments), the
 * step throws and retries, attempt 2's guard sees a run in flight one second
 * old and SKIPS. The run silently never happens, the client is blocked for six
 * hours, and the phantom row is later stamped failed. Deriving the id from the
 * event makes the retry idempotent instead.
 */
export function runIdForEvent(eventId: string): string {
  const h = createHash('sha256').update(`verbatim:run:${eventId}`).digest('hex')
  // Shape the digest as a v4-looking uuid so the uuid column accepts it.
  return [
    h.slice(0, 8),
    h.slice(8, 12),
    `4${h.slice(13, 16)}`,
    ((parseInt(h[16], 16) & 0x3) | 0x8).toString(16) + h.slice(17, 20),
    h.slice(20, 32),
  ].join('-')
}
