import { LinkGuard } from '@/components/share/link-guard'
import { DocumentDeck } from '@/components/print/document-deck'
import { FitWidth } from '@/components/reports/fit-width'
import { audienceLabel } from '@/lib/reports/cover'
import type { DocumentSnapshotData } from '@/lib/reports/documents/types'

// A shared DOCUMENT (2026-08-31): the written pages exactly as printed, one
// under the other, scaled to the reader's screen. A document carries no
// evidence on paper by design, so there are no popovers to keep alive here;
// the value of the link is that it opens anywhere and never travels stale
// (the operator's edits and a withdrawn voice both show on the next open).
// Client-led, as the arranged share: the client's name leads, Verbatim is
// the provenance line and the one link at the foot.
export function DocumentShareShell({ data, appUrl }: { data: DocumentSnapshotData; appUrl: string }) {
  const built = new Date(data.generatedAt)
  const date = Number.isNaN(built.getTime()) ? undefined : built.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
  return (
    <LinkGuard>
      <div className="mx-auto flex w-full max-w-[1216px] flex-col gap-6 px-4 py-8 md:px-6">
        <header className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 px-1">
          <p className="font-mono text-[11px] uppercase tracking-[0.08em] text-muted-foreground">Prepared by {data.company} · for {audienceLabel(data.audience)}</p>
          <p className="font-mono text-[11px] text-muted-foreground">{data.period} · {data.pages.length + 1} pages</p>
        </header>
        <FitWidth base={1123}>
          <div className="vb-print vb-preview flex flex-col gap-6" data-print-variant="b">
            <DocumentDeck data={data} date={date} />
          </div>
        </FitWidth>
        <footer className="flex flex-wrap items-baseline justify-between gap-3 border-t border-border/70 px-1 pt-4 font-mono text-[11px] text-muted-foreground">
          <span>Prepared by {data.company} · with Verbatim</span>
          <a href={appUrl} className="underline underline-offset-2 hover:text-foreground">Verbatim, what your customers say, with the receipts</a>
        </footer>
      </div>
    </LinkGuard>
  )
}
