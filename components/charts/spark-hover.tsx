'use client'

import { useState, type ReactNode } from 'react'

// The hover layer for a server-rendered sparkline: invisible hit zones per
// point and a small mono tooltip with the exact value and its label. Pure
// client leaf; the SVG itself is rendered on the server and passed through.

export function SparkHover({
  xs, ys, values, labels, unit = '', width, height, color, children,
}: {
  xs: number[]
  ys: number[]
  values: number[]
  labels: string[]
  unit?: string
  width: number
  height: number
  color: string
  children: ReactNode
}) {
  const [i, setI] = useState<number | null>(null)
  const n = values.length
  const slot = n > 1 ? (xs[n - 1] - xs[0]) / (n - 1) : width
  return (
    <span className="relative inline-flex" style={{ width, height, flex: 'none' }} onMouseLeave={() => setI(null)}>
      {children}
      <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} className="absolute inset-0" style={{ overflow: 'visible' }} aria-hidden>
        {i != null && (
          <>
            <line x1={xs[i]} x2={xs[i]} y1={0} y2={height} stroke="var(--border)" strokeWidth={1} />
            <circle cx={xs[i]} cy={ys[i]} r={3} fill={color} stroke="var(--tile)" strokeWidth={1.5} />
          </>
        )}
        {xs.map((x, k) => (
          <rect key={k} x={x - slot / 2} y={0} width={slot} height={height} fill="transparent" onMouseEnter={() => setI(k)} />
        ))}
      </svg>
      {i != null && (
        <span
          role="status"
          className="pointer-events-none absolute z-10 whitespace-nowrap rounded-[4px] bg-tile px-2 py-1 font-mono text-[10.5px] tabular-nums text-foreground shadow-tile"
          style={{ left: xs[i], top: -30, transform: `translateX(${i === n - 1 ? '-100%' : i === 0 ? '0' : '-50%'})` }}
        >
          <span className="font-semibold">{values[i].toLocaleString('en-US')}{unit}</span>
          {labels[i] && <span className="text-muted-foreground"> · {labels[i]}</span>}
        </span>
      )}
    </span>
  )
}
