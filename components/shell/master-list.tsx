import type { ReactNode } from 'react'
import Link from 'next/link'
import { cn } from '@/lib/utils'

// Server-renderable pieces of a master-detail page (see master-detail.tsx).
// The rail lists groups with counts; the list holds rows; the detail pane
// shows the selected item. Active state is derived on the server from the
// URL, so nothing here needs client JS.

/** Pane header: a title, an optional mono meta on the right, and controls below. */
export function PaneHeader({ title, meta, children, className }: { title: ReactNode; meta?: ReactNode; children?: ReactNode; className?: string }) {
  return (
    <header className={cn('flex shrink-0 flex-col gap-2 border-b border-border/70 px-4 pt-3.5 pb-3', className)}>
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="shrink-0 text-[10.5px] font-semibold uppercase tracking-[0.06em] text-secondary-foreground">{title}</h2>
        {meta && <span className="min-w-0 truncate font-mono text-[11px] text-muted-foreground">{meta}</span>}
      </div>
      {children}
    </header>
  )
}

/** The scrolling body of a pane. */
export function PaneBody({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('min-h-0 flex-1 overflow-y-auto', className)}>{children}</div>
}

/** A group in the rail: mono eyebrow + its links. */
export function RailGroup({ label, children }: { label?: ReactNode; children: ReactNode }) {
  return (
    <div className="px-2 py-2">
      {label && <p className="px-2 pb-1 font-mono text-[10px] uppercase tracking-[0.08em] text-muted-foreground/80">{label}</p>}
      <ul className="flex flex-col gap-px">{children}</ul>
    </div>
  )
}

/** One rail entry: label · count, active = weight + inner tint. */
export function RailLink({ href, active = false, count, children }: { href: string; active?: boolean; count?: number | string | null; children: ReactNode }) {
  return (
    <li>
      <Link
        href={href}
        aria-current={active ? 'page' : undefined}
        className={cn(
          'flex items-center gap-2 rounded-[4px] px-2 py-1.5 text-[12.5px] transition-colors',
          active ? 'bg-inner font-semibold text-foreground' : 'text-secondary-foreground hover:bg-inner hover:text-foreground',
        )}
      >
        <span className="min-w-0 flex-1 truncate">{children}</span>
        {count != null && <span className="font-mono text-[11px] tabular-nums text-muted-foreground">{count}</span>}
      </Link>
    </li>
  )
}

/** Segmented filter for a list header: links, one active. */
export function Segmented({ items }: { items: { href: string; label: ReactNode; active?: boolean; count?: number }[] }) {
  return (
    <div className="flex flex-wrap gap-1">
      {items.map((it, i) => (
        <Link
          key={i}
          href={it.href}
          aria-current={it.active ? 'true' : undefined}
          className={cn(
            'inline-flex h-6 items-center gap-1 rounded-full px-2.5 text-[11.5px] font-medium transition-colors',
            it.active ? 'bg-foreground text-tile' : 'bg-inner text-secondary-foreground hover:text-foreground',
          )}
        >
          {it.label}
          {it.count != null && <span className={cn('font-mono text-[10.5px] tabular-nums', it.active ? 'text-tile/80' : 'text-muted-foreground')}>{it.count}</span>}
        </Link>
      ))}
    </div>
  )
}

/** A list row: an inner block (nesting level 2) that links to ?item=. `search`
 *  is the text a ListSearch can match against. */
export function ListRow({
  href, active = false, search, children, className,
}: { href: string; active?: boolean; search?: string; children: ReactNode; className?: string }) {
  return (
    <li data-search={search?.toLowerCase()} className="px-2 first:pt-2 last:pb-2">
      <Link
        href={href}
        scroll={false}
        aria-current={active ? 'true' : undefined}
        className={cn(
          'block rounded-[4px] px-3 py-2.5 transition-colors',
          active ? 'bg-inner ring-1 ring-border' : 'hover:bg-inner',
          className,
        )}
      >
        {children}
      </Link>
    </li>
  )
}

/** The list container — rows are ListRow children. */
export function ListRows({ children, className }: { children: ReactNode; className?: string }) {
  return <ul className={cn('flex flex-col gap-1', className)}>{children}</ul>
}

/** The honest empty line inside a pane. */
export function PaneEmpty({ children }: { children: ReactNode }) {
  return <p className="px-4 py-6 text-[12px] text-muted-foreground">{children}</p>
}

/** Detail header: eyebrow (kind), title, one meta line. */
export function DetailHeader({ eyebrow, title, meta, children }: { eyebrow?: ReactNode; title: ReactNode; meta?: ReactNode; children?: ReactNode }) {
  return (
    <header className="shrink-0 border-b border-border/70 px-5 pt-4 pb-3.5">
      {eyebrow && <p className="mb-1 text-[10.5px] font-semibold uppercase tracking-[0.06em] text-secondary-foreground">{eyebrow}</p>}
      <h3 className="text-[15px] font-semibold leading-[1.3] tracking-[-0.005em] [text-wrap:pretty]">{title}</h3>
      {meta && <p className="mt-1 font-mono text-[11px] text-muted-foreground">{meta}</p>}
      {children}
    </header>
  )
}

/** A block of the detail pane with a small eyebrow. */
export function DetailSection({ label, children, className }: { label?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn('px-5 py-3.5', className)}>
      {label && <p className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">{label}</p>}
      {children}
    </section>
  )
}

/** A verbatim quote in the house style: serif, mono attribution. */
export function Verbatim({ quote, cite }: { quote: string; cite?: ReactNode }) {
  return (
    <blockquote className="border-l-2 border-border pl-3">
      <p className="font-serif text-[13.5px] leading-[1.45] text-foreground">“{quote}”</p>
      {cite && <footer className="mt-1 font-mono text-[10.5px] text-muted-foreground">{cite}</footer>}
    </blockquote>
  )
}
