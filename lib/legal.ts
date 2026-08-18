/**
 * Links to the public legal pages (T0-9, 2026-08-18).
 *
 * Deliberately its own module with no server-only imports: the consent line
 * renders inside client components (/signup, invite acceptance), and lib/site
 * reads `next/headers`, which a client bundle cannot import.
 *
 * The pages live on the apex; the app host 308s /site/* back to it, so in-app
 * links must be absolute. In local dev the apex is not a real host, so fall
 * back to the internal path the dev server actually serves.
 */
const ORIGIN =
  process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, '') ??
  (process.env.NODE_ENV === 'development' ? '/site' : 'https://verbatimintel.com')

export const PRIVACY_URL = `${ORIGIN}/privacy`
export const TERMS_URL = `${ORIGIN}/terms`
