import { getSessionContext } from '@/lib/auth'
import { PageFrame, PageBar } from '@/components/shell/page-grid'
import { MasterDetail } from '@/components/shell/master-detail'
import { PaneHeader, PaneBody, RailGroup, RailLink, ListRows, ListRow, PaneEmpty, DetailHeader, DetailSection } from '@/components/shell/master-list'
import { ListSearch } from '@/components/shell/list-search'

// Reports — "what changed, week by week": the archive of every periodic
// report, as a page inside the page (component-map §2): months in the rail,
// reports in the list, the stored report itself in the detail pane. The
// stored HTML is a self-contained email document, so it renders in a
// sandboxed iframe rather than being injected into the page; a
// <base target="_blank"> makes its deep links open in a full tab.
//
// Exports (Reports & Exports Stage 1, 2026-08-29): everything anyone on the
// workspace has exported — a page, a tile, an agent thread — listed under
// its own rail group so it can be found again. The Studio replaces this
// group in Stage 2.

interface WeeklyReport {
  id: string
  subject: string | null
  week_start: string | null
  week_end: string | null
  sent_to: string[] | null
  sent_at: string | null
}

interface ExportRow {
  id: string
  format: 'pdf' | 'png'
  tile_key: string | null
  bytes: number
  version: number
  stale: boolean
  rendered_at: string
  report_snapshots: { title: string; kind: string; ref: { page?: string; variant?: string } } | null
}

