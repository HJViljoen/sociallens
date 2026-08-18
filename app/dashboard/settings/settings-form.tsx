'use client'

import { useActionState } from 'react'
import { updateTrackingConfig, type SettingsFormState } from './actions'
import { PERIODS, DAYS } from './constants'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

// Facts vs knobs (Redesign Spec §9): clients edit the facts only they know —
// competitor names and how reports reach them. Keywords, platforms, and scrape
// depth (max_videos / comment_depth) are operator levers: they drive cost and
// output quality, so they're managed platform-side and have no client UI.

export interface TrackingConfig {
  competitor_names: string[] | null
  report_emails: string[] | null
  report_period: string | null
  report_day: string | null
}

const initialState: SettingsFormState = { ok: false, message: '' }
const join = (a: string[] | null) => (a ?? []).join(', ')
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

const selectCls =
  'h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50'

function Labeled({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
      {hint && <span className="block text-[11px] text-muted-foreground/70">{hint}</span>}
    </label>
  )
}

export function SettingsForm({ cfg, canEdit }: { cfg: TrackingConfig; canEdit: boolean }) {
  const [state, formAction, pending] = useActionState(updateTrackingConfig, initialState)

  return (
    <form action={formAction} className="space-y-6">
      {/* fieldset disables every control at once for read-only members + while saving */}
      <fieldset disabled={!canEdit || pending} className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Card>
            <CardHeader><CardTitle className="text-sm">Competitors</CardTitle></CardHeader>
            <CardContent>
              <Labeled label="Competitor names" hint="Comma-separated. Used to tag competitor content.">
                <Input name="competitor_names" defaultValue={join(cfg.competitor_names)} placeholder="Ottobock, Blatchford" />
              </Labeled>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-sm">Reports</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <Labeled label="Report period">
                {cfg.report_period === 'paused' ? (
                  // Pausing is an operator lever this select cannot represent.
                  // Before, it rendered as "Weekly" and a save reported success
                  // while the action quietly wrote 'paused' back: the UI lied
                  // about what had happened.
                  <p className="text-sm text-muted-foreground">
                    Paused. Updates are not being sent. Contact us to start them again.
                  </p>
                ) : (
                  <select name="report_period" defaultValue={cfg.report_period ?? 'weekly'} className={selectCls}>
                    {PERIODS.map((p) => <option key={p} value={p}>{cap(p)}</option>)}
                  </select>
                )}
              </Labeled>
              <Labeled label="Report day">
                <select name="report_day" defaultValue={cfg.report_day ?? 'monday'} className={selectCls}>
                  {DAYS.map((d) => <option key={d} value={d}>{cap(d)}</option>)}
                </select>
              </Labeled>
              <Labeled label="Report emails" hint="Comma-separated.">
                <Input name="report_emails" defaultValue={join(cfg.report_emails)} placeholder="team@brand.com" />
              </Labeled>
            </CardContent>
          </Card>
        </div>
      </fieldset>

      {canEdit ? (
        <div className="flex items-center gap-3">
          <Button type="submit" disabled={pending}>{pending ? 'Saving…' : 'Save changes'}</Button>
          {state.message && (
            <span className={`text-sm ${state.ok ? 'text-green-600' : 'text-destructive'}`}>{state.message}</span>
          )}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          You have read-only access. Ask an owner or admin to change tracking settings.
        </p>
      )}
    </form>
  )
}
