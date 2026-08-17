import type { RawItem } from './types'

// Thin typed Apify client. Replaces the ~6 scattered HTTP-Request nodes the n8n
// gather used. One job: run an actor and hand back its dataset items.

const APIFY_BASE = 'https://api.apify.com/v2'

export class ApifyError extends Error {}

/** True ONLY when Apify says the actor ran on this input and died —
 *  `HTTP 400` with `"type":"run-failed"` / `"run-aborted"` (the run-sync
 *  endpoint's shape for an actor crash). That is the one 4xx that can be a
 *  per-input verdict. Every other 4xx is about US, not the input — 401 token,
 *  402 usage limit (month-end!), 403 rental, 404 actor renamed, 408 run
 *  timeout, 400 memory-limit under fan-out — and must propagate so the step
 *  retries / re-plans instead of stamping healthy videos 'failed'. Transient
 *  5xx/429/network are retried inside runActor and also propagate. */
export function isActorRunFailedError(e: unknown): boolean {
  return e instanceof ApifyError && /^Apify 400\b/.test(e.message) && /"type"\s*:\s*"run-(failed|aborted)"/.test(e.message)
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * Run an Apify actor synchronously and return its dataset items.
 *
 * Uses `run-sync-get-dataset-items`: starts the actor, holds the connection
 * until it finishes (up to `timeoutSecs`), returns the dataset in one call.
 * Simple and right for the CLI / first live runs. The production upgrade is
 * webhook-driven async ingest (Migration-to-Code §Execution model) — a
 * deliberate later swap behind this same function, not built before it's testable.
 *
 * `actorId` is the slug form, e.g. 'clockworks~tiktok-scraper'.
 */
export async function runActor(
  actorId: string,
  input: RawItem,
  opts: { token?: string; timeoutSecs?: number } = {},
): Promise<RawItem[]> {
  const token = opts.token ?? process.env.APIFY_TOKEN
  if (!token) throw new ApifyError('APIFY_TOKEN not set')
  const timeout = opts.timeoutSecs ?? 300

  const url = `${APIFY_BASE}/acts/${actorId}/run-sync-get-dataset-items?timeout=${timeout}`
  const res = await fetchWithRetry(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(input),
  })

  const data = (await res.json()) as unknown
  return Array.isArray(data) ? (data as RawItem[]) : []
}

/**
 * Retry transient failures (5xx / 429 / network), fail fast on other 4xx.
 * Mirrors the Technical.md retry policy for platform-critical Apify calls.
 */
async function fetchWithRetry(url: string, init: RequestInit, tries = 3): Promise<Response> {
  let lastErr: unknown
  for (let attempt = 1; attempt <= tries; attempt++) {
    try {
      const res = await fetch(url, init)
      if (res.ok) return res
      const transient = res.status >= 500 || res.status === 429
      const body = await res.text().catch(() => '')
      if (!transient) throw new ApifyError(`Apify ${res.status}: ${body.slice(0, 300)}`)
      lastErr = new ApifyError(`Apify ${res.status}: ${body.slice(0, 120)}`)
    } catch (e) {
      if (e instanceof ApifyError && !/Apify 5|Apify 429/.test(e.message)) throw e
      lastErr = e
    }
    if (attempt < tries) await sleep(attempt * 2000)
  }
  throw lastErr instanceof Error ? lastErr : new ApifyError(String(lastErr))
}
