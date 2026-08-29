'use server'

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase-admin'
import { renderTokenSecret } from '@/lib/render-token'
import { loadShareLink, shareCookieName, shareCookieValue, verifySharePassword } from '@/lib/reports/share'

export interface UnlockState { ok: boolean; message: string }

/** The password gate: a correct password sets an HttpOnly cookie for this
 *  link (a signature over the link and its password hash — never the
 *  password) and the page re-renders open. */
export async function unlockShare(_prev: UnlockState, formData: FormData): Promise<UnlockState> {
  const token = String(formData.get('token') ?? '')
  const password = String(formData.get('password') ?? '').trim()
  const admin = createAdminClient()
  const found = await loadShareLink(admin, token)
  if (found.status !== 'ok') return { ok: false, message: 'This link is no longer available.' }
  if (!found.link.password_hash) redirect(`/r/${token}`)
  if (!password || !(await verifySharePassword(password, found.link.password_hash))) {
    return { ok: false, message: 'That password is not right.' }
  }
  const secret = renderTokenSecret()
  const jar = await cookies()
  const expires = found.link.expires_at ? new Date(found.link.expires_at) : new Date(Date.now() + 30 * 86_400_000)
  jar.set(shareCookieName(found.link.id), shareCookieValue(found.link, secret), {
    httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: `/r/${token}`, expires,
  })
  redirect(`/r/${token}`)
}
