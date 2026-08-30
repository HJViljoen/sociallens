import { notFound } from 'next/navigation'
import { Fragment } from 'react'
import { renderTokenSecret, verifyRenderToken } from '@/lib/render-token'
import { createAdminClient } from '@/lib/supabase-admin'
import { hydrateSnapshot, loadSnapshot } from '@/lib/snapshots'
import { pageModule } from '@/components/pages/registry'
import { PrintRoot, printStyleFrom } from '@/components/print/print-root'
import { Slide } from '@/components/print/slide'
import { PrintTile } from '@/components/print/print-tile'
import { ReportDeck } from '@/components/print/report-deck'
import { DocumentDeck } from '@/components/print/document-deck'
import { isDocumentData } from '@/lib/reports/documents/types'
import { applyEdits, loadEdits } from '@/lib/reports/documents/edits'
import type { ReportSnapshotData } from '@/lib/reports/types'
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

  // A report (Stage 2): several pages frozen under one snapshot — the deck
  // component composes them; hydration is the same walk as for a page.
  if (row.kind === 'report') {
    const data = await hydrateSnapshot<ReportSnapshotData>(admin, row)
    // A document (2026-08-31): written pages, no sections, no tiles. Its
    // workings were never selected, so nothing here can print them.
    if (isDocumentData(data)) {
      if (token.tileKey) notFound()
      // The operator's edits lie over the frozen pages (lib/reports/documents/edits.ts).
      const edits = await loadEdits(admin, snapshotId)
      return (
        <PrintRoot style={style}>
          <DocumentDeck data={applyEdits(data, edits)} />
        </PrintRoot>
      )
    }
    // One tile of one section on its own (Stage 3: the PNGs an email carries).
    // The token binds the tile; the first section of that page supplies it.
    if (token.tileKey) {
      const page = token.tileKey.split('.')[0]
      const section = data.sections.find((s) => s.section.page === page)
      const r = section ? pageModule(page)?.renderables[token.tileKey] : null
      if (!section || !r) notFound()
      return (
        <PrintRoot style={style}>
          <PrintTile>{r.render(section.data, 'print')}</PrintTile>
        </PrintRoot>
      )
    }
    return (
      <PrintRoot style={style}>
        <ReportDeck data={data} />
      </PrintRoot>
    )
  }

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
