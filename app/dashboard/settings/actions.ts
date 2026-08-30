'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { getSessionContext, canManageTenant } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase-admin'
import { deriveCompetitorKeywords } from '@/lib/onboarding-config'
import { PERIODS, DAYS } from './constants'

export interface SettingsFormState {
  ok: boolean
  message: string
}

// Comma-separated text field -> trimmed, de-blanked string[].
const csv = (v: FormDataEntryValue | null) =>
  String(v ?? '').split(',').map((x) => x.trim()).filter(Boolean)

// Facts vs knobs (Redesign Spec §9): this action accepts ONLY the client-
// editable facts. Keywords, platforms, and scrape depth are operator levers —
// deliberately absent here so a crafted POST can't move cost/quality knobs
// even though the row-level UPDATE policy would allow the write.
// Caps mirror the tracking_configs CHECK constraints (T0-2) so the limit
// arrives as a sentence rather than as a raw Postgres constraint name.
const schema = z.object({
  competitor_names: z.array(z.string()).min(1, 'add at least one competitor').max(15, 'track at most 15 competitors'),
  report_period: z.enum(PERIODS),
  report_day: z.enum(DAYS),
})

export async function updateTrackingConfig(
  _prev: SettingsFormState,
  formData: FormData,
): Promise<SettingsFormState> {
  // Server actions are directly POST-reachable, so authz is re-checked here —
  // never trusting the UI's disabled state. RLS is the third layer (the
  // tracking_configs UPDATE policy also requires owner/admin).
  const { supabase, clientId, role } = await getSessionContext()
  if (!canManageTenant(role)) {
    return { ok: false, message: 'You don’t have permission to change settings.' }
  }

  // Read the stored config BEFORE validating: a paused tenant's form has no
  // period control at all (the select cannot represent 'paused'), so the field
  // is absent from the POST and has to be filled in from what is stored.
  const { data: current } = await supabase
    .from('tracking_configs')
    .select('report_period, competitor_names, competitor_keywords')
    .eq('client_id', clientId)
    .maybeSingle()

  // Paused stays paused (T0-7). Before, the select rendered 'paused' as
  // 'weekly' and a save wrote that back, re-arming the scheduler on a tenant
  // meant to be quiet. Three live tenants sit at 'paused' today, Sealand
  // among them.
  const isPaused = current?.report_period === 'paused'

  const parsed = schema.safeParse({
    competitor_names: csv(formData.get('competitor_names')),
    report_period: isPaused ? 'weekly' : formData.get('report_period'),
    report_day: formData.get('report_day'),
  })

  if (!parsed.success) {
    const first = parsed.error.issues[0]
    const field = first?.path.join('.') || 'form'
    return { ok: false, message: `Invalid ${field}: ${first?.message ?? 'check your input.'}` }
  }

  const { error } = await supabase
    .from('tracking_configs')
    .update({
      ...parsed.data,
      ...(isPaused ? { report_period: 'paused' } : {}),
      updated_at: new Date().toISOString(),
    })
    .eq('client_id', clientId)

  if (error) {
    return { ok: false, message: `Could not save: ${error.message}` }
  }

  // competitor_keywords follows competitor_names unless an operator curated it
  // (T0-7): gather searches from the keywords while tagging matches on the
  // names, and no app surface ever wrote the keywords, so a self-serve tenant
  // gathered nothing about the competitors it just named. Written with the
  // admin client on purpose: T0-2 revoked the column from `authenticated`, so
  // it stays unreachable from a crafted POST and moves only through this
  // derivation. Authorization already passed (role check + the RLS update
  // above). Non-fatal: the four facts are saved either way.
  const storedKeywords = (current?.competitor_keywords ?? []) as string[]
  const previousDerived = deriveCompetitorKeywords((current?.competitor_names ?? []) as string[])
  const sameSet = (a: string[], b: string[]) =>
    JSON.stringify([...a].sort()) === JSON.stringify([...b].sort())
  const operatorCurated = storedKeywords.length > 0 && !sameSet(storedKeywords, previousDerived)
  if (!operatorCurated) {
    const next = deriveCompetitorKeywords(parsed.data.competitor_names)
    if (!sameSet(storedKeywords, next)) {
      const { error: kwErr } = await createAdminClient()
        .from('tracking_configs')
        .update({ competitor_keywords: next })
        .eq('client_id', clientId)
      if (kwErr) console.error(`[settings] competitor_keywords not updated for ${clientId}: ${kwErr.message}`)
    }
  }

  revalidatePath('/dashboard/settings')
  return { ok: true, message: 'Settings saved.' }
}
