import { adminKeyValid } from '@/lib/admin-auth'
import { createAdminClient } from '@/lib/supabase-admin'
import { appBaseUrl } from '@/lib/site'
import { renderBaseUrl } from '@/lib/render/render'
import { buildContext, renderStep } from '@/lib/reports/documents/steps'
import { failBuild } from '@/lib/reports/documents/builds'

// POST /api/admin/documents/render {buildId} — the render half of a document
// build, called by the build-document Inngest function's last step. Chromium
// runs here, in a route, never in a step. Admin key like the other admin
// routes; the proxy leaves /api/admin alone. Own tracing entry in next.config.

export const runtime = 'nodejs'
export const maxDuration = 300

export async function POST(req: Request): Promise<Response> {
  if (!adminKeyValid(req.headers.get('x-admin-key'))) return Response.json({ error: 'unauthorized' }, { status: 401 })
  const body = (await req.json().catch(() => null)) as { buildId?: unknown } | null
  const buildId = body?.buildId
  if (typeof buildId !== 'string' || !buildId) return Response.json({ error: 'buildId required' }, { status: 400 })

  const admin = createAdminClient()
  try {
    const ctx = await buildContext(admin, buildId)
    const { data: build } = await admin.from('report_builds').select('snapshot_id, status').eq('id', buildId).single()
    if (!build?.snapshot_id) return Response.json({ error: 'The build has no snapshot to print yet.' }, { status: 409 })
    const { data: snap } = await admin.from('report_snapshots').select('title').eq('id', build.snapshot_id).single()
    const out = await renderStep(admin, ctx, { snapshotId: build.snapshot_id as string, title: (snap?.title as string | undefined) ?? ctx.report.title }, renderBaseUrl(appBaseUrl()))
    return Response.json({ artifactId: out.artifactId, bytes: out.bytes, ms: out.ms })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    console.error('[admin/documents/render] failed:', e)
    await failBuild(admin, buildId, `Printing failed: ${message}`).catch(() => {})
    return Response.json({ error: message }, { status: 500 })
  }
}
