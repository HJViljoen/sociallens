import { getRouteSession } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase-admin'
import { appBaseUrl } from '@/lib/site'
import { hydrateSnapshot, loadSnapshot } from '@/lib/snapshots'
import { renderDigestEmail } from '@/lib/email/digest'
import { runSchedule } from '@/lib/schedules/run'
import type { ScheduleRow } from '@/lib/schedules/types'
import type { ReportSnapshotData } from '@/lib/reports/types'

// GET /api/schedules/[id]/preview[?send=<report_sends.id>] — the email as HTML,
// for a sandboxed iframe in the app (Stage 3).
//
//   with ?send   → "the email as sent": re-rendered from that send's snapshot
//                  (quotes resolve live, so an erased voice is gone; the
//                  inline sparkline images are not re-attached here)
//   without      → a dry preview at the workspace's current data: loaders +
//                  cover, no PDF, no link, no send, no rows left behind
//
// Any member may look; sending is owner/admin (the send route).

export const runtime = 'nodejs'
export const maxDuration = 120

const page = (html: string, status = 200) => new Response(html.replace(/<head>/i, '<head><base target="_blank">'), { status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex' } })
const note = (text: string, status: number) => page(`<!doctype html><html><body style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#6E7378;font-size:13px;padding:24px">${text}</body></html>`, status)

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getRouteSession()
  if (!session) return note('Not signed in.', 401)
  const { id } = await params
  const admin = createAdminClient()
  const { data: schedule } = await admin.from('report_schedules').select('*').eq('id', id).eq('client_id', session.clientId).maybeSingle()
  if (!schedule) return note('No such schedule.', 404)
  const s = schedule as ScheduleRow
  const sendId = new URL(request.url).searchParams.get('send')

  if (sendId) {
    const { data: send } = await admin.from('report_sends').select('snapshot_id, share_link_id').eq('id', sendId).eq('client_id', session.clientId).maybeSingle()
    const sid = (send as { snapshot_id: string | null } | null)?.snapshot_id
    const row = sid ? await loadSnapshot(admin, sid) : null
    if (!row || row.kind !== 'report') return note('This send has no stored build to show.', 404)
    const data = await hydrateSnapshot<ReportSnapshotData>(admin, row)
    let shareUrl: string | null = null
    const linkId = (send as { share_link_id: string | null } | null)?.share_link_id
    if (linkId) {
      const { data: link } = await admin.from('share_links').select('token, revoked_at').eq('id', linkId).maybeSingle()
      const l = link as { token: string; revoked_at: string | null } | null
      if (l && !l.revoked_at) shareUrl = `${appBaseUrl()}/r/${l.token}`
    }
    return page(renderDigestEmail({ data, shareUrl, appUrl: appBaseUrl(), attached: s.attach_pdf, cadenceWord: s.cadence === 'monthly' ? 'monthly' : 'weekly' }).html)
  }

  const { data: run } = await admin.from('pipeline_runs').select('id').eq('client_id', session.clientId).in('status', ['completed', 'partial']).order('completed_at', { ascending: false, nullsFirst: false }).limit(1).maybeSingle()
  const runId = (run as { id: string } | null)?.id
  if (!runId) return note('Nothing to show yet — your first update has not landed.', 409)
  const r = await runSchedule({ admin, schedule: s, runId, baseUrl: appBaseUrl(), mode: 'preview' })
  if (r.status !== 'preview' || !r.html) return note(r.error ?? 'Could not build the preview.', 500)
  return page(r.html)
}
