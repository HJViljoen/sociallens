import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

// The one-screen grid's unit. Every tile has the same anatomy — eyebrow + meta
// on top, content, a footer that links deeper — so the pages read as one
// system even though each page composes its tiles differently. Tiles never
// scroll the page: they are fixed-height cells on ≥xl and clamp their own
// content (overflow hidden, min-h-0); below xl the grid stacks and scrolls.
//
// Class strings are written out in full (never interpolated) so Tailwind v4's
// scanner sees them — hence the lookup maps for spans.

const COL: Record<number, string> = {
  1: 'xl:col-span-1', 2: 'xl:col-span-2', 3: 'xl:col-span-3', 4: 'xl:col-span-4',
  5: 'xl:col-span-5', 6: 'xl:col-span-6', 7: 'xl:col-span-7', 8: 'xl:col-span-8',
  9: 'xl:col-span-9', 10: 'xl:col-span-10', 11: 'xl:col-span-11', 12: 'xl:col-span-12',
}
const ROW: Record<number, string> = {
  1: 'xl:row-span-1', 2: 'xl:row-span-2', 3: 'xl:row-span-3',
  4: 'xl:row-span-4', 5: 'xl:row-span-5', 6: 'xl:row-span-6',
}
// Stacked (sub-xl) heights roughly follow the row span so the page keeps its
// rhythm when it scrolls; a 1-row tile is at least one row unit tall.
const MIN_H: Record<number, string> = {
  1: 'min-h-[116px]', 2: 'min-h-[248px]', 3: 'min-h-[380px]',
  4: 'min-h-[512px]', 5: 'min-h-[644px]', 6: 'min-h-[776px]',
}

export type TileVariant = 'default' | 'hero' | 'warm' | 'strip'

export interface TileProps {
  /** Column span on the 12-column grid (≥xl). */
  col: number
  /** Row span on the 6-row grid (≥xl). */
  row: number
  variant?: TileVariant
  eyebrow?: ReactNode
  meta?: ReactNode
  /** Left side of the footer — usually a Link deeper. */
  footer?: ReactNode
  /** Right side of the footer — a quiet note. */
  footerNote?: ReactNode
  className?: string
  bodyClassName?: string
  children?: ReactNode
}

export function Tile({
  col, row, variant = 'default', eyebrow, meta, footer, footerNote, className, bodyClassName, children,
}: TileProps) {
  const isHero = variant === 'hero'
  const isStrip = variant === 'strip'
  return (
    <section
      className={cn(
        'relative flex min-h-0 flex-col overflow-hidden rounded-[10px] text-[12.5px] leading-[1.45]',
        COL[col] ?? 'xl:col-span-12',
        ROW[row] ?? 'xl:row-span-1',
        MIN_H[row] ?? 'min-h-[116px]',
        'xl:min-h-0',
        variant === 'default' && 'gap-2 bg-tile px-3.5 py-3 ring-1 ring-border/90 shadow-[0_1px_2px_rgba(18,42,31,0.05),0_10px_24px_-14px_rgba(18,42,31,0.22)]',
        variant === 'warm' && 'gap-2 bg-tile px-3.5 py-3 ring-1 ring-clay/45 shadow-[0_1px_2px_rgba(18,42,31,0.05),0_10px_24px_-14px_rgba(18,42,31,0.22)]',
        isHero && 'stat-hero gap-3 px-5 py-4 shadow-[0_1px_2px_rgba(18,42,31,0.10),0_18px_40px_-16px_rgba(18,42,31,0.45)]',
        isStrip && 'flex-row items-stretch divide-x divide-border/80 bg-tile p-0 ring-1 ring-border/90 shadow-[0_1px_2px_rgba(18,42,31,0.05),0_10px_24px_-14px_rgba(18,42,31,0.22)]',
        className,
      )}
    >
      {!isStrip && (eyebrow || meta) && (
        <header className="flex items-baseline justify-between gap-2">
          {eyebrow ? (
            <h2
              className={cn(
                'truncate text-[10.5px] font-semibold uppercase tracking-[0.07em]',
                isHero ? 'text-[#F5F1E6]/70' : 'text-[#6B756B]',
              )}
            >
              {eyebrow}
            </h2>
          ) : <span />}
          {meta && (
            <span className={cn('shrink-0 whitespace-nowrap text-[11px]', isHero ? 'text-[#F5F1E6]/60' : 'text-muted-foreground')}>
              {meta}
            </span>
          )}
        </header>
      )}
      {isStrip ? children : (
        <div className={cn('flex min-h-0 flex-1 flex-col gap-2', bodyClassName)}>{children}</div>
      )}
      {!isStrip && (footer || footerNote) && (
        <footer className={cn('mt-auto flex items-center justify-between gap-2 pt-1 text-[11px] font-medium', isHero ? 'text-[#DCE8DD]' : 'text-primary')}>
          <span className="min-w-0 truncate">{footer}</span>
          {footerNote && <span className={cn('shrink-0 font-normal', isHero ? 'text-[#F5F1E6]/60' : 'text-muted-foreground')}>{footerNote}</span>}
        </footer>
      )}
    </section>
  )
}

/** One cell of a strip tile — a counted receipt. */
export function StripCell({ eyebrow, children, className }: { eyebrow: ReactNode; children?: ReactNode; className?: string }) {
  return (
    <div className={cn('flex min-w-0 flex-1 flex-col gap-1 px-4 py-3', className)}>
      <h2 className="truncate text-[10.5px] font-semibold uppercase tracking-[0.07em] text-[#6B756B]">{eyebrow}</h2>
      {children}
    </div>
  )
}

/** The honest empty line a tile shows when its data isn't there yet — the
 *  tile keeps its size, the grid never collapses. */
export function TileEmpty({ children }: { children: ReactNode }) {
  return <p className="text-[12px] text-muted-foreground">{children}</p>
}
