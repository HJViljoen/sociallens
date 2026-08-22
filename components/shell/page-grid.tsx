import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

// The one-screen frame. Inside the app shell's <main> (h-dvh minus the 48px
// header, 24px padding) the page is a flex column: PageBar on top, the grid
// filling whatever height is left. On ≥xl the grid is 12 columns × 6 equal
// rows and never scrolls the page — tiles clamp their own content. Below xl
// it becomes a single column of tiles and the page scrolls like before.

export function PageFrame({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('flex flex-col gap-3 xl:h-[calc(100dvh-6rem)] xl:min-h-0', className)}>
      {children}
    </div>
  )
}

export function PageGrid({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('grid grid-cols-1 gap-4 xl:min-h-0 xl:flex-1 xl:grid-cols-12 xl:grid-rows-6', className)}>
      {children}
    </div>
  )
}

/** Page title · context · right-hand controls, in one slim row under the
 *  shell header. Replaces the old full-width hero band on grid pages. */
export function PageBar({
  title, context, children,
}: { title: string; context?: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex h-8 shrink-0 items-center gap-3">
      <h1 className="text-[14px] font-semibold tracking-[-0.005em]">{title}</h1>
      {context && <span className="truncate text-[12px] text-muted-foreground">{context}</span>}
      {children && <div className="ml-auto flex shrink-0 items-center gap-2">{children}</div>}
    </div>
  )
}

/** A quiet pill control for the page bar (a link or a static label). */
export function BarPill({ children, active = false, className }: { children: ReactNode; active?: boolean; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex h-[26px] items-center gap-1.5 rounded-full px-2.5 text-[12px] font-medium',
        active ? 'bg-sidebar-accent text-primary' : 'bg-tile/80 text-[#3F4B44] ring-1 ring-border',
        className,
      )}
    >
      {children}
    </span>
  )
}
