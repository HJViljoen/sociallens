import { NextResponse } from 'next/server'
import { getRouteSession } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase-admin'
import { getBaseUrl } from '@/lib/site'
import { artifactFilename, logExport, replaceArtifactFile, signedArtifactUrl, type ArtifactRow } from '@/lib/artifacts'
import { dayStartIso } from '@/lib/ask/quota'
import { EXPORT_DAILY_LIMIT } from '@/lib/config'
import { renderArtifact, renderBaseUrl } from '@/lib/render/render'

// GET /api/artifacts/<id> — download a stored export: tenant check, then a
// one-hour signed Storage URL. A STALE artifact (its file deleted by the
// erasure sweep) is re-rendered from its snapshot first, where the erased
// voice no longer resolves; the new version is what the reader gets.

export const runtime = 'nodejs'
export const maxDuration = 300

export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await getRouteSession()
  if (!session) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })
  const { id } = await ctx.params
  const admin = createAdminClient()

  const { data, error } = await admin
    .from('artifacts')
    .select('*, report_snapshots!inner(title, kind, ref)')
    .eq('id', id)
    .eq('client_id', session.clientId)
    .maybeSingle()
  if (error) return NextResponse.json({ error: 'Could not read that export.' }, { status: 503 })
  if (!data) return NextResponse.json({ error: 'No such export.' }, { status: 404 })
  const row = data as ArtifactRow & { report_snapshots: { title: string; kind: string; ref: { page?: string } } }
  let artifact: ArtifactRow = row

  try {
    if (artifact.stale) {
      // A re-render is a render: it counts toward the same daily cap as an
      // export, and fails closed the same way.
      const { count, error: quotaErr } = await admin.from('export_events').select('id', { count: 'exact', head: true })
        .eq('client_id', session.clientId).in('action', ['export', 'rerender']).gte('created_at', dayStartIso(new Date()))
      if (quotaErr) return NextResponse.json({ error: 'Could not fetch this export just now. Try again shortly.' }, { status: 503 })
      if ((count ?? 0) >= EXPORT_DAILY_LIMIT) return NextResponse.json({ error: `That is ${EXPORT_DAILY_LIMIT} renders today, which is the daily limit. It resets tomorrow.` }, { status: 429 })
      const baseUrl = renderBaseUrl(await getBaseUrl())
      const { buffer, ms } = await renderArtifact({ baseUrl, snapshotId: artifact.snapshot_id, format: artifact.format, tileKey: artifact.tile_key })
      artifact = await replaceArtifactFile(admin, artifact, { buffer, renderMs: ms })
      await logExport(admin, { clientId: session.clientId, userId: session.userId, snapshotId: artifact.snapshot_id, artifactId: artifact.id, action: 'rerender', kind: row.report_snapshots.kind, format: artifact.format, page: row.report_snapshots.ref?.page ?? null, tileKey: artifact.tile_key })
    }
    await logExport(admin, { clientId: session.clientId, userId: session.userId, snapshotId: artifact.snapshot_id, artifactId: artifact.id, action: 'download', kind: row.report_snapshots.kind, format: artifact.format, page: row.report_snapshots.ref?.page ?? null, tileKey: artifact.tile_key })
    const url = await signedArtifactUrl(admin, artifact, artifactFilename(row.report_snapshots.title, artifact))
    return NextResponse.redirect(url, 302)
  } catch (e) {
    console.error('[artifacts] failed:', e)
    return NextResponse.json({ error: 'Couldn’t fetch this export. Try again.' }, { status: 500 })
  }
}
