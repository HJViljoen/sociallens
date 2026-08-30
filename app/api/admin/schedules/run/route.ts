import { NextResponse } from 'next/server'
import { adminKeyValid } from '@/lib/admin-auth'
import { createAdminClient } from '@/lib/supabase-admin'
import { appBaseUrl } from '@/lib/site'
import { renderBaseUrl } from '@/lib/render/render'
import { runSchedule } from '@/lib/schedules/run'
import type { ScheduleRow } from '@/lib/schedules/types'

// POST /api/admin/schedules/run — fire ONE schedule for ONE update (Stage 3).
//
//   { scheduleId, runId }   — X-Admin-Key (ADMIN_API_KEY), the trigger-run idiom
//
// Called by the Inngest function after a scheduled update, one step per
// schedule: the render (Chromium, seconds, 2 GB) lives here in a route
// handler, not in an Inngest step — the account's concurrency is a hard 5
// shared with the pipeline. Under /api/admin because the proxy lets that
// prefix through to the key check. Safe to call twice: the runner claims
// report_sends (schedule_id, run_id) before it renders, so a retry after a
// lost response returns already_sent instead of a second email.

export const runtime = 'nodejs'
export const maxDuration = 300

export async function POST(request: Request) {
  if (!adminKeyValid(request.headers.get('x-admin-key'))) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const body = (await request.json().catch(() => null)) as { scheduleId?: unknown; runId?: unknown } | null
  const scheduleId = typeof body?.scheduleId === 'string' ? body.scheduleId : null
  const runId = typeof body?.runId === 'string' ? body.runId : null
  if (!scheduleId || !runId) return NextResponse.json({ error: 'scheduleId and runId required' }, { status: 400 })

  const admin = createAdminClient()
  const { data } = await admin.from('report_schedules').select('*').eq('id', scheduleId).maybeSingle()
  if (!data) return NextResponse.json({ error: 'no such schedule' }, { status: 404 })

  const r = await runSchedule({ admin, schedule: data as ScheduleRow, runId, baseUrl: appBaseUrl(), renderBaseUrl: renderBaseUrl(appBaseUrl()), mode: 'send' })
  // The HTML never leaves the runner here; the row and the snapshot are the record.
  return NextResponse.json(
    { status: r.status, sendId: r.sendId, snapshotId: r.snapshotId, artifactId: r.artifactId, shareUrl: r.shareUrl, subject: r.subject, ms: r.ms, error: r.error },
    { status: r.status === 'failed' ? 500 : 200 },
  )
}
