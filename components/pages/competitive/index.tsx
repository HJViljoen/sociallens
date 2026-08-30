import Link from 'next/link'
import { Fragment, type ReactNode } from 'react'
import { HowToRead } from '@/components/how-to-read'
import { ExportMenu, ExportScope } from '@/components/export-menu'
import { PageFrame, PageGrid, PageBar, BarPill } from '@/components/shell/page-grid'
import { Tile, TileEmpty } from '@/components/shell/tile'
import { cn } from '@/lib/utils'
import { MasterDetail } from '@/components/shell/master-detail'
import { PaneHeader, PaneBody, RailGroup, RailLink, ListRows, ListRow, PaneEmpty, DetailHeader, DetailSection, Verbatim } from '@/components/shell/master-list'
import { ListSearch } from '@/components/shell/list-search'
import { LineChart } from '@/components/charts/line-chart'
import { Delta } from '@/components/charts/stat'
import { fmtInt, fmtPct, fmtDelta, round1, weekdayDate, shortDate } from '@/lib/format'
import { kindOf, competitorBucket, SENTIMENT_MIN_JUDGED, type KindTone } from '@/lib/competitive-tiles'
import {
  loadCompetitive, isCompetitiveEmpty, competitiveFindingHref, LEGEND_ITEMS,
  type CompetitiveData, type CompetitiveEmpty, type FindingDetail,
} from '@/lib/pages/competitive'
import type { PageModule, PrintVariant, RenderMode, Renderable, Slide } from '@/lib/renderables/types'
import { FaceOff, FaceOffHeader, YOU_COLOR, THEM_COLOR } from './face-off'
import { competitiveEmail } from '@/components/email/tiles'

// Competitive Intelligence renderers — the JSX half of the old page (split
// 2026-08-29, Reports & Exports T5), one pure function per tile/pane. `mode`
// changes only what has no meaning on paper: links, ListSearch, the
// "Face-off vs X" nav. MasterDetail (client, resizable) has no print
// equivalent — in print, `rail`/`list`/`detail` self-wrap in the same Pane
// classes it would otherwise supply, so a standalone tile export (or three
// side by side) reads as three static columns.

const COMP_DIM = 'color-mix(in srgb, var(--comp) 55%, var(--tile))'
const PANE_CLASS = 'flex h-full min-h-0 flex-col overflow-hidden rounded-lg bg-tile shadow-tile'

const KIND_CHIP: Record<KindTone, string> = {
  lead: 'bg-accent text-accent-foreground',
  threat: 'bg-negative/12 text-negative',
  gap: 'bg-warning/15 text-warning',
  tone: 'bg-inner text-muted-foreground',
  other: 'bg-inner text-muted-foreground',
}

function KindChip({ category }: { category: string }) {
  const k = kindOf(category)
  return <span className={`inline-flex shrink-0 items-center rounded-full px-2 py-px text-[10.5px] font-semibold ${KIND_CHIP[k.tone]}`}>{k.label}</span>
}

type D = CompetitiveData
type R = (data: D, mode: RenderMode) => ReactNode

/** One standings row: rank · dot · name · pct · delta, a bar underneath. A
 *  `Link` only in app mode — the rows aren't clickable on paper. */
function standingRow(opts: { name: string; you?: boolean; pct: number; videos: number; delta: number | null; rank?: number; color: string; active: boolean; maxPct: number; href?: string }) {
  const inner = (
    <>
      <div className="flex items-center gap-2.5">
        <span className="w-4 shrink-0 font-mono text-[11.5px] font-semibold tabular-nums text-muted-foreground">{opts.rank ?? ''}</span>
        <span className="size-2 shrink-0 rounded-[2px]" style={{ background: opts.color }} aria-hidden />
        <span className={cn('min-w-0 flex-1 truncate text-[12.5px]', opts.you ? 'text-secondary-foreground' : 'font-semibold')}>{opts.name}</span>
        <span className="font-mono text-[12px] font-semibold tabular-nums">{fmtPct(opts.pct)}</span>
        <span className="w-14 text-right"><Delta value={opts.delta} unit="pt" good={opts.you ? 'up' : 'down'} /></span>
      </div>
      <div className="mt-0.5 flex items-center gap-2 pl-[26px]">
        <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-inner"><span className="block h-full rounded-full" style={{ width: `${Math.max(2, (opts.pct / opts.maxPct) * 100)}%`, background: opts.color }} /></span>
        <span className="w-16 shrink-0 text-right font-mono text-[10.5px] tabular-nums text-muted-foreground">{fmtInt(opts.videos)} videos</span>
      </div>
    </>
  )
  const cls = cn('block rounded-[4px] px-2.5 py-1.5', opts.active && 'bg-inner', opts.href && 'hover:bg-inner/70')
  return opts.href ? <Link href={opts.href} className={cls} aria-current={opts.active ? 'true' : undefined}>{inner}</Link> : <div className={cls}>{inner}</div>
}

