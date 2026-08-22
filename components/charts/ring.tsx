// The one circle the redesign allows: a ring for share-of-something, ≤4 slices,
// your number in the centre. Dash offsets on a single circle per segment, with
// a surface-coloured gap between segments (dataviz spacer rule). Server SVG.

export interface RingSegment { label: string; value: number; color: string }

export function Ring({
  segments, size = 120, thickness = 14, center, sub, gap = 2.5, className,
}: {
  segments: RingSegment[]
  size?: number
  thickness?: number
  center?: string
  sub?: string
  gap?: number
  className?: string
}) {
  const total = segments.reduce((t, s) => t + Math.max(0, s.value), 0)
  const r = (size - thickness) / 2
  const c = size / 2
  const C = 2 * Math.PI * r
  const arcs: (RingSegment & { len: number; offset: number })[] = []
  for (const s of segments) {
    if (s.value <= 0) continue
    const len = total > 0 ? (s.value / total) * C : 0
    const offset = arcs.length ? arcs[arcs.length - 1].offset + arcs[arcs.length - 1].len + gap : 0
    arcs.push({ ...s, len: Math.max(0, len - gap), offset })
  }
  return (
    <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} className={className} style={{ flex: 'none' }} role="img" aria-label={segments.map((s) => `${s.label} ${s.value}`).join(', ')}>
      {total === 0 && <circle cx={c} cy={c} r={r} fill="none" stroke="var(--muted)" strokeWidth={thickness} />}
      {arcs.map((a) => (
        <circle
          key={a.label}
          cx={c} cy={c} r={r}
          fill="none"
          stroke={a.color}
          strokeWidth={thickness}
          strokeDasharray={`${a.len.toFixed(2)} ${(C - a.len).toFixed(2)}`}
          strokeDashoffset={-a.offset}
          transform={`rotate(-90 ${c} ${c})`}
        >
          <title>{`${a.label}: ${a.value}`}</title>
        </circle>
      ))}
      {center && (
        <text x={c} y={c + (sub ? 2 : 6)} textAnchor="middle" fontFamily="var(--font-jetbrains), ui-monospace, monospace" fontSize={size >= 110 ? 22 : 16} fontWeight={600} fill="var(--foreground)" letterSpacing="-1">
          {center}
        </text>
      )}
      {sub && (
        <text x={c} y={c + 16} textAnchor="middle" fontFamily="var(--font-jakarta), ui-sans-serif, sans-serif" fontSize={10} fill="var(--muted-foreground)">
          {sub}
        </text>
      )}
    </svg>
  )
}
