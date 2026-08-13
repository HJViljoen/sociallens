'use client'

import { useActionState } from 'react'
import { submitLead, type LeadState } from './actions'

const idle: LeadState = { status: 'idle', message: '' }

const inputClass =
  'w-full rounded-lg border border-input bg-white/70 px-3.5 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent transition'

export function LeadForm() {
  const [state, formAction, pending] = useActionState(submitLead, idle)

  if (state.status === 'sent') {
    return (
      <div className="rounded-xl bg-secondary px-5 py-6 text-center">
        <p className="font-semibold text-secondary-foreground">Thanks, got it.</p>
        <p className="mt-1 text-sm text-muted-foreground">
          You&rsquo;ll hear back from the founder, usually within a day.
        </p>
      </div>
    )
  }

  return (
    <form action={formAction} className="space-y-4">
      {/* Honeypot — hidden from humans, tempting to bots. */}
      <div className="hidden" aria-hidden>
        <label>
          Website
          <input type="text" name="website" tabIndex={-1} autoComplete="off" />
        </label>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="mb-1.5 block text-sm font-medium">Name</label>
          <input type="text" name="name" required disabled={pending} className={inputClass} />
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium">Work email</label>
          <input type="email" name="email" required disabled={pending} className={inputClass} />
        </div>
      </div>
      <div>
        <label className="mb-1.5 block text-sm font-medium">Brand</label>
        <input type="text" name="company" required disabled={pending} className={inputClass} />
      </div>
      <div>
        <label className="mb-1.5 block text-sm font-medium">
          What would you want to know about your market?{' '}
          <span className="font-normal text-muted-foreground">(optional)</span>
        </label>
        <textarea name="interest" rows={3} disabled={pending} className={inputClass} />
      </div>

      {state.message && <p className="text-sm text-destructive">{state.message}</p>}

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-lg bg-primary py-2.5 text-sm font-semibold text-primary-foreground transition duration-200 hover:brightness-110 active:scale-[0.98] disabled:opacity-50"
      >
        {pending ? 'Sending…' : 'Request early access'}
      </button>
      <p className="text-center text-xs text-muted-foreground">
        Replies come from Heinrich, usually within a day.
      </p>
    </form>
  )
}
