import { MethodNote, type MethodNoteData } from '@/components/print/method-note'
import { audienceLabel, substituteFigures } from '@/lib/reports/cover'
import type { ReportSnapshotData } from '@/lib/reports/types'

// The cover (Report Studio, Stage 2): the report's title, who it is for, and a
// few sentences in that reader's register with every number written in by
// code from the frozen figure table. Same slide box as every other page; the
// method note of the first section as its footer, so even the cover says
// where the numbers come from.
export function CoverSlide({ data, page, pages, method }: { data: ReportSnapshotData; page: number; pages: number; method: MethodNoteData | null }) {
  const parts = substituteFigures(data.cover.body, data.figures)
  return (
    <section className="vb-slide">
      <header className="flex shrink-0 items-baseline justify-between gap-4">
        <span className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-muted-foreground">Prepared for {audienceLabel(data.cover.register)}</span>
        <span className="shrink-0 font-mono text-[10.5px] text-muted-foreground">{data.company} · {data.period}</span>
      </header>
      <div className="vb-slide-body">
        <div className="flex h-full flex-col justify-center gap-7 px-[6%]">
          <h1 className="max-w-[18ch] text-[44px] font-semibold leading-[1.08] tracking-[-0.02em] text-foreground [text-wrap:balance]">{data.cover.title}</h1>
          <p className="max-w-[62ch] text-[17px] leading-[1.55] text-secondary-foreground">
            {parts.map((p, i) => ('text' in p ? <span key={i}>{p.text}</span> : <strong key={i} className="font-semibold text-foreground">{p.figure}</strong>))}
          </p>
          <p className="font-mono text-[11px] text-muted-foreground">
            {data.sections.length} {data.sections.length === 1 ? 'section' : 'sections'} · {pages - 1} {pages - 1 === 1 ? 'page' : 'pages'} follow · Prepared by {data.company} · with Verbatim
          </p>
        </div>
      </div>
      <footer className="flex shrink-0 items-baseline justify-between gap-4 border-t border-border/70 pt-1.5">
        <div className="min-w-0 flex-1">{method ? <MethodNote data={method} /> : <span />}</div>
        <span className="shrink-0 font-mono text-[9.5px] text-muted-foreground">{page} / {pages}</span>
      </footer>
    </section>
  )
}
