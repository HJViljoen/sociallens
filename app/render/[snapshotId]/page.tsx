import { notFound } from 'next/navigation'
import { Fragment } from 'react'
import { renderTokenSecret, verifyRenderToken } from '@/lib/render-token'
import { createAdminClient } from '@/lib/supabase-admin'
import { hydrateSnapshot, loadSnapshot } from '@/lib/snapshots'
import { pageModule } from '@/components/pages/registry'
import { PrintRoot, printStyleFrom } from '@/components/print/print-root'
import { Slide } from '@/components/print/slide'
import { PrintTile } from '@/components/print/print-tile'
import { MethodNote, type MethodNoteData } from '@/components/print/method-note'

// Print-mode HTML for one snapshot, fetched by the export route's headless
// Chrome. proxy.ts lets /render through without a session; the signed token
// is the gate (lib/render-token.ts) and it names exactly one snapshot.
//
// snapshot → resolveQuotes (the words come back live) → the page module's
// slides, each renderable in print mode. One section per slide; the method
// note on every slide. A tile export renders that one tile on its own.

export const dynamic = 'force-dynamic'

export default async function RenderPage({
  params, searchParams,
}: {
  params: Promise<{ snapshotId: string }>
  searchParams: Promise<{ t?: string; tile?: string; style?: string }>
}) {
  const [{ snapshotId }, sp] = await Promise.all([params, searchParams])
  const token = verifyRenderToken(sp.t, renderTokenSecret())
  if (!token || token.snapshotId !== snapshotId) notFound()

  const admin = createAdminClient()
  const row = await loadSnapshot(admin, snapshotId)
  if (!row) notFound()
  const style = printStyleFrom(sp.style)

  if (row.kind === 'page' || row.kind === 'tile' || row.kind === 'agent_thread') {
    const mod = row.ref.page ? pageModule(row.ref.page) : null
    if (!mod) notFound()
    const data = await hydrateSnapshot<{ method?: MethodNoteData }>(admin, row)
    // The token binds the tile (review B): a page token cannot be pointed at
    // an arbitrary tile through the query string.
    const tileKey = token.tileKey ?? row.ref.tileKey
    if (row.kind === 'tile' || tileKey) {
      const r = tileKey ? mod.renderables[tileKey] : null
      if (!r) notFound()
      return (
        <PrintRoot style={style}>
          <PrintTile>{r.render(data, 'print')}</PrintTile>
        </PrintRoot>
      )
    }
    const slides = mod.slides(data, row.ref.variant ?? 'default')
    const chrome = {
      context: mod.printContext ? mod.printContext(data) : row.title,
      footer: data.method ? <MethodNote data={data.method} /> : <span />,
    }
    return (
      <PrintRoot style={style}>
        {slides.map((s, i) => (
          <Slide key={i} title={s.title} chrome={chrome} page={i + 1} pages={slides.length} layout={s.layout === 'grid' ? 'grid' : 'single'}>
            {s.keys.map((k) => <Fragment key={k}>{mod.renderables[k]?.render(data, 'print') ?? null}</Fragment>)}
          </Slide>
        ))}
      </PrintRoot>
    )
  }

  notFound()
}
