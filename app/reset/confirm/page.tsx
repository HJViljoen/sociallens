'use client'

import { useActionState } from 'react'
import Link from 'next/link'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { updatePassword, type ResetState } from '../actions'

const idle: ResetState = { ok: false, message: '' }

// Supabase's recovery link lands here with a session already established, so
// the form only has to set the new password. A stale link means no session,
// and the action says so rather than failing silently.
export default function ResetConfirmPage() {
  const [state, formAction, pending] = useActionState(updatePassword, idle)

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/30 p-4">
      <div className="w-full max-w-md rounded-xl border bg-background p-8 shadow-sm">
        <h1 className="text-2xl font-bold tracking-tight">Verbatim</h1>
        <p className="mb-6 text-sm text-muted-foreground">Choose a new password</p>

        <form action={formAction} className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium">New password</label>
            <Input
              name="password" type="password" autoComplete="new-password"
              required minLength={8} placeholder="At least 8 characters" disabled={pending}
            />
          </div>

          {state.message && <p className="text-sm text-destructive">{state.message}</p>}

          <Button type="submit" disabled={pending} className="w-full cursor-pointer">
            {pending ? 'Saving…' : 'Set password'}
          </Button>
        </form>

        <p className="mt-6 text-center text-sm text-muted-foreground">
          Need a new link? <Link href="/reset" className="text-foreground underline">Start over</Link>
        </p>
      </div>
    </div>
  )
}
