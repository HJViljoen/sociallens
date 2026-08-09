'use server'

import { z } from 'zod'
import { redirect } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase-admin'
import { createServerSupabaseClient } from '@/lib/supabase-server'

// State shape (a type) — idle value lives in the client page; a 'use server'
// module may only export async functions.
export interface SignupState {
  ok: boolean
  message: string
  needsLogin?: boolean
}

const schema = z.object({
  full_name: z.string().trim().min(1),
  email: z.email(),
  password: z.string().min(8),
})

const isEmailTaken = (e: { code?: string; message?: string } | null) =>
  !!e && (e.code === 'email_exists' || /already.*(registered|exists)/i.test(e.message ?? ''))

// Self-serve signup. Creates the auth account (email pre-confirmed — see note),
// signs the user in, and sends them to /onboarding to set up their workspace.
//
// NOTE: accounts are created with email_confirm:true because no verification
// flow is built (Resend IS wired for invites/reports — the missing piece is the
// verify-email flow, not the provider). A new account only ever gets its own
// fresh, empty workspace via onboarding — it can't touch any existing tenant —
// so the blast radius is "junk workspaces", not a data leak.
// Harden before public launch: require verification.
export async function signUp(_prev: SignupState, formData: FormData): Promise<SignupState> {
  const parsed = schema.safeParse({
    full_name: formData.get('full_name'),
    email: String(formData.get('email') ?? '').trim().toLowerCase(),
    password: formData.get('password'),
  })
  if (!parsed.success) {
    return { ok: false, message: 'Enter your name, a valid email, and a password of at least 8 characters.' }
  }
  const { full_name, email, password } = parsed.data

  const admin = createAdminClient()
  const { error: createErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name },
  })
  if (createErr) {
    if (isEmailTaken(createErr)) {
      return { ok: false, message: 'An account with this email already exists.', needsLogin: true }
    }
    return { ok: false, message: `Could not create account: ${createErr.message}` }
  }

  const supabase = await createServerSupabaseClient()
  const { error: signInErr } = await supabase.auth.signInWithPassword({ email, password })
  if (signInErr) redirect('/login')
  redirect('/onboarding')
}
