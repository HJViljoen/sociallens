// Proportional segmented bar + its dot legend. Extracted from
// app/dashboard/page.tsx so the where-you-stand cards and any new surface share
// one implementation. Colour classes are passed in written-out (Tailwind v4
// scans literals) — callers use lib/ui-colors helpers, never interpolation.

/** One segment of a proportional bar. */
export interface Segment {
  label: string
  count: number
  pct: number
  color: string
}

/** Proportional segmented bar with 2px surface gaps + per-segment tooltips. */
export function ProportionBar({ segments, of }: { segments: Segment[]; of: string }) {
  return (
    <div className="flex h-2.5 w-full shrink-0 gap-0.5 overflow-hidden rounded-full">
      {segments.map((s) => (
        <span
          key={s.label}
          className={`${s.color} first:rounded-l-full last:rounded-r-full`}
          style={{ width: `${Math.max(2, s.pct)}%` }}
          title={`${s.label} · ${s.count} ${of} (${s.pct}%)`}
        />
      ))}
    </div>
  )
}

/** Dot legend for a proportional bar — identity is never colour-alone. */
export function BarLegend({ segments }: { segments: Segment[] }) {
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1">
      {segments.map((s) => (
        <span key={s.label} className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <span className={`size-2 rounded-full ${s.color}`} aria-hidden />
          {s.label} {s.pct}%
        </span>
      ))}
    </div>
  )
}
