import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getRouteSession } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase-admin'
import { catalogueTitle } from '@/lib/reports/catalogue'
import { newSectionId } from '@/lib/reports/templates'
import { sectionSchema, tidySections } from '@/lib/reports/validate'
import type { ReportSection } from '@/lib/reports/types'

// GET  /api/reports?status=draft   → the drafts the Export menu can add a page to.
// POST /api/reports                → a new report holding one section (the
//                                    page the operator is looking at).

export async function GET(req: Request) {
  const session = await getRouteSession()
  if (!session) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })
  const status = new URL(req.url).searchParams.get('status')
  const { data, error } = await session.supabase
    .from('reports')
    .select('id, title, status, updated_at')
    .eq('client_id', session.clientId)
    .in('status', status === 'draft' || status === 'built' ? [status] : ['draft', 'built'])
    .order('updated_at', { ascending: false })
    .limit(20)
  if (error) return NextResponse.json({ error: 'Could not list reports.' }, { status: 503 })
  return NextResponse.json({ reports: data ?? [] })
}

const createBody = z.object({ section: sectionSchema.omit({ id: true }) })

export async function POST(req: Request) {
  const session = await getRouteSession()
  if (!session) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })
  const parsed = createBody.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Bad request.' }, { status: 400 })
  const [section] = tidySections([{ ...parsed.data.section, id: newSectionId() }])
  const admin = createAdminClient()
  const { data, error } = await admin
    .from('reports')
    .insert({ client_id: session.clientId, template_key: null, title: `${catalogueTitle(section.page)} report`, audience: 'general', sections: [section] satisfies ReportSection[], cover: { register: 'general' }, created_by: session.userId })
    .select('id, title')
    .single()
  if (error || !data) return NextResponse.json({ error: 'Could not create the report.' }, { status: 503 })
  return NextResponse.json({ id: data.id, title: data.title, sectionId: section.id })
}
