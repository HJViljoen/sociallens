'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { canManageTenant, getSessionContext } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase-admin'
import { instantiate, starterTemplate } from '@/lib/reports/templates'
import { documentTemplate } from '@/lib/reports/documents/templates'
import { DEFAULT_DOCUMENT_SETTINGS } from '@/lib/reports/documents/types'
import { reportPatchSchema, tidySections } from '@/lib/reports/validate'
import { AUDIENCES, isAudience, type CoverSpec, type ReportRow, type ReportSection } from '@/lib/reports/types'
import { scheduleInputSchema, type ScheduleInput } from '@/lib/schedules/validate'
import { markSnapshotsStale } from '@/lib/artifacts'
import { DOCUMENT_EDIT_MAX } from '@/lib/config'

// The Studio's writes (Stage 2, moved here in Stage 3). Server actions are
// directly POST-reachable, so every one re-resolves the tenant from the
// session and scopes the row by client_id; the admin client does the write
// (no insert/update policies — the product's idiom).
//
// Templates (a workspace's own = a `reports` row): any member may make and
// edit one — the operator's team, not an admin console. SCHEDULES send
// external email, so they are owner/admin, like Settings and Team.

export interface ActionState {
  ok: boolean
  message: string
}

const STUDIO = '/dashboard/studio'
const REPORTS = '/dashboard/reports'

/** Your own template from a starter, or blank; lands in the editor. */
export async function createReport(formData: FormData): Promise<void> {
  const { clientId, userId } = await getSessionContext()
  const admin = createAdminClient()
  // A written report (2026-08-31): kind 'document', the template's name and
  // reader, no sections, the settings at their defaults.
  const documentKey = String(formData.get('document') ?? '')
  if (documentKey) {
    const t = documentTemplate(documentKey)
    if (!t) throw new Error('unknown document template')
    const { data, error } = await admin
      .from('reports')
      .insert({ client_id: clientId, kind: 'document', template_key: t.key, title: t.name, audience: t.audience, sections: [], cover: { register: t.audience }, settings: DEFAULT_DOCUMENT_SETTINGS, created_by: userId })
      .select('id')
      .single()
    if (error || !data) throw new Error(`create report: ${error?.message ?? 'no row'}`)
    redirect(`${STUDIO}/edit/${data.id as string}`)
  }
  const templateKey = String(formData.get('template') ?? '')
  let title = 'Untitled template'
  let audience: ReportRow['audience'] = 'general'
  let sections: ReportSection[] = []
  let key: string | null = null
  if (templateKey) {
    const t = starterTemplate(templateKey)
    if (!t) throw new Error('unknown template')
    title = t.name; audience = t.audience; sections = instantiate(t.sections); key = t.key
  }
  const cover: CoverSpec = { register: audience }
  const { data, error } = await admin
    .from('reports')
    .insert({ client_id: clientId, template_key: key, title, audience, sections, cover, created_by: userId })
    .select('id')
    .single()
  if (error || !data) throw new Error(`create report: ${error?.message ?? 'no row'}`)
  redirect(`${STUDIO}/edit/${data.id as string}`)
}

const patchArgs = z.object({ id: z.uuid(), patch: reportPatchSchema })

