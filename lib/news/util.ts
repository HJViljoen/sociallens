import { createHash } from 'crypto'

/** Stable dedupe key for a news item — sha1 hex of its guid || url. */
export const hashKey = (s: string): string => createHash('sha1').update(s).digest('hex')

/** Parse a date-ish string (RFC-822, ISO, …) to an ISO timestamp; null if unparseable. */
export function toIso(s: string): string | null {
  if (!s) return null
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

/** report_period → Google News `when:` window token (matches the gather window lengths). */
export function periodToWhen(period: string): string {
  return period === 'daily' ? '1d' : period === 'monthly' ? '30d' : '7d'
}
