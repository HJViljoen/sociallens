/**
 * Run-error bookkeeping for the pipeline's non-fatal steps.
 *
 * A pipeline run degrades rather than dies: a step that exhausts its retries is
 * caught, counted, and the run closes 'partial'. Until 2026-08-16 that count was
 * the ONLY record — the reason lived in a console line that the host's log
 * retention dropped within the hour, so a partial run was indistinguishable from
 * any other partial run after the fact. These helpers shape what close-run
 * persists to `pipeline_runs.errors` / `.error_message`.
 */

/** Hard cap on stored error strings. A pathological run (every comment batch
 *  failing) must not write an unbounded jsonb blob; the count in
 *  error_message stays honest past the cap. */
export const RUN_ERROR_CAP = 50

/**
 * One-line summary of a run's step errors, grouped by step label.
 *
 * `total` is the true error count, which can exceed `recorded.length` once the
 * cap bites — the summary says so rather than under-reporting.
 * Returns null for a clean run so error_message stays NULL.
 */
export function summariseRunErrors(total: number, recorded: string[]): string | null {
  if (total <= 0) return null

  const counts = new Map<string, number>()
  for (const entry of recorded) {
    const label = entry.split(': ')[0]
    counts.set(label, (counts.get(label) ?? 0) + 1)
  }

  const parts = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([label, n]) => (n > 1 ? `${label} ×${n}` : label))

  const noun = total === 1 ? 'step error' : 'step errors'
  if (!parts.length) return `${total} ${noun}`

  const truncated = total > recorded.length ? ` (first ${recorded.length} recorded)` : ''
  return `${total} ${noun}${truncated}: ${parts.join(', ')}`
}

/** How many recorded errors the partial-run alert lists inline. The full
 *  (RUN_ERROR_CAP-bounded) list is always in pipeline_runs.errors; the email
 *  only needs enough to name the failing step(s) at a glance. */
export const ALERT_ERROR_LIST_CAP = 15

/**
 * Operator alert for a run that closed 'partial'.
 *
 * Until 2026-08-16 only 'failed' and zero-video runs alerted, so a degraded
 * run — report delivered, side-layer silently dead — looked identical to a
 * clean one in the inbox. That is exactly how the first scheduled run's dead
 * owned layer went unnoticed. The email carries the same summary close-run
 * persists, so the operator sees the failing step without opening the DB.
 */
export function partialRunAlert(input: {
  runId: string
  clientName: string
  total: number
  recorded: string[]
  reportSent: boolean
}): { subject: string; text: string } {
  const { runId, clientName, total, recorded, reportSent } = input
  const listed = recorded.slice(0, ALERT_ERROR_LIST_CAP).map((e) => `- ${e}`)
  const rest = recorded.length - listed.length
  if (rest > 0) listed.push(`…and ${rest} more in pipeline_runs.errors`)

  const text = [
    `Run ${runId} for ${clientName} completed but closed PARTIAL: ${total} step${total === 1 ? '' : 's'} failed after retries.`,
    reportSent
      ? 'The client report was still sent — the core loop finished; the steps below degraded silently.'
      : 'No client report was requested for this run.',
    '',
    `Summary: ${summariseRunErrors(total, recorded) ?? `${total} step errors`}`,
    '',
    'Errors:',
    ...(listed.length ? listed : ['- (none recorded)']),
    '',
    'Full list: pipeline_runs.errors / error_message. Owned-layer step named? → scripts/diagnose-owned.ts.',
  ].join('\n')

  return { subject: `Verbatim run PARTIAL — ${clientName}`, text }
}

/**
 * Pass A degradation rule (Tier 0, 2026-08-18): the run is degraded when any
 * live call died on a 429, or when failed calls exceed `ratio` of attempts.
 * Returns the one-line reason to record via noteError, or null when the run
 * may still close clean (the failed videos are simply re-read next run).
 */
export function passADegradation(
  a: { attempted: number; errored: number; rateLimited: boolean; firstError?: string },
  ratio: number,
): string | null {
  if (a.errored <= 0) return null
  const share = a.attempted > 0 ? a.errored / a.attempted : 1
  const degraded = a.rateLimited || share > ratio
  if (!degraded) return null
  const pct = Math.round(share * 100)
  const why = a.rateLimited ? ' incl. a 429 (rate limit / credits)' : ''
  const first = a.firstError ? ` — first: ${a.firstError}` : ''
  return `${a.errored} of ${a.attempted} video calls failed (${pct}%)${why}${first}`
}
