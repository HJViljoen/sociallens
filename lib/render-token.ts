import { createHmac, timingSafeEqual } from 'crypto'

/**
 * Signed, short-lived token for the internal /render route (Reports & Exports
 * Stage 1, 2026-08-29).
 *
 * /render/<snapshotId> serves print-mode HTML to headless Chrome, which runs
 * server-side with no Supabase session. proxy.ts lets /render through
 * unauthenticated; THIS is the gate. The token is minted by the export route
 * and verified by the render page in the same process, so it never needs to be
 * anything but an HMAC over a small payload with an expiry — no database
 * round-trip, nothing to revoke: a token that has expired is simply invalid.
 *
 * The first signed token in this codebase. Deliberately minimal (HMAC-SHA256,
 * base64url payload.signature) rather than a JWT library: two functions, no
 * dependency, and the payload is ours to shape.
 */

export interface RenderTokenPayload {
  /** report_snapshots.id the page may render. */
  snapshotId: string
  /** Renderable key when the render is one tile, e.g. 'dashboard.strip'. */
  tileKey?: string
  /** Unix seconds. Verification fails at or after this instant. */
  exp: number
}

/** Ten minutes: a render is measured in seconds; the ceiling is the route's
 *  maxDuration (300 s) plus slack. */
export const RENDER_TOKEN_TTL_SECONDS = 600

const b64url = (buf: Buffer) => buf.toString('base64url')

function sign(payloadB64: string, secret: string): string {
  return b64url(createHmac('sha256', secret).update(payloadB64).digest())
}

export function signRenderToken(payload: RenderTokenPayload, secret: string): string {
  if (!secret) throw new Error('render token: empty secret')
  const payloadB64 = b64url(Buffer.from(JSON.stringify(payload)))
  return `${payloadB64}.${sign(payloadB64, secret)}`
}

/** Returns the payload when the signature matches and the token has not
 *  expired; null otherwise. Never throws on malformed input — a bad token is
 *  a 404, not a stack trace. */
export function verifyRenderToken(
  token: string | null | undefined,
  secret: string,
  now: Date = new Date(),
): RenderTokenPayload | null {
  if (!token || !secret) return null
  const dot = token.indexOf('.')
  if (dot <= 0 || dot === token.length - 1) return null
  const payloadB64 = token.slice(0, dot)
  const given = token.slice(dot + 1)
  const expected = sign(payloadB64, secret)
  const a = Buffer.from(given)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null
  let payload: unknown
  try {
    payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'))
  } catch {
    return null
  }
  if (!payload || typeof payload !== 'object') return null
  const p = payload as Partial<RenderTokenPayload>
  if (typeof p.snapshotId !== 'string' || !p.snapshotId) return null
  if (typeof p.exp !== 'number' || !Number.isFinite(p.exp)) return null
  if (p.tileKey !== undefined && typeof p.tileKey !== 'string') return null
  const nowSec = now.getTime() / 1000
  if (nowSec >= p.exp) return null
  // The TTL holds at the verifier too, not only at mint: a payload signed with
  // a far-off exp (a leaked secret, a bug) is still only good for ten minutes.
  if (p.exp - nowSec > RENDER_TOKEN_TTL_SECONDS) return null
  return { snapshotId: p.snapshotId, exp: p.exp, ...(p.tileKey ? { tileKey: p.tileKey } : {}) }
}

/** The signing secret. RENDER_TOKEN_SECRET when set; otherwise the service-role
 *  key, which is acceptable ONLY because a render token is minted and checked
 *  by this same server and never handed to a browser a person controls. Set
 *  the dedicated secret in Vercel all the same, so the two can be rotated
 *  apart (the lesson of ADMIN_API_KEY, lib/admin-auth.ts). */
export function renderTokenSecret(): string {
  return process.env.RENDER_TOKEN_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || ''
}
