import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { BarChart3, TrendingUp } from 'lucide-react'

// The two things the stored profile can say beyond the person on screen:
// where each kind of person turns up, and how the mix has moved.
//
// Both are drawn by hand in SVG. No chart library — that is a standing rule
// here (DESIGN §3), and at this size a library would be more code than the
// twenty lines of geometry it replaces.

/** One colour per persona, held across both charts and the legend so a line
 *  and a row are recognisably the same person. */
export const PERSONA_COLOURS = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-5)', 'var(--chart-4)'] as const
export const personaColour = (i: number) => PERSONA_COLOURS[i % PERSONA_COLOURS.length]

const PLATFORM_LABEL: Record<string, string> = {
  tiktok: 'TikTok',
  youtube: 'YouTube',
  instagram: 'Instagram',
  reddit: 'Reddit',
}
// Platforms get their own scale, deliberately not the persona hues: two colour
// systems on one page must not look like the same axis.
const PLATFORM_SHADE = ['bg-primary/75', 'bg-primary/50', 'bg-primary/30', 'bg-primary/15'] as const

export interface PlatformRow {
  key: string
  name: string
  total: number
  counts: Record<string, number>
}

export function PlatformMix({ rows, platforms }: { rows: PlatformRow[]; platforms: string[] }) {
  const usable = rows.filter((r) => r.total > 0)
  if (!usable.length || !platforms.length) return null

  return (
    <Card className="rounded-3xl ring-1 ring-primary/25">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base font-semibold">
          <BarChart3 className="size-[1.15rem] text-muted-foreground" aria-hidden />
          Where each one turns up
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Share of each group&rsquo;s conversations by platform. Where you find this person, not where they came from.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          {platforms.map((p, i) => (
            <span key={p} className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className={`size-2.5 rounded-sm ${PLATFORM_SHADE[i % PLATFORM_SHADE.length]}`} aria-hidden />
              {PLATFORM_LABEL[p] ?? p}
            </span>
          ))}
        </div>

        <div className="space-y-3">
          {usable.map((row) => (
            <div key={row.key} className="grid grid-cols-[9rem_1fr] items-center gap-3">
              <span className="truncate text-sm font-medium">{row.name}</span>
              <span className="flex h-3 overflow-hidden rounded-full bg-muted">
                {platforms.map((p, i) => {
                  const pct = ((row.counts[p] ?? 0) / row.total) * 100
                  if (pct <= 0) return null
                  return (
                    <span
                      key={p}
                      className={PLATFORM_SHADE[i % PLATFORM_SHADE.length]}
                      style={{ width: `${pct}%` }}
                      title={`${row.name} · ${PLATFORM_LABEL[p] ?? p} · ${Math.round(pct)}%`}
                    />
                  )
                })}
              </span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

export interface ShareSeries {
  key: string
  name: string
  /** Share of the profile at each run, in run order. null where the persona
   *  did not exist in that run — a gap, not a zero. */
  points: (number | null)[]
}

export function ShareOverTime({ dates, series }: { dates: string[]; series: ShareSeries[] }) {
  return (
    <Card className="rounded-3xl ring-1 ring-primary/25">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base font-semibold">
          <TrendingUp className="size-[1.15rem] text-muted-foreground" aria-hidden />
          How the mix has moved
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Each group&rsquo;s share of the profile, update by update.
        </p>
      </CardHeader>
      <CardContent>
        {dates.length < 2 ? (
          // One reading is a dot, not a trend. Saying so beats drawing a chart
          // that implies a line where there is no second point.
          <p className="py-6 text-center text-sm text-muted-foreground">
            This chart needs two updates to draw a line. It appears after your next one.
          </p>
        ) : (
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
            <LineChart dates={dates} series={series} />
            <ul className="flex flex-row flex-wrap gap-x-4 gap-y-2 sm:w-40 sm:shrink-0 sm:flex-col">
              {series.map((s, i) => (
                <li key={s.key} className="flex items-center gap-2 text-xs">
                  <span
                    className="h-0.5 w-4 shrink-0 rounded-full"
                    style={{ background: personaColour(i) }}
                    aria-hidden
                  />
                  <span className="truncate">{s.name}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

/** Hand-drawn multi-line chart. Fixed viewBox, scaled by CSS — the same
 *  approach every other chart in this app uses. */
function LineChart({ dates, series }: { dates: string[]; series: ShareSeries[] }) {
  const W = 320
  const H = 120
  const pad = { top: 8, right: 6, bottom: 18, left: 6 }
  const innerW = W - pad.left - pad.right
  const innerH = H - pad.top - pad.bottom

  const max = Math.max(
    10,
    ...series.flatMap((s) => s.points.filter((p): p is number => p != null)),
  )
  const x = (i: number) => pad.left + (dates.length === 1 ? innerW / 2 : (i / (dates.length - 1)) * innerW)
  const y = (v: number) => pad.top + innerH - (v / max) * innerH

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-40 w-full" role="img" aria-label="Share of the profile per update">
      {/* Baseline only. Gridlines would add ink without adding a reading at
          this size — the legend and the shape carry it. */}
      <line
        x1={pad.left}
        y1={pad.top + innerH}
        x2={W - pad.right}
        y2={pad.top + innerH}
        stroke="var(--border)"
        strokeWidth={1}
        vectorEffect="non-scaling-stroke"
      />
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
                strokeWidth={1.75}
                strokeLinecap="round"
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
              />
            ))}
            {s.points.map((p, i) =>
              p == null ? null : <circle key={i} cx={x(i)} cy={y(p)} r={2} fill={personaColour(si)} />,
            )}
          </g>
        )
      })}
      {dates.map((d, i) => (
        <text
          key={d + i}
          x={x(i)}
          y={H - 4}
          textAnchor={i === 0 ? 'start' : i === dates.length - 1 ? 'end' : 'middle'}
          className="fill-muted-foreground"
          style={{ fontSize: 8 }}
        >
          {d.slice(5)}
        </text>
      ))}
    </svg>
  )
}
