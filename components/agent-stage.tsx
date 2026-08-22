import { CrowdFigure, type FigureKey } from '@/components/crowd-figure'

// The crowd parts and stands in a ring around whoever is asking.
//
// The Consumer Profile's entrance moves its blocks OUT from the figure with an
// overshoot, as if the connector were a tether. This is the same gesture at
// page scale: every figure starts stacked at the centre and travels out to its
// place on an ellipse, so the ring assembles itself around the composer rather
// than simply appearing.
//
// The ellipse is read as a circle in perspective — wide and shallow, the way a
// ring of people standing around you would project onto a flat page. Depth is
// carried by SIZE: a figure high on the screen is further back, so it is
// smaller and fainter than one low and near. Without that the ring reads as a
// flat oval of stickers.
//
// Positions are computed from a fixed formula with no randomness. Math.random
// here would produce different coordinates on the server and the client and
// hydration would tear.

const COUNT = 18

/** Deterministic jitter in [-1, 1]. sin of a large multiple is chaotic enough
 *  to look unplanned and is identical on both sides of hydration. */
function wobble(i: number, salt: number): number {
  return Math.sin(i * 12.9898 + salt) * 43758.5453 % 1
}

const VARIANTS: FigureKey[] = ['a', 'b', 'c', 'e']

interface Placed {
  x: number
  y: number
  scale: number
  opacity: number
  variant: FigureKey
  lean: number
  delay: number
}

const RING: Placed[] = Array.from({ length: COUNT }, (_, i) => {
  // Start at the top and go round. The half-step offset stops the first figure
  // sitting dead above the composer, where it would read as a hat.
  const angle = ((i + 0.5) / COUNT) * Math.PI * 2 - Math.PI / 2
  const rx = 26 + wobble(i, 1.7) * 4
  const ry = 11 + wobble(i, 5.3) * 2.5
  const x = Math.cos(angle) * rx
  const y = Math.sin(angle) * ry
  // depth: -1 at the back of the ring, +1 at the front.
  const depth = y / ry
  return {
    x,
    y,
    scale: 0.62 + 0.38 * ((depth + 1) / 2),
    // The back of the ring sits further into the haze.
    opacity: 0.07 + 0.06 * ((depth + 1) / 2),
    variant: VARIANTS[i % VARIANTS.length],
    lean: wobble(i, 9.1) * 3.5,
    // Rippling outward: the ones nearest the front leave last, so the ring
    // opens toward the reader rather than all at once.
    delay: 0.06 + ((depth + 1) / 2) * 0.22,
  }
})

/** The ambient ring. Sits behind everything; never interactive. */
export function AgentCrowdRing() {
  return (
    <div className="agent-ring pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
      {RING.map((f, i) => (
        <div
          key={i}
          className="agent-ring-figure absolute left-1/2 top-1/2"
          style={
            {
              '--rx': `${f.x}rem`,
              '--ry': `${f.y}rem`,
              '--s': f.scale,
              '--o': f.opacity,
              animationDelay: `${f.delay}s`,
            } as React.CSSProperties
          }
        >
          <CrowdFigure
            personaKey={`ring-${i}`}
            variant={f.variant}
            lean={f.lean}
            className="h-40 w-auto text-primary"
          />
        </div>
      ))}
    </div>
  )
}
