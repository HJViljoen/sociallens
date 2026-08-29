import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

// One landscape slide (297 × 167 mm, one section per page — Heinrich,
// 2026-08-29). Header: the section on the left, the page's context on the
// right. Body: the 12-column print grid or a single pane. Footer: the method
// note, on every slide, because the reader of a PDF has no drawer to open.

export interface SlideChrome {
  /** Page · client · date — mono, right-aligned in the header. */
  context: ReactNode
  /** The method note (components/print/method-note.tsx), rendered on every slide. */
  footer: ReactNode
}

export function Slide({
  title, chrome, page, pages, layout = 'grid', note, children, className,
}: {
  title: ReactNode
  chrome: SlideChrome
  page: number
  pages: number
  layout?: 'grid' | 'single'
  /** The operator's one line of framing (Report Studio) — a serif note under
   *  the title on a section's first slide; the body gives up its height. */
  note?: string | null
  children: ReactNode
  className?: string
}) {
  const hasNote = Boolean(note && note.trim())
  return (
    <section className={cn('vb-slide', className)} data-note={hasNote ? '' : undefined}>
      <header className="flex shrink-0 items-baseline justify-between gap-4">
        <h1 className="truncate text-[15px] font-semibold tracking-[-0.01em] text-foreground">{title}</h1>
        <span className="shrink-0 font-mono text-[10.5px] text-muted-foreground">{chrome.context}</span>
      </header>
      {hasNote && (
        <p className="vb-slide-note truncate font-serif text-[12.5px] italic leading-[18px] text-secondary-foreground">{note}</p>
      )}
      <div className="vb-slide-body">
        {layout === 'grid' ? (
          <div className="vb-print-grid">{children}</div>
        ) : (
          <div className="flex h-full min-h-0 flex-col">{children}</div>
        )}
      </div>
      <footer className="flex shrink-0 items-baseline justify-between gap-4 border-t border-border/70 pt-1.5">
        <div className="min-w-0 flex-1">{chrome.footer}</div>
        <span className="shrink-0 font-mono text-[9.5px] text-muted-foreground">{page} / {pages}</span>
      </footer>
    </section>
  )
}
