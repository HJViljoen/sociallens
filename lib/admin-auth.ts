import { timingSafeEqual } from 'crypto'

/**
 * Ops authentication for /api/admin/* (Tier 0 T0-11, 2026-08-18).
 *
 * Both admin routes compared X-Admin-Key against SUPABASE_SERVICE_ROLE_KEY, so
 * the ops bearer WAS the database master key: it travelled in curl history and
 * in the README, and rotating it after a leak meant re-keying every server-side
 * Supabase call in the product. ADMIN_API_KEY is a separate credential that can
 * be rotated on its own.
 *
 * The service-role key still works during the changeover, so an in-flight
 * script does not break the moment this deploys. Remove that fallback once
 * ADMIN_API_KEY is set in Vercel and the local scripts are updated.
 */
export function adminKeyValid(provided: string | null | undefined): boolean {
  const candidates = [process.env.ADMIN_API_KEY, process.env.SUPABASE_SERVICE_ROLE_KEY]
    .filter((k): k is string => Boolean(k))
  const given = provided ?? ''
  return candidates.some((expected) => {
    const a = Buffer.from(given)
    const b = Buffer.from(expected)
    return a.length === b.length && timingSafeEqual(a, b)
  })
}