// ── where you stand ─────────────────────────────────────────────────────
const standings: R = (d, mode) => {
  const app = mode === 'app'
  const s = d.standings
  if (!s) {
    return (
      <Tile exportKey="competitive.standings" col={12} row={2} eyebrow="Where you stand" meta={d.layerWord}>
        <TileEmpty>The face-off starts once a competitor’s videos are tracked — add competitors in Settings, and the next update compares you side by side.</TileEmpty>
      </Tile>
    )
  }
  const sel = d.selection
  return (
    <Tile exportKey="competitive.standings" col={4} row={3} eyebrow="Where you stand" meta={`by videos · ${d.layerWord}`}
      footerNote={`${s.competitors.length} competitor${s.competitors.length === 1 ? '' : 's'} tracked`}
      footer={app ? <span className="text-[11.5px] font-normal text-muted-foreground">Select a competitor to face off →</span> : undefined}
    >
      {s.client && (
        <div className="flex items-baseline gap-2">
          <span className="font-mono text-[30px] font-semibold leading-none tabular-nums tracking-[-0.01em]">{fmtPct(s.client.pct)}</span>
          <Delta value={s.client.delta} unit="pt" good="up" />
          <span className="text-[11.5px] text-muted-foreground">of tracked conversation is you</span>
        </div>
      )}
      <ol className="-mx-2.5 flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto">
        {s.competitors.map((c, i) => (
          <li key={c.name}>
            {standingRow({
              name: c.name, pct: c.pct, videos: c.videos, delta: c.delta, rank: i + 1, maxPct: s.maxPct,
              color: c.name === sel.vs ? THEM_COLOR : COMP_DIM, active: c.name === sel.vs,
              href: app ? competitiveFindingHref({ vs: c.name, kind: sel.kind, about: sel.about, item: sel.itemId }) : undefined,
            })}
          </li>
        ))}
        {s.client && <li>{standingRow({ name: s.client.name, you: true, pct: s.client.pct, videos: s.client.videos, delta: s.client.delta, color: YOU_COLOR, active: false, maxPct: s.maxPct })}</li>}
      </ol>
    </Tile>
  )
}

// ── face-off vs the selected competitor ──────────────────────────────────
const faceoff: R = (d, mode) => {
  if (!d.standings || !d.faceoff) return null
  const app = mode === 'app'
  const fo = d.faceoff
  return (
    <Tile exportKey="competitive.faceoff" col={8} row={3} eyebrow={`Face-off · ${d.brandShort} vs ${fo.lead}`} meta={d.layerWord}
      footer={fo.leadFindings > 0 ? (
        app
          ? <Link href={competitiveFindingHref({ vs: fo.lead, about: fo.lead }, 'findings')}>{fo.leadFindings} finding{fo.leadFindings === 1 ? '' : 's'} about {fo.lead} ↓</Link>
          : <span>{fo.leadFindings} finding{fo.leadFindings === 1 ? '' : 's'} about {fo.lead}</span>
      ) : undefined}
      footerNote={fo.youDelta != null && fo.themDelta != null ? `vs last update: ${d.brandShort} ${fmtDelta(fo.youDelta, 'pt', 1)} · ${fo.lead} ${fmtDelta(fo.themDelta, 'pt', 1)}` : undefined}
      bodyClassName="min-h-0 overflow-y-auto">
      {fo.rows.length > 0 ? (
        <div className="flex flex-col gap-3">
          <FaceOffHeader
            you={`${d.brandShort} · you`} youLine={fo.youPraise ? `Praised for ${fo.youPraise.toLowerCase()}` : undefined}
            centre={d.layerWord === 'this update' ? 'This update' : 'All updates'}
            them={fo.lead} themLine={fo.themPraise ? `Praised for ${fo.themPraise.toLowerCase()}` : undefined}
          />
          <div className="flex flex-col gap-3"><FaceOff rows={fo.rows} /></div>
        </div>
      ) : <TileEmpty>Nothing to compare against {fo.lead} yet — the face-off fills in as their videos are tracked and analysed.</TileEmpty>}
    </Tile>
  )
}

