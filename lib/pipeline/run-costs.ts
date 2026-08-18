import { createAdminClient } from '../supabase-admin'

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

export type ApifyAttribution = 'exact' | 'ambiguous' | 'unavailable'

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
    attribution: concurrentRuns > 1 ? 'ambiguous' : 'exact',
  }
}

async function fetchApifyRuns(): Promise<ApifyRun[] | null> {
  const token = process.env.APIFY_TOKEN
  if (!token) return null
  try {
    const res = await fetch(`${APIFY_RUNS_URL}?desc=1&limit=200`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) return null
    const body = (await res.json()) as { data?: { items?: ApifyRun[] } }
    return body.data?.items ?? []
  } catch {
    return null
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

  const [{ data: calls }, { data: runRow }] = await Promise.all([
    admin.from('ai_call_log').select('pass, cost_usd').eq('run_id', runId),
    admin.from('pipeline_runs').select('started_at').eq('id', runId).maybeSingle(),
  ])

  const byPass: Record<string, number> = {}
  for (const c of ((calls ?? []) as { pass: string; cost_usd: number | null }[])) {
    byPass[c.pass] = Math.round((( byPass[c.pass] ?? 0) + Number(c.cost_usd ?? 0)) * 10000) / 10000
  }
  // 'transcribe' bills per audio minute / per caption item, outside the token
  // pricing everything else uses, so it is reported on its own line.
  const transcribeUsd = byPass.transcribe ?? 0
  const openaiUsd = Math.round(
    Object.entries(byPass).reduce((s, [pass, v]) => (pass === 'transcribe' ? s : s + v), 0) * 10000,
  ) / 10000

  const windowStart = (runRow?.started_at as string | undefined) ?? new Date(Date.now() - 6 * 3600_000).toISOString()
  const windowEnd = new Date().toISOString()

  const [apifyRuns, { count: concurrent }] = await Promise.all([
    fetchApifyRuns(),
    admin.from('pipeline_runs')
      .select('id', { head: true, count: 'exact' })
      .neq('id', runId)
      .gte('started_at', windowStart)
      .lte('started_at', windowEnd),
  ])

  const apify = apifyRuns
    ? attributeApifySpend(apifyRuns, windowStart, windowEnd, (concurrent ?? 0) + 1)
    : { usd: 0, attribution: 'unavailable' as ApifyAttribution }

  const summary: RunCostSummary = {
    openaiUsd,
    transcribeUsd,
    apifyUsd: apifyRuns ? apify.usd : null,
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

/** Model spend on this run so far, straight from ai_call_log. The budget stop
 *  reads this at every step boundary, so it must stay one cheap query. */
export async function runSpendSoFar(runId: string): Promise<number> {
  const admin = createAdminClient()
  const { data } = await admin.from('ai_call_log').select('cost_usd').eq('run_id', runId)
  const total = ((data ?? []) as { cost_usd: number | null }[])
    .reduce((s, r) => s + Number(r.cost_usd ?? 0), 0)
  return Math.round(total * 10000) / 10000
}
