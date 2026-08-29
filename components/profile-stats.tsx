import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { BarChart3, TrendingUp } from 'lucide-react'

// The two things the stored profile can say beyond the person on screen:
// where each kind of person turns up, and how the mix has moved.
//
// Both are drawn by hand in SVG. No chart library — that is a standing rule
// here (DESIGN §3), and at this size a library would be more code than the
// thirty lines of geometry it replaces.

/** One colour per persona, held across the chart and its key so a line and a
 *  name are recognisably the same person. */
export const PERSONA_COLOURS = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-5)', 'var(--chart-4)'] as const
export const personaColour = (i: number) => PERSONA_COLOURS[i % PERSONA_COLOURS.length]

const PLATFORM_LABEL: Record<string, string> = {
  tiktok: 'TikTok',
  youtube: 'YouTube',
  instagram: 'Instagram',
  reddit: 'Reddit',
}

// Three greens separated by LIGHTNESS rather than by opacity — tints of one
// colour read as a gradient, which is what made the last version unreadable —
// and the marketing surface's marker yellow for the fourth, where three shades
// of one hue would start to blur. Fixed per platform, so a platform keeps its
// colour even when another one is absent from the data.
const PLATFORM_COLOUR: Record<string, string> = {
  tiktok: 'var(--chart-1)',
  instagram: 'var(--chart-2)',
  youtube: 'var(--chart-4)',
  reddit: '#F7D046',
}
export const platformColour = (p: string) => PLATFORM_COLOUR[p] ?? 'var(--chart-3)'

export interface PlatformRow {
  key: string
  name: string
  total: number
  counts: Record<string, number>
}