// ── share of tracked conversation over time ──────────────────────────────
const shareLine: R = (d) => {
  if (!d.standings) return null
  const series = d.shareLine.series
  const lead = d.selection.vs
  return (
    <Tile exportKey="competitive.shareLine" col={7} row={2} eyebrow="Share of tracked conversation over time"
      meta={series ? `${d.updatesCount} updates · ${series.layer === 'cumulative' ? 'all-time share' : 'share per update'}` : undefined}
      footerNote={series ? `since your first update: ${d.brandShort} ${fmtDelta(series.youDelta, 'pt', 1)}${series.themDelta != null ? ` · ${lead} ${fmtDelta(series.themDelta, 'pt', 1)}` : ''}` : undefined}
      bodyClassName="min-h-0 justify-center">
      {series && lead ? (
        <div className="overflow-x-auto">
          <LineChart
            series={[
              { label: d.brandShort, values: series.you, color: YOU_COLOR },
              ...(series.them ? [{ label: lead, values: series.them, color: THEM_COLOR }] : []),
            ]}
            labels={series.dates.map(shortDate)}
            format={(v) => `${round1(v)}%`}
            width={620} height={150} padL={40} padR={110}
          />
        </div>
      ) : <TileEmpty>Two updates are needed to draw a line — the first comparison lands with the next update.</TileEmpty>}
    </Tile>
  )
}

