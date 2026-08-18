'use client'

import { useActionState } from 'react'
import Link from 'next/link'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { requestReset, type ResetState } from './actions'

const idle: ResetState = { ok: false, message: '' }

export default function ResetRequestPage() {
  const [state, formAction, pending] = useActionState(requestReset, idle)

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/30 p-4">
      <div className="w-full max-w-md rounded-xl border bg-background p-8 shadow-sm">
        <h1 className="text-2xl font-bold tracking-tight">Verbatim</h1>
        <p className="mb-6 text-sm text-muted-foreground">Reset your password</p>

        <form action={formAction} className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium">Work email</label>
            <Input name="email" type="email" autoComplete="email" required placeholder="you@brand.com" disabled={pending} />
          </div>

          {state.message && (
            <p className={`text-sm ${state.ok ? 'text-muted-foreground' : 'text-destructive'}`}>{state.message}</p>
          )}

          <Button type="submit" disabled={pending} className="w-full cursor-pointer">
            {pending ? 'Sending…' : 'Send reset link'}
          </Button>
        </form>

        <p className="mt-6 text-center text-sm text-muted-foreground">
          Remembered it? <Link href="/login" className="text-primary underline">Sign in</Link>
        </p>
      </div>
    </div>
  )
}
