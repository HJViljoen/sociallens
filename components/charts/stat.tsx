import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { fmtDelta, round1 } from '@/lib/format'

// Counted figures, the way the redesign shows them: mono, tabular, big; a unit
// word beside; a signed delta in the favourability colour. Numbers here are
// counts of real voices/videos/themes or shares — never model scores.

export function StatValue({
  children, unit, size = 'md', className,
}: { children: ReactNode; unit?: ReactNode; size?: 'sm' | 'md' | 'lg'; className?: string }) {
  return (
    <span className={cn('inline-flex items-baseline gap-1.5', className)}>
      <span
        className={cn(
          'font-mono font-semibold tabular-nums leading-none tracking-[-0.03em]',
          size === 'sm' && 'text-[18px]',
          size === 'md' && 'text-[24px]',
          size === 'lg' && 'text-[30px]',
        )}
      >
        {children}
      </span>
      {unit && <span className="text-[12px] font-medium text-muted-foreground">{unit}</span>}
    </span>
  )
}

export type Good = 'up' | 'down' | 'neutral'

/** Is this delta favourable? null = flat or direction-neutral. */
export function favourability(delta: number, good: Good, unit: 'pt' | 'count' | '%' = 'count'): boolean | null {
  const flat = Math.abs(delta) < (unit === 'count' ? 0.5 : 0.05)
  if (flat || good === 'neutral') return null
  const up = delta > 0
  return good === 'up' ? up : !up
}

export function Delta({
  value, unit = '', decimals, good = 'neutral', suffix, className,
}: {
  value: number | null | undefined
  /** Printed after the number: "pt", "%", "" */
  unit?: string
  decimals?: 0 | 1
  good?: Good
  /** Context after the delta, e.g. "vs last update" */
  suffix?: string
  className?: string
}) {
  if (value == null || Number.isNaN(value)) return null
  const dec = decimals ?? (unit === 'pt' || unit === '%' ? 1 : 0)
  const fav = favourability(value, good, unit === 'pt' ? 'pt' : unit === '%' ? '%' : 'count')
  const v = dec === 1 ? round1(value) : Math.round(value)
  return (
    <span
      className={cn(
        'font-mono text-[11px] tabular-nums',
        fav === null ? 'text-muted-foreground' : fav ? 'text-positive' : 'text-negative',
        className,
      )}
    >
      {fmtDelta(v, unit, dec)}
      {suffix ? ` ${suffix}` : ''}
    </span>
  )
}

/** The stat sentence (component-map §5): value · delta · base, e.g.
 *  "521  +118  since last update". The delta is the only coloured thing; the
 *  base ("since last update", "all-time") sits in grey after it. `aside` is an
 *  optional element on the same line (a sparkline). */
export function StatSentence({
  value, unit, delta, deltaUnit = '', good = 'neutral', base, aside, size = 'md', className,
}: {
  value: ReactNode
  unit?: ReactNode
  delta?: number | null
  deltaUnit?: string
  good?: Good
  /** What the delta is measured against, in words. Shown even without a delta. */
  base?: ReactNode
  aside?: ReactNode
  size?: 'sm' | 'md' | 'lg'
  className?: string
}) {
  return (
    <div className={cn('flex min-w-0 flex-col gap-1', className)}>
      <span className="flex items-center gap-2.5">
        <StatValue unit={unit} size={size}>{value}</StatValue>
        {aside}
      </span>
      {(delta != null || base) && (
        <span className="flex items-baseline gap-1.5 text-[11.5px] text-muted-foreground">
          {delta != null && <Delta value={delta} unit={deltaUnit} good={good} />}
          {base && <span className="truncate">{base}</span>}
        </span>
      )}
    </div>
  )
}
