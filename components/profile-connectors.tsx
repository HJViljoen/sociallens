'use client'

import { useEffect, useState } from 'react'

// The lines from each block to the figure.
//
// Three earlier attempts failed for the same reason: they guessed where the
// figure was. Hard-coded fractions of the grid drifted as soon as a persona
// wrote a different amount; aiming at the body's centre sent every line through
// the empty gap between head and shoulders; aiming at a fixed flank left them
// stopping short, because the silhouette's width changes with height and with
// which figure is drawn.
//
// So nothing is guessed. Both ends are measured:
//   - the start is the centre of the block, from its own bounding box;
//   - the end is the CLOSEST POINT ON THE FIGURE'S OUTLINE, found by walking
//     the real path and circle with getPointAtLength and taking the nearest
//     sample to that block.
//
// Correct for any persona, any silhouette, any window size — and a line meets
// the shoulder, the flank or the head depending on where its block genuinely
// is, instead of every line aiming at one spot.

/** How far down the figure a connector may terminate, as a share of its
 *  height. Below this the silhouette is fading into the page and a line would
 *  run flat along the bottom of the composition. */
const OUTLINE_FLOOR = 0.62

interface Line {
  x1: number
  y1: number
  x2: number
  y2: number
  side: 'left' | 'right'
}

/** Sample an outline in page coordinates. */
function sampleOutline(el: SVGGeometryElement, samples: number): DOMPoint[] {
  const ctm = el.getScreenCTM()
  if (!ctm) return []
  const total = el.getTotalLength()
  if (!total) return []
  const out: DOMPoint[] = []
  for (let i = 0; i <= samples; i++) {
    const p = el.getPointAtLength((i / samples) * total)
    out.push(new DOMPoint(p.x, p.y).matrixTransform(ctm))
  }
  return out
}

export function ProfileConnectors() {
  const [lines, setLines] = useState<Line[]>([])

  useEffect(() => {
    const grid = document.querySelector<HTMLElement>('[data-connector-root]')
    if (!grid) return

    const measure = () => {
      const g = grid.getBoundingClientRect()
      const figure = grid.querySelector<SVGSVGElement>('[data-figure]')
      if (!g.width || !g.height || !figure) return

      const all = [...figure.querySelectorAll<SVGGeometryElement>('path, circle')].flatMap((el) =>
        sampleOutline(el, 160),
      )
      if (!all.length) return

      // A floor on how low a line may meet the figure. Nearest-point alone sent
      // the share bar — which sits at the bottom of its column — down to the
      // hem, where the line ran nearly flat along the pane and the silhouette
      // is already fading out. Cutting the bottom of the outline out of the
      // running makes that line climb to the flank instead, so every connector
      // lands on the body proper.
      const box = figure.getBoundingClientRect()
      const floor = box.top + box.height * OUTLINE_FLOOR
      const outline = all.filter((p) => p.y <= floor)
      if (!outline.length) return

      const next: Line[] = []
      for (const el of grid.querySelectorAll<HTMLElement>('[data-connector]')) {
        const r = el.getBoundingClientRect()
        if (!r.width) continue
        const side = el.dataset.connector === 'right' ? 'right' : 'left'
        // Start at the block's own centre, as asked. The card is opaque, so the
        // run from centre to edge is hidden and the line reads as leaving the
        // edge — while the anchor itself can never fall outside the card.
        const cx = r.left + r.width / 2
        const cy = r.top + r.height / 2

        let best = outline[0]
        let bestD = Infinity
        for (const p of outline) {
          const d = (p.x - cx) ** 2 + (p.y - cy) ** 2
          if (d < bestD) {
            bestD = d
            best = p
          }
        }

        // Aim from the centre, but BEGIN at the card's edge. Drawn from the
        // centre itself the line shows through the card, which is translucent;
        // clipped to where the ray leaves the box it keeps exactly the same
        // direction and starts where the reader expects it to.
        const dx = best.x - cx
        const dy = best.y - cy
        const ts: number[] = []
        if (dx > 0) ts.push((r.right - cx) / dx)
        if (dx < 0) ts.push((r.left - cx) / dx)
        if (dy > 0) ts.push((r.bottom - cy) / dy)
        if (dy < 0) ts.push((r.top - cy) / dy)
        const t = Math.min(...ts.filter((v) => v > 0 && Number.isFinite(v)))
        const sx = Number.isFinite(t) ? cx + dx * t : cx
        const sy = Number.isFinite(t) ? cy + dy * t : cy

        next.push({
          x1: ((sx - g.left) / g.width) * 100,
          y1: ((sy - g.top) / g.height) * 100,
          x2: ((best.x - g.left) / g.width) * 100,
          y2: ((best.y - g.top) / g.height) * 100,
          side,
        })
      }
      setLines(next)
    }

    // Measure now so the lines arrive with everything else, then again once the
    // entrance has settled: during it the figure is still moving, and a point
    // on a moving outline is the wrong point.
    measure()
    const settle = window.setTimeout(measure, 700)
    const ro = new ResizeObserver(measure)
    ro.observe(grid)
    for (const el of grid.querySelectorAll('[data-connector]')) ro.observe(el)
    return () => {
      window.clearTimeout(settle)
      ro.disconnect()
    }
  }, [])

  // Nothing until measured: drawing at a guess first would show every line
  // jumping into place on load.
  if (!lines.length) return null

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
          x2={l.x2}
          y2={l.y2}
          stroke="var(--primary)"
          strokeOpacity={0.7}
          strokeWidth={1.25}
          vectorEffect="non-scaling-stroke"
          className={l.side === 'left' ? 'profile-line-left' : 'profile-line-right'}
        />
      ))}
    </svg>
  )
}
