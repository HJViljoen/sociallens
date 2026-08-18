/**
 * Signup gate (Tier 0 T0-3, 2026-08-18).
 *
 * /signup created a CONFIRMED auth user through the service role: no email
 * verification, no captcha, no rate limit, no invite. Anyone could mint tenants
 * on a product whose own site says it is taking five design partners, and every
 * one of them arrived pre-approved for scheduled paid runs. The sales-led fix is
 * a shared code; the self-serve fix (verified email + Turnstile) comes with the
 * self-serve motion.
 *
 * Fails CLOSED when SIGNUP_INVITE_CODE is unset, so a missing env var locks the
 * door rather than leaving it open. The lead form on the marketing site is the
 * front door and is unaffected.
 */

export type SignupGate = { ok: true } | { ok: false; message: string }

export function checkSignupCode(supplied: string | null | undefined): SignupGate {
  const expected = (process.env.SIGNUP_INVITE_CODE ?? '').trim()
  if (!expected) {
    return { ok: false, message: 'Sign-up is invite-only right now. Request access and we will send you a code.' }
  }
  const given = (supplied ?? '').trim()
  if (!given) return { ok: false, message: 'Enter your invite code.' }
  if (given.toLowerCase() !== expected.toLowerCase()) {
    return { ok: false, message: 'That invite code is not valid.' }
  }
  return { ok: true }
}
