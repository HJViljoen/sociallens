import type { DeltaVerdict } from '@/lib/report-bands'

// "Since last update" movement badge. Extracted from app/dashboard/page.tsx so
// every surface (stat band, funnel, finding tiles, the where-you-stand cards)
// renders the same delta. Self-gates: renders nothing until a previous update
// exists (delta == null), so first runs simply show no comparison.
//
// DeltaBadge is for COUNTS (themes, recommendations, comments): a count that
// changed, changed. For PROPORTIONS (sentiment share, share of tracked videos)
// use MovementBadge below, which only draws an arrow when the shift cleared a
// band on denominators big enough to carry it (T0-8, 2026-08-18).
export function DeltaBadge({ delta, unit }: { delta: number | null; unit?: string }) {
  if (delta == null) return null
  const suffix = unit ? ` ${unit}` : ''
  if (delta === 0) {
    return (
      <span className="whitespace-nowrap text-xs font-medium text-muted-foreground" title="no change since your last update">
        unchanged
      </span>
    )
  }
  return (
    <span
      title="movement since your last update"
      className={`whitespace-nowrap text-xs font-semibold ${delta > 0 ? 'text-positive' : 'text-negative'}`}
    >
      {delta > 0 ? '▲' : '▼'} {Math.abs(delta).toLocaleString('en-US')}{suffix}
    </span>
  )
}

/**
 * Proportion movement, band-gated (T0-8). Same visual language as DeltaBadge
 * when something genuinely moved; otherwise it says which of the two honest
 * non-answers applies, so a flat week reads as flat instead of as noise.
 */
export function MovementBadge({ verdict, unit }: { verdict: DeltaVerdict | null; unit?: string }) {
  if (!verdict) return null
  if (verdict.state === 'too_little_data') {
    return (
      <span className="whitespace-nowrap text-xs font-medium text-muted-foreground" title="not enough rated items on both sides to compare yet">
        too little data
      </span>
    )
  }
  if (verdict.state === 'no_clear_change') {
    return (
      <span
        className="whitespace-nowrap text-xs font-medium text-muted-foreground"
        title={`moved ${verdict.change > 0 ? '+' : ''}${verdict.change}${unit ? ` ${unit}` : ''}, inside the ${verdict.band} pt margin of this measurement`}
      >
        no clear change
      </span>
    )
  }
  const suffix = unit ? ` ${unit}` : ''
  return (
    <span
      title={`moved beyond the ${verdict.band} pt margin of this measurement`}
      className={`whitespace-nowrap text-xs font-semibold ${verdict.change > 0 ? 'text-positive' : 'text-negative'}`}
    >
      {verdict.change > 0 ? '▲' : '▼'} {Math.abs(verdict.change).toLocaleString('en-US')}{suffix}
    </span>
  )
}
