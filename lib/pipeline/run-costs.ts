import { createAdminClient, selectAll } from '../supabase-admin'

// Per-run spend ledger (Tier 1, 2026-08-18).
//
// OpenAI and Whisper spend was already computed per call in ai_call_log and
// never rolled up, so "what did this run cost" meant hand-written SQL. Apify
// spend was worse than invisible: when the 2026-08-16 run failed, the diagnosis
// had to come from Apify's own billing history, because the product held no
// record of what it had spent.

/** Apify's account-level runs list. run-sync-get-dataset-items returns only
 *  dataset items — no run id, no usage — so per-call attribution would mean
 *  changing the hottest, most expensive path in gather. This reads the account
 *  ledger once at close-run instead and attributes by time window. */
const APIFY_RUNS_URL = 'https://api.apify.com/v2/actor-runs'

export interface ApifyRun {
  startedAt: string
  finishedAt?: string | null
  usageTotalUsd?: number | null
  actId?: string
}

export type ApifyAttribution = 'exact' | 'ambiguous' | 'partial' | 'unavailable'

/**
 * Sum the Apify runs that belong to this pipeline run's window.
 *
 * `concurrentRuns` is how many pipeline runs were in flight account-wide over
 * the same window. Apify bills per account, not per tenant, so when two
 * tenants overlap the split is unknowable — the total is still recorded, and
 * labelled `ambiguous` rather than quietly presented as this run's spend.
 */
export function attributeApifySpend(
  runs: ApifyRun[],
  windowStart: string,
  windowEnd: string,
  concurrentRuns = 1,
  /** False when the account listing ran out of pages before reaching the
   *  window start — the sum is then a floor, never a total. */
  complete = true,
): { usd: number; attribution: ApifyAttribution } {
  const from = new Date(windowStart).getTime()
  const to = new Date(windowEnd).getTime()
  let usd = 0
  for (const r of runs) {
    const started = new Date(r.startedAt).getTime()
    if (!Number.isFinite(started) || started < from || started > to) continue
    usd += Number(r.usageTotalUsd ?? 0)
  }
  return {
    usd: Math.round(usd * 10000) / 10000,
    // Only claim 'exact' when this run was alone on the account AND we actually
    // read back far enough to see the whole window.
    attribution: !complete ? 'partial' : concurrentRuns > 1 ? 'ambiguous' : 'exact',
  }
}

/** Apify page size, and how many pages we are willing to walk. Every comment
 *  scrape is its own actor run, so a pipeline run generates 300-500+ of them —
 *  a single page of 200 would silently sum a fraction and report it as exact. */
const APIFY_PAGE = 500
const APIFY_MAX_PAGES = 8

/** Walk the account's actor runs back until we pass the window start.
 *  `complete: false` means we ran out of pages before reaching it, so the sum
 *  is a floor, not a total. */
