import { Fragment } from 'react'
import { pageModule } from '@/components/pages/registry'
import { CoverSlide } from '@/components/print/cover-slide'
import { Slide } from '@/components/print/slide'
import { catalogueTitle } from '@/lib/reports/catalogue'
import { deckSlides } from '@/lib/reports/compose'
import type { ReportSnapshotData } from '@/lib/reports/types'

// A report's deck from its (hydrated) snapshot data: the cover, then every
// section's slides in the order the operator set, numbered once across the
// report, the framing on a section's first slide. Rendered inside a PrintRoot
// by /render/<snapshot> for the PDF and by the Studio's preview: one
// component, one look.
//
// Chrome on a report's pages (Heinrich, 2026-08-30): the page's name top
// right, and at the foot only "Created by {company} with Verbatim", the date
// and the page number. The method note stays on single-page exports.

const fmtDate = (d: Date) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })

export function DeckFooter({ company, date }: { company: string; date: string }) {
  return (
    <p className="truncate font-mono text-[9.5px] leading-[1.35] text-muted-foreground">
      <span className="text-secondary-foreground">Created by {company} with Verbatim</span>
      <span aria-hidden> · </span>
      <span>{date}</span>
    </p>
  )
}

export function ReportDeck({ data, date = fmtDate(new Date()) }: { data: ReportSnapshotData; date?: string }) {
  const deck = deckSlides(data, (p) => pageModule(p))
  const pages = deck.length
  return (
    <>
      {deck.map((s) => {
        if (s.kind === 'cover') return <CoverSlide key="cover" data={data} pages={pages} />
        const sec = data.sections[s.sectionIndex]
        const mod = pageModule(sec.section.page)
        if (!mod) return null
        const chrome = { context: catalogueTitle(sec.section.page), footer: <DeckFooter company={data.company} date={date} /> }
        return (
          <Slide
            key={`${sec.section.id}-${s.n}`}
            title={s.slide.title}
            chrome={chrome}
            page={s.n}
            pages={pages}
            layout={s.slide.layout === 'grid' ? 'grid' : 'single'}
            note={s.first ? sec.section.framing : null}
          >
            {s.slide.keys.map((k) => <Fragment key={k}>{mod.renderables[k]?.render(sec.data, 'print') ?? null}</Fragment>)}
          </Slide>
        )
      })}
    </>
  )
}
