import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

// The grid's unit. Every tile has the same anatomy — eyebrow + meta on top,
// content, a footer that links deeper — so the pages read as one system even
// though each page composes its tiles differently.
//
// 2026-08-28 (MASTER §Visual identity): a tile is a white surface with the
// ambient --shadow-tile, no border. Depth comes from elevation, never tone.
// Inside a tile, items may sit in a TileBlock — a flat, faintly tinted inner
// block with no shadow and no border. Two levels only, never a third
// (component-map §1, nesting discipline).
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
  /** Row span in 116px row units (≥xl). */
  row: number
  variant?: TileVariant
  eyebrow?: ReactNode
  meta?: ReactNode
  /** Hero only: a serif lead line under the eyebrow — the page's one sentence. */
  lead?: ReactNode
  /** Left side of the footer — usually a Link deeper. */
  footer?: ReactNode
  /** Right side of the footer — a quiet note. */
  footerNote?: ReactNode
  /** The whole tile is a link target: lifts on hover (only clickable tiles lift). */
  hoverable?: boolean
  /** The tile's renderable key ('dashboard.strip'): shows the export control
   *  when export-in-place is on (removed 2026-08-30 for the Studio; the key
   *  stays on every tile for its return). */
  exportKey?: string
  className?: string
  bodyClassName?: string
  /** How the body's groups share spare height: packed at the top, spread
   *  between, or centred. */
  distribute?: 'start' | 'between' | 'center'
  children?: ReactNode
}

export function Tile({
  col, row, variant = 'default', eyebrow, meta, lead, footer, footerNote, hoverable = false, exportKey, className, bodyClassName, distribute = 'start', children,
}: TileProps) {
  const isHero = variant === 'hero'
  const isStrip = variant === 'strip'
  return (
    <section
      // data-tile / data-col / data-row: how print mode addresses a tile
      // (app/globals.css §Print mode) — the xl: span classes do not fire in
      // Chrome's print media, whose width is the page box.
      data-tile=""
      data-col={col}
      data-row={row}
      style={{ '--vb-span': col } as React.CSSProperties}
      className={cn(
        'group/tile relative flex min-h-0 flex-col overflow-hidden rounded-lg bg-tile text-[12.5px] leading-[1.45] shadow-tile',
        COL[col] ?? 'xl:col-span-12',
        ROW[row] ?? 'xl:row-span-1',
        MIN_H[row] ?? 'min-h-[116px]',
        'xl:min-h-0',
        (variant === 'default' || variant === 'warm') && 'gap-2.5 px-4 py-3.5',
        isHero && 'gap-3 px-5 py-4',
        isStrip && 'flex-col divide-y divide-border/70 p-0 sm:flex-row sm:items-stretch sm:divide-x sm:divide-y-0',
        hoverable && 'motion-safe:transition-[transform,box-shadow] motion-safe:duration-150 hover:-translate-y-0.5 hover:shadow-tile-hover',
        className,
      )}
    >
      {!isStrip && (eyebrow || meta || exportKey) && (
        <header className="relative flex items-baseline justify-between gap-2">
          {eyebrow ? (
            <h2 className="truncate text-[10.5px] font-semibold uppercase tracking-[0.06em] text-secondary-foreground">
              {eyebrow}
            </h2>
          ) : <span />}
          {meta && (
            <span className="shrink-0 whitespace-nowrap font-mono text-[11px] text-muted-foreground">
              {meta}
            </span>
          )}
          {/* Export control: absolutely placed so the header keeps its height;
              the meta slides left only while the tile is hovered. */}
        </header>
      )}
      {isHero && lead && (
        <p className="line-clamp-3 font-serif text-[17px] font-medium leading-[1.35] tracking-[-0.005em] text-foreground [text-wrap:pretty]">{lead}</p>
      )}
      {isStrip ? children : (
        <div className={cn('flex min-h-0 flex-1 flex-col gap-2.5', distribute === 'between' && 'justify-between', distribute === 'center' && 'justify-center', bodyClassName)}>{children}</div>
      )}
      {!isStrip && (footer || footerNote) && (
        <footer className={cn('mt-auto flex items-center justify-between gap-2 border-t border-border/70 bg-tile pt-2 text-[12px] font-medium text-foreground', hoverable ? 'static' : 'relative z-[1]')}>
          <span className="min-w-0 truncate [&_a:hover]:underline">{footer}</span>
          {footerNote && <span className="shrink-0 font-mono text-[11px] font-normal text-muted-foreground">{footerNote}</span>}
        </footer>
      )}
    </section>
  )
}

/** An inner block inside a tile — flat, faintly tinted, no shadow, no border.
 *  The second (and last) nesting level. Pass `as="li"` inside lists. */
export function TileBlock({ children, className, as: As = 'div' }: { children: ReactNode; className?: string; as?: 'div' | 'li' | 'article' }) {
  return <As className={cn('rounded-[4px] bg-inner px-3 py-2.5', className)}>{children}</As>
}

/** One cell of a strip tile — a counted receipt. */
export function StripCell({ eyebrow, children, className }: { eyebrow: ReactNode; children?: ReactNode; className?: string }) {
  return (
    <div className={cn('flex min-h-0 min-w-0 flex-1 flex-col justify-center gap-[3px] overflow-hidden px-4 py-2.5', className)}>
      <h2 className="shrink-0 truncate text-[10.5px] font-semibold uppercase tracking-[0.06em] text-secondary-foreground">{eyebrow}</h2>
      {children}
    </div>
  )
}

/** The honest empty line a tile shows when its data isn't there yet — the
 *  tile keeps its size, the grid never collapses. */
export function TileEmpty({ children }: { children: ReactNode }) {
  return <p className="text-[12px] text-muted-foreground">{children}</p>
}
