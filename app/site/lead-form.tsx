'use client'

import { useActionState } from 'react'
import { submitLead, type LeadState } from './actions'

const idle: LeadState = { status: 'idle', message: '' }

// The early-access form, styled for the dark closing band. Three required
// fields (a lead without a name and a brand cannot be acted on) plus the
// optional question that seeds the first artefact we send back.
export function LeadForm() {
  const [state, formAction, pending] = useActionState(submitLead, idle)

  if (state.status === 'sent') {
    return (
      <div className="access">
        <div className="sent">
          <b>Thanks, got it.</b>
          You&rsquo;ll hear back from the founder, usually within a day.
        </div>
      </div>
    )
  }

  return (
    <form action={formAction} className="access">
      {/* Honeypot: hidden from humans, tempting to bots. */}
      <div className="hidden" aria-hidden>
        <label>
          Website
          <input type="text" name="website" tabIndex={-1} autoComplete="off" />
        </label>
      </div>
      <div className="fields">
        <input type="text" name="name" autoComplete="name" required disabled={pending} placeholder="Your name" aria-label="Your name" />
        <input type="email" name="email" autoComplete="email" required disabled={pending} placeholder="Work email" aria-label="Work email" />
      </div>
      <input type="text" name="company" autoComplete="organization" required disabled={pending} placeholder="Your brand" aria-label="Your brand" />
      <textarea name="interest" disabled={pending} placeholder="What are you trying to decide? (optional)" aria-label="What are you trying to decide? Optional." />
      <p role="alert" aria-live="polite" className="msg">
        {state.message}
      </p>
      <div>
        <button type="submit" className="btn btn-green" disabled={pending}>
          {pending ? 'Sending…' : 'Get early access'}
        </button>
      </div>
      <p className="note">Replies come from Heinrich, usually within a day.</p>
    </form>
  )
}
