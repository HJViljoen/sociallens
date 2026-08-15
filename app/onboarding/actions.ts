'use server'

import { z } from 'zod'
import { redirect } from 'next/navigation'
import { requireUser } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase-admin'
import { SELECTABLE_PLATFORMS } from '@/app/dashboard/settings/constants'

// State shape (a type) — idle value lives in the client form; a 'use server'
// module may only export async functions.
export interface OnboardingState {
  ok: boolean
  message: string
}

const csv = (v: FormDataEntryValue | null) =>
  String(v ?? '').split(',').map((x) => x.trim()).filter(Boolean)

const schema = z.object({
  company_name: z.string().trim().min(1, 'enter your company name'),
  industry_keywords: z.array(z.string()).min(1, 'add at least one industry keyword'),
  competitor_names: z.array(z.string()),
  platforms: z.array(z.enum(SELECTABLE_PLATFORMS)).min(1, 'pick at least one platform'),
})

const TRIAL_DAYS = 14

// Provision a brand-new workspace for the signed-in, membership-less user:
// creates the client, an initial tracking_config, and the user's owner
// membership — then drops them into the dashboard. Uses the service role
// because the user has no tenant context yet, so RLS can't authorize these
// writes (this is the "provisioning" use of the service role, by design).
export async function createWorkspace(_prev: OnboardingState, formData: FormData): Promise<OnboardingState> {
  const { user } = await requireUser()
  const admin = createAdminClient()

  // Guard: if they already have a workspace, don't create a second one.
  const { data: existing } = await admin
    .from('users').select('id').eq('id', user.id).maybeSingle()
  if (existing) redirect('/dashboard')

  const parsed = schema.safeParse({
    company_name: formData.get('company_name'),
    industry_keywords: csv(formData.get('industry_keywords')),
    competitor_names: csv(formData.get('competitor_names')),
    platforms: formData.getAll('platforms').map(String),
  })
  if (!parsed.success) {
    return { ok: false, message: `Please ${parsed.error.issues[0]?.message ?? 'check your input'}.` }
  }
  const { company_name, industry_keywords, competitor_names, platforms } = parsed.data

  // 1) Client (tenant)
  const { data: client, error: clientErr } = await admin
    .from('clients')
    .insert({
      company_name,
      plan: 'trial',
      trial_ends_at: new Date(Date.now() + TRIAL_DAYS * 86_400_000).toISOString(),
    })
    .select('id')
    .single()
  if (clientErr || !client) {
    return { ok: false, message: `Could not create workspace: ${clientErr?.message ?? 'unknown error'}` }
  }
  const clientId = client.id as string

  // 2) Initial tracking config (most columns default; seed what we collected).
  const { error: cfgErr } = await admin.from('tracking_configs').insert({
    client_id: clientId,
    brand_keywords: [company_name],
    competitor_names,
    industry_keywords,
    platforms,
    report_emails: user.email ? [user.email] : [],
  })
  if (cfgErr) return { ok: false, message: `Could not save tracking settings: ${cfgErr.message}` }

  // 3) Owner membership for the creator.
  const fullName = (user.user_metadata?.full_name as string | undefined) || user.email?.split('@')[0] || 'Owner'
  const { error: memberErr } = await admin.from('users').insert({
    id: user.id, client_id: clientId, email: user.email, full_name: fullName, role: 'owner',
  })
  if (memberErr) return { ok: false, message: `Could not finish setup: ${memberErr.message}` }

  redirect('/dashboard')
}
