import type { ReactNode } from 'react'
import Link from 'next/link'
import { cn } from '@/lib/utils'

// One row of a ranked list: dot · label · bar · count. The bar is a plain
// div track — no SVG needed — and its colour follows the entity (bucket), never
// its rank. Used for themes, platforms, hooks, formats.

export function RankedBar({
  label, pct, color, count, dot, badge, barWidth = 110, href, className,
}: {
  label: ReactNode
  /** 0–100, relative to the list's maximum. */
  pct: number
  /** CSS colour for the bar (and the dot when `dot` is true). */
  color: string
  count?: ReactNode
  dot?: boolean
  badge?: ReactNode
  barWidth?: number
  href?: string
  className?: string
}) {
  const row = (
    <>
      {dot && <span className="size-1.5 shrink-0 rounded-full" style={{ background: color }} aria-hidden />}
      <span className="min-w-0 flex-1 truncate text-[12.5px]">{label}</span>
      {badge}
      <span className="h-1.5 shrink-0 overflow-hidden rounded-full bg-muted" style={{ width: barWidth }} aria-hidden>
        <span className="block h-full rounded-full" style={{ width: `${Math.max(2, Math.min(100, pct))}%`, background: color }} />
      </span>
      {count != null && <span className="w-7 shrink-0 text-right font-mono text-[11.5px] font-semibold tabular-nums">{count}</span>}
    </>
  )
  const cls = cn('flex items-center gap-2 leading-[1.3]', href && 'rounded-sm hover:bg-muted/50', className)
  return href ? <Link href={href} className={cls}>{row}</Link> : <div className={cls}>{row}</div>
}