// ── the full comparison ───────────────────────────────────────────────────
const table: R = (d) => {
  if (!d.standings) return null
  const rows = d.table.rows
  const lead = d.selection.vs
  return (
    <Tile exportKey="competitive.table" col={5} row={2} eyebrow="The full comparison" meta="incl. the wider category" bodyClassName="min-h-0 overflow-auto">
      {rows.length > 0 ? (
        <table className="w-full text-[11.5px]">
          <thead>
            <tr className="border-b border-border/70 text-[10px] uppercase tracking-[0.05em] text-muted-foreground">
              <th className="pb-1 pr-2 text-left font-semibold">Who</th>
              <th className="pb-1 pr-2 text-right font-semibold">Videos</th>
              <th className="pb-1 pr-2 text-right font-semibold">Share</th>
              <th className="pb-1 pr-2 text-right font-semibold">Comments</th>
              <th className="pb-1 pr-2 text-right font-semibold">Eng.</th>
              <th className="pb-1 pr-2 text-right font-semibold">Positive</th>
              <th className="pb-1 text-right font-semibold">Themes</th>
            </tr>
          </thead>
          <tbody className="font-mono tabular-nums">
            {rows.map((r) => (
              <tr key={r.key} className={`border-b border-border/70 last:border-0 ${(lead && r.key === competitorBucket(lead)) || r.key === 'client' ? 'font-semibold' : ''}`}>
                <td className="py-1 pr-2 font-sans"><span className="flex items-center gap-1.5"><span className="size-2 shrink-0 rounded-[2px]" style={{ background: r.color }} aria-hidden />{r.label}</span></td>
                <td className="py-1 pr-2 text-right">{fmtInt(r.videos)}</td>
                <td className="py-1 pr-2 text-right">{fmtPct(r.pct)}</td>
                <td className="py-1 pr-2 text-right">{r.comments != null ? fmtInt(r.comments) : '—'}</td>
                <td className="py-1 pr-2 text-right">{r.engagement != null ? fmtPct(r.engagement) : '—'}</td>
                <td className="py-1 pr-2 text-right">{r.positive != null ? fmtPct(r.positive, 0) : '—'}</td>
                <td className="py-1 text-right">{r.themes != null ? fmtInt(r.themes) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : <TileEmpty>The comparison fills in with the next update.</TileEmpty>}
      {rows.length > 0 && (
        <p className="text-[10.5px] leading-[1.45] text-muted-foreground">
          Videos and share are {d.layerWord === 'this update' ? 'this update’s' : 'all-time'} tracked conversation by who posted. Comments as platforms report them; engagement is the mean rate across this update’s videos that carry one. Positive is the share of rated videos, shown only with {SENTIMENT_MIN_JUDGED}+ rated{rows.some((r) => r.judged > 0) ? ` — ${rows.filter((r) => r.judged > 0).map((r) => `${r.label.replace(' · you', '')} ${fmtInt(r.judged)}`).join(', ')} rated` : ''}. Themes are those heard under each group’s videos in the latest analysed update.
        </p>
      )}
    </Tile>
  )
}

// ── findings: rail ──────────────────────────────────────────────────────
const rail: R = (d, mode) => {
  const sel = d.selection
  const body = (
    <>
      <PaneHeader title="Findings" meta={d.rail.insightsCount > 0 ? `${d.rail.insightsCount} · ${weekdayDate(d.runDate)}` : undefined} />
      <PaneBody>
        <RailGroup>
          <RailLink href={competitiveFindingHref({ vs: sel.vs })} active={!sel.kind && !sel.about} count={d.rail.insightsCount}>All findings</RailLink>
        </RailGroup>
        {d.rail.kinds.length > 0 && (
          <RailGroup label="By kind">
            {d.rail.kinds.map((g) => (
              <RailLink key={g.category} href={competitiveFindingHref({ vs: sel.vs, kind: g.category })} active={sel.kind === g.category} count={g.count}>{g.label}</RailLink>
            ))}
          </RailGroup>
        )}
        {d.rail.competitors.length > 0 && (
          <RailGroup label="About a competitor">
            {d.rail.competitors.map((c) => (
              <RailLink key={c.name} href={competitiveFindingHref({ vs: sel.vs, about: c.name })} active={sel.about === c.name && !sel.kind} count={c.count}>{c.name}</RailLink>
            ))}
          </RailGroup>
        )}
      </PaneBody>
    </>
  )
  return mode === 'print' ? <div className={PANE_CLASS}>{body}</div> : body
}

// ── findings: list ──────────────────────────────────────────────────────
const LIST_ID = 'competitive-list'
const list: R = (d, mode) => {
  const app = mode === 'app'
  const sel = d.selection
  const l = d.list
  const body = (
    <>
      <PaneHeader title={l.title} meta={l.meta ?? undefined}>
        {app && l.searchable && <ListSearch scope={LIST_ID} placeholder="Search findings…" />}
        {l.blurb && <p className="text-[11.5px] text-muted-foreground">{l.blurb}</p>}
      </PaneHeader>
      <PaneBody>
        <div id={LIST_ID}>
          {l.rows.length > 0 ? (
            <ListRows>
              {l.rows.map((ci) => (
                <ListRow key={ci.id} href={competitiveFindingHref({ vs: sel.vs, kind: sel.kind, about: sel.about, item: ci.id }, 'findings')} active={ci.id === sel.itemId} search={ci.search}>
                  <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                    <KindChip category={ci.category} />
                    {ci.competitorName && <span className="min-w-0 truncate">vs {ci.competitorName}</span>}
                    {ci.coverage && <span className={`ml-auto shrink-0 font-mono text-[10.5px] ${ci.coverage.thin ? 'text-warning' : ''}`}>{ci.coverage.text}</span>}
                  </div>
                  <p className="mt-1 line-clamp-2 text-[13px] font-semibold leading-[1.3]">{ci.title}</p>
                  <p className="mt-0.5 line-clamp-1 text-[11.5px] text-muted-foreground">{ci.finding}</p>
                </ListRow>
              ))}
            </ListRows>
          ) : <PaneEmpty>{l.emptyMessage}</PaneEmpty>}
        </div>
      </PaneBody>
    </>
  )
  return mode === 'print' ? <div className={PANE_CLASS}>{body}</div> : body
}

// ── findings: detail ──────────────────────────────────────────────────────
const detail: R = (d, mode) => {
  const app = mode === 'app'
  const f = d.detail
  const body = (
    <>
      {f && (
        <DetailHeader eyebrow={kindOf(f.category).label} title={f.title} meta={[f.competitorName ? `vs ${f.competitorName}` : null, f.coverage?.text, f.impact].filter(Boolean).join(' · ')}>
          {kindOf(f.category).blurb && <p className="mt-1.5 text-[11.5px] text-muted-foreground">{kindOf(f.category).blurb}</p>}
        </DetailHeader>
      )}
      <PaneBody>
        {f ? (
          <>
            <DetailSection label="The finding">
              <p className="text-[13px] leading-[1.55]">{f.finding}</p>
            </DetailSection>
            {f.quotes.length > 0 && (
              <DetailSection label={f.competitorName ? `${f.competitorName}’s audience, in their words` : 'In their words'}>
                <div className="flex flex-col gap-2.5">{f.quotes.map((q, i) => <Verbatim key={i} quote={q.text} />)}</div>
              </DetailSection>
            )}
            <DetailSection label="Grounded in">
              <p className="text-[12.5px] text-secondary-foreground">
                {f.voices > 0 ? <><span className="font-mono font-semibold text-foreground">{fmtInt(f.voices)}</span> {f.voices === 1 ? 'voice' : 'voices'}</> : 'its supporting themes'}
                {f.coverage?.thin && <span className="text-warning"> · thin coverage — a hint, not a finding</span>}
              </p>
              {f.platforms.length > 0 && (
                <p className="mt-1 flex flex-wrap gap-x-3 font-mono text-[10.5px] tabular-nums text-muted-foreground">
                  {f.platforms.map((p) => <span key={p.label}>{p.label} {p.count}</span>)}
                </p>
              )}
              {f.support.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {f.support.map((s) => <span key={s} className="rounded-full bg-inner px-2 py-px text-[10.5px] text-muted-foreground">{s.replace(/_/g, ' ')}</span>)}
                </div>
              )}
            </DetailSection>
            {app && f.faceOffTarget && (
              <DetailSection className="border-t border-border/70">
                <Link href={competitiveFindingHref({ vs: f.faceOffTarget, kind: d.selection.kind, about: d.selection.about, item: f.id })} className="text-[12.5px] font-medium hover:underline">Face-off vs {f.faceOffTarget} ↑</Link>
              </DetailSection>
            )}
          </>
        ) : <PaneEmpty>{app ? 'Select a finding to read it with its voices.' : d.list.emptyMessage}</PaneEmpty>}
      </PaneBody>
    </>
  )
  return mode === 'print' ? <div className={PANE_CLASS}>{body}</div> : body
}

// ── the selected finding, in full — a two-column print slide ──────────────
function FindingBody({ f }: { f: FindingDetail }) {
  const k = kindOf(f.category)
  return (
    <div className="grid h-full min-h-0 grid-cols-[3fr_2fr] gap-6">
      <div className="min-h-0 space-y-3 overflow-hidden">
        <p className="text-[10.5px] font-semibold uppercase tracking-[0.06em] text-secondary-foreground">{k.label}{f.competitorName ? ` · vs ${f.competitorName}` : ''}</p>
        <h3 className="text-[15px] font-semibold leading-[1.3] tracking-[-0.005em] [text-wrap:pretty]">{f.title}</h3>
        <p className="text-[13px] leading-[1.55]">{f.finding}</p>
        {f.quotes.length > 0 && (
          <div className="space-y-2 border-t border-border/70 pt-3">
            <p className="text-[10.5px] font-semibold uppercase tracking-[0.07em] text-muted-foreground">{f.competitorName ? `${f.competitorName}’s audience, in their words` : 'In their words'}</p>
            {f.quotes.map((q, i) => <blockquote key={i} className="border-l-2 border-border pl-2.5 text-[12.5px] italic leading-[1.4] text-foreground/90">“{q.text}”</blockquote>)}
          </div>
        )}
      </div>
      <div className="min-h-0 space-y-3 overflow-hidden">
        <p className="text-[10.5px] font-semibold uppercase tracking-[0.06em] text-secondary-foreground">Grounded in</p>
        <p className="text-[12.5px] text-secondary-foreground">
          {f.voices > 0 ? <>{fmtInt(f.voices)} {f.voices === 1 ? 'voice' : 'voices'}</> : 'its supporting themes'}
          {f.coverage && <span className="block text-[11px] text-muted-foreground">{f.coverage.text}</span>}
        </p>
        {f.platforms.length > 0 && (
          <p className="flex flex-wrap gap-x-3 font-mono text-[10.5px] tabular-nums text-muted-foreground">
            {f.platforms.map((p) => <span key={p.label}>{p.label} {p.count}</span>)}
          </p>
        )}
        {f.support.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {f.support.map((s) => <span key={s} className="rounded-full bg-inner px-2 py-px text-[10.5px] text-muted-foreground">{s.replace(/_/g, ' ')}</span>)}
          </div>
        )}
      </div>
    </div>
  )
}

const finding: R = (d) => (d.detail ? <FindingBody f={d.detail} /> : <TileEmpty>{d.list.emptyMessage}</TileEmpty>)

/** Full export: one finding per slide — key `competitive.item:<index>`. */
const ITEM_SLIDE_PREFIX = 'competitive.item:'

function competitiveItemSlide(n: number): Renderable<D> {
  return {
    key: `${ITEM_SLIDE_PREFIX}${n}`,
    title: 'Finding',
    render: (d) => {
      const f = d.allFindings?.[n]
      return f ? <FindingBody f={f} /> : null
    },
  }
}

const baseRenderables: Record<string, Renderable<D>> = {
  'competitive.standings': { key: 'competitive.standings', title: 'Where you stand', render: standings },
  'competitive.faceoff': { key: 'competitive.faceoff', title: 'Face-off', render: faceoff },
  'competitive.shareLine': { key: 'competitive.shareLine', title: 'Share of tracked conversation over time', render: shareLine },
  'competitive.table': { key: 'competitive.table', title: 'The full comparison', render: table },
  'competitive.rail': { key: 'competitive.rail', title: 'Findings', render: rail },
  'competitive.list': { key: 'competitive.list', title: 'Findings list', render: list },
  'competitive.detail': { key: 'competitive.detail', title: 'Finding', render: detail },
  'competitive.finding': { key: 'competitive.finding', title: 'The selected finding', render: finding },
}

const OVERVIEW_ORDER = ['competitive.standings', 'competitive.faceoff', 'competitive.shareLine', 'competitive.table']

for (const [k, fn] of Object.entries(competitiveEmail)) baseRenderables[k].email = fn

function competitiveSlides(d: D, variant: PrintVariant): Slide[] {
  const slides: Slide[] = [
    { title: 'Where you stand', keys: ['competitive.standings', 'competitive.faceoff'], layout: 'grid' },
    { title: 'Share over time and the full comparison', keys: ['competitive.shareLine', 'competitive.table'], layout: 'grid' },
    { title: d.detail ? d.detail.title : 'The selected finding', keys: ['competitive.finding'], layout: 'single' },
  ]
  if (variant === 'full') {
    const n = d.allFindings?.length ?? 0
    for (let i = 0; i < n; i++) slides.push({ title: d.allFindings![i].title, keys: [`${ITEM_SLIDE_PREFIX}${i}`], layout: 'single' })
  }
  return slides
}

export const competitivePage: PageModule<D> = {
  key: 'competitive',
  title: 'Competitive Intelligence',
  async load(scope) {
    const d = await loadCompetitive(scope)
    return isCompetitiveEmpty(d) ? null : d
  },
  slides: (d, variant) => competitiveSlides(d, variant),
  renderables: new Proxy(baseRenderables, {
    get(target, key: string) {
      if (key in target) return target[key]
      if (typeof key === 'string' && key.startsWith(ITEM_SLIDE_PREFIX)) return competitiveItemSlide(Number(key.slice(ITEM_SLIDE_PREFIX.length)))
      return undefined
    },
  }),
  snapshotTitle: (d) => `Competitive Intelligence · ${d.brand} · ${weekdayDate(d.runDate)}`,
}

/** The app page: page bar, the overview grid, the findings master-detail. */
export function CompetitivePage({ data: d, detail: detailParam, params }: { data: CompetitiveData | CompetitiveEmpty; detail?: string; params: Record<string, string | undefined> }) {
  const showLegend = detailParam === 'legend'
  if (isCompetitiveEmpty(d)) {
    return (
      <PageFrame>
        <PageBar title="Competitive Intelligence" context={d.brand} />
        <section className="rounded-lg bg-tile p-6 shadow-tile">
          <p className="text-[12px] text-muted-foreground">Your first comparison lands with {d.nextUpdate} — check back then.</p>
        </section>
      </PageFrame>
    )
  }
  return (
    <ExportScope page="competitive" params={params} tiles={Object.values(baseRenderables).map((r) => ({ key: r.key, title: r.title }))}>
    <PageFrame className="min-h-0 flex-1">
      <PageBar title="Competitive Intelligence" context={d.context}>
        <ExportMenu />
        {d.updatesCount > 1 && <BarPill>Last {d.updatesCount} updates</BarPill>}
        <HowToRead items={d.legendItems ?? LEGEND_ITEMS} open={showLegend} basePath="/dashboard/competitive" />
      </PageBar>

      <PageGrid>
        {OVERVIEW_ORDER.map((key) => <Fragment key={key}>{baseRenderables[key].render(d, 'app')}</Fragment>)}
      </PageGrid>

      {/* The findings, as a page inside the page, beneath the overview. A fixed
          height on desktop so the three panes scroll inside themselves. */}
      <div id="findings" className="scroll-mt-3">
        <MasterDetail id="competitive-findings" className="md:h-[600px]" rail={rail(d, 'app')} list={list(d, 'app')} detail={detail(d, 'app')} />
      </div>
    </PageFrame>
    </ExportScope>
  )
}
