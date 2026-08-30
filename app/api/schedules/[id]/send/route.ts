import { NextResponse } from 'next/server'
import { canManageTenant, getRouteSession } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase-admin'
import { appBaseUrl } from '@/lib/site'
import { runSchedule } from '@/lib/schedules/run'
import type { ScheduleRow } from '@/lib/schedules/types'

// POST /api/schedules/[id]/send — an owner or admin fires a schedule by hand (Stage 3).
//
//   { mode: 'test' }  → one real email to the caller only; nothing recorded
//   { mode: 'now' }   → the real thing for the latest completed update: claim,
//                       build, send to the list, record — the same path the
//                       update takes, so "Send now" is a rehearsal of Sunday
//
// Tenant from the session, never the body; the schedule must be the tenant's.

export const runtime = 'nodejs'
export const maxDuration = 300

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getRouteSession()
  if (!session) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })
  if (!canManageTenant(session.role)) return NextResponse.json({ error: 'Only an owner or admin can send.' }, { status: 403 })
  const { id } = await params
  const body = (await request.json().catch(() => null)) as { mode?: unknown } | null
  const mode = body?.mode === 'test' ? 'test' : body?.mode === 'now' ? 'send' : null
  if (!mode) return NextResponse.json({ error: 'Bad request.' }, { status: 400 })
  if (mode === 'test' && !session.email) return NextResponse.json({ error: 'Your account has no email address to send to.' }, { status: 400 })

  const admin = createAdminClient()
  const { data: schedule } = await admin.from('report_schedules').select('*').eq('id', id).eq('client_id', session.clientId).maybeSingle()
  if (!schedule) return NextResponse.json({ error: 'No such schedule.' }, { status: 404 })
  const { data: run } = await admin.from('pipeline_runs').select('id').eq('client_id', session.clientId).in('status', ['completed', 'partial']).order('completed_at', { ascending: false, nullsFirst: false }).limit(1).maybeSingle()
  const runId = (run as { id: string } | null)?.id
  if (!runId) return NextResponse.json({ error: 'Nothing to send yet — your first update has not landed.' }, { status: 409 })

  const r = await runSchedule({ admin, schedule: schedule as ScheduleRow, runId, baseUrl: appBaseUrl(), mode, to: mode === 'test' ? [session.email!] : undefined })
  return NextResponse.json(
    { status: r.status, subject: r.subject, shareUrl: r.shareUrl, ms: r.ms, error: r.error, to: mode === 'test' ? session.email : (schedule as ScheduleRow).recipients },
    { status: r.status === 'failed' ? 500 : 200 },
  )
}
