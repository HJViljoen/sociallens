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

// Platforms are named by HUE, not by depth. Four tints of one green read as a
// gradient — the eye sorts them into an order that doesn't exist, and two
// adjacent segments of a bar become impossible to tell apart. These are the
// accent hues, deliberately outside the green scale the personas use, so the
// two colour systems on this page can never be mistaken for one axis.
// Fixed per platform rather than by index: a platform keeps its colour even
// when another one drops out of the data.
const PLATFORM_STYLE: Record<string, { bg: string; fg: string }> = {
  tiktok: { bg: 'var(--accent-slate)', fg: '#FFFFFF' },
  youtube: { bg: 'var(--accent-clay)', fg: '#FFFFFF' },
  instagram: { bg: 'var(--accent-plum)', fg: '#FFFFFF' },
  reddit: { bg: 'var(--accent-ochre)', fg: '#3B2C10' },
}
const FALLBACK_STYLE = { bg: 'var(--accent-pine)', fg: '#FFFFFF' }
export const platformStyle = (p: string) => PLATFORM_STYLE[p] ?? FALLBACK_STYLE

export interface PlatformRow {
  key: string
  name: string
  total: number
  counts: Record<string, number>
}

export function PlatformMix({
  rows,
  platforms,
  totals,
  grandTotal,
}: {
  rows: PlatformRow[]
  platforms: string[]
  /** Distinct conversations per platform across the whole profile. */
  totals: Record<string, number>
  /** Distinct conversations behind the profile. Not the sum of the rows —
   *  a conversation where two kinds of person both speak counts once here and
   *  once in each of their rows. */
  grandTotal: number
}) {
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
          Conversations by platform, for each kind of person. Where you find them, not where they came from.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* The measurable line: the size of the whole thing, and how it splits.
            A bar shows proportion; only a number answers "out of how many". */}
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs">
          <span className="font-semibold tabular-nums">
            {grandTotal.toLocaleString()} conversations
          </span>
          {platforms.map((p) => (
            <span key={p} className="inline-flex items-center gap-1.5 text-muted-foreground">
              <span
                className="size-2.5 rounded-sm"
                style={{ background: platformStyle(p).bg }}
                aria-hidden
              />
              {PLATFORM_LABEL[p] ?? p}
              <span className="font-medium tabular-nums text-foreground">
                {(totals[p] ?? 0).toLocaleString()}
              </span>
            </span>
          ))}
        </div>

        <div className="space-y-2.5">
          <div className="grid grid-cols-[8.5rem_1fr_4rem] gap-3 text-[0.65rem] uppercase tracking-wide text-muted-foreground">
            <span />
            <span />
            <span className="text-right">Total</span>
          </div>
          {usable.map((row) => (
            <div key={row.key} className="grid grid-cols-[8.5rem_1fr_4rem] items-center gap-3">
              <span className="truncate text-sm font-medium">{row.name}</span>
              <span className="flex h-7 overflow-hidden rounded-md bg-muted">
                {platforms.map((p) => {
                  const count = row.counts[p] ?? 0
                  if (count <= 0) return null
                  const pct = (count / row.total) * 100
                  const style = platformStyle(p)
                  return (
                    <span
                      key={p}
                      className="flex items-center justify-center overflow-hidden"
                      style={{ width: `${pct}%`, background: style.bg }}
                      title={`${row.name} · ${PLATFORM_LABEL[p] ?? p} · ${count.toLocaleString()} conversations (${Math.round(pct)}%)`}
                    >
                      {/* Only where it fits. A number clipped in half is worse
                          than no number — the tooltip still carries every one. */}
                      {pct >= 11 ? (
                        <span className="text-[0.7rem] font-medium tabular-nums" style={{ color: style.fg }}>
                          {count.toLocaleString()}
                        </span>
                      ) : null}
                    </span>
                  )
                })}
              </span>
              <span className="text-right text-sm font-medium tabular-nums">{row.total.toLocaleString()}</span>
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
  if (!dates.length || !series.length) return null

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
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-center sm:gap-8">
          <LineChart dates={dates} series={series} />
          <ul className="flex flex-row flex-wrap gap-x-4 gap-y-2 sm:w-40 sm:shrink-0 sm:flex-col">
            {series.map((s, i) => (
              <li key={s.key} className="flex items-center gap-2 text-xs">
                <span
                  className="h-1 w-5 shrink-0 rounded-full"
                  style={{ background: personaColour(i) }}
                  aria-hidden
                />
                <span className="truncate">{s.name}</span>
              </li>
            ))}
          </ul>
        </div>
        {dates.length < 2 ? (
          // The points are real and plotted. What isn't there yet is the
          // movement — say that, rather than let a single column read as a
          // trend that happens to be flat.
          <p className="pt-2 text-xs text-muted-foreground">
            One update so far. These are today&rsquo;s shares; the lines join them from your next one.
          </p>
        ) : null}
      </CardContent>
    </Card>
  )
}

/** Hand-drawn multi-line chart. Fixed viewBox, scaled by CSS — the same
 *  approach every other chart in this app uses. */
function LineChart({ dates, series }: { dates: string[]; series: ShareSeries[] }) {
  const W = 320
  const H = 120
  const pad = { top: 10, right: 8, bottom: 18, left: 24 }
  const innerW = W - pad.left - pad.right
  const innerH = H - pad.top - pad.bottom

  // Round the ceiling up to a whole ten so the top label is a number a reader
  // can hold, and a single plotted point still lands somewhere meaningful on
  // the axis rather than pinned to the top of the box.
  const peak = Math.max(10, ...series.flatMap((s) => s.points.filter((p): p is number => p != null)))
  const max = Math.ceil(peak / 10) * 10
  const x = (i: number) => pad.left + (dates.length === 1 ? innerW / 2 : (i / (dates.length - 1)) * innerW)
  const y = (v: number) => pad.top + innerH - (v / max) * innerH

  // With a single update every dot shares an x, and two shares a couple of
  // points apart land almost on top of each other — Össur's third and fourth
  // are 17% and 15%. So that column gets its values written beside it, pushed
  // apart to a legible spacing. The LABEL moves; the dot never does.
  const single = dates.length === 1
  const labels = single
    ? (() => {
        const items = series
          .map((s, si) => ({ si, v: s.points[0] }))
          .filter((it): it is { si: number; v: number } => it.v != null)
          .sort((a, b) => b.v - a.v)
        let last = -Infinity
        return items.map((it) => {
          const wanted = Math.max(y(it.v), last + 9)
          last = wanted
          return { ...it, ly: wanted }
        })
      })()
    : []

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-48 w-full max-w-[32rem]" role="img" aria-label="Share of the profile per update">
      {/* Two rules and two labels: the scale a dot is read against. Without
          them a lone column of points is decoration. */}
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
      <text x={pad.left - 5} y={pad.top + 3} textAnchor="end" className="fill-muted-foreground" style={{ fontSize: 8 }}>
        {max}%
      </text>
      <text x={pad.left - 5} y={pad.top + innerH + 3} textAnchor="end" className="fill-muted-foreground" style={{ fontSize: 8 }}>
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
                strokeWidth={1.75}
                strokeLinecap="round"
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
              />
            ))}
            {/* With one update there is no line to draw, and five specks in the
                middle of an empty box read as noise. Each persona gets a short
                stub instead — the same mark the legend shows, which is what
                makes it read as a line that has not been continued yet. */}
            {single && s.points[0] != null ? (
              <line
                x1={x(0) - 11}
                y1={y(s.points[0])}
                x2={x(0) + 11}
                y2={y(s.points[0])}
                stroke={personaColour(si)}
                strokeWidth={1.75}
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
              />
            ) : null}
            {s.points.map((p, i) =>
              p == null ? null : (
                // Ringed in the page's own colour: with one update every dot
                // shares an x, and two close shares would otherwise merge into
                // a single blob.
                <circle
                  key={i}
                  cx={x(i)}
                  cy={y(p)}
                  r={2.6}
                  fill={personaColour(si)}
                  stroke="var(--background)"
                  strokeWidth={0.9}
                />
              ),
            )}
          </g>
        )
      })}
      {labels.map(({ si, v, ly }) => (
        <text
          key={si}
          x={x(0) + 15}
          y={ly + 3}
          className="fill-muted-foreground"
          style={{ fontSize: 8 }}
        >
          {v}%
        </text>
      ))}
      {dates.map((d, i) => (
        <text
          key={d + i}
          x={x(i)}
          y={H - 4}
          textAnchor={dates.length === 1 ? 'middle' : i === 0 ? 'start' : i === dates.length - 1 ? 'end' : 'middle'}
          className="fill-muted-foreground"
          style={{ fontSize: 8 }}
        >
          {d.slice(5)}
        </text>
      ))}
    </svg>
  )
}
