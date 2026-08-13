'use client'

import { useActionState } from 'react'
import { submitLead, type LeadState } from './actions'

const idle: LeadState = { status: 'idle', message: '' }

const inputClass =
  'w-full rounded-lg border border-input bg-white/70 px-3.5 py-3 text-sm text-foreground transition focus:border-transparent focus:outline-none focus:ring-2 focus:ring-ring'

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
          <label htmlFor="lead-name" className="mb-1.5 block text-sm font-medium">
            Name
          </label>
          <input
            id="lead-name"
            type="text"
            name="name"
            autoComplete="name"
            required
            disabled={pending}
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="lead-email" className="mb-1.5 block text-sm font-medium">
            Work email
          </label>
          <input
            id="lead-email"
            type="email"
            name="email"
            autoComplete="email"
            required
            disabled={pending}
            className={inputClass}
          />
        </div>
      </div>
      <div>
        <label htmlFor="lead-company" className="mb-1.5 block text-sm font-medium">
          Brand
        </label>
        <input
          id="lead-company"
          type="text"
          name="company"
          autoComplete="organization"
          required
          disabled={pending}
          className={inputClass}
        />
      </div>
      <div>
        <label htmlFor="lead-interest" className="mb-1.5 block text-sm font-medium">
          What would you want to know about your market?{' '}
          <span className="font-normal text-muted-foreground">(optional)</span>
        </label>
        <textarea
          id="lead-interest"
          name="interest"
          rows={3}
          disabled={pending}
          className={inputClass}
        />
      </div>

      {/* Announced to assistive tech, and sits directly above the control that
          triggered it. */}
      <p role="alert" aria-live="polite" className="text-sm text-destructive empty:hidden">
        {state.message}
      </p>

      <button
        type="submit"
        disabled={pending}
        className="w-full cursor-pointer rounded-lg bg-primary py-3 text-sm font-semibold text-primary-foreground transition duration-200 ease-site hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background active:scale-[0.98] disabled:opacity-50"
      >
        {pending ? 'Sending…' : 'Request early access'}
      </button>
      <p className="text-center text-xs text-muted-foreground">
        Replies come from Heinrich, usually within a day.
      </p>
    </form>
  )
}
