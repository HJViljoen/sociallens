'use client'

import { useActionState } from 'react'
import Link from 'next/link'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { acceptInvitation, type AcceptState } from './actions'
import { LegalConsent } from '@/components/legal-consent'

const idleAccept: AcceptState = { ok: false, message: '' }

function ErrorMsg({ message, needsLogin }: { message: string; needsLogin?: boolean }) {
  if (!message) return null
  return (
    <p className="text-sm text-destructive">
      {message}
      {needsLogin && (
        <>
          {' '}
          <Link href="/login" className="underline">Sign in</Link>
        </>
      )}
    </p>
  )
}

// Signed in as the invited email — one click to join.
export function AcceptButton({ token }: { token: string }) {
  const [state, formAction, pending] = useActionState(acceptInvitation, idleAccept)
  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="token" value={token} />
      <Button type="submit" disabled={pending} className="w-full">
        {pending ? 'Joining…' : 'Accept invitation'}
      </Button>
      <ErrorMsg message={state.message} needsLogin={state.needsLogin} />
    </form>
  )
}

// Not signed in — set a name + password to create the account and join.
export function SignupAcceptForm({ token, email }: { token: string; email: string }) {
  const [state, formAction, pending] = useActionState(acceptInvitation, idleAccept)
  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="token" value={token} />
      <div>
        <label className="mb-1 block text-sm font-medium">Email</label>
        <Input value={email} readOnly disabled className="bg-muted/40" />
      </div>
      <div>
        <label className="mb-1 block text-sm font-medium">Your name</label>
        <Input name="full_name" required placeholder="Jordan Lee" disabled={pending} />
      </div>
      <div>
        <label className="mb-1 block text-sm font-medium">Set a password</label>
        <Input name="password" type="password" required minLength={8} placeholder="At least 8 characters" disabled={pending} />
      </div>
      <LegalConsent disabled={pending} />
      <Button type="submit" disabled={pending} className="w-full">
        {pending ? 'Creating account…' : 'Accept & create account'}
      </Button>
      <ErrorMsg message={state.message} needsLogin={state.needsLogin} />
    </form>
  )
}
