'use server'

import { z } from 'zod'
import { redirect } from 'next/navigation'
import { requireUser } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase-admin'
import { ensureDefaultSchedule } from '@/lib/schedules/default'
import { SELECTABLE_PLATFORMS } from '@/app/dashboard/settings/constants'
import { deriveCompetitorKeywords, ONBOARDING_MAX_VIDEOS } from '@/lib/onboarding-config'

// State shape (a type) — idle value lives in the client form; a 'use server'
// module may only export async functions.
export interface OnboardingState {
  ok: boolean
  message: string
}

const csv = (v: FormDataEntryValue | null) =>
  String(v ?? '').split(',').map((x) => x.trim()).filter(Boolean)

// Competitors are required and category words are not (T0-7): the marketing
// site promises "Your brand. Your competitors. That's everything. No keyword
// tuning", and the form asked for the exact opposite. Competitors are also the
// half the product cannot work without, since half the corpus is found through
// them and every competitive surface reads them.
const schema = z.object({
  company_name: z.string().trim().min(1, 'enter your company name'),
  industry_keywords: z.array(z.string()),
  competitor_names: z.array(z.string()).min(1, 'add at least one competitor'),
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

  // 1) Client (tenant). Created INACTIVE and unapproved (T0-2): a signup used
  //    to become a live tenant that the next Monday's scheduler picked up and
  //    started spending Apify and OpenAI money on, unattended and unbilled. An
  //    operator sets is_active + approved_at once the workspace is real.
  const { data: client, error: clientErr } = await admin
    .from('clients')
    .insert({
      company_name,
      plan: 'trial',
      is_active: false,
      approved_at: null,
      trial_ends_at: new Date(Date.now() + TRIAL_DAYS * 86_400_000).toISOString(),
    })
    .select('id')
    .single()
  if (clientErr || !client) {
    return { ok: false, message: `Could not create workspace: ${clientErr?.message ?? 'unknown error'}` }
  }
  const clientId = client.id as string

  // 2) Initial tracking config. competitor_keywords is DERIVED (T0-7): gather
  //    searches from it while tagging matches on competitor_names, and nothing
  //    ever wrote it, so a self-serve tenant gathered nothing about the
  //    competitors it just named. max_videos overrides the column default of
  //    10, which is too thin for the analysis floors to leave anything.
  const { error: cfgErr } = await admin.from('tracking_configs').insert({
    client_id: clientId,
    brand_keywords: [company_name],
    competitor_names,
    competitor_keywords: deriveCompetitorKeywords(competitor_names),
    industry_keywords,
    platforms,
    max_videos: ONBOARDING_MAX_VIDEOS,
    report_emails: user.email ? [user.email] : [],
  })
  if (cfgErr) return { ok: false, message: `Could not save tracking settings: ${cfgErr.message}` }

  // 2b) Default schedule ("Weekly digest"), seeded with the creator's address
  // — mirrors the tracking_configs.report_emails seed above, now the source
  // recipients actually send from. Non-fatal: a bookkeeping failure must
  // never block workspace creation.
  try {
    await ensureDefaultSchedule(admin, clientId, user.email ? [user.email] : [], user.id)
  } catch (e) {
    console.error(`[onboarding] default schedule not created for ${clientId}: ${e instanceof Error ? e.message : String(e)}`)
  }

  // 3) Owner membership for the creator.
  const fullName = (user.user_metadata?.full_name as string | undefined) || user.email?.split('@')[0] || 'Owner'
  const { error: memberErr } = await admin.from('users').insert({
    id: user.id, client_id: clientId, email: user.email, full_name: fullName, role: 'owner',
  })
  if (memberErr) return { ok: false, message: `Could not finish setup: ${memberErr.message}` }

  redirect('/dashboard')
}
