import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getRouteSession } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase-admin'
import { REPORT_MAX_SECTIONS } from '@/lib/config'
import { newSectionId } from '@/lib/reports/templates'
import { sectionSchema, tidySections } from '@/lib/reports/validate'
import type { ReportSection } from '@/lib/reports/types'

// POST /api/reports/[id]/sections — "add to report" from a page's Export menu:
// appends the page, with the selection the operator is looking at.

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await getRouteSession()
  if (!session) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })
  const { id } = await ctx.params
  const parsed = z.object({ section: sectionSchema.omit({ id: true }) }).safeParse(await req.json().catch(() => null))
  if (!parsed.success || !z.uuid().safeParse(id).success) return NextResponse.json({ error: 'Bad request.' }, { status: 400 })
  const admin = createAdminClient()
  const { data: report } = await admin.from('reports').select('id, sections').eq('id', id).eq('client_id', session.clientId).maybeSingle()
  if (!report) return NextResponse.json({ error: 'No such report.' }, { status: 404 })
  const sections = (report.sections as ReportSection[]) ?? []
  if (sections.length >= REPORT_MAX_SECTIONS) return NextResponse.json({ error: `A report holds at most ${REPORT_MAX_SECTIONS} sections.` }, { status: 409 })
  const [section] = tidySections([{ ...parsed.data.section, id: newSectionId() }])
  const { error } = await admin.from('reports').update({ sections: [...sections, section], status: 'draft', updated_at: new Date().toISOString() }).eq('id', id).eq('client_id', session.clientId)
  if (error) return NextResponse.json({ error: 'Could not add that page.' }, { status: 503 })
  return NextResponse.json({ id, sectionId: section.id, count: sections.length + 1 })
}
