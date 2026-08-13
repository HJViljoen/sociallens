'use server'

import { sendLeadEmail } from '@/lib/email'

export interface LeadState {
  status: 'idle' | 'sent' | 'error'
  message: string
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export async function submitLead(_prev: LeadState, formData: FormData): Promise<LeadState> {
  // Honeypot: bots fill every field; the form hides this one from humans.
  // Pretend success so the bot moves on.
  if (String(formData.get('website') ?? '').trim() !== '') {
    return { status: 'sent', message: '' }
  }

  const name = String(formData.get('name') ?? '').trim()
  const email = String(formData.get('email') ?? '').trim()
  const company = String(formData.get('company') ?? '').trim()
  const interest = String(formData.get('interest') ?? '').trim()

  // Name the field that's actually wrong: a four-field form should never make
  // the reader re-check all of them.
  const missing: string[] = []
  if (!name) missing.push('your name')
  if (!EMAIL_RE.test(email)) missing.push(email ? 'a valid work email' : 'your work email')
  if (!company) missing.push('your brand')
  if (missing.length > 0) {
    const list =
      missing.length === 1
        ? missing[0]
        : `${missing.slice(0, -1).join(', ')} and ${missing[missing.length - 1]}`
    return { status: 'error', message: `Still needed: ${list}.` }
  }

  const { sent } = await sendLeadEmail({ name, email, company, interest: interest || undefined })
  if (!sent) {
    return {
      status: 'error',
      message:
        "That didn't send. Try again in a minute, or email heinrich@verbatimintel.com directly.",
    }
  }
  return { status: 'sent', message: '' }
}
