import { createAdminClient } from '../supabase-admin'

// Who may SEND to the Verbatim Agent.
//
// Deliberate asymmetry, and the first time this product has one: every member
// of a tenant can SEE the agent and every stored thread (that falls out of the
// ordinary RLS select policy), but only a platform admin may ask a question.
// Heinrich, 2026-08-22: "make it so that only I can use the agent, show it to
// the rest, but don't let them send anything."
//
// Why the gate lives in the route handler and not in RLS: RLS governs reads,
// and this is a rule about writes that also spends money on a model call. A
// select policy is the wrong instrument, and writes already go through the
// service role, which RLS does not constrain at all.
//
// `platform_admins` and `is_superadmin()` have existed in the schema since the
// RBAC work but NOTHING in the application has ever read them — lib/auth.ts
// says superadmins operate through the service role rather than the tenant UI.
// This is the first app-level use, so it reads the table directly rather than
// calling is_superadmin(), which resolves auth.uid() from the request JWT and
// would be evaluated as the service role here.

export async function isPlatformAdmin(userId: string): Promise<boolean> {
  if (!userId) return false
  const admin = createAdminClient()
  const { data, error } = await admin
    .from('platform_admins')
    .select('user_id')
    .eq('user_id', userId)
    .maybeSingle()
  // Fail CLOSED. An unreadable admin table must not hand out send rights; the
  // worst case is that the operator is told to try again, not that a tenant
  // starts spending on model calls.
  if (error) return false
  return Boolean(data)
}
