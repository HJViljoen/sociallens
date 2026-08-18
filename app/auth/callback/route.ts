import { redirect } from 'next/navigation'
import { createServerSupabaseClient } from '@/lib/supabase-server'

/**
 * Supabase auth code exchange (fresh-eyes review, 2026-08-18).
 *
 * The password-reset flow shipped without this and could never complete:
 * `@supabase/ssr`'s createServerClient defaults to PKCE, so the emailed
 * recovery link returns to the app with a `code` query parameter, and nothing
 * consumed it. `/reset/confirm` therefore always found no session and told
 * every user their link had expired.
 *
 * This route exchanges the code for a session (writing the auth cookies) and
 * forwards to wherever the link was headed.
 */
export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url)
  const code = url.searchParams.get('code')
  // Only same-origin paths: `next` comes off a URL, so it is attacker-shaped
  // input and must never become an open redirect.
  const raw = url.searchParams.get('next') ?? '/reset/confirm'
  const next = raw.startsWith('/') && !raw.startsWith('//') ? raw : '/reset/confirm'

  if (!code) redirect('/login?error=link_invalid')

  const supabase = await createServerSupabaseClient()
  const { error } = await supabase.auth.exchangeCodeForSession(code)
  if (error) {
    console.error(`[auth/callback] code exchange failed: ${error.message}`)
    redirect('/reset?error=link_expired')
  }
  redirect(next)
}
