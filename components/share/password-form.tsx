'use client'

import { useActionState } from 'react'
import { unlockShare, type UnlockState } from '@/app/r/[token]/actions'

const initial: UnlockState = { ok: false, message: '' }

export function PasswordForm({ token, title, company }: { token: string; title: string; company: string }) {
  const [state, action, pending] = useActionState(unlockShare, initial)
  return (
    <form action={action} className="mx-auto mt-24 flex w-full max-w-sm flex-col gap-4 rounded-lg bg-tile p-6 shadow-tile">
      <input type="hidden" name="token" value={token} />
      <div>
        <p className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-muted-foreground">Prepared by {company}</p>
        <h1 className="mt-1 text-[17px] font-semibold">{title}</h1>
        <p className="mt-1 text-[12.5px] text-muted-foreground">This report is protected. Enter the password you were given.</p>
      </div>
      <label className="block">
        <span className="text-xs font-medium text-muted-foreground">Password</span>
        <input name="password" type="password" autoComplete="off" autoFocus required
          className="mt-1 h-9 w-full rounded-[4px] border border-input bg-tile px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50" />
      </label>
      <div className="flex items-center gap-3">
        <button type="submit" disabled={pending} className="inline-flex h-8 items-center rounded-full bg-primary px-4 text-[12.5px] font-medium text-primary-foreground hover:bg-accent-foreground disabled:opacity-60">
          {pending ? 'Checking…' : 'Open the report'}
        </button>
        {state.message && <span className="text-[12px] text-negative" aria-live="polite">{state.message}</span>}
      </div>
    </form>
  )
}
