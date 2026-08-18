import { adminKeyValid } from '@/lib/admin-auth'
import { generateWeeklyReport, previewWeeklyReport } from '@/lib/report'

// Superadmin ops hook: build/send a client's report outside the schedule —
// ad-hoc re-sends and testing the email path (Resend creds live only in this
// deployment, so a local script can't exercise real delivery). Same auth as
// trigger-run: ADMIN_API_KEY in X-Admin-Key (T0-11), with the service-role key
// still accepted during the changeover.
//
// Body: { clientId, runId?, mode? }
//   mode 'preview' → build only, returns subject/recipients/html (no DB write, no email)
//   mode 'store'   → persist to weekly_reports without sending
//   default        → persist + send to tracking_configs.report_emails

export async function POST(req: Request): Promise<Response> {
  if (!adminKeyValid(req.headers.get('x-admin-key'))) {
    return Response.json({ error: 'unauthorized' }, { status: 401 })
  }

  const body = (await req.json().catch(() => null)) as
    { clientId?: unknown; runId?: unknown; mode?: unknown } | null
  const clientId = body?.clientId
  if (typeof clientId !== 'string' || !clientId) {
    return Response.json({ error: 'clientId required' }, { status: 400 })
  }
  const runId = typeof body?.runId === 'string' ? body.runId : undefined
  const mode = body?.mode

  if (mode === 'preview') {
    const preview = await previewWeeklyReport({ clientId, runId })
    if (!preview) return Response.json({ error: 'no completed run to report on' }, { status: 404 })
    return Response.json(preview)
  }

  const result = await generateWeeklyReport({ clientId, runId, send: mode !== 'store' })
  return Response.json(result)
}
