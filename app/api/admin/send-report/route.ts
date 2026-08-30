import { adminKeyValid } from '@/lib/admin-auth'
import { createAdminClient } from '@/lib/supabase-admin'
import { appBaseUrl } from '@/lib/site'
import { runSchedule } from '@/lib/schedules/run'
import type { ScheduleRow } from '@/lib/schedules/types'

// Superadmin ops hook: fire a workspace's schedule outside the update —
// re-sends and testing the email path (Resend creds live only in this
// deployment). Same auth as trigger-run: ADMIN_API_KEY in X-Admin-Key
// (T0-11), the service-role key still accepted during the changeover.
//
// Body: { clientId, scheduleId?, runId?, mode?, to? }
//   scheduleId    → that schedule; else the workspace's default (its digest)
//   runId         → that update; else the latest completed one
//   mode 'preview' → build only, returns subject/html/text (no rows, no email)
//   mode 'test'    → one real send to `to` (an array of addresses); nothing recorded
//   default        → the real thing: claim, build, send to the list, record

export async function POST(req: Request): Promise<Response> {
  if (!adminKeyValid(req.headers.get('x-admin-key'))) {
    return Response.json({ error: 'unauthorized' }, { status: 401 })
  }

  const body = (await req.json().catch(() => null)) as
    { clientId?: unknown; scheduleId?: unknown; runId?: unknown; mode?: unknown; to?: unknown } | null
  const clientId = body?.clientId
  if (typeof clientId !== 'string' || !clientId) {
    return Response.json({ error: 'clientId required' }, { status: 400 })
  }
  const admin = createAdminClient()
  const q = admin.from('report_schedules').select('*').eq('client_id', clientId)
  const { data: schedule } = typeof body?.scheduleId === 'string' ? await q.eq('id', body.scheduleId).maybeSingle() : await q.eq('is_default', true).maybeSingle()
  if (!schedule) return Response.json({ error: 'no such schedule' }, { status: 404 })

  let runId = typeof body?.runId === 'string' ? body.runId : null
  if (!runId) {
    const { data: run } = await admin.from('pipeline_runs').select('id').eq('client_id', clientId).in('status', ['completed', 'partial']).order('completed_at', { ascending: false, nullsFirst: false }).limit(1).maybeSingle()
    runId = (run as { id: string } | null)?.id ?? null
  }
  if (!runId) return Response.json({ error: 'no completed update to report on' }, { status: 404 })

  const mode = body?.mode === 'preview' ? 'preview' : body?.mode === 'test' ? 'test' : 'send'
  const to = Array.isArray(body?.to) ? (body!.to as unknown[]).filter((x): x is string => typeof x === 'string') : undefined
  const result = await runSchedule({ admin, schedule: schedule as ScheduleRow, runId, baseUrl: appBaseUrl(), mode, to })
  return Response.json(result, { status: result.status === 'failed' ? 500 : 200 })
}
