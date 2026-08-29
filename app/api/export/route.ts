import { NextResponse } from 'next/server'
import { getRouteSession } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase-admin'
import { getBaseUrl } from '@/lib/site'
import { pageModule } from '@/components/pages/registry'
import { createSnapshot, type SnapshotKind } from '@/lib/snapshots'
import { artifactFilename, logExport, signedArtifactUrl, storeArtifact, type ArtifactFormat } from '@/lib/artifacts'
import { renderArtifact, renderBaseUrl } from '@/lib/render/render'
import { dayStartIso } from '@/lib/ask/quota'
import { EXPORT_DAILY_LIMIT } from '@/lib/config'
import type { PageKey, PrintVariant } from '@/lib/renderables/types'

// POST /api/export — freeze what the reader is looking at and render it.
//
//   { kind: 'page' | 'tile', page, tileKey?, params?, variant?, format: 'pdf' | 'png' }
//
// The tenant comes from the SESSION, never the body. The loader runs on the
// session's RLS client with the same params the page had, so the snapshot is
// exactly what the reader saw. Then: snapshot (quotes frozen to refs) →
// headless Chrome prints /render/<snapshot> → Storage → artifacts row →
// export_events. The file never comes back in this response (Vercel caps
// bodies at 4.5 MB); a one-hour signed URL does.
//
// A route handler, not a server action, and no dot in the path (proxy.ts
// would skip the auth check).

export const runtime = 'nodejs'
// Chromium cold start + a page load + print, measured in seconds; the ceiling
// is the platform's, generous so a slow render fails as a render.
export const maxDuration = 300

const PAGE_KEYS = new Set<PageKey>(['dashboard', 'market', 'voice', 'competitive', 'content', 'profile', 'agent'])

interface Body {
  kind?: unknown
  page?: unknown
  tileKey?: unknown
  params?: unknown
  variant?: unknown
  format?: unknown
  style?: unknown
}

export async function POST(request: Request) {
  const session = await getRouteSession()
  if (!session) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })
  const { clientId, userId, supabase } = session

  let body: Body
  try {
    body = (await request.json()) as Body
  } catch {
    return NextResponse.json({ error: 'Bad request.' }, { status: 400 })
  }
  const kind = body.kind === 'tile' ? 'tile' : body.kind === 'page' ? 'page' : null
  const format: ArtifactFormat | null = body.format === 'pdf' ? 'pdf' : body.format === 'png' ? 'png' : null
  const page = typeof body.page === 'string' && PAGE_KEYS.has(body.page as PageKey) ? (body.page as PageKey) : null
  const tileKey = typeof body.tileKey === 'string' && body.tileKey ? body.tileKey : null
  const variant: PrintVariant = body.variant === 'full' ? 'full' : 'default'
  const style = body.style === 'b' ? 'b' : body.style === 'a' ? 'a' : null
  const params: Record<string, string | undefined> = {}
  if (body.params && typeof body.params === 'object') {
    for (const [k, v] of Object.entries(body.params as Record<string, unknown>)) if (typeof v === 'string') params[k] = v
  }
  if (!kind || !format || !page) return NextResponse.json({ error: 'Bad request.' }, { status: 400 })
  if (kind === 'tile' && !tileKey) return NextResponse.json({ error: 'A tile export names its tile.' }, { status: 400 })
  if (format === 'png' && kind !== 'tile') return NextResponse.json({ error: 'PNG is for a single tile; a page exports as PDF.' }, { status: 400 })
  // A tile as PDF: the render page shows that one tile; Chrome prints it on one slide-sized page.

  const mod = pageModule(page)
  if (!mod) return NextResponse.json({ error: 'That page cannot be exported yet.' }, { status: 400 })
  if (tileKey && !mod.renderables[tileKey]) return NextResponse.json({ error: 'Unknown tile.' }, { status: 400 })

  const admin = createAdminClient()

  // Daily cap: a render is seconds of a 2 GB function and a Storage object.
  // Fail CLOSED on a read error, as the agent's cap does.
  const { count: usedToday, error: quotaErr } = await admin
    .from('export_events')
    .select('id', { count: 'exact', head: true })
    .eq('client_id', clientId)
    .eq('action', 'export')
    .gte('created_at', dayStartIso(new Date()))
  if (quotaErr) {
    console.error('[export] quota read failed:', quotaErr)
    return NextResponse.json({ error: 'Could not start that just now. Try again shortly.' }, { status: 503 })
  }
  if ((usedToday ?? 0) >= EXPORT_DAILY_LIMIT) {
    return NextResponse.json({ error: `That is ${EXPORT_DAILY_LIMIT} exports today, which is the daily limit. It resets tomorrow — or tell us if you need more.` }, { status: 429 })
  }

  try {
    const data = await mod.load({ supabase, clientId, params, variant })
    if (!data) return NextResponse.json({ error: 'Nothing to export yet — your first update has not landed.' }, { status: 409 })
    const d = data as { runId?: string | null }
    const title = tileKey ? `${mod.renderables[tileKey].title} · ${mod.snapshotTitle(data)}` : mod.snapshotTitle(data)
    // An agent thread is its own kind of snapshot (the Reports list says so).
    const snapKind: SnapshotKind = page === 'agent' && kind === 'page' ? 'agent_thread' : kind
    const snap = await createSnapshot(admin, {
      clientId, userId, kind: snapKind,
      ref: { page, ...(tileKey ? { tileKey } : {}), params, variant },
      title,
      runId: typeof d.runId === 'string' ? d.runId : null,
      data,
    })
    const baseUrl = renderBaseUrl(await getBaseUrl())
    const { buffer, ms } = await renderArtifact({ baseUrl, snapshotId: snap.id, format, tileKey, style })
    const artifact = await storeArtifact(admin, { clientId, snapshotId: snap.id, format, tileKey, buffer, renderMs: ms })
    await logExport(admin, { clientId, userId, snapshotId: snap.id, artifactId: artifact.id, action: 'export', kind: snapKind, format, page, tileKey })
    const url = await signedArtifactUrl(admin, artifact, artifactFilename(title, artifact))
    return NextResponse.json({ artifactId: artifact.id, snapshotId: snap.id, url, ms, bytes: artifact.bytes })
  } catch (e) {
    console.error('[export] failed:', e)
    return NextResponse.json({ error: 'Couldn’t render this — try again.' }, { status: 500 })
  }
}
