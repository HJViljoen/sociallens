import { Fragment } from 'react'
import { pageModule } from '@/components/pages/registry'
import { CoverSlide } from '@/components/print/cover-slide'
import { MethodNote } from '@/components/print/method-note'
import { Slide } from '@/components/print/slide'
import { deckSlides } from '@/lib/reports/compose'
import { methodOf, type ReportSnapshotData } from '@/lib/reports/types'

// A report's deck from its (hydrated) snapshot data: the cover, then every
// section's slides in the order the operator set, numbered once across the
// report, each section's own method note in the footer and its framing on
// its first slide. Rendered inside a PrintRoot by /render/<snapshot> for the
// PDF and by the Studio's preview — one component, one look.
export function ReportDeck({ data }: { data: ReportSnapshotData }) {
  const deck = deckSlides(data, (p) => pageModule(p))
  const pages = deck.length
  const firstMethod = data.sections.length ? methodOf(data.sections[0].data) : null
  return (
    <>
      {deck.map((s) => {
        if (s.kind === 'cover') return <CoverSlide key="cover" data={data} page={1} pages={pages} method={firstMethod} />
        const sec = data.sections[s.sectionIndex]
        const mod = pageModule(sec.section.page)
        if (!mod) return null
        const method = methodOf(sec.data)
        const chrome = { context: sec.context, footer: method ? <MethodNote data={method} /> : <span /> }
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
