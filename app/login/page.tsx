'use client'

import { useActionState } from 'react'
import Link from 'next/link'
import { login, type LoginState } from './actions'

const idle: LoginState = { message: '' }

export default function LoginPage() {
  const [state, formAction, pending] = useActionState(login, idle)

  return (
    <div className="relative min-h-screen flex items-center justify-center bg-background px-4 overflow-hidden">
      <div className="crowd-bg" aria-hidden />

      <div className="relative z-10 w-full max-w-md rounded-2xl bg-card ring-1 ring-border/70 shadow-tile-hover p-8">
        <div className="flex items-center gap-2.5 mb-1.5">
          <span className="h-6 w-6 rounded-md bg-primary" aria-hidden />
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Verbatim</h1>
        </div>
        <p className="text-muted-foreground mb-7 text-sm">Consumer intelligence, in their own words.</p>

        <form action={formAction} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-foreground mb-1.5">Email</label>
            <input
              type="email"
              name="email"
              autoComplete="email"
              required
              disabled={pending}
              className="w-full rounded-xl border border-input bg-background/60 px-3.5 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent transition"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-foreground mb-1.5">Password</label>
            <input
              type="password"
              name="password"
              autoComplete="current-password"
              required
              disabled={pending}
              className="w-full rounded-xl border border-input bg-background/60 px-3.5 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent transition"
            />
          </div>

          {state.message && <p className="text-destructive text-sm">{state.message}</p>}

          <button
            type="submit"
            disabled={pending}
            className="w-full rounded-xl bg-primary text-primary-foreground py-2.5 text-sm font-semibold hover:brightness-110 active:translate-y-px disabled:opacity-50 transition cursor-pointer"
          >
            {pending ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <p className="mt-4 text-center text-sm text-muted-foreground">
          <Link href="/reset" className="font-medium text-foreground hover:underline">Forgot your password?</Link>
        </p>

        <p className="mt-2 text-center text-sm text-muted-foreground">
          Don&apos;t have an account?{' '}
          <Link href="/signup" className="font-medium text-foreground hover:underline">Sign up</Link>
        </p>
      </div>
    </div>
  )
}
