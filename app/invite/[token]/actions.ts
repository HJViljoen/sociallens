'use server'

import { z } from 'zod'
import { redirect } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase-admin'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { addRecipient } from '@/lib/recipients'
import { loadInvite } from './data'

// State shape lives here (a type, erased at build); the idle value is defined in
// the client component. A 'use server' module may only export async functions.
export interface AcceptState {
  ok: boolean
  message: string
  // Set when the invite email already has an account: the invitee must sign in
  // (we can't know their password) before they can accept.
  needsLogin?: boolean
}

const acceptSchema = z.object({
  token: z.string().min(1),
  full_name: z.string().trim().min(1).optional(),
  password: z.string().min(8).optional(),
})

const isEmailTaken = (e: { code?: string; message?: string } | null) =>
  !!e && (e.code === 'email_exists' || /already.*(registered|exists)/i.test(e.message ?? ''))

// Accept an invite. Two paths:
//  • Signed in as the invited email  -> just attach the membership.
//  • Not signed in                   -> create the account (email pre-confirmed,
//    since the token already proves intent), attach membership, sign in.
// Membership writes use the service role: the invitee has no tenant context yet,
// so RLS can't authorize them — the token is the authorization.
export async function acceptInvitation(_prev: AcceptState, formData: FormData): Promise<AcceptState> {
  const parsed = acceptSchema.safeParse({
    token: formData.get('token'),
    full_name: formData.get('full_name') ?? undefined,
    password: formData.get('password') ?? undefined,
  })
  if (!parsed.success) {
    return { ok: false, message: 'Enter your name and a password of at least 8 characters.' }
  }
  const { token, full_name, password } = parsed.data

  const { invite, reason } = await loadInvite(token)
  if (!invite) return { ok: false, message: reason }

  const admin = createAdminClient()
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()

  // --- Signed-in path ---------------------------------------------------------
  if (user) {
    if ((user.email ?? '').toLowerCase() !== invite.email.toLowerCase()) {
      return {
        ok: false,
        message: `This invite is for ${invite.email}, but you’re signed in as ${user.email}. Sign out and open the link again.`,
      }
    }
    const { data: existing } = await admin
      .from('users').select('client_id').eq('id', user.id).maybeSingle()
    if (existing && existing.client_id !== invite.client_id) {
      return { ok: false, message: 'Your account already belongs to another workspace.' }
    }
    if (!existing) {
      const name = (user.user_metadata?.full_name as string | undefined) || invite.email.split('@')[0]
      const { error } = await admin.from('users').insert({
        id: user.id, client_id: invite.client_id, email: invite.email, full_name: name, role: invite.role,
      })
      if (error) return { ok: false, message: `Could not join workspace: ${error.message}` }
    }
    await markAccepted(invite.id)
    await addToReportRecipients(invite.client_id, invite.email)
    redirect('/dashboard')
  }

  // --- Not-signed-in path: create account, then sign in -----------------------
  if (!full_name || !password) {
    return { ok: false, message: 'Enter your name and a password of at least 8 characters.' }
  }
  // Consent, re-checked server-side (T0-9). Only on this path: someone already
  // signed in accepted at their own signup.
  if (!formData.get('accept_terms')) {
    return { ok: false, message: 'Please accept the terms and privacy notice.' }
  }

  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email: invite.email,
    password,
    email_confirm: true,
    user_metadata: { full_name },
  })
  if (createErr) {
    if (isEmailTaken(createErr)) {
      return { ok: false, message: 'You already have an account. Sign in, then open this link again.', needsLogin: true }
    }
    return { ok: false, message: `Could not create your account: ${createErr.message}` }
  }

  const newUserId = created.user!.id
  const { error: memberErr } = await admin.from('users').insert({
    id: newUserId, client_id: invite.client_id, email: invite.email, full_name, role: invite.role,
  })
  if (memberErr) return { ok: false, message: `Could not join workspace: ${memberErr.message}` }

  await markAccepted(invite.id)
  await addToReportRecipients(invite.client_id, invite.email)

  // Establish a session (writes auth cookies via the SSR client) then land them in.
  const { error: signInErr } = await supabase.auth.signInWithPassword({ email: invite.email, password })
  if (signInErr) redirect('/login')
  redirect('/dashboard')
}

async function markAccepted(id: string) {
  const admin = createAdminClient()
  await admin
    .from('invitations')
    .update({ status: 'accepted', accepted_at: new Date().toISOString() })
    .eq('id', id)
}

/**
 * Joining the workspace puts you on the report (T0-10). Before this,
 * report_emails held only whoever signed the tenant up: Össur had five users
 * and one address, so the people invited to read the intelligence never
 * received it. Non-fatal and admin-client: a bookkeeping failure must never
 * block someone from joining, and the accepter is usually a member, whom RLS
 * does not let write tracking_configs.
 */
async function addToReportRecipients(clientId: string, email: string): Promise<void> {
  try {
    const admin = createAdminClient()
    const { data } = await admin
      .from('tracking_configs').select('report_emails').eq('client_id', clientId).maybeSingle()
    const current = (data?.report_emails ?? []) as string[]
    const next = addRecipient(current, email)
    if (next.length === current.length) return
    await admin.from('tracking_configs').update({ report_emails: next }).eq('client_id', clientId)
  } catch (e) {
    console.error(`[invite] could not add ${email} to report_emails: ${e instanceof Error ? e.message : String(e)}`)
  }
}
