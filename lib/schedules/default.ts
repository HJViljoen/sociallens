import type { SupabaseClient } from '@supabase/supabase-js'
import { normaliseRecipients } from './validate'
import type { ScheduleRow } from './types'

/**
 * The workspace's default schedule — its "Weekly digest" — is where a new
 * teammate lands (accepting an invite, T0-10) and what a new workspace is
 * given at birth (onboarding, provisioning, the demo seed). One per
 * workspace, enforced by report_schedules_one_default.
 */

export const DEFAULT_SCHEDULE_NAME = 'Weekly digest'
export const DEFAULT_SCHEDULE_STARTER = 'weekly_digest'

/** Create the default schedule if the workspace has none; returns the row either way. */
export async function ensureDefaultSchedule(admin: SupabaseClient, clientId: string, recipients: string[] = [], createdBy: string | null = null): Promise<ScheduleRow> {
  const { data: existing } = await admin.from('report_schedules').select('*').eq('client_id', clientId).eq('is_default', true).maybeSingle()
  if (existing) return existing as ScheduleRow
  const { data, error } = await admin
    .from('report_schedules')
    .insert({
      client_id: clientId,
      name: DEFAULT_SCHEDULE_NAME,
      starter_key: DEFAULT_SCHEDULE_STARTER,
      cadence: 'every_update',
      recipients: normaliseRecipients(recipients),
      attach_pdf: true,
      share_days: 30,
      active: true,
      is_default: true,
      created_by: createdBy,
    })
    .select('*')
    .single()
  if (error || !data) throw new Error(`default schedule: ${error?.message ?? 'no row'}`)
  return data as ScheduleRow
}

/** Add an address to the default schedule's list (case-insensitive, no
 *  duplicates, the 25 cap respected). Returns whether anything changed. */
export async function joinDefaultSchedule(admin: SupabaseClient, clientId: string, email: string): Promise<boolean> {
  const s = await ensureDefaultSchedule(admin, clientId)
  const next = normaliseRecipients([...s.recipients, email])
  if (next.length === s.recipients.length || next.length > 25) return false
  const { error } = await admin.from('report_schedules').update({ recipients: next, updated_at: new Date().toISOString() }).eq('id', s.id)
  if (error) throw new Error(`default schedule: ${error.message}`)
  return true
}

/** Every active schedule's list, for "who gets the update" surfaces. */
export async function recipientsByschedule(admin: SupabaseClient, clientId: string): Promise<{ id: string; name: string; recipients: string[]; active: boolean; is_default: boolean }[]> {
  const { data } = await admin.from('report_schedules').select('id, name, recipients, active, is_default').eq('client_id', clientId).order('is_default', { ascending: false }).order('created_at')
  return (data ?? []) as { id: string; name: string; recipients: string[]; active: boolean; is_default: boolean }[]
}
