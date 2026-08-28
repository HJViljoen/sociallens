import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

// The page frame. Inside the app shell's <main> (h-dvh, 24px padding) the page
// is a flex column: PageBar on top, then the grid. On ≥xl the grid is 12
// columns; rows are 116px units and a tile spans as many as it asks for. The
// 2026-08-22 rule that every page must fit one screen is retired (MASTER rule
// 7, 2026-08-28): the grid grows with its content and the page scrolls when it
// has to — whether a given page fits one screen is that page's own judgment.
// Below xl the grid becomes a single column of tiles.

export function PageFrame({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('flex flex-col gap-3', className)}>
      {children}
    </div>
  )
}

export function PageGrid({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('grid grid-cols-1 gap-4 xl:grid-cols-12 xl:auto-rows-[116px]', className)}>
      {children}
    </div>
  )
}

/** Page title · context · right-hand controls, in one slim row at the top of
 *  the page. `subtitle` (optional) is a one-line reading under the title —
 *  component-map §1: orientation and actions in one place. */
export function PageBar({
  title, context, subtitle, children,
}: { title: string; context?: ReactNode; subtitle?: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex shrink-0 flex-col gap-0.5">
      <div className="flex h-8 items-center gap-3">
        <h1 className="text-[17px] font-semibold tracking-[-0.01em]">{title}</h1>
        {context && <span className="truncate font-mono text-[11.5px] text-muted-foreground">{context}</span>}
        {children && <div className="ml-auto flex shrink-0 items-center gap-2">{children}</div>}
      </div>
      {subtitle && <p className="text-[12.5px] text-muted-foreground">{subtitle}</p>}
    </div>
  )
}

/** A quiet pill control for the page bar (a link or a static label). Green
 *  only when it is the page's primary action (rule 1). */
export function BarPill({ children, active = false, primary = false, className }: { children: ReactNode; active?: boolean; primary?: boolean; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex h-[26px] items-center gap-1.5 rounded-full px-2.5 text-[12px] font-medium transition-colors',
        primary
          ? 'bg-primary text-primary-foreground hover:bg-accent-foreground'
          : active
            ? 'bg-inner text-foreground ring-1 ring-border'
            : 'bg-tile text-secondary-foreground ring-1 ring-border hover:bg-inner',
        className,
      )}
    >
      {children}
    </span>
  )
}