/** Save an edit from the outline: title, audience, cover title, sections. */
export async function updateReport(args: { id: string; patch: z.infer<typeof reportPatchSchema> }): Promise<ActionState> {
  const parsed = patchArgs.safeParse(args)
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? 'That edit could not be saved.' }
  const { clientId } = await getSessionContext()
  const admin = createAdminClient()
  const { data: current } = await admin.from('reports').select('id, cover, audience').eq('id', parsed.data.id).eq('client_id', clientId).maybeSingle()
  if (!current) return { ok: false, message: 'No such template.' }
  const p = parsed.data.patch
  const cover = { ...((current.cover as CoverSpec) ?? {}) } as CoverSpec
  if (p.audience) cover.register = p.audience
  if (p.coverTitle !== undefined) { if (p.coverTitle) cover.title = p.coverTitle; else delete cover.title }
  // "Written for" is free text; a known register keeps its prompt, anything else is written plainly for that reader.
  if (p.reader !== undefined) {
    if (p.reader) cover.reader = p.reader; else delete cover.reader
    const known = AUDIENCES.find((a) => a.label.toLowerCase() === (p.reader ?? '').toLowerCase())
    p.audience = known ? known.key : 'general'
  }
  if (!cover.register) cover.register = isAudience(current.audience) ? current.audience : 'general'
  const row: Record<string, unknown> = { cover, updated_at: new Date().toISOString() }
  if (p.title !== undefined) row.title = p.title
  if (p.audience !== undefined) row.audience = p.audience
  if (p.sections !== undefined) row.sections = tidySections(p.sections)
  // An edit after a build makes the template a draft again: the latest build
  // no longer shows what the outline says.
  if (p.sections !== undefined || p.audience !== undefined || p.coverTitle !== undefined || p.title !== undefined || p.reader !== undefined) row.status = 'draft'
  const { error } = await admin.from('reports').update(row).eq('id', parsed.data.id).eq('client_id', clientId)
  if (error) return { ok: false, message: 'Could not save that. Try again.' }
  revalidatePath(`${STUDIO}/edit/${parsed.data.id}`)
  revalidatePath(STUDIO)
  return { ok: true, message: 'Saved' }
}

export async function deleteReport(formData: FormData): Promise<void> {
  const id = z.uuid().parse(String(formData.get('id') ?? ''))
  const { clientId } = await getSessionContext()
  const admin = createAdminClient()
  // Builds stay: a snapshot outlives its template (report_id → null) so links
  // and downloaded files keep working; a schedule pointing here goes with it.
  const { error } = await admin.from('reports').delete().eq('id', id).eq('client_id', clientId)
  if (error) throw new Error(`delete report: ${error.message}`)
  revalidatePath(STUDIO)
  redirect(STUDIO)
}

/** Revoke a share link: the address stops working at the next open. */
export async function revokeShareLink(formData: FormData): Promise<void> {
  const id = z.uuid().parse(String(formData.get('id') ?? ''))
  const { clientId } = await getSessionContext()
  const admin = createAdminClient()
  const { error } = await admin.from('share_links').update({ revoked_at: new Date().toISOString() }).eq('id', id).eq('client_id', clientId).is('revoked_at', null)
  if (error) throw new Error(`revoke share link: ${error.message}`)
  revalidatePath(STUDIO)
  revalidatePath(REPORTS)
}

// ── schedules (owner / admin) ──────────────────────────────────────────────

const NOT_ALLOWED: ActionState = { ok: false, message: 'Only an owner or admin can change schedules.' }

/** Create (no id) or update (id) a schedule from the form. */
export async function saveSchedule(args: { id?: string | null; input: ScheduleInput }): Promise<ActionState & { id?: string }> {
  const { clientId, userId, role } = await getSessionContext()
  if (!canManageTenant(role)) return NOT_ALLOWED
  const parsed = scheduleInputSchema.safeParse(args.input)
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? 'That could not be saved.' }
  const s = parsed.data
  const admin = createAdminClient()
  if (s.starterKey && !starterTemplate(s.starterKey)) return { ok: false, message: 'Pick a template.' }
  if (s.reportId) {
    const { data: r } = await admin.from('reports').select('id').eq('id', s.reportId).eq('client_id', clientId).maybeSingle()
    if (!r) return { ok: false, message: 'That template is not in this workspace.' }
  }
  const row = {
    name: s.name,
    starter_key: s.starterKey,
    report_id: s.reportId,
    cadence: s.cadence,
    recipients: s.recipients,
    attach_pdf: s.attachPdf,
    share_days: s.shareDays,
    active: s.active,
    updated_at: new Date().toISOString(),
  }
  const id = args.id ? z.uuid().safeParse(args.id).data ?? null : null
  if (id) {
    const { error } = await admin.from('report_schedules').update(row).eq('id', id).eq('client_id', clientId)
    if (error) return { ok: false, message: 'Could not save that. Try again.' }
    revalidatePath(STUDIO)
    return { ok: true, message: 'Saved', id }
  }
  const { data, error } = await admin.from('report_schedules').insert({ ...row, client_id: clientId, created_by: userId, is_default: false }).select('id').single()
  if (error || !data) return { ok: false, message: 'Could not create the schedule. Try again.' }
  revalidatePath(STUDIO)
  return { ok: true, message: 'Saved', id: data.id as string }
}

