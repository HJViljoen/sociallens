import { createHmac, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'crypto'
import { promisify } from 'util'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { SnapshotRow } from '../snapshots'

const scrypt = promisify(scryptCb)

/**
 * Share links (Stage 2, D6): `/r/<token>` — read-only, no account, rendered
 * live from a report snapshot. The token is the whole secret: 32 random
 * bytes, base64url (no dots — proxy.ts skips auth for a dotted last segment,
 * and a share URL must go through the proxy's public-prefix check, not around
 * it). Expiry, revoke, an optional password (scrypt, node:crypto — the first
 * password in this codebase, no dependency), a view log.
 *
 * The token column is withheld from the authenticated grant (migration
 * 20260830090000): the public route looks it up with the service role and
 * serves the SNAPSHOT — never a tenant table read live.
 */

export interface ShareLinkRow {
  id: string
  client_id: string
  snapshot_id: string
  token: string
  title: string
  expires_at: string | null
  password_hash: string | null
  revoked_at: string | null
  view_count: number
  last_viewed_at: string | null
  created_by: string | null
  created_at: string
}

export function mintShareToken(): string {
  const t = randomBytes(32).toString('base64url')
  if (t.includes('.')) throw new Error('share token: unexpected dot')
  return t
}

export const SHARE_TOKEN_RE = /^[A-Za-z0-9_-]{43}$/

// ── password ──────────────────────────────────────────────────────────────
// scrypt with a random salt, stored as `salt:hash` (hex). N=16384 is the
// node default; a share password is a courtesy lock, not a vault.

export async function hashSharePassword(password: string): Promise<string> {
  const salt = randomBytes(16)
  const hash = (await scrypt(password.normalize('NFKC'), salt, 32)) as Buffer
  return `${salt.toString('hex')}:${hash.toString('hex')}`
}

export async function verifySharePassword(password: string, stored: string | null | undefined): Promise<boolean> {
  if (!stored) return false
  const [saltHex, hashHex] = stored.split(':')
  if (!saltHex || !hashHex) return false
  const salt = Buffer.from(saltHex, 'hex')
  const expected = Buffer.from(hashHex, 'hex')
  const got = (await scrypt(password.normalize('NFKC'), salt, expected.length)) as Buffer
  return got.length === expected.length && timingSafeEqual(got, expected)
}

// ── the unlock cookie ─────────────────────────────────────────────────────
// After a correct password the browser holds an HttpOnly cookie for that
// link: HMAC(link id + password hash, secret). Changing the password or the
// secret invalidates it; it never contains the password.

export function shareCookieName(linkId: string): string {
  return `vb_share_${linkId.replace(/-/g, '')}`
}

export function shareCookieValue(link: Pick<ShareLinkRow, 'id' | 'password_hash'>, secret: string): string {
  if (!secret) throw new Error('share cookie: empty secret')
  return createHmac('sha256', secret).update(`${link.id}:${link.password_hash ?? ''}`).digest('base64url')
}

export function shareCookieValid(link: Pick<ShareLinkRow, 'id' | 'password_hash'>, given: string | null | undefined, secret: string): boolean {
  if (!given || !secret) return false
  const a = Buffer.from(given)
  const b = Buffer.from(shareCookieValue(link, secret))
  return a.length === b.length && timingSafeEqual(a, b)
}

// ── status ────────────────────────────────────────────────────────────────

export type ShareStatus = 'ok' | 'invalid' | 'expired' | 'revoked'

export function shareStatus(link: Pick<ShareLinkRow, 'expires_at' | 'revoked_at'> | null, now: Date = new Date()): ShareStatus {
  if (!link) return 'invalid'
  if (link.revoked_at) return 'revoked'
  if (link.expires_at && new Date(link.expires_at).getTime() <= now.getTime()) return 'expired'
  return 'ok'
}

export function expiryFromDays(days: number | null, now: Date = new Date()): string | null {
  if (days === null) return null
  return new Date(now.getTime() + days * 86_400_000).toISOString()
}

/** Look a token up with the service role. Returns the link and its snapshot,
 *  or the reason it cannot be shown. */
export async function loadShareLink(admin: SupabaseClient, token: string): Promise<{ status: 'ok'; link: ShareLinkRow; snapshot: SnapshotRow } | { status: Exclude<ShareStatus, 'ok'> }> {
  if (!SHARE_TOKEN_RE.test(token)) return { status: 'invalid' }
  const { data } = await admin.from('share_links').select('*').eq('token', token).maybeSingle()
  const link = (data as ShareLinkRow | null) ?? null
  const status = shareStatus(link)
  if (status !== 'ok' || !link) return { status: status === 'ok' ? 'invalid' : status }
  const { data: snap } = await admin.from('report_snapshots').select('*').eq('id', link.snapshot_id).eq('client_id', link.client_id).maybeSingle()
  if (!snap) return { status: 'invalid' }
  return { status: 'ok', link, snapshot: snap as SnapshotRow }
}

/** A view: hashed address, truncated agent — enough to say "opened 12 times
 *  from 3 places", never who. */
export function hashViewerIp(ip: string | null, secret: string): string | null {
  if (!ip || !secret) return null
  return createHmac('sha256', secret).update(ip).digest('base64url').slice(0, 16)
}
