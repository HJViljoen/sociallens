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

  if (!name || !company || !EMAIL_RE.test(email)) {
    return {
      status: 'error',
      message: 'Please fill in your name, a valid work email, and your brand.',
    }
  }

  const { sent } = await sendLeadEmail({ name, email, company, interest: interest || undefined })
  if (!sent) {
    return {
      status: 'error',
      message: "Something went wrong sending this — please try again in a minute.",
    }
  }
  return { status: 'sent', message: '' }
}
