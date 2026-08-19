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
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('users').select('client_id, role').eq('id', user.id).maybeSingle()
  if (!profile) redirect('/onboarding')

  return {
    supabase,
    userId: user.id,
    email: user.email,
    clientId: profile.client_id as string,
    role: profile.role as Role,
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
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data: profile } = await supabase
    .from('users').select('client_id, role').eq('id', user.id).maybeSingle()
  if (!profile) return null

  return {
    supabase,
    userId: user.id,
    email: user.email,
    clientId: profile.client_id as string,
    role: profile.role as Role,
  }
}

// Tenant-level write/admin gate (settings, schedule, member management).
// Platform superadmins provision/manage tenants via the service role rather
// than the tenant UI, so they're intentionally not folded in here.
export function canManageTenant(role: Role): boolean {
  return role === 'owner' || role === 'admin'
}
