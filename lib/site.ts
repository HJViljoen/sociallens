import { headers } from 'next/headers'

// Absolute origin for building shareable links (e.g. invite URLs). Prefers an
// explicitly configured URL in production; falls back to the request host so
// links work in local dev without extra config. Request-scoped (reads headers).
export async function getBaseUrl(): Promise<string> {
  const configured = process.env.NEXT_PUBLIC_APP_URL
  if (configured) return configured.replace(/\/$/, '')

  const h = await headers()
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost:3000'
  const proto = h.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https')
  return `${proto}://${host}`
}

/** Canonical marketing-site origin. The legal pages live on the apex; the app
 *  host 308s /site/* back to it, so in-app links must be absolute (T0-9).
 *  In local dev the apex is not a real host, so fall back to the relative path
 *  the dev server does serve. */
export const SITE_ORIGIN =
  process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, '') ??
  (process.env.NODE_ENV === 'development' ? '/site' : 'https://verbatimintel.com')

export const PRIVACY_URL = `${SITE_ORIGIN}/privacy`
export const TERMS_URL = `${SITE_ORIGIN}/terms`
