import { CrowdFigure, type FigureKey } from '@/components/crowd-figure'

// The crowd stands around whoever is asking — thick against the box, thinning
// out to a few stragglers in the corners.
//
// The first version was ONE ring at one radius, which read as an oval outline
// rather than a crowd: an even necklace of people with nothing inside or
// outside it. This is a FIELD instead — concentric rings whose DENSITY falls as
// they go out. Circumference grows with radius, so keeping the count flat would
// already thin it; the counts fall as well, which roughly halves the people per
// unit of arc at every step:
//
//   ring   radius   figures   per unit arc
//   0      0.85     20        23.5
//   1      1.20     18        15.0
//   2      1.60     15         9.4
//   3      2.05     12         5.9
//   4      2.55      9         3.5
//   5      3.10      6         1.9
//
// Rounder than before (rx/ry 1.65, was 2.36). It stays flattened because a ring
// of people standing around you IS an ellipse on a flat page — a true circle
// would read as a target painted on the floor rather than a crowd seen from
// standing height.
//
// Positions come from a fixed sin-based hash, never Math.random: random here
// would give the server and the client different coordinates and hydration
// would tear.

/** Deterministic jitter in (-1, 1) — identical on both sides of hydration. */
function wobble(i: number, salt: number): number {
  return (Math.sin(i * 12.9898 + salt) * 43758.5453) % 1
}

const VARIANTS: FigureKey[] = ['a', 'b', 'c', 'e']

/** Base ellipse, in rem, before the responsive --ring multiplier. */
const RX = 15
const RY = 9.5

// Six rings now, reaching half as far again. The density gradient is the whole
// point, so adding people had to mean adding them UNEVENLY — the inner rings
// grew most, and the outermost is still only six figures, so the corners stay
// as stragglers rather than filling in.
const RINGS = [
  { r: 0.85, n: 20, alpha: 0.175 },
  { r: 1.2, n: 18, alpha: 0.15 },
  { r: 1.6, n: 15, alpha: 0.12 },
  { r: 2.05, n: 12, alpha: 0.092 },
  { r: 2.55, n: 9, alpha: 0.068 },
  { r: 3.1, n: 6, alpha: 0.048 },
]

interface Placed {
  x: number
  y: number
  scale: number
  opacity: number
  variant: FigureKey
  lean: number
  delay: number
}

let seq = 0
const RING: Placed[] = RINGS.flatMap((ring, ri) =>
  Array.from({ length: ring.n }, (_, i) => {
    const k = seq++
    // Each ring is rotated off its neighbour so the figures do not line up into
    // spokes, and jittered so the rings do not read as concentric bands.
    const offset = ri * 0.37
    const angle = ((i + offset + wobble(k, 3.1) * 0.35) / ring.n) * Math.PI * 2 - Math.PI / 2
    const rx = RX * ring.r * (1 + wobble(k, 1.7) * 0.09)
    const ry = RY * ring.r * (1 + wobble(k, 5.3) * 0.09)
    const x = Math.cos(angle) * rx
    const y = Math.sin(angle) * ry
    // -1 at the back of the ring, +1 at the front.
    const depth = y / ry
    const near = (depth + 1) / 2
    return {
      x,
      y,
      // Front of the ring is nearer, so larger. Outer rings are further into
      // the haze, so smaller again — that is what turns concentric ellipses
      // into distance.
      scale: (0.5 + 0.34 * near) * (1 - ri * 0.055),
      opacity: ring.alpha * (0.72 + 0.5 * near),
      variant: VARIANTS[k % VARIANTS.length],
      lean: wobble(k, 9.1) * 3.5,
      // Rippling outward: the inner ring makes room first, the stragglers
      // arrive last, so the crowd opens rather than appearing.
      delay: 0.04 + ri * 0.05 + near * 0.12,
    }
  }),
)

/** The ambient crowd. Sits behind everything; never interactive. */
export function AgentCrowdRing() {
  return (
    <div className="agent-ring pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
      {RING.map((f, i) => (
        <div
          key={i}
          className="agent-ring-figure absolute left-1/2 top-1/2"
          style={
            {
              '--rx': `${f.x.toFixed(2)}rem`,
              '--ry': `${f.y.toFixed(2)}rem`,
              '--s': f.scale.toFixed(3),
              '--o': f.opacity.toFixed(3),
              animationDelay: `${f.delay.toFixed(2)}s`,
            } as React.CSSProperties
          }
        >
          <CrowdFigure
            personaKey={`ring-${i}`}
            variant={f.variant}
            lean={f.lean}
            className="h-28 w-auto text-primary"
          />
        </div>
      ))}
    </div>
  )
}
