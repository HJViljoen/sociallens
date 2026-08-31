import { NextResponse } from 'next/server'
import { z } from 'zod'
import { canManageTenant, getRouteSession } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase-admin'
import { appBaseUrl } from '@/lib/site'
import { renderBaseUrl } from '@/lib/render/render'
import { deliverSend } from '@/lib/schedules/deliver'
import { runSchedule } from '@/lib/schedules/run'
import type { ScheduleRow, SendRow } from '@/lib/schedules/types'

// POST /api/schedules/[id]/send — firing or finishing a schedule by hand.
//
//   { mode: 'test' }    → one real email to the caller only; nothing recorded.
//                         Owner or admin.
//   { mode: 'now' }     → the real thing for the latest completed update:
//                         claim, build, send to the list (or hold as ready on
//                         a review schedule), record. Owner or admin.
//   { mode: 'deliver',  → send a build that is waiting as `ready`. ANY member
//     sendId }            may press this — the recipients were set by an owner
//                         or admin; who approved is recorded (T9, 2026-08-31).
//
// Tenant from the session, never the body; the schedule must be the tenant's.

export const runtime = 'nodejs'
export const maxDuration = 300

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getRouteSession()
  if (!session) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })
  const { id } = await params
  const body = (await request.json().catch(() => null)) as { mode?: unknown; sendId?: unknown } | null
  const mode = body?.mode === 'test' ? 'test' : body?.mode === 'now' ? 'send' : body?.mode === 'deliver' ? 'deliver' : null
  if (!mode) return NextResponse.json({ error: 'Bad request.' }, { status: 400 })
  if (mode !== 'deliver' && !canManageTenant(session.role)) return NextResponse.json({ error: 'Only an owner or admin can send.' }, { status: 403 })
  if (mode === 'test' && !session.email) return NextResponse.json({ error: 'Your account has no email address to send to.' }, { status: 400 })

  const admin = createAdminClient()
  const { data: schedule } = await admin.from('report_schedules').select('*').eq('id', id).eq('client_id', session.clientId).maybeSingle()
  if (!schedule) return NextResponse.json({ error: 'No such schedule.' }, { status: 404 })

  if (mode === 'deliver') {
    const sendId = z.uuid().safeParse(body?.sendId).data
    if (!sendId) return NextResponse.json({ error: 'Bad request.' }, { status: 400 })
    const { data: sendRow } = await admin.from('report_sends').select('id, schedule_id, client_id').eq('id', sendId).eq('client_id', session.clientId).maybeSingle()
    if (!sendRow || (sendRow as Pick<SendRow, 'schedule_id'>).schedule_id !== id) return NextResponse.json({ error: 'No such send.' }, { status: 404 })
    const r = await deliverSend({ admin, sendId, baseUrl: appBaseUrl(), renderBaseUrl: renderBaseUrl(appBaseUrl()), mode: 'review', approvedBy: session.userId })
    return NextResponse.json(
      { status: r.status, subject: r.subject, ms: r.ms, error: r.error, to: (schedule as ScheduleRow).recipients },
      { status: r.status === 'failed' ? 500 : 200 },
    )
  }

  const { data: run } = await admin.from('pipeline_runs').select('id').eq('client_id', session.clientId).in('status', ['completed', 'partial']).order('completed_at', { ascending: false, nullsFirst: false }).limit(1).maybeSingle()
  const runId = (run as { id: string } | null)?.id
  if (!runId) return NextResponse.json({ error: 'Nothing to send yet — your first update has not landed.' }, { status: 409 })

  const r = await runSchedule({ admin, schedule: schedule as ScheduleRow, runId, baseUrl: appBaseUrl(), renderBaseUrl: renderBaseUrl(appBaseUrl()), mode, to: mode === 'test' ? [session.email!] : undefined })
  return NextResponse.json(
    { status: r.status, subject: r.subject, shareUrl: r.shareUrl, notified: r.notified, ms: r.ms, error: r.error, to: mode === 'test' ? session.email : (schedule as ScheduleRow).recipients },
    { status: r.status === 'failed' ? 500 : 200 },
  )
}
