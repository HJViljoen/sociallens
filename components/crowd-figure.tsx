// One figure from the crowd, drawn large.
//
// The geometry is lifted verbatim from the front tier (stroke-opacity 1.000) of
// public/crowd.svg and normalised to head-centre x=0, head-top y=0. Five real
// bodies, so a persona switcher changes silhouette without anyone inventing a
// shape — these are the same people already standing in the background of every
// page.
//
// Why not reuse the asset: crowd.svg has no ids or classes to target, is used
// as a CSS background-image on three surfaces, and hard-codes stroke #14503A so
// it cannot follow the dark theme. Inline SVG is the house pattern for every
// chart here anyway (no chart libraries — DESIGN rule), and it themes, scales
// and gives the evidence blocks real coordinates to point at.

const FIGURES = {
  a: { d: 'M-27.3,116.6 Q-34.4,42.9 0.0,44.4 Q34.8,42.9 27.2,116.6', r: 18.6, w: 34.8, h: 116.6 },
  b: { d: 'M-34.4,105.6 Q-24.3,37.4 0.0,38.7 Q28.8,37.4 34.5,105.6', r: 17.8, w: 34.5, h: 105.6 },
  c: { d: 'M-31.8,104.0 Q-26.8,37.7 0.0,39.0 Q33.4,37.7 31.9,104.0', r: 16.4, w: 33.4, h: 104.0 },
  d: { d: 'M-17.3,91.9 Q-8.8,28.3 0.0,29.6 Q17.3,28.3 17.2,91.9', r: 14.1, w: 17.3, h: 91.9 },
  e: { d: 'M-30.3,96.0 Q-26.4,26.7 0.0,28.1 Q34.2,26.7 30.3,96.0', r: 13.4, w: 34.2, h: 96.0 },
} as const

export type FigureKey = keyof typeof FIGURES
const KEYS = Object.keys(FIGURES) as FigureKey[]

/** Stable silhouette per persona — same approach as categoryTint in
 *  lib/ui-colors.ts, so the same persona keeps its body across runs and reloads
 *  rather than shuffling on every render. */
export function figureForKey(key: string): FigureKey {
  let h = 0
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0
  return KEYS[h % KEYS.length]
}

export function CrowdFigure({
  personaKey,
  className = '',
  lean = 0,
  title,
}: {
  personaKey: string
  className?: string
  /** Degrees, about the hem — the asset's own figures lean −3.93…+3.95°. */
  lean?: number
  title?: string
}) {
  const f = FIGURES[figureForKey(personaKey)]
  // Padding keeps the round line caps and the stroke off the viewBox edge.
  const pad = 8
  const width = 2 * (f.w + pad)
  return (
    <svg
      viewBox={`${-(f.w + pad)} ${-pad} ${width} ${f.h + 2 * pad}`}
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.9}
      strokeLinecap="round"
      strokeLinejoin="round"
      role={title ? 'img' : 'presentation'}
      aria-hidden={title ? undefined : true}
    >
      {title && <title>{title}</title>}
      <g transform={`rotate(${lean} 0 ${f.h})`}>
        {/* non-scaling-stroke keeps the line at crowd weight however large the
            figure renders — the same treatment the dashboard charts use. */}
        <path d={f.d} vectorEffect="non-scaling-stroke" />
        <circle cx={0} cy={f.r} r={f.r} vectorEffect="non-scaling-stroke" />
      </g>
    </svg>
  )
}
