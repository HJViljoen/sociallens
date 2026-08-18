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

/** Postgres unique-violation code, raised by the partial unique index when two
 *  open-run steps race past the pre-check. */
export const PG_UNIQUE_VIOLATION = '23505'
