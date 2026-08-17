import type { RawItem } from './types'

// Thin typed Apify client. Replaces the ~6 scattered HTTP-Request nodes the n8n
// gather used. One job: run an actor and hand back its dataset items.

const APIFY_BASE = 'https://api.apify.com/v2'

export class ApifyError extends Error {}

/** True when Apify answered with a definitive 4xx (not 429) — the actor
 *  rejected or failed on THIS input, and retrying the same call won't change
 *  it. Transient failures (5xx / 429 / network) are already retried inside
 *  runActor and surface as different messages; callers should let those
 *  propagate so the Inngest step retries with backoff. */
export function isNonTransientApifyError(e: unknown): boolean {
  return e instanceof ApifyError && /^Apify 4\d\d\b/.test(e.message) && !/^Apify 429\b/.test(e.message)
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
