'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { getSessionContext } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase-admin'
import { instantiate, starterTemplate } from '@/lib/reports/templates'
import { audienceSchema, reportPatchSchema, tidySections } from '@/lib/reports/validate'
import { isAudience, type CoverSpec, type ReportRow, type ReportSection } from '@/lib/reports/types'

// The Studio's writes (Stage 2). Server actions are directly POST-reachable,
// so every one re-resolves the tenant from the session and scopes the row by
// client_id; the admin client does the write (no insert/update policies —
// the product's idiom). Any member of the workspace may edit a report: the
// operator's team, not an admin console.

export interface ActionState {
  ok: boolean
  message: string
}

const BASE = '/dashboard/reports'

/** New report from a starter, a tenant template, or blank; lands in the Studio. */
export async function createReport(formData: FormData): Promise<void> {
  const { clientId, userId } = await getSessionContext()
  const admin = createAdminClient()
  const templateKey = String(formData.get('template') ?? '')
  const tenantTemplateId = String(formData.get('tenant_template') ?? '')
  let title = 'Untitled report'
  let audience: ReportRow['audience'] = 'general'
  let sections: ReportSection[] = []
  let key: string | null = null
  if (templateKey) {
    const t = starterTemplate(templateKey)
    if (!t) throw new Error('unknown template')
    title = t.name; audience = t.audience; sections = instantiate(t.sections); key = t.key
  } else if (tenantTemplateId) {
    const { data: t } = await admin.from('report_templates').select('name, audience, sections').eq('id', tenantTemplateId).eq('client_id', clientId).maybeSingle()
    if (!t) throw new Error('unknown template')
    title = t.name as string
    audience = isAudience(t.audience) ? t.audience : 'general'
    sections = instantiate(((t.sections as Omit<ReportSection, 'id'>[]) ?? []))
    key = `tenant:${tenantTemplateId}`
  }
  const cover: CoverSpec = { register: audience }
  const { data, error } = await admin
    .from('reports')
    .insert({ client_id: clientId, template_key: key, title, audience, sections, cover, created_by: userId })
    .select('id')
    .single()
  if (error || !data) throw new Error(`create report: ${error?.message ?? 'no row'}`)
  redirect(`${BASE}/studio/${data.id as string}`)
}

const patchArgs = z.object({ id: z.uuid(), patch: reportPatchSchema })

/** Save an edit from the outline: title, audience, cover title, sections. */
export async function updateReport(args: { id: string; patch: z.infer<typeof reportPatchSchema> }): Promise<ActionState> {
  const parsed = patchArgs.safeParse(args)
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? 'That edit could not be saved.' }
  const { clientId } = await getSessionContext()
  const admin = createAdminClient()
  const { data: current } = await admin.from('reports').select('id, cover, audience').eq('id', parsed.data.id).eq('client_id', clientId).maybeSingle()
  if (!current) return { ok: false, message: 'No such report.' }
  const p = parsed.data.patch
  const cover = { ...((current.cover as CoverSpec) ?? {}) } as CoverSpec
  if (p.audience) cover.register = p.audience
  if (p.coverTitle !== undefined) { if (p.coverTitle) cover.title = p.coverTitle; else delete cover.title }
  if (!cover.register) cover.register = isAudience(current.audience) ? current.audience : 'general'
  const row: Record<string, unknown> = { cover, updated_at: new Date().toISOString() }
  if (p.title !== undefined) row.title = p.title
  if (p.audience !== undefined) row.audience = p.audience
  if (p.sections !== undefined) row.sections = tidySections(p.sections)
  const { error } = await admin.from('reports').update(row).eq('id', parsed.data.id).eq('client_id', clientId)
  if (error) return { ok: false, message: 'Could not save that — try again.' }
  revalidatePath(`${BASE}/studio/${parsed.data.id}`)
  revalidatePath(BASE)
  return { ok: true, message: 'Saved' }
}

export async function deleteReport(formData: FormData): Promise<void> {
  const id = z.uuid().parse(String(formData.get('id') ?? ''))
  const { clientId } = await getSessionContext()
  const admin = createAdminClient()
  // Builds stay: a snapshot outlives its report (report_id → null) so links
  // and downloaded files keep working; only the editable definition goes.
  const { error } = await admin.from('reports').delete().eq('id', id).eq('client_id', clientId)
  if (error) throw new Error(`delete report: ${error.message}`)
  revalidatePath(BASE)
  redirect(`${BASE}?group=reports`)
}

export async function saveAsTemplate(args: { id: string; name: string }): Promise<ActionState> {
  const parsed = z.object({ id: z.uuid(), name: z.string().trim().min(1).max(80) }).safeParse(args)
  if (!parsed.success) return { ok: false, message: 'Give the template a name.' }
  const { clientId, userId } = await getSessionContext()
  const admin = createAdminClient()
  const { data: r } = await admin.from('reports').select('audience, sections, cover').eq('id', parsed.data.id).eq('client_id', clientId).maybeSingle()
  if (!r) return { ok: false, message: 'No such report.' }
  const sections = ((r.sections as ReportSection[]) ?? []).map(({ id: _id, ...rest }) => rest)
  const { error } = await admin.from('report_templates').insert({
    client_id: clientId, name: parsed.data.name, audience: audienceSchema.catch('general').parse(r.audience), sections, cover: r.cover, created_by: userId,
  })
  if (error) return { ok: false, message: 'Could not save the template — try again.' }
  revalidatePath(`${BASE}/new`)
  return { ok: true, message: 'Saved as a template' }
}
