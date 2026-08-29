import { NextResponse } from 'next/server'
import { getRouteSession } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase-admin'
import { getBaseUrl } from '@/lib/site'
import { renderBaseUrl } from '@/lib/render/render'
import { dayStartIso } from '@/lib/ask/quota'
import { EXPORT_DAILY_LIMIT } from '@/lib/config'
import { BuildEmptyError, buildReport } from '@/lib/reports/build'
import type { ReportRow } from '@/lib/reports/types'

// POST /api/reports/[id]/build — freeze the report as it is now and print it.
// The tenant is the session's; the report must be that tenant's. Counts
// toward the daily export cap like any render. No dot in the path.

export const runtime = 'nodejs'
export const maxDuration = 300

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await getRouteSession()
  if (!session) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })
  const { supabase, clientId, userId } = session
  const { id } = await ctx.params

  const [{ data: report, error: reportErr }, { data: client }] = await Promise.all([
    supabase.from('reports').select('*').eq('id', id).eq('client_id', clientId).maybeSingle(),
    supabase.from('clients').select('company_name').eq('id', clientId).maybeSingle(),
  ])
  if (reportErr) return NextResponse.json({ error: 'Could not read that report.' }, { status: 503 })
  if (!report) return NextResponse.json({ error: 'No such report.' }, { status: 404 })

  const admin = createAdminClient()
  const { count: usedToday, error: quotaErr } = await admin
    .from('export_events')
    .select('id', { count: 'exact', head: true })
    .eq('client_id', clientId)
    .in('action', ['export', 'rerender'])
    .gte('created_at', dayStartIso(new Date()))
  if (quotaErr) return NextResponse.json({ error: 'Could not start that just now. Try again shortly.' }, { status: 503 })
  if ((usedToday ?? 0) >= EXPORT_DAILY_LIMIT) {
    return NextResponse.json({ error: `That is ${EXPORT_DAILY_LIMIT} exports today, which is the daily limit. It resets tomorrow — or tell us if you need more.` }, { status: 429 })
  }

  try {
    const baseUrl = renderBaseUrl(await getBaseUrl())
    const out = await buildReport({
      admin, supabase, clientId, userId,
      report: report as ReportRow,
      company: (client?.company_name as string | undefined) ?? '',
      baseUrl,
    })
    return NextResponse.json(out)
  } catch (e) {
    if (e instanceof BuildEmptyError) return NextResponse.json({ error: e.message }, { status: 409 })
    console.error('[reports/build] failed:', e)
    return NextResponse.json({ error: 'Couldn’t build this report — try again.' }, { status: 500 })
  }
}
