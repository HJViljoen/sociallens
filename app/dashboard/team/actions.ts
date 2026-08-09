'use server'

import { randomBytes } from 'node:crypto'
import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { getSessionContext, canManageTenant, ROLES } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase-admin'
import { getBaseUrl } from '@/lib/site'
import { sendInviteEmail } from '@/lib/email'

// State shape (a type, erased at build) — the idle value lives in the client
// component, since a 'use server' module may only export async functions.
export interface ActionState {
  ok: boolean
  message: string
  // inviteMember surfaces the link so the owner can share it directly — the
  // manual fallback when Resend isn't configured (or the email is missed).
  inviteUrl?: string
}

const inviteSchema = z.object({
  email: z.email(),
  role: z.enum(ROLES),
})

// Owner/admin invites a teammate. Admins may only grant 'member'; only owners
// can mint admins/owners. Authz is re-checked here (actions are POST-reachable),
// and RLS on invitations is the backstop. The invite link is returned so it can
// be shared manually until an email provider is wired.
export async function inviteMember(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { supabase, clientId, role, userId, email: inviterEmail } = await getSessionContext()
  if (!canManageTenant(role)) {
    return { ok: false, message: 'You don’t have permission to invite people.' }
  }

  const parsed = inviteSchema.safeParse({
    email: String(formData.get('email') ?? '').trim().toLowerCase(),
    role: formData.get('role'),
  })
  if (!parsed.success) {
    return { ok: false, message: 'Enter a valid email and role.' }
  }
  const { email, role: grantRole } = parsed.data

  if (role === 'admin' && grantRole !== 'member') {
    return { ok: false, message: 'Admins can only invite members. Ask an owner to grant elevated roles.' }
  }

  // Already a teammate? (RLS lets owners/admins see their tenant's users.)
  const { data: existing } = await supabase
    .from('users').select('id').eq('client_id', clientId).ilike('email', email).maybeSingle()
  if (existing) {
    return { ok: false, message: 'That person is already on your team.' }
  }

  const token = randomBytes(24).toString('base64url')

  const { error } = await supabase.from('invitations').insert({
    client_id: clientId,
    email,
    role: grantRole,
    token,
    invited_by: userId,
  })
  if (error) {
    // Unique partial index → a pending invite for this email already exists.
    if (error.code === '23505') {
      return { ok: false, message: 'There’s already a pending invite for that email. Revoke it first to re-send.' }
    }
    return { ok: false, message: `Could not create invite: ${error.message}` }
  }

  const inviteUrl = `${await getBaseUrl()}/invite/${token}`
  // Stub: no-op send until a provider exists. The link is shown in the UI either way.
  const { sent } = await sendInviteEmail({ to: email, inviteUrl, companyName: '', invitedByEmail: inviterEmail })

  revalidatePath('/dashboard/team')
  return {
    ok: true,
    message: sent
      ? `Invite sent to ${email}.`
      : `Invite created for ${email}. Copy the link below and send it to them.`,
    inviteUrl,
  }
}

const idSchema = z.object({ id: z.uuid() })

// Owner/admin revokes a pending invite. RLS scopes the update to the tenant.
export async function revokeInvitation(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { supabase, role } = await getSessionContext()
  if (!canManageTenant(role)) {
    return { ok: false, message: 'You don’t have permission to do that.' }
  }
  const parsed = idSchema.safeParse({ id: formData.get('id') })
  if (!parsed.success) return { ok: false, message: 'Invalid invite.' }

  const { error } = await supabase
    .from('invitations')
    .update({ status: 'revoked' })
    .eq('id', parsed.data.id)
    .eq('status', 'pending')
  if (error) return { ok: false, message: `Could not revoke: ${error.message}` }

  revalidatePath('/dashboard/team')
  return { ok: true, message: 'Invite revoked.' }
}

const roleChangeSchema = z.object({
  userId: z.uuid(),
  role: z.enum(ROLES),
})

// Owner-only: change a teammate's role. Uses the service role after authz because
// public.users has no UPDATE policy and we enforce a "must keep ≥1 owner"
// invariant RLS can't express. Can't change your own role here (transfer
// ownership by promoting someone else first).
export async function changeMemberRole(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { clientId, role, userId } = await getSessionContext()
  if (role !== 'owner') {
    return { ok: false, message: 'Only owners can change roles.' }
  }
  const parsed = roleChangeSchema.safeParse({
    userId: formData.get('userId'),
    role: formData.get('role'),
  })
  if (!parsed.success) return { ok: false, message: 'Invalid role change.' }
  const { userId: targetId, role: newRole } = parsed.data

  if (targetId === userId) {
    return { ok: false, message: 'You can’t change your own role. Have another owner do it.' }
  }

  const admin = createAdminClient()
  const { data: target } = await admin
    .from('users').select('id, role, client_id').eq('id', targetId).maybeSingle()
  if (!target || target.client_id !== clientId) {
    return { ok: false, message: 'That person isn’t on your team.' }
  }
  if (target.role === newRole) {
    return { ok: true, message: 'No change — they already have that role.' }
  }

  // Don't demote the last remaining owner.
  if (target.role === 'owner' && newRole !== 'owner') {
    const { count } = await admin
      .from('users').select('id', { count: 'exact', head: true })
      .eq('client_id', clientId).eq('role', 'owner')
    if ((count ?? 0) <= 1) {
      return { ok: false, message: 'Promote another owner first — a workspace needs at least one owner.' }
    }
  }

  const { error } = await admin.from('users').update({ role: newRole }).eq('id', targetId)
  if (error) return { ok: false, message: `Could not update role: ${error.message}` }

  revalidatePath('/dashboard/team')
  return { ok: true, message: 'Role updated.' }
}

// Owner-only: remove a teammate's membership (revokes app access; the auth
// account itself is left intact). Same invariants as role change.
export async function removeMember(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { clientId, role, userId } = await getSessionContext()
  if (role !== 'owner') {
    return { ok: false, message: 'Only owners can remove members.' }
  }
  const parsed = z.object({ userId: z.uuid() }).safeParse({ userId: formData.get('userId') })
  if (!parsed.success) return { ok: false, message: 'Invalid member.' }
  const targetId = parsed.data.userId

  if (targetId === userId) {
    return { ok: false, message: 'You can’t remove yourself.' }
  }

  const admin = createAdminClient()
  const { data: target } = await admin
    .from('users').select('id, role, client_id').eq('id', targetId).maybeSingle()
  if (!target || target.client_id !== clientId) {
    return { ok: false, message: 'That person isn’t on your team.' }
  }
  if (target.role === 'owner') {
    const { count } = await admin
      .from('users').select('id', { count: 'exact', head: true })
      .eq('client_id', clientId).eq('role', 'owner')
    if ((count ?? 0) <= 1) {
      return { ok: false, message: 'You can’t remove the last owner.' }
    }
  }

  const { error } = await admin.from('users').delete().eq('id', targetId)
  if (error) return { ok: false, message: `Could not remove member: ${error.message}` }

  revalidatePath('/dashboard/team')
  return { ok: true, message: 'Member removed.' }
}
