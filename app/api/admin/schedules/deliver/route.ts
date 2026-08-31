import { adminKeyValid } from '@/lib/admin-auth'
import { createAdminClient } from '@/lib/supabase-admin'
import { appBaseUrl } from '@/lib/site'
import { renderBaseUrl } from '@/lib/render/render'
import { deliverSend, readyForReview } from '@/lib/schedules/deliver'
import type { ScheduleRow, SendRow } from '@/lib/schedules/types'

// POST /api/admin/schedules/deliver {sendId} — the delivery half of a
// scheduled document build, called by build-document's `deliver` step once
// the PDF exists. Chromium and the email body run here, in a route, never in
// a step. Admin key like the other admin routes; own tracing entry.
//
// The decision lives here, in one place: the schedule asked for a review, or
// the self-check flagged the build, and it waits for a person; otherwise it
// goes out now.

export const runtime = 'nodejs'
export const maxDuration = 300

export async function POST(req: Request): Promise<Response> {
  if (!adminKeyValid(req.headers.get('x-admin-key'))) return Response.json({ error: 'unauthorized' }, { status: 401 })
  const body = (await req.json().catch(() => null)) as { sendId?: unknown } | null
  const sendId = body?.sendId
  if (typeof sendId !== 'string' || !sendId) return Response.json({ error: 'sendId required' }, { status: 400 })

  const admin = createAdminClient()
  try {
    const { data: sendRow } = await admin.from('report_sends').select('*').eq('id', sendId).maybeSingle()
    const send = sendRow as SendRow | null
    if (!send) return Response.json({ error: 'No such send.' }, { status: 404 })
    if (send.status === 'sent') return Response.json({ status: 'already_sent' })

    const { data: scheduleRow } = send.schedule_id ? await admin.from('report_schedules').select('*').eq('id', send.schedule_id).maybeSingle() : { data: null }
    const schedule = scheduleRow as ScheduleRow | null
    if (!schedule) return Response.json({ error: 'The schedule this send belonged to was removed.' }, { status: 409 })

    // What the build produced becomes what the send carries. (The share link
    // is minted at delivery, not here: a review that is never sent should not
    // leave a public link behind.)
    const { data: buildRow } = await admin
      .from('report_builds')
      .select('needs_review, snapshot_id, artifact_id')
      .eq('send_id', sendId)
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    const build = buildRow as { needs_review: boolean; snapshot_id: string | null; artifact_id: string | null } | null
    if (!build?.snapshot_id) return Response.json({ error: 'The build has nothing to send.' }, { status: 409 })
    if (!send.snapshot_id || !send.artifact_id) {
      await admin.from('report_sends').update({ snapshot_id: build.snapshot_id, artifact_id: build.artifact_id }).eq('id', sendId)
    }
    const flagged = Boolean(build.needs_review)

    if (schedule.review || flagged) {
      const out = await readyForReview(admin, { sendId, baseUrl: appBaseUrl() })
      return Response.json({ status: out.status, subject: out.subject, error: out.error, flagged }, { status: out.status === 'failed' ? 500 : 200 })
    }

    const out = await deliverSend({ admin, sendId, baseUrl: appBaseUrl(), renderBaseUrl: renderBaseUrl(appBaseUrl()), mode: 'auto' })
    return Response.json({ status: out.status, subject: out.subject, ms: out.ms, error: out.error }, { status: out.status === 'failed' ? 500 : 200 })
  } catch (e) {
    console.error('[admin/schedules/deliver] failed:', e)
    return Response.json({ error: e instanceof Error ? e.message : 'deliver failed' }, { status: 500 })
  }
}
