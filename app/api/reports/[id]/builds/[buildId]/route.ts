import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getRouteSession } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase-admin'
import { artifactFilename, signedArtifactUrl, type ArtifactRow } from '@/lib/artifacts'
import { BUILD_COLS, BUILD_PHASE_WORDS } from '@/lib/reports/documents/builds'
import type { ReportBuildRow } from '@/lib/reports/types'

// GET /api/reports/[id]/builds/[buildId] — where a document build is, for
// the Studio to poll. The tenant reads its own row (RLS); a finished build
// also carries a one-hour signed url for its PDF.

export const runtime = 'nodejs'

export interface BuildStatusBody {
  id: string
  status: ReportBuildRow['status']
  phase: string
  needsReview: boolean
  error: string | null
  snapshotId: string | null
  artifactId: string | null
  costUsd: number
  startedAt: string
  finishedAt: string | null
  url: string | null
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string; buildId: string }> }) {
  const session = await getRouteSession()
  if (!session) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })
  const { supabase, clientId } = session
  const { id, buildId } = await ctx.params
  if (!z.uuid().safeParse(id).success || !z.uuid().safeParse(buildId).success) return NextResponse.json({ error: 'No such build.' }, { status: 404 })

  const { data, error } = await supabase.from('report_builds').select(BUILD_COLS).eq('id', buildId).eq('report_id', id).eq('client_id', clientId).maybeSingle()
  if (error) return NextResponse.json({ error: 'Could not read that build.' }, { status: 503 })
  if (!data) return NextResponse.json({ error: 'No such build.' }, { status: 404 })
  const row = data as ReportBuildRow

  let url: string | null = null
  if (row.status === 'done' && row.artifact_id) {
    const admin = createAdminClient()
    const [{ data: artifact }, { data: snap }] = await Promise.all([
      admin.from('artifacts').select('*').eq('id', row.artifact_id).maybeSingle(),
      row.snapshot_id ? admin.from('report_snapshots').select('title').eq('id', row.snapshot_id).maybeSingle() : Promise.resolve({ data: null as { title?: string } | null }),
    ])
    if (artifact) url = await signedArtifactUrl(admin, artifact as ArtifactRow, artifactFilename((snap?.title as string | undefined) ?? 'report', artifact as ArtifactRow)).catch(() => null)
  }

  const body: BuildStatusBody = {
    id: row.id,
    status: row.status,
    phase: BUILD_PHASE_WORDS[row.status],
    needsReview: row.needs_review,
    error: row.error,
    snapshotId: row.snapshot_id,
    artifactId: row.artifact_id,
    costUsd: Number(row.cost_usd),
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    url,
  }
  return NextResponse.json(body, { headers: { 'cache-control': 'no-store' } })
}
