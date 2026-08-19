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
//
// Drawn as a filled cream body with a deep-green outline while the backdrop
// crowd stays in thin line: the page's subject should read as a person standing
// in FRONT of the crowd — solid enough to occlude it — not as one more outline
// lost in it.

// Figure d (front #13) is deliberately absent: it is the narrow, short,
// asymmetric one, and next to these four it reads as a different species
// rather than a different person. The set has to look like one crowd.
const FIGURES = {
  a: { d: 'M-27.3,116.6 Q-34.4,42.9 0.0,44.4 Q34.8,42.9 27.2,116.6', r: 18.6, w: 34.8, h: 116.6 },
  // b, adjusted for the same reason as e, less severely: its shoulder apex sat
  // 3.1 units under the head against 6–7 on a and c. Apex dropped to match.
  b: { d: 'M-34.4,105.6 Q-24.3,42.4 0.0,43.7 Q28.8,42.4 34.5,105.6', r: 17.8, w: 34.5, h: 105.6 },
  c: { d: 'M-31.8,104.0 Q-26.8,37.7 0.0,39.0 Q33.4,37.7 31.9,104.0', r: 16.4, w: 33.4, h: 104.0 },
  // e, adjusted: as lifted, its head was the smallest of the set (0.28 of its
  // height against ~0.32) and sat almost directly on the shoulders — a 1.3-unit
  // neck against 6–7 on the others — so it read as a different kind of person
  // rather than a different person. Head enlarged and the shoulder apex dropped
  // to open the same neck gap the rest have. Silhouette width untouched.
  e: { d: 'M-30.3,96.0 Q-26.4,37.2 0.0,38.6 Q34.2,37.2 30.3,96.0', r: 16.0, w: 34.2, h: 96.0 },
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
  variant,
  className = '',
  lean = 0,
  title,
}: {
  personaKey: string
  /** Explicit silhouette. Omit to fall back to the per-key hash. */
  variant?: FigureKey
  className?: string
  /** Degrees, about the hem — the asset's own figures lean −3.93…+3.95°. */
  lean?: number
  title?: string
}) {
  const f = FIGURES[variant ?? figureForKey(personaKey)]
  // Padding keeps the round line caps and the stroke off the viewBox edge.
  const pad = 8
  const width = 2 * (f.w + pad)
  return (
    <svg
      viewBox={`${-(f.w + pad)} ${-pad} ${width} ${f.h + 2 * pad}`}
      className={className}
      // Warm cream body, deep-green outline. The opaque cream (not --card,
      // which is translucent) matters: a see-through body would let the crowd
      // backdrop show through the subject. Filled this way the figure OCCLUDES
      // the crowd, which is what makes it read as standing in front of it.
      fill="var(--popover)"
      stroke="currentColor"
      strokeWidth={4.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      data-figure
      role={title ? 'img' : 'presentation'}
      aria-hidden={title ? undefined : true}
      // Bottom-anchored: the figure stands ON the bottom of whatever box it is
      // given, the way it stands in the crowd.
      preserveAspectRatio="xMidYMax meet"
    >
      {title && <title>{title}</title>}
      <g transform={`rotate(${lean} 0 ${f.h})`}>
        {/* Filled, not outlined. The shoulder path is an open curve, so a fill
            closes it along the hem and gives a solid body — the same silhouette
            the crowd draws in line, brought forward as a subject rather than a
            sketch. */}
        {/* The shoulder path is open, so the fill closes it along the hem
            while the stroke does not — the body has no bottom line, which is
            what makes it read as continuing past the edge rather than sitting
            on a shelf. non-scaling-stroke keeps the outline an even weight
            however large the figure is drawn. */}
        <path d={f.d} vectorEffect="non-scaling-stroke" />
        <circle cx={0} cy={f.r} r={f.r} vectorEffect="non-scaling-stroke" />
      </g>
    </svg>
  )
}

/** Give every persona in a profile its own silhouette.
 *
 *  A bare hash is stable per persona but collides: on the real Össur cast it
 *  put five people on three bodies and never used the fourth. This keeps the
 *  hash as the preference, then walks to the next free figure when one is
 *  taken — deterministic for a given cast, and it uses the whole set before it
 *  repeats. Order is the caller's, so it does not shuffle between renders. */
export function assignFigures(keys: string[]): Map<string, FigureKey> {
  const out = new Map<string, FigureKey>()
  const taken = new Set<FigureKey>()
  for (const key of keys) {
    const preferred = figureForKey(key)
    let pick = preferred
    if (taken.has(pick)) {
      const from = KEYS.indexOf(preferred)
      const free = KEYS.slice(from).concat(KEYS.slice(0, from)).find((k) => !taken.has(k))
      pick = free ?? preferred
    }
    taken.add(pick)
    out.set(key, pick)
    if (taken.size === KEYS.length) taken.clear()
  }
  return out
}

