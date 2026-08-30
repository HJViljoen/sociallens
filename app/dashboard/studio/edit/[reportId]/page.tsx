import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getSessionContext } from '@/lib/auth'
import { PageFrame, PageBar, BarPill } from '@/components/shell/page-grid'
import { PaneHeader, PaneBody } from '@/components/shell/master-list'
import { pageModule } from '@/components/pages/registry'
import { BuildButton } from '@/components/reports/build-button'
import { Outline } from '@/components/reports/outline'
import { ReportPreview } from '@/components/reports/preview'
import { loadReportSections } from '@/lib/reports/build'
import { studioCatalogue } from '@/lib/reports/catalogue'
import { deckSlides } from '@/lib/reports/compose'
import { composeFallbackCover } from '@/lib/reports/cover'
import { figuresFor, mergeFigures } from '@/lib/reports/figures'
import { methodOf, type ReportRow, type ReportSnapshotData } from '@/lib/reports/types'
import { REPORT_SLIDES_WARN } from '@/lib/config'

// The Report Studio (Stage 2, spec §4): outline left, the print deck right.
// The preview is server-rendered from the saved definition at the tenant's
// current data — the same components the PDF is printed from — and every
// outline change saves, then refreshes it. Building freezes what is shown.

export const dynamic = 'force-dynamic'

export default async function StudioPage({ params }: { params: Promise<{ reportId: string }> }) {
  const { reportId } = await params
  const { supabase, clientId } = await getSessionContext()
  const [{ data: row }, { data: client }] = await Promise.all([
    supabase.from('reports').select('*').eq('id', reportId).eq('client_id', clientId).maybeSingle(),
    supabase.from('clients').select('company_name').eq('id', clientId).maybeSingle(),
  ])
  if (!row) notFound()
  const report = row as ReportRow
  const company = (client?.company_name as string | undefined) ?? ''

  const { sections, skipped } = await loadReportSections(supabase, clientId, report)
  const figures = mergeFigures(sections.map((s) => figuresFor(s.section.page, s.data)))
  const first = sections[0] ? methodOf(sections[0].data) : null
  const period = first?.period ?? 'This update'
  const title = report.cover.title?.trim() || report.title
  const data: ReportSnapshotData = {
    version: 1,
    reportId: report.id,
    title,
    audience: report.audience,
    company: first?.company || company,
    period,
    cover: composeFallbackCover({ title, register: report.cover.register ?? report.audience, company: first?.company || company, period, sectionTitles: sections.map((s) => s.title), figures }),
    figures,
    sections,
  }
  const slideCount = deckSlides(data, (p) => pageModule(p)).length

  return (
    <PageFrame className="min-h-0 flex-1">
      <PageBar title={report.title} context={`Report · ${sections.length} section${sections.length === 1 ? '' : 's'} · ${slideCount} slide${slideCount === 1 ? '' : 's'}`}>
        <Link href={`/dashboard/studio?item=${report.id}`}><BarPill>Back to the Studio</BarPill></Link>
        <BuildButton reportId={report.id} />
      </PageBar>
      <div className="flex min-h-0 flex-1 flex-col gap-3 md:h-[calc(100dvh_-_6.75rem)] md:flex-row">
        <section className="flex min-h-0 flex-col overflow-hidden rounded-lg bg-tile shadow-tile md:w-[380px] md:shrink-0">
          <PaneHeader title="Outline" meta={report.status === 'built' ? 'built' : 'draft'} />
          <PaneBody className="px-3 py-3">
            <Outline
              key={report.updated_at}
              reportId={report.id}
              title={report.title}
              audience={report.audience}
              reader={report.cover.reader ?? ''}
              sections={report.sections}
              catalogue={studioCatalogue()}
              skipped={skipped.map((s) => ({ sectionId: s.section.id, reason: s.reason }))}
              slideCount={slideCount}
              slidesWarn={REPORT_SLIDES_WARN}
            />
          </PaneBody>
        </section>
        <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg bg-tile shadow-tile">
          <PaneHeader title="Preview" />
          <PaneBody className="bg-inner p-4">
            {sections.length ? <ReportPreview data={data} /> : (
              <p className="px-2 py-6 text-[12.5px] text-muted-foreground">Nothing to show yet. Add a page on the left.</p>
            )}
          </PaneBody>
        </section>
      </div>
    </PageFrame>
  )
}
