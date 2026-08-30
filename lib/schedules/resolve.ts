import type { SupabaseClient } from '@supabase/supabase-js'
import { instantiate, starterTemplate } from '../reports/templates'
import type { ReportRow } from '../reports/types'
import type { ScheduleRow } from './types'

/**
 * The report a schedule sends: a starter template becomes a ReportRow-shaped
 * object with an EMPTY id (no reports row exists, so the snapshot's report_id
 * FK stays null — the scripts/render-page.ts idiom); one of the workspace's
 * own templates is its reports row. Null when the source no longer exists.
 */
export async function resolveScheduleReport(
  admin: SupabaseClient,
  schedule: Pick<ScheduleRow, 'client_id' | 'starter_key' | 'report_id'>,
): Promise<{ report: ReportRow; company: string } | null> {
  const { data: client } = await admin.from('clients').select('company_name').eq('id', schedule.client_id).maybeSingle()
  const company = ((client as { company_name?: string } | null)?.company_name ?? '').trim()

  if (schedule.report_id) {
    const { data } = await admin.from('reports').select('*').eq('id', schedule.report_id).eq('client_id', schedule.client_id).maybeSingle()
    return data ? { report: data as ReportRow, company } : null
  }
  const t = schedule.starter_key ? starterTemplate(schedule.starter_key) : null
  if (!t) return null
  const now = new Date().toISOString()
  return {
    company,
    report: {
      id: '',
      client_id: schedule.client_id,
      template_key: t.key,
      title: t.name,
      audience: t.audience,
      sections: instantiate(t.sections),
      cover: { register: t.audience },
      status: 'draft',
      latest_snapshot_id: null,
      created_by: null,
      created_at: now,
      updated_at: now,
    },
  }
}
