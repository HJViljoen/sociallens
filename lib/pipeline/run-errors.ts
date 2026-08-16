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
