'use client'

import { useActionState } from 'react'
import Link from 'next/link'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { signUp, type SignupState } from './actions'

const idleSignup: SignupState = { ok: false, message: '' }

export default function SignupPage() {
  const [state, formAction, pending] = useActionState(signUp, idleSignup)

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/30 p-4">
      <div className="w-full max-w-md rounded-xl border bg-background p-8 shadow-sm">
        <h1 className="text-2xl font-bold tracking-tight">Verbatim</h1>
        <p className="mb-6 text-sm text-muted-foreground">Create your account</p>

        <form action={formAction} className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium">Your name</label>
            <Input name="full_name" required placeholder="Jordan Lee" disabled={pending} />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">Work email</label>
            <Input name="email" type="email" required placeholder="you@brand.com" disabled={pending} />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">Password</label>
            <Input name="password" type="password" required minLength={8} placeholder="At least 8 characters" disabled={pending} />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">Invite code</label>
            <Input name="invite_code" required placeholder="From your invitation" disabled={pending} />
            <p className="mt-1 text-xs text-muted-foreground">
              Verbatim is invite-only while we work with our first partners.{' '}
              <a href="https://verbatimintel.com" className="cursor-pointer text-primary underline">Request access</a>.
            </p>
          </div>

          {state.message && (
            <p className="text-sm text-destructive">
              {state.message}
              {state.needsLogin && (
                <> <Link href="/login" className="underline">Sign in</Link></>
              )}
            </p>
          )}

          <Button type="submit" disabled={pending} className="w-full">
            {pending ? 'Creating account…' : 'Create account'}
          </Button>
        </form>

        <p className="mt-6 text-center text-sm text-muted-foreground">
          Already have an account?{' '}
          <Link href="/login" className="text-primary underline">Sign in</Link>
        </p>
      </div>
    </div>
  )
}
