import { Fragment } from 'react'
import { pageModule } from '@/components/pages/registry'
import { MethodNote } from '@/components/print/method-note'
import { LinkGuard } from '@/components/share/link-guard'
import { sectionSlides } from '@/lib/reports/compose'
import { audienceLabel, substituteFigures } from '@/lib/reports/cover'
import { methodOf, type ReportSnapshotData } from '@/lib/reports/types'

// A shared report, read live from its snapshot (D5): the cover, then every
// section as its APP-mode tiles — the evidence popovers work, which is what
// a link is for and a PDF cannot do. Client-led: the client's name leads,
// Verbatim is the provenance line and the one link at the foot.
export function ShareShell({ data, appUrl }: { data: ReportSnapshotData; appUrl: string }) {
  const parts = substituteFigures(data.cover.body, data.figures)
  return (
    <LinkGuard>
      <div className="mx-auto flex w-full max-w-[1216px] flex-col gap-8 px-4 py-8 md:px-6">
        <header className="flex flex-col gap-5 rounded-lg bg-tile px-6 py-7 shadow-tile md:px-10 md:py-10">
          <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
            <p className="font-mono text-[11px] uppercase tracking-[0.08em] text-muted-foreground">Prepared by {data.company} · for {audienceLabel(data.cover.register)}</p>
            <p className="font-mono text-[11px] text-muted-foreground">{data.period}</p>
          </div>
          <h1 className="max-w-[22ch] text-[34px] font-semibold leading-[1.1] tracking-[-0.02em] [text-wrap:balance] md:text-[42px]">{data.cover.title}</h1>
          <p className="max-w-[68ch] text-[16px] leading-[1.6] text-secondary-foreground">
            {parts.map((p, i) => ('text' in p ? <span key={i}>{p.text}</span> : <strong key={i} className="font-semibold text-foreground">{p.figure}</strong>))}
          </p>
          <p className="font-mono text-[11px] text-muted-foreground">{data.sections.length} section{data.sections.length === 1 ? '' : 's'} · figures frozen when this was built · quoted voices read live, so a withdrawn comment never travels</p>
        </header>

        {data.sections.map((sec, i) => {
          const mod = pageModule(sec.section.page)
          if (!mod) return null
          const slides = sectionSlides(mod, sec.section, sec.data)
          const method = methodOf(sec.data)
          return (
            <section key={sec.section.id} className="flex flex-col gap-3" aria-labelledby={`sec-${i}`}>
              <div className="flex flex-col gap-1 px-1">
                <h2 id={`sec-${i}`} className="text-[17px] font-semibold tracking-[-0.01em]">{i + 1}. {sec.title.split(' · ')[0]}</h2>
                {sec.section.framing && <p className="font-serif text-[14px] italic text-secondary-foreground">{sec.section.framing}</p>}
              </div>
              {/* Grid slides are tiles and sit in the app grid; a single-layout
                  slide (the executive brief, a selected item, a per-item
                  slide) is a full-width pane on paper and gets one here too —
                  dropped into the grid it would spill across the columns. */}
              {slides.map((slide, j) =>
                slide.layout === 'grid' ? (
                  // The app grid with rows that can grow: on a page some tiles sit
                  // outside the grid and take their content's height (Market's
                  // short read); here every tile is a grid item.
                  <div key={j} className="grid grid-cols-1 gap-4 xl:grid-cols-12 xl:auto-rows-[minmax(116px,auto)]">
                    {slide.keys.map((k) => <Fragment key={k}>{mod.renderables[k]?.render(sec.data, 'app') ?? null}</Fragment>)}
                  </div>
                ) : (
                  <div key={j} className="flex flex-col gap-4 rounded-lg bg-tile px-6 py-5 shadow-tile">
                    <p className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-muted-foreground">{slide.title}</p>
                    {slide.keys.map((k) => <Fragment key={k}>{mod.renderables[k]?.render(sec.data, 'app') ?? null}</Fragment>)}
                  </div>
                ),
              )}
              {method && <div className="px-1"><MethodNote data={method} /></div>}
            </section>
          )
        })}

        <footer className="flex flex-wrap items-baseline justify-between gap-3 border-t border-border/70 px-1 pt-4 font-mono text-[11px] text-muted-foreground">
          <span>Prepared by {data.company} · with Verbatim</span>
          <a href={appUrl} className="underline underline-offset-2 hover:text-foreground">Verbatim — what your customers say, with the receipts</a>
        </footer>
      </div>
    </LinkGuard>
  )
}
