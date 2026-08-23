import { cache } from 'react'
import { redirect } from 'next/navigation'
import { createServerSupabaseClient } from './supabase-server'
import type { User } from '@supabase/supabase-js'

export type Role = 'owner' | 'admin' | 'member'

// Most-privileged first. Used for select options and validation.
export const ROLES: readonly Role[] = ['owner', 'admin', 'member'] as const

export interface SessionContext {
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>
  userId: string
  email?: string
  clientId: string
  role: Role
}

// Who is this request, verified — WITHOUT a round-trip to the Auth server.
// The project signs JWTs with an asymmetric key (ES256), so getClaims()
// verifies the cookie's access token locally against the JWKS (a module-level
// cache, 10-min TTL; the discovery endpoint is edge-cached for cold
// instances). getUser() by contrast is a network call to /auth/v1/user on
// EVERY invocation — and the layout, the page and the proxy each made one,
// serially, on every navigation. Only the session-refresh path touches the
// network now (and it must: that is what rotates the cookie).
//
// React cache(): the dashboard layout and every page both resolve the session,
// in the same request — without this each resolved it independently (two JWT
// checks, two `users` lookups). Cached per server request; server actions and
// route handlers get their own scope.
const resolveIdentity = cache(async () => {
  const supabase = await createServerSupabaseClient()
  const { data, error } = await supabase.auth.getClaims()
  if (error || !data?.claims?.sub) return { supabase, userId: null as string | null, email: undefined as string | undefined }
  return { supabase, userId: data.claims.sub as string, email: data.claims.email as string | undefined }
})

// The tenant membership for a verified user — one `users` lookup per request
// (this is the query every page used to repeat, and it is the first DB hit of
// a cold request, so it is also the one that pays the pool wake-up).
const resolveMembership = cache(async (userId: string) => {
  const { supabase } = await resolveIdentity()
  const { data: profile } = await supabase
    .from('users').select('client_id, role').eq('id', userId).maybeSingle()
  return profile as { client_id: string; role: Role } | null
})

// Just the signed-in auth identity — no tenant membership required. Used by the
// onboarding flow, which runs *before* a user has a workspace (so it can't use
// getSessionContext, which would bounce a membership-less user back to it).
// Redirects to /login when unauthenticated.
export async function requireUser(): Promise<{
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>
  user: User
}> {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  return { supabase, user }
}

// Single source of truth for "who is this request, and which tenant/role".
// Resolves the signed-in user + their tenant membership in one place so pages
// and server actions don't each re-implement the auth + profile lookup. The
// returned `supabase` is the user's session client — every read through it is
// RLS-enforced.
//
// Redirects to /login when unauthenticated, or to /onboarding when the account
// is signed in but has no membership row yet (freshly signed-up, or an invite
// that was abandoned mid-accept). Onboarding provisions the workspace + owner
// membership, after which this resolves normally.
export async function getSessionContext(): Promise<SessionContext> {
  const { supabase, userId, email } = await resolveIdentity()
  if (!userId) redirect('/login')

  const profile = await resolveMembership(userId)
  if (!profile) redirect('/onboarding')

  return {
    supabase,
    userId,
    email,
    clientId: profile.client_id,
    role: profile.role,
  }
}

/** The same resolution as getSessionContext, but for ROUTE HANDLERS.
 *
 *  getSessionContext calls redirect(), which in a route handler produces a 307
 *  to /login rather than a JSON error — a fetch() caller sees an opaque
 *  redirect instead of "you are signed out". This returns null instead so the
 *  handler can answer with a status the client can act on.
 *
 *  Auth is still enforced upstream by proxy.ts for /api/* paths; this resolves
 *  WHICH tenant the authenticated request belongs to, which is the part that
 *  must never be taken from the request body. */
export async function getRouteSession(): Promise<SessionContext | null> {
  const { supabase, userId, email } = await resolveIdentity()
  if (!userId) return null

  const profile = await resolveMembership(userId)
  if (!profile) return null

  return {
    supabase,
    userId,
    email,
    clientId: profile.client_id,
    role: profile.role,
  }
}

// Tenant-level write/admin gate (settings, schedule, member management).
// Platform superadmins provision/manage tenants via the service role rather
// than the tenant UI, so they're intentionally not folded in here.
export function canManageTenant(role: Role): boolean {
  return role === 'owner' || role === 'admin'
}
