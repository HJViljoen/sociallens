// The one circle the redesign allows: a ring for share-of-something, ≤4 slices,
// your number in the centre. Dash offsets on a single circle per segment, with
// a surface-coloured gap between segments (dataviz spacer rule). Server SVG.
//
// `interactive` marks each segment with data-seg / data-label / data-pct and
// the centre texts with data-ring-center / data-ring-sub, so a surrounding
// <RingSync> (client) can expand the hovered segment, swap the centre to its
// share, and highlight the matching legend row (component-map §1: "the pie
// expands and shows the percentage").

export interface RingSegment { label: string; value: number; color: string }

export function Ring({
  segments, size = 120, thickness = 14, center, sub, gap = 2.5, interactive = false, animate = true, className,
}: {
  segments: RingSegment[]
  size?: number
  thickness?: number
  center?: string
  sub?: string
  gap?: number
  interactive?: boolean
  animate?: boolean
  className?: string
}) {
  const total = segments.reduce((t, s) => t + Math.max(0, s.value), 0)
  const r = (size - thickness) / 2
  const c = size / 2
  const C = 2 * Math.PI * r
  const arcs: (RingSegment & { len: number; offset: number; idx: number; pct: number })[] = []
  segments.forEach((s, idx) => {
    if (s.value <= 0) return
    const len = total > 0 ? (s.value / total) * C : 0
    const offset = arcs.length ? arcs[arcs.length - 1].offset + arcs[arcs.length - 1].len + gap : 0
    arcs.push({ ...s, len: Math.max(0, len - gap), offset, idx, pct: total > 0 ? (s.value / total) * 100 : 0 })
  })
  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      width={size}
      height={size}
      className={className}
      style={{ flex: 'none', overflow: 'visible', ['--ring-thick' as string]: `${thickness}px` }}
      role="img"
      aria-label={segments.map((s) => `${s.label} ${s.value}`).join(', ')}
    >
      {total === 0 && <circle cx={c} cy={c} r={r} fill="none" stroke="var(--muted)" strokeWidth={thickness} />}
      {arcs.map((a) => (
        <circle
          key={`${a.idx}-${a.label}`}
          className={animate ? 'vi-anim-ring' : undefined}
          data-seg={interactive ? a.idx : undefined}
          data-label={interactive ? a.label : undefined}
          data-pct={interactive ? `${a.pct.toFixed(1)}%` : undefined}
          cx={c} cy={c} r={r}
          fill="none"
          stroke={a.color}
          strokeWidth={thickness}
          strokeDasharray={`${a.len.toFixed(2)} ${(C - a.len).toFixed(2)}`}
          strokeDashoffset={-a.offset}
          transform={`rotate(-90 ${c} ${c})`}
          style={{ transition: 'stroke-width 120ms ease-out' }}
        >
          <title>{`${a.label}: ${a.value}`}</title>
        </circle>
      ))}
      {center && (
        <text data-ring-center={interactive ? '' : undefined} x={c} y={c + (sub ? 2 : 6)} textAnchor="middle" fontFamily="var(--font-plex-mono), ui-monospace, monospace" fontSize={size >= 110 ? 22 : 16} fontWeight={600} fill="var(--foreground)" letterSpacing="-1">
          {center}
        </text>
      )}
      {sub && (
        <text data-ring-sub={interactive ? '' : undefined} x={c} y={c + 16} textAnchor="middle" fontFamily="var(--font-plex-sans), ui-sans-serif, sans-serif" fontSize={10} fill="var(--muted-foreground)">
          {sub}
        </text>
      )}
    </svg>
  )
}