const BASE = '/dashboard/reports'
const fmtDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : null
const fmtWhen = (iso: string) => new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
const fmtBytes = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1000))} KB`)
const monthKey = (iso: string | null) => (iso ? iso.slice(0, 7) : 'undated')
const monthLabel = (key: string) => (key === 'undated' ? 'Undated' : new Date(`${key}-01T00:00:00Z`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' }))
const href = (month?: string | null, item?: string | null, group?: 'exports' | null) => {
  const q = new URLSearchParams()
  if (group) q.set('group', group)
  if (month) q.set('month', month)
  if (item) q.set('item', item)
  const qs = q.toString()
  return qs ? `${BASE}?${qs}` : BASE
}
const exportKindLabel = (e: ExportRow) => {
  const k = e.report_snapshots?.kind
  if (k === 'agent_thread') return 'Agent thread'
  if (k === 'tile' || e.tile_key) return 'Tile'
  return e.report_snapshots?.ref?.variant === 'full' ? 'Page, everything' : 'Page'
}

export default async function ReportsPage({ searchParams }: { searchParams?: Promise<{ month?: string; item?: string; group?: string }> }) {
  const sp = (await searchParams) ?? {}
  // Auth + tenant via the RLS-enforced session client. See lib/auth.ts.
  const { supabase, clientId } = await getSessionContext()

  const [{ data }, { data: exportData }] = await Promise.all([
    supabase.from('weekly_reports')
      .select('id, subject, week_start, week_end, sent_to, sent_at')
      .eq('client_id', clientId).order('week_end', { ascending: false }),
    supabase.from('artifacts')
      .select('id, format, tile_key, bytes, version, stale, rendered_at, report_snapshots(title, kind, ref)')
      .eq('client_id', clientId).order('rendered_at', { ascending: false }).limit(200),
  ])
  const reports = (data ?? []) as WeeklyReport[]
  const exports = (exportData ?? []) as unknown as ExportRow[]
  const showExports = sp.group === 'exports'

  const months = new Map<string, number>()
  for (const r of reports) months.set(monthKey(r.week_end), (months.get(monthKey(r.week_end)) ?? 0) + 1)
  const month = !showExports && sp.month && months.has(sp.month) ? sp.month : null
  const shown = month ? reports.filter((r) => monthKey(r.week_end) === month) : reports
  const itemId = !showExports && sp.item && shown.some((r) => r.id === sp.item) ? sp.item : (showExports ? null : shown[0]?.id ?? null)
  const selected = itemId ? shown.find((r) => r.id === itemId) ?? null : null
  const exportId = showExports ? (sp.item && exports.some((e) => e.id === sp.item) ? sp.item : exports[0]?.id ?? null) : null
  const selectedExport = exportId ? exports.find((e) => e.id === exportId) ?? null : null

  // Only the selected report's HTML is read — the list carries none.
  let html: string | null = null
  if (selected) {
    const { data: row } = await supabase.from('weekly_reports').select('html_content').eq('client_id', clientId).eq('id', selected.id).maybeSingle()
    html = row?.html_content ? String(row.html_content).replace(/<head>/i, '<head><base target="_blank">') : null
  }

  const rail = (
    <>
      <PaneHeader title="Archive" meta={reports.length > 0 ? `${reports.length} report${reports.length === 1 ? '' : 's'}` : undefined} />
      <PaneBody>
        <RailGroup>
          <RailLink href={href()} active={!month && !showExports} count={reports.length}>All reports</RailLink>
        </RailGroup>
        {months.size > 0 && (
          <RailGroup label="By month">
            {[...months.entries()].map(([key, n]) => (
              <RailLink key={key} href={href(key)} active={month === key} count={n}>{monthLabel(key)}</RailLink>
            ))}
          </RailGroup>
        )}
        <RailGroup label="Exports">
          <RailLink href={href(null, null, 'exports')} active={showExports} count={exports.length}>Everything exported</RailLink>
        </RailGroup>
      </PaneBody>
    </>
  )

  const LIST_ID = 'reports-list'
  const list = showExports ? (
    <>
      <PaneHeader title="Exports" meta={exports.length > 0 ? 'newest first' : undefined}>
        {exports.length > 5 && <ListSearch scope={LIST_ID} placeholder="Search exports…" />}
      </PaneHeader>
      <PaneBody>
        <div id={LIST_ID}>
          {exports.length > 0 ? (
            <ListRows>
              {exports.map((e) => (
                <ListRow key={e.id} href={href(null, e.id, 'exports')} active={e.id === exportId} search={`${e.report_snapshots?.title ?? ''} ${e.format}`}>
                  <p className="line-clamp-2 text-[13px] font-semibold leading-[1.3]">{e.report_snapshots?.title ?? 'Export'}</p>
                  <p className="mt-0.5 font-mono text-[10.5px] text-muted-foreground">
                    {exportKindLabel(e)} · {e.format.toUpperCase()} · {fmtWhen(e.rendered_at)}{e.stale ? ' · re-renders on download' : ''}
                  </p>
                </ListRow>
              ))}
            </ListRows>
          ) : (
            <PaneEmpty>Nothing exported yet. Every page and tile has an export control; what you export lands here.</PaneEmpty>
          )}
        </div>
      </PaneBody>
    </>
  ) : (
    <>
      <PaneHeader title={month ? monthLabel(month) : 'All reports'} meta={shown.length > 0 ? 'newest first' : undefined}>
        {shown.length > 5 && <ListSearch scope={LIST_ID} placeholder="Search reports…" />}
      </PaneHeader>
      <PaneBody>
        <div id={LIST_ID}>
          {shown.length > 0 ? (
            <ListRows>
              {shown.map((r) => (
                <ListRow key={r.id} href={href(month, r.id)} active={r.id === itemId} search={`${r.subject ?? ''} ${fmtDate(r.week_end) ?? ''}`}>
                  <p className="line-clamp-2 text-[13px] font-semibold leading-[1.3]">{r.subject ?? 'Report'}</p>
                  <p className="mt-0.5 font-mono text-[10.5px] text-muted-foreground">
                    {fmtDate(r.week_start)} – {fmtDate(r.week_end)} · {r.sent_at ? `emailed ${fmtDate(r.sent_at)}` : 'viewable here'}
                  </p>
                </ListRow>
              ))}
            </ListRows>
          ) : (
            <PaneEmpty>Your reports will appear here after each update — the first lands with your next one.</PaneEmpty>
          )}
        </div>
      </PaneBody>
    </>
  )

  const detail = showExports ? (
    selectedExport ? (
      <>
        <DetailHeader eyebrow={exportKindLabel(selectedExport)} title={selectedExport.report_snapshots?.title ?? 'Export'}
          meta={`${selectedExport.format.toUpperCase()} · ${fmtBytes(selectedExport.bytes)} · rendered ${fmtWhen(selectedExport.rendered_at)}${selectedExport.version > 1 ? ` · version ${selectedExport.version}` : ''}`} />
        <DetailSection>
          <a href={`/api/artifacts/${selectedExport.id}`} className="inline-flex h-[28px] items-center rounded-full bg-primary px-3 text-[12px] font-medium text-primary-foreground hover:bg-accent-foreground">
            Download {selectedExport.format.toUpperCase()}
          </a>
          {selectedExport.stale && (
            <p className="mt-3 text-[12px] text-muted-foreground">A voice in this export was withdrawn since it was made. Downloading renders it again from the same figures, without that voice.</p>
          )}
          <p className="mt-3 text-[12px] text-muted-foreground">
            The figures in an export are frozen at the moment it was made; the quoted voices are read live, so a withdrawn comment never travels.
          </p>
        </DetailSection>
      </>
    ) : (
      <PaneEmpty>Select an export to download it.</PaneEmpty>
    )
  ) : selected ? (
    <>
      <DetailHeader eyebrow={fmtDate(selected.week_end) ?? 'Report'} title={selected.subject ?? 'Report'}
        meta={`${fmtDate(selected.week_start)} – ${fmtDate(selected.week_end)}${selected.sent_at ? ` · emailed ${fmtDate(selected.sent_at)}${selected.sent_to?.length ? ` to ${selected.sent_to.length}` : ''}` : ' · stored, not emailed'}`} />
      {html ? (
        <iframe
          srcDoc={html}
          sandbox="allow-popups allow-popups-to-escape-sandbox"
          title={selected.subject ?? 'Report'}
          className="min-h-0 w-full flex-1 bg-tile max-md:h-[70vh]"
        />
      ) : (
        <PaneEmpty>This report has no stored content.</PaneEmpty>
      )}
    </>
  ) : (
    <PaneEmpty>Select a report to read it here.</PaneEmpty>
  )

  return (
    <PageFrame className="min-h-0 flex-1">
      <PageBar title="Reports" context="what changed, update by update" />
      <MasterDetail id="reports" rail={rail} list={list} detail={detail} />
    </PageFrame>
  )
}
