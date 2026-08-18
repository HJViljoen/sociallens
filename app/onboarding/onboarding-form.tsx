'use client'

import { useActionState } from 'react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { SELECTABLE_PLATFORMS } from '@/app/dashboard/settings/constants'
import { createWorkspace, type OnboardingState } from './actions'

const idleOnboarding: OnboardingState = { ok: false, message: '' }

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-sm font-medium">{label}</span>
      {children}
      {hint && <span className="block text-[11px] text-muted-foreground/70">{hint}</span>}
    </label>
  )
}

export function OnboardingForm() {
  const [state, formAction, pending] = useActionState(createWorkspace, idleOnboarding)

  return (
    <form action={formAction} className="space-y-5">
      <fieldset disabled={pending} className="space-y-5">
        <Field label="Company name">
          <Input name="company_name" required placeholder="Acme Co." />
        </Field>

        <Field label="Competitors" hint="Comma-separated. The brands you compete with. We listen under their posts too.">
          <Input name="competitor_names" required placeholder="Nike, Hoka, On" />
        </Field>

        <Field label="Category words" hint="Comma-separated, optional. A few words people use for what you sell.">
          <Input name="industry_keywords" placeholder="running shoes, trail running, marathon" />
        </Field>

        <div className="space-y-1.5">
          <span className="text-sm font-medium">Platforms to track</span>
          <div className="flex flex-wrap gap-4 pt-1">
            {SELECTABLE_PLATFORMS.map((p) => (
              <label key={p} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  name="platforms"
                  value={p}
                  defaultChecked
                  className="size-4 rounded border-input accent-primary"
                />
                {cap(p)}
              </label>
            ))}
          </div>
        </div>
      </fieldset>

      {state.message && <p className="text-sm text-destructive">{state.message}</p>}

      <Button type="submit" disabled={pending} className="w-full">
        {pending ? 'Setting up…' : 'Create workspace'}
      </Button>
    </form>
  )
}
