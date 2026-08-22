import Link from 'next/link'
import type { ReactNode } from 'react'
import { squarify, type Bucket } from '@/lib/voice-tiles'
import { Sparkline } from '@/components/charts/sparkline'

// The theme map — Voice's hero chart: a squarified treemap of the top themes
// this update. Block area = conversations (evidence_count, a real count);
// fill = the entity bucket's tint; a FULL 1px outline in the bucket colour and
// equal 5px gaps on both axes (Heinrich's round-3 fix). Server-rendered: the
// layout is solved once on a reference frame and placed with percentages, so
// the map fills whatever the tile gives it. Every block is a link one click
// deeper (?detail=<themeId>).

export interface ThemeBlock {
  id: string
  label: string
  /** conversations this update — the block's area */
  count: number
  bucket: Bucket
  /** the category chip, already worded for clients */
  category: string
  categoryClass: string
  isNew: boolean
  /** conversations per update, oldest → newest (≥2 points draws a spark) */
  series?: number[]
  href: string
}

// Bucket fills are the tile surface tinted with the bucket colour — the same
// hues as the reference (#E3EEE3 / #E4E8EF / #F3DFD5 on cream), and they
// still read on the dark tile. Class strings can't carry these, so inline.
const FILL: Record<Bucket, string> = {
  client: 'color-mix(in srgb, var(--positive) 14%, var(--tile))',
  category: 'color-mix(in srgb, var(--accent-slate) 14%, var(--tile))',
  competitor: 'color-mix(in srgb, var(--accent-clay) 16%, var(--tile))',
}
export const EDGE: Record<Bucket, string> = {
  client: 'var(--positive)',
  category: 'var(--accent-slate)',
  competitor: 'var(--accent-clay)',
}

/** Reference frame the layout is solved on (the hero tile's map area at 1440×900). */
const REF_W = 708, REF_H = 372
const GAP = 5

export function ThemeMap({ blocks, className }: { blocks: ThemeBlock[]; className?: string }) {
  if (blocks.length === 0) return null
  const rects = squarify(blocks.map((b) => Math.max(1, b.count)), 0, 0, REF_W, REF_H)
  return (
    <div className={`relative min-h-0 w-full flex-1 ${className ?? ''}`}>
      {blocks.map((b, i) => {
        const r = rects[i]
        // Size classes from the reference frame: big blocks carry the category
        // chip + spark, mid blocks the New chip, small ones label + count only.
        const big = r.w > 150 && r.h > 70
        const mid = r.w > 95 && r.h > 48
        const edge = EDGE[b.bucket]
        return (
          <Link
            key={b.id}
            href={b.href}
            scroll={false}
            title={`${b.label} · ${b.count} conversation${b.count === 1 ? '' : 's'}`}
            className={`absolute flex flex-col gap-[3px] overflow-hidden rounded-[6px] text-foreground transition-[filter] hover:brightness-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 ${mid ? 'px-[9px] py-2' : 'px-1.5 py-[5px]'}`}
            style={{
              left: `calc(${(r.x / REF_W) * 100}% + ${GAP / 2}px)`,
              top: `calc(${(r.y / REF_H) * 100}% + ${GAP / 2}px)`,
              width: `calc(${(r.w / REF_W) * 100}% - ${GAP}px)`,
              height: `calc(${(r.h / REF_H) * 100}% - ${GAP}px)`,
              background: FILL[b.bucket],
              boxShadow: `0 0 0 1px ${edge}`,
            }}
          >
            <span className={`font-semibold leading-[1.2] ${big ? 'line-clamp-3 text-[13px]' : mid ? 'line-clamp-2 text-[11.5px]' : 'line-clamp-2 text-[10.5px]'}`}>{b.label}</span>
            <span className="mt-auto flex min-w-0 items-center gap-1.5">
              <span className={`font-mono font-semibold tabular-nums leading-none ${big ? 'text-[15px]' : 'text-[12px]'}`}>{b.count}</span>
              {big && <Chip className={b.categoryClass}>{b.category}</Chip>}
              {b.isNew && mid && <Chip className="bg-sidebar-accent text-primary">New</Chip>}
              {big && b.series && b.series.length >= 2 && (
                <Sparkline values={b.series} color={edge} width={54} height={14} endDot={false} className="ml-auto" />
              )}
            </span>
          </Link>
        )
      })}
    </div>
  )
}

function Chip({ children, className }: { children: ReactNode; className: string }) {
  return (
    <span className={`inline-flex h-[18px] max-w-[9rem] shrink items-center truncate rounded-full px-[7px] text-[10.5px] font-medium ${className}`}>
      {children}
    </span>
  )
}

/** The bucket legend for the map's footer. */
export function BucketLegend({ competitor }: { competitor: string | null }) {
  const item = (bucket: Bucket, label: string) => (
    <span className="flex items-center gap-1">
      <span className="size-1.5 rounded-full" style={{ background: EDGE[bucket] }} aria-hidden />
      {label}
    </span>
  )
  return (
    <span className="flex items-center gap-2.5 text-[10.5px]">
      {item('client', 'your audience')}
      {item('category', 'wider category')}
      {competitor && item('competitor', `${competitor}’s`)}
    </span>
  )
}
