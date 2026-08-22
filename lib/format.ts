// Deterministic, hydration-safe formatters for client-facing numbers and dates.
//
// Intl / toLocaleString draw on ICU data that differs between the Node server
// and the browser, so using them in hydrated output causes SSR mismatches.
// Everything here formats by hand and anchors dates to UTC (run_date and
// snapshot_date are stored at fixed UTC instants), so server and client agree.
// Pure functions only — tested in lib/format.test.ts.

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/** 6163 → "6,163". Rounds first; negative numbers keep their sign. */
export function fmtInt(n: number): string {
  const r = Math.round(n)
  const sign = r < 0 ? '-' : ''
  return sign + Math.abs(r).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

/** 6163 → "6.2K", 18391 → "18.4K", 1_200_000 → "1.2M", 468 → "468".
 *  One decimal below 10 of a unit ("6.2K"), none above ("18K") — the compact
 *  form a stat tile wants, never false precision. */
export function fmtCompact(n: number): string {
  const abs = Math.abs(n)
  const sign = n < 0 ? '-' : ''
  const one = (v: number) => {
    const s = v < 10 ? (Math.round(v * 10) / 10).toFixed(1) : Math.round(v).toString()
    return s.endsWith('.0') ? s.slice(0, -2) : s
  }
  if (abs >= 1_000_000) return `${sign}${one(abs / 1_000_000)}M`
  if (abs >= 1_000) return `${sign}${one(abs / 1_000)}K`
  return `${sign}${Math.round(abs)}`
}

export const round1 = (n: number) => Math.round(n * 10) / 10

/** 85.1 → "85.1%", 16 → "16%". One decimal max, trailing .0 dropped. */
export function fmtPct(n: number, decimals: 0 | 1 = 1): string {
  const v = decimals === 0 ? Math.round(n) : round1(n)
  return `${v}%`
}

/** Signed delta: +2.3 → "+2.3 pt", -53 → "−53", 0 → "±0". Unit optional. */
export function fmtDelta(n: number, unit = '', decimals: 0 | 1 = 0): string {
  const v = decimals === 0 ? Math.round(n) : round1(n)
  const body = decimals === 0 ? fmtInt(Math.abs(v)) : Math.abs(v).toString()
  const sign = v > 0 ? '+' : v < 0 ? '−' : '±'
  return `${sign}${body}${unit ? ` ${unit}` : ''}`
}

/** "2026-08-16T07:07:51Z" → "16 Aug" (UTC). */
export function shortDate(iso: string): string {
  const d = new Date(iso)
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`
}

/** "2026-08-16T07:07:51Z" → "Sun 16 Aug" (UTC). */
export function weekdayDate(iso: string): string {
  const d = new Date(iso)
  return `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`
}

/** Capitalise the first letter — for platform/enum fallbacks only. */
export const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

export const PLATFORM_LABEL: Record<string, string> = {
  tiktok: 'TikTok',
  youtube: 'YouTube',
  instagram: 'Instagram',
  reddit: 'Reddit',
}

export function platformLabel(p: string): string {
  return PLATFORM_LABEL[p] ?? cap(p)
}

/** "TikTok, YouTube & Instagram" */
export function listNames(platforms: string[]): string {
  const names = platforms.map(platformLabel)
  if (names.length <= 1) return names.join('')
  return `${names.slice(0, -1).join(', ')} & ${names[names.length - 1]}`
}
