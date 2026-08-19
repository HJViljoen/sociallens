import { ASK_DAILY_LIMIT } from '../config'

/**
 * Per-tenant daily cap on Ask submissions.
 *
 * /api/ask is the first endpoint in this product where a logged-in user spends
 * real money on demand: three model calls, ~$0.35–0.50 for a large plan. With
 * no cap, one signed-in account submitting back to back is roughly $40/hour,
 * and twenty concurrent requests are far worse — Vercel will happily fan them
 * out and nothing in the code would notice.
 *
 * A daily count is deliberately crude. It needs no new infrastructure (the
 * rows are already there), it cannot be defeated by concurrency in a way that
 * matters at this scale, and the failure mode is a clear message rather than a
 * silent bill. A real rate limiter belongs with the self-serve motion, next to
 * the signup gate's Turnstile.
 */
export type QuotaCheck = { ok: true; used: number } | { ok: false; message: string }

export function evaluateQuota(usedToday: number, limit = ASK_DAILY_LIMIT): QuotaCheck {
  if (usedToday >= limit) {
    return {
      ok: false,
      message: `That is ${limit} checks today, which is the daily limit. It resets tomorrow — or tell us if you need more.`,
    }
  }
  return { ok: true, used: usedToday }
}

/** Start of the current UTC day, as an ISO timestamp for the count query. */
export function dayStartIso(now: Date): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString()
}
