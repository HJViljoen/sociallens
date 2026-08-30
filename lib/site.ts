import { headers } from 'next/headers'

// Absolute origin for building shareable links (e.g. invite URLs). Prefers an
// explicitly configured URL in production; falls back to the request host so
// links work in local dev without extra config. Request-scoped (reads headers).
/** The app's origin with no request in scope — an Inngest step, a script. The
 *  configured URL, else the render base (dev), never a request header. */
export function appBaseUrl(): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL || process.env.RENDER_BASE_URL
  if (configured) return configured.replace(/\/$/, '')
  // The app lives on the app. subdomain — the apex is the marketing site.
  return process.env.NODE_ENV === 'production' ? 'https://app.verbatimintel.com' : 'http://localhost:3000'
}

export async function getBaseUrl(): Promise<string> {
  const configured = process.env.NEXT_PUBLIC_APP_URL
  if (configured) return configured.replace(/\/$/, '')

  const h = await headers()
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost:3000'
  const proto = h.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https')
  return `${proto}://${host}`
}