export async function deleteSchedule(formData: FormData): Promise<void> {
  const id = z.uuid().parse(String(formData.get('id') ?? ''))
  const { clientId, role } = await getSessionContext()
  if (!canManageTenant(role)) throw new Error(NOT_ALLOWED.message)
  const admin = createAdminClient()
  // The workspace's default schedule is paused, never deleted: an accepted
  // invite lands on it. Its sends stay in the archive (schedule_id nulls).
  const { data: row } = await admin.from('report_schedules').select('is_default').eq('id', id).eq('client_id', clientId).maybeSingle()
  if (!row) throw new Error('no such schedule')
  if ((row as { is_default: boolean }).is_default) throw new Error('The default schedule can be paused, not deleted.')
  const { error } = await admin.from('report_schedules').delete().eq('id', id).eq('client_id', clientId)
  if (error) throw new Error(`delete schedule: ${error.message}`)
  revalidatePath(STUDIO)
  redirect(STUDIO)
}

// ── document edits (2026-08-31) ───────────────────────────────────────────
// An operator's edit of one block of a BUILT document: an overlay row in
// report_edits, never a change to the snapshot (lib/reports/documents/
// edits.ts). Any member, like the template itself. The edit stales the
// snapshot's artifacts so the next download prints the new words.

const blockEditArgs = z.object({ snapshotId: z.uuid(), blockId: z.string().min(1).max(80), text: z.string().max(DOCUMENT_EDIT_MAX) })

export async function saveBlockEdit(args: { snapshotId: string; blockId: string; text: string }): Promise<ActionState> {
  const parsed = blockEditArgs.safeParse(args)
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? 'That edit could not be saved.' }
  const { clientId, userId } = await getSessionContext()
  const admin = createAdminClient()
  const { data: snap } = await admin.from('report_snapshots').select('id, report_id').eq('id', parsed.data.snapshotId).eq('client_id', clientId).maybeSingle()
  if (!snap) return { ok: false, message: 'No such build.' }
  const { error } = await admin
    .from('report_edits')
    .upsert({ client_id: clientId, snapshot_id: snap.id, block_id: parsed.data.blockId, text: parsed.data.text, edited_by: userId, edited_at: new Date().toISOString() }, { onConflict: 'snapshot_id,block_id' })
  if (error) return { ok: false, message: 'Could not save that. Try again.' }
  await markSnapshotsStale(admin, [snap.id as string], { apply: true }).catch((e) => console.error('[studio] stale after edit failed:', e))
  if (snap.report_id) revalidatePath(`${STUDIO}/edit/${snap.report_id}`)
  revalidatePath(STUDIO)
  return { ok: true, message: 'Saved' }
}

export async function restoreBlock(args: { snapshotId: string; blockId: string }): Promise<ActionState> {
  const parsed = blockEditArgs.pick({ snapshotId: true, blockId: true }).safeParse(args)
  if (!parsed.success) return { ok: false, message: 'That block could not be restored.' }
  const { clientId } = await getSessionContext()
  const admin = createAdminClient()
  const { data: snap } = await admin.from('report_snapshots').select('id, report_id').eq('id', parsed.data.snapshotId).eq('client_id', clientId).maybeSingle()
  if (!snap) return { ok: false, message: 'No such build.' }
  const { error } = await admin.from('report_edits').delete().eq('snapshot_id', snap.id).eq('block_id', parsed.data.blockId).eq('client_id', clientId)
  if (error) return { ok: false, message: 'Could not restore that. Try again.' }
  await markSnapshotsStale(admin, [snap.id as string], { apply: true }).catch((e) => console.error('[studio] stale after restore failed:', e))
  if (snap.report_id) revalidatePath(`${STUDIO}/edit/${snap.report_id}`)
  revalidatePath(STUDIO)
  return { ok: true, message: 'Restored' }
}
