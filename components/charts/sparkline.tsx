// Server-rendered SVG sparkline — the smallest chart that works. No client JS.

export function Sparkline({
  values, color = 'var(--primary)', width = 90, height = 26, fill = false, endDot = true, strokeWidth = 1.5, className,
}: {
  values: number[]
  color?: string
  width?: number
  height?: number
  fill?: boolean
  endDot?: boolean
  strokeWidth?: number
  className?: string
}) {
  if (values.length === 0) return null
  const lo = Math.min(...values), hi = Math.max(...values)
  const rng = hi - lo || 1
  const n = values.length
  const xs = values.map((_, i) => (n === 1 ? width / 2 : 2 + (i * (width - 4)) / (n - 1)))
  const ys = values.map((v) => height - 3 - ((v - lo) / rng) * (height - 6))
  const pts = xs.map((x, i) => `${x.toFixed(1)},${ys[i].toFixed(1)}`).join(' ')
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      className={className}
      style={{ overflow: 'visible', flex: 'none' }}
      aria-hidden
    >
      {fill && n > 1 && (
        <polygon points={`${xs[0].toFixed(1)},${height - 1} ${pts} ${xs[n - 1].toFixed(1)},${height - 1}`} fill={color} opacity={0.12} />
      )}
      <polyline points={pts} fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinejoin="round" strokeLinecap="round" />
      {endDot && <circle cx={xs[n - 1]} cy={ys[n - 1]} r={2.6} fill={color} stroke="var(--tile)" strokeWidth={1.5} />}
    </svg>
  )
}