async function fetchApifyRuns(windowStart: string): Promise<{ runs: ApifyRun[]; complete: boolean } | null> {
  const token = process.env.APIFY_TOKEN
  if (!token) return null
  const from = new Date(windowStart).getTime()
  const runs: ApifyRun[] = []
  try {
    for (let page = 0; page < APIFY_MAX_PAGES; page++) {
      const res = await fetch(`${APIFY_RUNS_URL}?desc=1&limit=${APIFY_PAGE}&offset=${page * APIFY_PAGE}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) return runs.length ? { runs, complete: false } : null
      const items = ((await res.json()) as { data?: { items?: ApifyRun[] } }).data?.items ?? []
      runs.push(...items)
      if (items.length < APIFY_PAGE) return { runs, complete: true }
      // Sorted newest-first: once a page ends before the window, we have it all.
      const oldest = items[items.length - 1]?.startedAt
      if (oldest && new Date(oldest).getTime() < from) return { runs, complete: true }
    }
    return { runs, complete: false }
  } catch {
    return runs.length ? { runs, complete: false } : null
  }
}

export interface RunCostSummary {
  openaiUsd: number
  transcribeUsd: number
  apifyUsd: number | null
  apifyAttribution: ApifyAttribution
  byPass: Record<string, number>
}

/** Roll a finished run's spend into run_costs. Non-fatal by contract: the
 *  caller wraps it, and a ledger failure must never change a run's outcome. */
export async function writeRunCosts(clientId: string, runId: string): Promise<RunCostSummary> {
  const admin = createAdminClient()

  const [calls, { data: runRow }] = await Promise.all([
    // Paginated and index-aligned, for the same reasons as runSpendSoFar.
    selectAll<{ pass: string; cost_usd: number | null }>(() =>
      admin.from('ai_call_log').select('pass, cost_usd')
        .eq('client_id', clientId).eq('run_id', runId).order('id', { ascending: true }),
    ),
    admin.from('pipeline_runs').select('started_at').eq('id', runId).maybeSingle(),
  ])

  const byPass: Record<string, number> = {}
  for (const c of calls) {
    byPass[c.pass] = Math.round((( byPass[c.pass] ?? 0) + Number(c.cost_usd ?? 0)) * 10000) / 10000
  }
  // 'transcribe' bills per audio minute / per caption item, outside the token
  // pricing everything else uses, so it is reported on its own line.
  const transcribeUsd = byPass.transcribe ?? 0
  const openaiUsd = Math.round(
    Object.entries(byPass).reduce((s, [pass, v]) => (pass === 'transcribe' ? s : s + v), 0) * 10000,
  ) / 10000

  // NOTE: an analysis-only resume rewrites started_at to now (T0-1), so a
  // resumed run's window deliberately excludes the original gather's Apify
  // spend — that spend belongs to the attempt that made it, not to the resume.
  const windowStart = (runRow?.started_at as string | undefined) ?? new Date(Date.now() - 6 * 3600_000).toISOString()
  const windowEnd = new Date().toISOString()

  const [apifyPage, { count: concurrent }] = await Promise.all([
    fetchApifyRuns(windowStart),
    // OVERLAP, not "started in the window": a run that began before this one
    // and is still in flight spends on the same Apify account, and the
    // scheduler fans tenants out seconds apart. Counting only runs that
    // STARTED inside the window labelled the last-dispatched run 'exact' while
    // two others were spending alongside it.
    admin.from('pipeline_runs')
      .select('id', { head: true, count: 'exact' })
      .neq('id', runId)
      .lte('started_at', windowEnd)
      .or(`completed_at.is.null,completed_at.gte.${windowStart}`),
  ])

  const apify = apifyPage
    ? attributeApifySpend(apifyPage.runs, windowStart, windowEnd, (concurrent ?? 0) + 1, apifyPage.complete)
    : { usd: 0, attribution: 'unavailable' as ApifyAttribution }

  const summary: RunCostSummary = {
    openaiUsd,
    transcribeUsd,
    apifyUsd: apifyPage ? apify.usd : null,
    apifyAttribution: apify.attribution,
    byPass,
  }

  const { error } = await admin.from('run_costs').upsert({
    run_id: runId,
    client_id: clientId,
    openai_usd: openaiUsd,
    transcribe_usd: transcribeUsd,
    apify_usd: summary.apifyUsd,
    apify_attribution: summary.apifyAttribution,
    by_pass: byPass,
  }, { onConflict: 'run_id' })
  if (error) throw new Error(`write run_costs: ${error.message}`)
  return summary
}

/**
 * Model spend on this run so far. The budget stop reads this at every step
 * boundary.
 *
 * MUST paginate: a bare select caps at 1000 rows, and a runaway run — the only
 * thing this exists to catch — makes MORE calls, so the reported figure would
 * plateau around $3.50 while real spend climbed without limit. Verified against
 * prod: run ef1e28a3 has 1,024 call rows costing $2.3261, of which a bare
 * select sees $2.0264. The ceiling could never reach the $15 budget, so the
 * stop could never fire.
 *
 * `client_id` is in the filter because ai_call_log's only index is
 * (client_id, run_id); filtering on run_id alone sequential-scans the table on
 * every one of a run's ~150-250 step boundaries.
 */
export async function runSpendSoFar(clientId: string, runId: string): Promise<number> {
  const admin = createAdminClient()
  const rows = await selectAll<{ cost_usd: number | null }>(() =>
    admin.from('ai_call_log').select('cost_usd')
      .eq('client_id', clientId).eq('run_id', runId).order('id', { ascending: true }),
  )
  const total = rows.reduce((s, r) => s + Number(r.cost_usd ?? 0), 0)
  return Math.round(total * 10000) / 10000
}
