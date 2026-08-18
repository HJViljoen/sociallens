'use server'

import { z } from 'zod'
import { redirect } from 'next/navigation'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { getBaseUrl } from '@/lib/site'

// Password reset (Tier 0 T0-3, 2026-08-18). Before this there was no recovery
// path at all: a forgotten password meant asking an operator to reset it by
// hand through the service role, and nothing in the product said so.
//
// Two halves. requestReset sends the recovery link; updatePassword runs after
// Supabase's link has established a recovery session on /reset/confirm.

export interface ResetState {
  ok: boolean
  message: string
}

const emailSchema = z.object({ email: z.email() })
const passwordSchema = z.object({ password: z.string().min(8) })

export async function requestReset(_prev: ResetState, formData: FormData): Promise<ResetState> {
  const parsed = emailSchema.safeParse({
    email: String(formData.get('email') ?? '').trim().toLowerCase(),
  })
  // Always the same answer, whether or not the address exists: the reset form
  // must not become a way to test which emails have accounts.
  const sameAnswer: ResetState = {
    ok: true,
    message: 'If that email has an account, a reset link is on its way. Check your inbox.',
  }
  if (!parsed.success) return sameAnswer

  const supabase = await createServerSupabaseClient()
  const { error } = await supabase.auth.resetPasswordForEmail(parsed.data.email, {
    redirectTo: `${await getBaseUrl()}/reset/confirm`,
  })
  if (error) console.error(`[reset] ${parsed.data.email}: ${error.message}`)
  return sameAnswer
}

export async function updatePassword(_prev: ResetState, formData: FormData): Promise<ResetState> {
  const parsed = passwordSchema.safeParse({ password: formData.get('password') })
  if (!parsed.success) return { ok: false, message: 'Choose a password of at least 8 characters.' }

  const supabase = await createServerSupabaseClient()
  // The recovery link signed them in already; without that session this fails,
  // which is exactly the right outcome for a stale or replayed link.
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return { ok: false, message: 'This reset link has expired. Request a new one.' }
  }
  const { error } = await supabase.auth.updateUser({ password: parsed.data.password })
  if (error) return { ok: false, message: `Could not set your password: ${error.message}` }
  redirect('/dashboard')
}
