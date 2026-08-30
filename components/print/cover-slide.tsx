import type { ReportSnapshotData } from '@/lib/reports/types'

// The cover (Report Studio): the title, and how much follows. Nothing else on
// it (Heinrich, 2026-08-30): no register line, no company and date, no
// paragraph, no footer. The model-written cover text still travels in the
// snapshot for the email and the archive.
export function CoverSlide({ data, pages }: { data: ReportSnapshotData; pages: number }) {
  return (
    <section className="vb-slide">
      <div className="vb-slide-body">
        <div className="flex h-full flex-col justify-center gap-7 px-[6%]">
          <h1 className="max-w-[18ch] text-[44px] font-semibold leading-[1.08] tracking-[-0.02em] text-foreground [text-wrap:balance]">{data.cover.title}</h1>
          <p className="font-mono text-[11px] text-muted-foreground">
            {data.sections.length} {data.sections.length === 1 ? 'section' : 'sections'} · {pages} {pages === 1 ? 'page' : 'pages'}
          </p>
        </div>
      </div>
    </section>
  )
}