export function PlatformMix({ rows, platforms }: { rows: PlatformRow[]; platforms: string[] }) {
  const usable = rows.filter((r) => r.total > 0)
  if (!usable.length || !platforms.length) {
    // Honest empty (Tile keeps its size): an older profile whose insights a
    // later update pruned has nothing left to count. The next profile stores
    // its own mix and does not depend on them.
    return (
      <p className="text-[12.5px] leading-relaxed text-muted-foreground">
        Where each one turns up is not on record for this profile — the conversations it was drawn from have since been superseded. The next profile carries its own count.
      </p>
    )
  }

  return (
    <Card className="rounded-3xl ring-1 ring-primary/25">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base font-semibold">
          <BarChart3 className="size-[1.15rem] text-muted-foreground" aria-hidden />
          Where each one turns up
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3 lg:grid-cols-5">
          {usable.map((row) => (
            <Donut key={row.key} row={row} platforms={platforms} />
          ))}
        </div>
        <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2 border-t pt-4 text-xs text-muted-foreground">
          {platforms.map((p) => (
            <span key={p} className="inline-flex items-center gap-1.5">
              <span className="size-2.5 rounded-sm" style={{ background: platformColour(p) }} aria-hidden />
              {PLATFORM_LABEL[p] ?? p}
            </span>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

/** One persona's platform split, as a ring with its total in the hole.
 *  Drawn with dash offsets on a single circle rather than arc paths: the same
 *  geometry in a tenth of the code, and the gaps between segments come free. */
function Donut({ row, platforms }: { row: PlatformRow; platforms: string[] }) {
  const R = 38
  const C = 2 * Math.PI * R
  const GAP = 2.5

  // A plain loop, not map(): the running offset is reassigned per segment,
  // which the React Compiler lint refuses inside a callback.
  const segments: { p: string; count: number; len: number; offset: number }[] = []
  let offset = 0
  for (const p of platforms) {
    const count = row.counts[p] ?? 0
    if (count <= 0) continue
    const len = (count / row.total) * C
    segments.push({ p, count, len, offset })
    offset += len
  }

  return (
    <figure className="flex flex-col items-center gap-2">
      <figcaption className="text-center text-sm font-medium leading-tight">{row.name}</figcaption>
      <svg viewBox="0 0 100 100" className="w-full max-w-[11rem]" role="img" aria-label={`${row.name}: ${row.total} conversations`}>
        <circle cx="50" cy="50" r={R} fill="none" stroke="var(--muted)" strokeWidth={13} />
        {segments.map((s) => (
          <circle
            key={s.p}
            cx="50"
            cy="50"
            r={R}
            fill="none"
            stroke={platformColour(s.p)}
            strokeWidth={13}
            // The gap is taken off the END of each arc, so a segment never
            // overruns the next one's start and the ring stays true to size.
            strokeDasharray={`${Math.max(0, s.len - GAP)} ${C - Math.max(0, s.len - GAP)}`}
            strokeDashoffset={-s.offset}
            transform="rotate(-90 50 50)"
          >
            <title>{`${row.name} · ${PLATFORM_LABEL[s.p] ?? s.p} · ${s.count.toLocaleString()} conversations`}</title>
          </circle>
        ))}
        <text x="50" y="50" textAnchor="middle" className="fill-foreground" style={{ fontSize: 20, fontWeight: 600 }}>
          {row.total.toLocaleString()}
        </text>
        <text x="50" y="62" textAnchor="middle" className="fill-muted-foreground" style={{ fontSize: 7.5 }}>
          conversations
        </text>
      </svg>
    </figure>
  )
}

export interface ShareSeries {
  key: string
  name: string
  /** Share of the profile at each run, in run order. null where the persona
   *  did not exist in that run — a gap, not a zero. */
  points: (number | null)[]
}

/** How many updates the timeline is drawn for, whether or not they exist yet.
 *  A chart that re-scales with every new reading makes the same history look
 *  different each week; a fixed track means a point stays where it was put and
 *  the line grows into the space to its right. */
const SLOTS = 12

export function ShareOverTime({ dates, series }: { dates: string[]; series: ShareSeries[] }) {
  if (!dates.length || !series.length) return null

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_16rem]">
      <Card className="rounded-3xl ring-1 ring-primary/25">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base font-semibold">
            <TrendingUp className="size-[1.15rem] text-muted-foreground" aria-hidden />
            How the mix has moved
          </CardTitle>
        </CardHeader>
        <CardContent>
          <LineChart dates={dates} series={series} />
        </CardContent>
      </Card>

      <Card className="rounded-3xl ring-1 ring-primary/25">
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-semibold">Who is who</CardTitle>
        </CardHeader>
        <CardContent className="flex h-full flex-col justify-center">
          {/* A key that only maps colours to names leaves the reader to find
              each line on the chart to learn anything. Carrying the current
              share turns it into the chart's table: the same five rows, in the
              same order, with the number the lines are drawn from. */}
          <div className="flex items-center justify-between pb-1 text-[0.65rem] uppercase tracking-wide text-muted-foreground">
            <span>Group</span>
            <span>Share</span>
          </div>
          <ul className="flex flex-col divide-y divide-border/70">
            {series.map((s, i) => {
              const latest = [...s.points].reverse().find((p) => p != null)
              return (
                <li key={s.key} className="flex items-center gap-3 py-3.5">
                  <span
                    className="size-3 shrink-0 rounded-full"
                    style={{ background: personaColour(i) }}
                    aria-hidden
                  />
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">{s.name}</span>
                  <span className="shrink-0 text-sm font-medium tabular-nums">
                    {latest != null ? `${latest}%` : '—'}
                  </span>
                </li>
              )
            })}
          </ul>
        </CardContent>
      </Card>
    </div>
  )
}

/** Hand-drawn multi-line chart. Fixed viewBox, scaled by CSS — the same
 *  approach every other chart in this app uses. */
function LineChart({ dates, series }: { dates: string[]; series: ShareSeries[] }) {
  const W = 560
  const H = 200
  const pad = { top: 16, right: 18, bottom: 26, left: 34 }
  const innerW = W - pad.left - pad.right
  const innerH = H - pad.top - pad.bottom

  // Round the ceiling up to a whole ten so the top label is a number a reader
  // can hold, and so the track does not rescale on a one-point change.
  const peak = Math.max(10, ...series.flatMap((s) => s.points.filter((p): p is number => p != null)))
  const max = Math.ceil(peak / 10) * 10
  const x = (i: number) => pad.left + (i / (SLOTS - 1)) * innerW
  const y = (v: number) => pad.top + innerH - (v / max) * innerH

  const single = dates.length === 1
  // With one update every mark shares an x, and two shares a couple of points
  // apart land almost on top of each other. That column gets its values written
  // beside it, pushed apart to a legible spacing. The LABEL moves; the mark
  // never does.
  const labels = single
    ? (() => {
        const items = series
          .map((s, si) => ({ si, v: s.points[0] }))
          .filter((it): it is { si: number; v: number } => it.v != null)
          .sort((a, b) => b.v - a.v)
        let last = -Infinity
        return items.map((it) => {
          const wanted = Math.max(y(it.v), last + 11)
          last = wanted
          return { ...it, ly: wanted }
        })
      })()
    : []

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="Share of the profile per update">
      {/* Two rules and two labels: the scale a mark is read against. */}
      <line
        x1={pad.left}
        y1={pad.top}
        x2={W - pad.right}
        y2={pad.top}
        stroke="var(--border)"
        strokeWidth={1}
        strokeDasharray="2 3"
        vectorEffect="non-scaling-stroke"
      />
      <line
        x1={pad.left}
        y1={pad.top + innerH}
        x2={W - pad.right}
        y2={pad.top + innerH}
        stroke="var(--border)"
        strokeWidth={1}
        vectorEffect="non-scaling-stroke"
      />
      <text x={pad.left - 6} y={pad.top + 3} textAnchor="end" className="fill-muted-foreground" style={{ fontSize: 9 }}>
        {max}%
      </text>
      <text x={pad.left - 6} y={pad.top + innerH + 3} textAnchor="end" className="fill-muted-foreground" style={{ fontSize: 9 }}>
        0
      </text>
      {series.map((s, si) => {
        // Break the path where a persona was absent, so a gap reads as a gap
        // rather than a straight line through data that does not exist.
        const segments: string[] = []
        let current: string[] = []
        s.points.forEach((p, i) => {
          if (p == null) {
            if (current.length) segments.push(current.join(' '))
            current = []
            return
          }
          current.push(`${current.length ? 'L' : 'M'}${x(i).toFixed(1)},${y(p).toFixed(1)}`)
        })
        if (current.length) segments.push(current.join(' '))
        return (
          <g key={s.key}>
            {segments.map((d, i) => (
              <path
                key={i}
                d={d}
                fill="none"
                stroke={personaColour(si)}
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
              />
            ))}
            {/* With one update there is no line to draw. Each persona gets a
                short stub running RIGHT, into the empty track — the same mark
                the key shows, and it points where the line is going. */}
            {single && s.points[0] != null ? (
              <line
                x1={x(0)}
                y1={y(s.points[0])}
                x2={x(0) + 18}
                y2={y(s.points[0])}
                stroke={personaColour(si)}
                strokeWidth={2}
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
              />
            ) : null}
            {s.points.map((p, i) =>
              p == null ? null : (
                // Ringed in the page's own colour, so two close shares stay two
                // marks instead of merging into one blob.
                <circle
                  key={i}
                  cx={x(i)}
                  cy={y(p)}
                  r={3}
                  fill={personaColour(si)}
                  stroke="var(--background)"
                  strokeWidth={1}
                />
              ),
            )}
          </g>
        )
      })}
      {labels.map(({ si, v, ly }) => (
        <text key={si} x={x(0) + 24} y={ly + 3} className="fill-muted-foreground" style={{ fontSize: 9 }}>
          {v}%
        </text>
      ))}
      {dates.map((d, i) => (
        <text
          key={d + i}
          x={x(i)}
          y={H - 6}
          textAnchor={i === 0 ? 'start' : 'middle'}
          className="fill-muted-foreground"
          style={{ fontSize: 9 }}
        >
          {d.slice(5)}
        </text>
      ))}
    </svg>
  )
}
