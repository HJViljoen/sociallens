'use client'

import { useEffect, useState } from 'react'

// The lines from each block to the figure.
//
// These started as hard-coded fractions of the grid, which is fine until the
// content moves — and it moves constantly: every persona writes a different
// amount, so a card that sits at 62% for one sits at 55% for the next, and a
// line that emerged neatly from under one card starts in mid-air on another.
// Tuning the numbers fixed the persona in front of me and broke the next one.
//
// So they are measured. Each element that wants a line carries data-connector
// ("left" or "right", naming the side of the grid it lives on); this reads
// their real positions after paint and re-reads on resize. A line starts just
// INSIDE its element, so the element's own background trims that end, and aims
// past the figure's centre, so the opaque body trims the other. Both ends are
// hidden and only the span between them shows — which is what makes them look
// exactly connected without either end ever being precisely placed.

interface Line {
  x1: number
  y1: number
  side: 'left' | 'right'
}

export function ProfileConnectors({ bodyCentre }: { bodyCentre: number }) {
  const [lines, setLines] = useState<Line[]>([])

  useEffect(() => {
    const grid = document.querySelector<HTMLElement>('[data-connector-root]')
    if (!grid) return

    const measure = () => {
      const g = grid.getBoundingClientRect()
      if (!g.width || !g.height) return
      const next: Line[] = []
      for (const el of grid.querySelectorAll<HTMLElement>('[data-connector]')) {
        const side = el.dataset.connector === 'right' ? 'right' : 'left'
        const r = el.getBoundingClientRect()
        if (!r.width) continue
        // 1.5% inside the element's inner edge: far enough under it to be
        // trimmed, close enough that the visible line still starts at the edge.
        const edge = side === 'left' ? r.right - g.left : r.left - g.left
        const inset = side === 'left' ? -0.015 * g.width : 0.015 * g.width
        next.push({
          x1: ((edge + inset) / g.width) * 100,
          y1: ((r.top + r.height / 2 - g.top) / g.height) * 100,
          side,
        })
      }
      setLines(next)
    }

    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(grid)
    for (const el of grid.querySelectorAll('[data-connector]')) ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Nothing until measured: drawing at a guess first would show every line
  // jumping into place on load.
  if (!lines.length) return null

  const target = { x: 50, y: 100 - (1 - bodyCentre) * 100 * 0.55 }

  return (
    <svg
      aria-hidden
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      className="pointer-events-none absolute inset-0 z-0 hidden size-full lg:block"
    >
      {lines.map((l, i) => (
        <line
          key={i}
          x1={l.x1}
          y1={l.y1}
          x2={target.x}
          y2={target.y}
          stroke="var(--primary)"
          strokeOpacity={0.7}
          strokeWidth={1.25}
          vectorEffect="non-scaling-stroke"
          // Travels with the block it belongs to; the end that meets the figure
          // moves underneath it, where the opaque body hides it.
          className={l.side === 'left' ? 'profile-line-left' : 'profile-line-right'}
        />
      ))}
    </svg>
  )
}
