import Link from 'next/link'
import { PageFrame, PageBar, BarPill } from '@/components/shell/page-grid'
import { DocumentBuildControl } from '@/components/documents/build-control'
import { DocumentEditor } from '@/components/documents/document-editor'
import { EditorLayout } from '@/components/documents/editor-layout'
import { SettingsPane } from '@/components/documents/settings-pane'
import { DocumentDeck } from '@/components/print/document-deck'
import { createAdminClient } from '@/lib/supabase-admin'
import { hydrateSnapshot, loadSnapshot, loadSnapshotWorkings } from '@/lib/snapshots'
import { applyEdits, loadEdits } from '@/lib/reports/documents/edits'
import { documentSettings, isDocumentData, type DocumentWorkings } from '@/lib/reports/documents/types'
import { documentTemplate } from '@/lib/reports/documents/templates'
import { BUILD_ACTIVE, type ReportRow } from '@/lib/reports/types'
import { latestBuild } from '@/lib/reports/documents/builds'
import { BUILD_PHASE_WORDS } from '@/lib/reports/documents/builds'

// The document editor (T8c, 2026-08-31): settings on the left, the built
// pages on the right, editable in place, the workings beside them on
// request. Before the first build the page says so and offers Build.

const fmtWhen = (iso: string) => new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

export async function DocumentStudioPage({ report, clientId }: { report: ReportRow; clientId: string }) {
  const admin = createAdminClient()
  const template = documentTemplate(report.template_key)
  const settings = documentSettings(report.settings)
  const [{ data: cfg }, build, snapshot] = await Promise.all([
    admin.from('tracking_configs').select('competitor_names').eq('client_id', clientId).maybeSingle(),
    latestBuild(admin, report.id),
    report.latest_snapshot_id ? loadSnapshot(admin, report.latest_snapshot_id) : Promise.resolve(null),
  ])
  const tracked = ((cfg?.competitor_names ?? []) as string[]).filter(Boolean)
  const inFlight = build && BUILD_ACTIVE.includes(build.status) ? { id: build.id, status: build.status, startedAt: build.started_at } : null

  let editor: React.ReactNode = null
  if (snapshot && snapshot.client_id === clientId) {
    const raw = await hydrateSnapshot(admin, snapshot)
    if (isDocumentData(raw)) {
      const [edits, workings] = await Promise.all([
        loadEdits(admin, snapshot.id),
        // loadSnapshotWorkings already resolves the quote refs live.
        loadSnapshotWorkings<DocumentWorkings>(admin, snapshot.id, clientId),
      ])
      const data = applyEdits(raw, edits)
      const built = new Date(data.generatedAt)
      const date = Number.isNaN(built.getTime()) ? undefined : built.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
      editor = (
        <DocumentEditor key={snapshot.id} snapshotId={snapshot.id} data={data} workings={workings} editedIds={edits.map((e) => e.block_id)}
          deck={<DocumentDeck data={data} date={date} />} />
      )
    }
  }

  const pageCount = snapshot && isDocumentData(snapshot.data) ? snapshot.data.pages.length + 1 : null
  return (
    <PageFrame className="min-h-0 flex-1">
      <PageBar title={report.title} context={`Written report · ${template?.name ?? 'document'}${pageCount ? ` · ${pageCount} pages` : ''}${build ? ` · ${build.status === 'done' ? `built ${fmtWhen(build.finished_at ?? build.started_at)}` : BUILD_PHASE_WORDS[build.status].toLowerCase()}` : ''}`}>
        <Link href={`/dashboard/studio?item=${report.id}`}><BarPill>Back to the Studio</BarPill></Link>
        <DocumentBuildControl reportId={report.id} inFlight={inFlight} />
      </PageBar>
      <EditorLayout
        settings={<SettingsPane reportId={report.id} title={report.title} reader={report.cover?.reader ?? ''} settings={settings} tracked={tracked} />}
        page={editor ?? (
          <div className="flex flex-1 flex-col items-start justify-center gap-3 px-8">
            <p className="text-[14px] font-medium">{inFlight ? 'Writing the first draft.' : 'Build to write the first draft.'}</p>
            <p className="max-w-[48ch] text-[12.5px] text-muted-foreground">{template?.description ?? ''} A build reads the update, asks the data, writes for its reader and prints the PDF; three to five minutes. Then every block on the page can be edited here before it goes out.</p>
            {build?.status === 'failed' && build.error && <p className="text-[12.5px] text-negative">The last build failed: {build.error}</p>}
          </div>
        )}
      />
    </PageFrame>
  )
}
