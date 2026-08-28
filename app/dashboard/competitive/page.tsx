import Link from 'next/link'
import type { ReactNode } from 'react'
import { selectAll } from '@/lib/supabase-admin'
import { getSessionContext } from '@/lib/auth'
import { HowToRead } from '@/components/how-to-read'
import { rankByTheme, fetchQuotesByAudience, fetchInsightsByIds, createQuotePicker, bucketByAudienceId, scopeToCompetitor, type ThemeBucketRow } from '@/lib/quotes'
import type { GlossaryKey } from '@/lib/calibration'
import { fmtInt, fmtPct, fmtDelta, round1, weekdayDate, shortDate, cap } from '@/lib/format'
import { shareBreakdown, pointDelta, type Sov } from '@/lib/dashboard-tiles'
import {
  leadCompetitor, competitorShares, competitorBucket, bucketStats, themeCounts, faceOffRows, praisedFor, shareSeries,
  kindOf, orderInsights, groupByKind, coverageOf, coverageText, SENTIMENT_MIN_JUDGED,
  type VideoStatRow, type KindTone,
} from '@/lib/competitive-tiles'
import { PageFrame, PageGrid, PageBar, BarPill } from '@/components/shell/page-grid'
import { Tile, TileEmpty } from '@/components/shell/tile'
import { cn } from '@/lib/utils'
import { MasterDetail } from '@/components/shell/master-detail'
import { PaneHeader, PaneBody, RailGroup, RailLink, ListRows, ListRow, PaneEmpty, DetailHeader, DetailSection, Verbatim } from '@/components/shell/master-list'
import { ListSearch } from '@/components/shell/list-search'
import { LineChart } from '@/components/charts/line-chart'
import { Delta } from '@/components/charts/stat'
import { FaceOff, FaceOffHeader, YOU_COLOR, THEM_COLOR } from './face-off'

// Competitive Intelligence — "where do we stand vs <competitor>?" (Heinrich,
// 2026-08-28 evening): the face-off IS the top of the page — standings, the
// butterfly vs the selected competitor, the share line and the full
// comparison as tiles — and the findings sit beneath it as a page inside the
// page (rail: all · by kind · about a competitor; list; the finding with its
// voices). `?vs=` picks the competitor up top; `?kind=` / `?about=` / `?item=`
// drive the findings block. Every figure is a stored count or share; model
// judgments only gate, order and word. Client copy: no run / pass / gather.

interface SummaryRow {
  run_id: string
  run_date: string
  total_videos: number | null
  share_of_voice: Sov | null
  period_share_of_voice: Sov | null
}

interface CompetitiveInsight {
  id: string
  category: string
  competitor_name: string | null
  title: string
  finding: string
  evidence: { supporting_theme_ids?: string[] } | null
  impact_level: string | null
  hero_quote: string | null
}

interface ThemeRow extends ThemeBucketRow {
  run_id: string
  category: string
  label: string
  evidence_count: number | null
  strength_score: number | null
  rank_score: number | null
}

const BASE = '/dashboard/competitive'
const LEGEND_ITEMS: GlossaryKey[] = ['conversations', 'sentiment']

type Params = { vs?: string | null; kind?: string | null; about?: string | null; item?: string | null }
const href = (p: Params, hash?: string) => {
  const q = new URLSearchParams()
  for (const k of ['vs', 'kind', 'about', 'item'] as const) if (p[k]) q.set(k, p[k]!)
  const qs = q.toString()
  return `${BASE}${qs ? `?${qs}` : ''}${hash ? `#${hash}` : ''}`
}
const COMP_DIM = 'color-mix(in srgb, var(--comp) 55%, var(--tile))'

// Kind chips on the semantic tokens: lead = green tint, threat = red tint,
// gap = amber tint, tone and the rest = grey. Full class strings for Tailwind.
const KIND_CHIP: Record<KindTone, string> = {
  lead: 'bg-accent text-accent-foreground',
  threat: 'bg-negative/12 text-negative',
  gap: 'bg-warning/15 text-warning',
  tone: 'bg-inner text-muted-foreground',
  other: 'bg-inner text-muted-foreground',
}
const impactWord = (l: string | null) => (l === 'high' ? 'high impact' : l === 'medium' ? 'medium impact' : l === 'low' ? 'low impact' : null)

function KindChip({ category }: { category: string }) {
  const k = kindOf(category)
  return <span className={`inline-flex shrink-0 items-center rounded-full px-2 py-px text-[10.5px] font-semibold ${KIND_CHIP[k.tone]}`}>{k.label}</span>
}

export default async function CompetitiveIntelligencePage({ searchParams }: { searchParams?: Promise<{ detail?: string; vs?: string; group?: string; item?: string; kind?: string; about?: string }> }) {
  const sp = (await searchParams) ?? {}
  const { supabase, clientId } = await getSessionContext()

  // Anchor on the newest update WITH analysis; an in-flight one has no
  // findings yet and would blank the page for the duration of every update.
  const [{ data: client }, { data: tc }, { data: latestRun }, runningRes, historyRaw] = await Promise.all([
    supabase.from('clients').select('company_name').eq('id', clientId).maybeSingle(),
    supabase.from('tracking_configs').select('report_day, report_period').eq('client_id', clientId).maybeSingle(),
    supabase.from('pipeline_runs').select('id, started_at')
      .eq('client_id', clientId).in('status', ['completed', 'partial'])
      .order('started_at', { ascending: false }).limit(1).maybeSingle(),
    supabase.from('pipeline_runs').select('id').eq('client_id', clientId).eq('status', 'running'),
    selectAll<SummaryRow>(() =>
      supabase.from('run_summary').select('run_id, run_date, total_videos, share_of_voice, period_share_of_voice')
        .eq('client_id', clientId).order('run_date', { ascending: true }),
    ),
  ])
  const runningIds = ((runningRes.data ?? []) as { id: string }[]).map((r) => r.id)
  const notRunning = runningIds.length ? `(${runningIds.join(',')})` : null
  const brand = client?.company_name ?? 'Your brand'
  const brandShort = brand.split(/\s[—–-]\s/)[0].trim() || brand
  const runId = latestRun?.id as string | undefined
  const nextUpdate = tc?.report_period === 'weekly' && tc?.report_day ? `${cap(tc.report_day)}’s update` : 'the next update'
  const showLegend = sp.detail === 'legend'

  if (!runId) {
    return (
      <PageFrame>
        <PageBar title="Competitive Intelligence" context={brand} />
        <section className="rounded-lg bg-tile p-6 shadow-tile">
          <p className="text-[12px] text-muted-foreground">Your first comparison lands with {nextUpdate} — check back then.</p>
        </section>
      </PageFrame>
    )
  }

  // ── the update's state + its history + this update's videos ───────────
  let themedQ = supabase.from('themes').select('run_id').eq('client_id', clientId)
  if (notRunning) themedQ = themedQ.not('run_id', 'in', notRunning)
  let latestVidQ = supabase.from('videos').select('run_id').eq('client_id', clientId)
  if (notRunning) latestVidQ = latestVidQ.not('run_id', 'in', notRunning)
  const [ciRes, latestThemedRes, latestVidRes] = await Promise.all([
    supabase.from('competitive_insights').select('id, category, competitor_name, title, finding, evidence, impact_level, hero_quote')
      .eq('client_id', clientId).eq('run_id', runId),
    themedQ.order('created_at', { ascending: false }).limit(1).maybeSingle(),
    latestVidQ.order('scraped_at', { ascending: false }).limit(1).maybeSingle(),
  ])
  const themedRunId = (latestThemedRes.data?.run_id as string | undefined) ?? null
  const videoRunId = (latestVidRes.data?.run_id as string | undefined) ?? null
  const [themeRows, videoRows] = await Promise.all([
    themedRunId
      ? selectAll<ThemeRow>(() =>
          supabase.from('themes').select('run_id, bucket, category, label, evidence_count, strength_score, rank_score, supporting_insight_ids')
            .eq('client_id', clientId).eq('run_id', themedRunId).order('id'),
        )
      : Promise.resolve([] as ThemeRow[]),
    videoRunId
      ? selectAll<VideoStatRow>(() =>
          supabase.from('videos').select('is_client, is_competitor, competitor_name, comments_count, engagement_rate, sentiment, sentiment_source, analyzed_lane')
            .eq('client_id', clientId).eq('run_id', videoRunId).eq('source', 'discovered').order('id'),
        )
      : Promise.resolve([] as VideoStatRow[]),
  ])

  const history = historyRaw.filter((s) => s.run_id && !runningIds.includes(s.run_id))
  const summary = history.find((s) => s.run_id === runId) ?? history[history.length - 1] ?? null
  const summaryIdx = summary ? history.indexOf(summary) : -1
  const prev = summaryIdx > 0 ? history[summaryIdx - 1] : null
  const runDate = summary?.run_date ?? (latestRun?.started_at as string)
  const updatesCount = history.length

  // ── the competitors, on which layer ────────────────────────────────────
  const hasKeys = (o: Sov | null | undefined) => !!o && Object.keys(o).length > 0
  let faceLayer: 'period' | 'cumulative' = hasKeys(summary?.period_share_of_voice) ? 'period' : 'cumulative'
  let faceSov = faceLayer === 'period' ? summary?.period_share_of_voice : summary?.share_of_voice
  if (!leadCompetitor(faceSov, null) && faceLayer === 'period' && leadCompetitor(summary?.share_of_voice, null)) {
    faceLayer = 'cumulative'
    faceSov = summary?.share_of_voice
  }
  const prevSov = faceLayer === 'period' ? prev?.period_share_of_voice : prev?.share_of_voice
  const competitors = competitorShares(faceSov)
  const share = shareBreakdown(faceSov)
  const sharePrev = shareBreakdown(prevSov)
  const stats = videoRows.length > 0 && videoRunId === runId ? bucketStats(videoRows) : null
  const themesByBucket = themeRows.length > 0 ? themeCounts(themeRows) : null

  // ── findings ───────────────────────────────────────────────────────────
  const insights = orderInsights((ciRes.data ?? []) as CompetitiveInsight[])
  const kinds = groupByKind(insights)
  const findingsByCompetitor = new Map<string, number>()
  for (const ci of insights) if (ci.competitor_name) findingsByCompetitor.set(ci.competitor_name, (findingsByCompetitor.get(ci.competitor_name) ?? 0) + 1)

  // ── selection ──────────────────────────────────────────────────────────
  const byName = (want: string | undefined | null, names: string[]) => (want ? names.find((n) => n.toLowerCase() === want.toLowerCase()) ?? null : null)
  // Old links: ?group=faceoff&item=<competitor> meant "vs that competitor".
  const legacyVs = sp.group === 'faceoff' && sp.item ? sp.item : null
  const lead = byName(sp.vs ?? legacyVs, competitors.map((c) => c.name)) ?? competitors[0]?.name ?? null
  const kind = sp.kind && kinds.some((g) => g.category === sp.kind) ? sp.kind : null
  const about = byName(sp.about, [...findingsByCompetitor.keys()])
  const findingsShown = insights.filter((ci) => (!kind || ci.category === kind) && (!about || ci.competitor_name === about))
  const itemId = sp.item && findingsShown.some((ci) => ci.id === sp.item) ? sp.item : (findingsShown[0]?.id ?? null)
  const selected = itemId ? insights.find((ci) => ci.id === itemId) ?? null : null
  // Findings links keep the overview's competitor; overview links keep the findings' state.
  const keepFindings = { kind, about, item: itemId }

  // ── the face-off vs the selected competitor ────────────────────────────
  const rows = lead ? faceOffRows({ sov: faceSov, layer: faceLayer, competitor: lead, stats, themes: themesByBucket, fmtInt, fmtPct }) : []
  const youPraise = praisedFor(themeRows, 'client')
  const themPraise = lead ? praisedFor(themeRows, competitorBucket(lead)) : null
  const youDelta = pointDelta(share?.client?.pct, sharePrev?.client?.pct)
  const themDelta = lead ? pointDelta(share?.competitors.find((c) => c.name === lead)?.pct, sharePrev?.competitors.find((c) => c.name === lead)?.pct) : null
  const series = lead ? shareSeries(history, lead) : null
  const fieldRows = share
    ? [
        ...(share.client ? [{ key: 'client', label: `${brandShort} · you`, color: YOU_COLOR, videos: share.client.videos, pct: share.client.pct }] : []),
        ...share.competitors.map((c) => ({ key: competitorBucket(c.name), label: c.name, color: c.name === lead ? THEM_COLOR : COMP_DIM, videos: c.videos, pct: c.pct })),
        ...(share.rest ? [{ key: 'industry-other', label: 'Wider category', color: 'var(--cat)', videos: share.rest.videos, pct: share.rest.pct }] : []),
      ].map((r) => {
        const s = stats?.get(r.key)
        return {
          ...r,
          comments: s ? s.comments : null,
          engagement: s?.avgEngagement ?? null,
          positive: s && s.judged >= SENTIMENT_MIN_JUDGED ? (s.positive / s.judged) * 100 : null,
          judged: s?.judged ?? 0,
          themes: themesByBucket?.get(r.key) ?? null,
        }
      })
    : []
  const maxPct = Math.max(share?.client?.pct ?? 0, ...competitors.map((c) => c.pct), 1)

  // ── the selected finding + its voices (shared lib/quotes) ──────────────
  const citedIds = new Set<string>()
  for (const ci of insights) for (const id of ci.evidence?.supporting_theme_ids ?? []) citedIds.add(id)
  for (const t of themeRows) for (const id of t.supporting_insight_ids ?? []) citedIds.add(id)
  const audienceInsights = insights.length > 0
    ? await fetchInsightsByIds<{ id: string; theme: string; platform: string | null }>(supabase, [...citedIds], 'id, theme, platform')
    : []
  const themeSlugById = new Map(audienceInsights.map((a) => [a.id, a.theme]))
  const platformById = new Map(audienceInsights.map((a) => [a.id, a.platform]))
  // A finding about a competitor quotes THAT competitor's audience, never your
  // own customers — presenting one brand's voices as another's is the defect.
  const bucketById = bucketByAudienceId(themeRows)
  const audienceIdsFor = (ci: CompetitiveInsight) => scopeToCompetitor(ci.evidence?.supporting_theme_ids ?? [], bucketById, ci.competitor_name)
  const claimOf = (ci: CompetitiveInsight) => `${ci.title} ${ci.finding}`
  let quotes: string[] = []
  let voices = 0
  let platforms: { label: string; count: number }[] = []
  if (selected) {
    const ids = audienceIdsFor(selected)
    voices = ids.length
    const byPlatform = new Map<string, number>()
    for (const id of ids) { const pl = platformById.get(id) ?? 'other'; byPlatform.set(pl, (byPlatform.get(pl) ?? 0) + 1) }
    platforms = [...byPlatform.entries()].sort((a, b) => b[1] - a[1]).map(([pl, count]) => ({ label: pl === 'other' ? 'Other' : cap(pl), count }))
    const pool = rankByTheme(ids, claimOf(selected), themeSlugById).slice(0, 120)
    const quotesByAudience = await fetchQuotesByAudience(supabase, pool)
    const pick = createQuotePicker(quotesByAudience, themeSlugById)
    quotes = pick(ids, 3, claimOf(selected), selected.hero_quote)
  }
  const supportFor = (ci: CompetitiveInsight) => [...new Set((ci.evidence?.supporting_theme_ids ?? []).map((id) => themeSlugById.get(id)).filter((s): s is string => !!s))].slice(0, 4)
  const coverageFor = (ci: CompetitiveInsight) => coverageText(coverageOf(summary?.share_of_voice, ci.competitor_name))
  const emptyFindingsReason = competitors.length === 0
    ? 'No competitor videos drew enough comments this update — the consumer voice about them mostly lives in creator and category content not yet tied to a competitor.'
    : 'Competitor videos were tracked, but not enough of them drew comments to form a comparable theme — so there was only one brand to read, and the cross-brand analysis waited.'

  const layerWord = faceLayer === 'period' ? 'this update' : 'all updates'
  const context = `${lead ? `Where do we stand vs ${lead}?` : 'Where do we stand?'} · ${weekdayDate(runDate)}`
  const leadFindings = lead ? findingsByCompetitor.get(lead) ?? 0 : 0

  // ── the overview: standings · face-off · share line · full comparison ──
  const standingRow = (opts: { name: string; you?: boolean; pct: number; videos: number; delta: number | null; rank?: number; color: string; active: boolean; href?: string }) => {
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
          <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-inner"><span className="block h-full rounded-full" style={{ width: `${Math.max(2, (opts.pct / maxPct) * 100)}%`, background: opts.color }} /></span>
          <span className="w-16 shrink-0 text-right font-mono text-[10.5px] tabular-nums text-muted-foreground">{fmtInt(opts.videos)} videos</span>
        </div>
      </>
    )
    const cls = cn('block rounded-[4px] px-2.5 py-1.5', opts.active && 'bg-inner', opts.href && 'hover:bg-inner/70')
    return opts.href ? <Link href={opts.href} className={cls} aria-current={opts.active ? 'true' : undefined}>{inner}</Link> : <div className={cls}>{inner}</div>
  }

  const overview = competitors.length > 0 ? (
    <>
      <Tile col={4} row={3} eyebrow="Where you stand" meta={`by videos · ${layerWord}`}
        footerNote={`${competitors.length} competitor${competitors.length === 1 ? '' : 's'} tracked`}
        footer={<span className="text-[11.5px] font-normal text-muted-foreground">Select a competitor to face off →</span>}>
        {share?.client && (
          <div className="flex items-baseline gap-2">
            <span className="font-mono text-[30px] font-semibold leading-none tabular-nums tracking-[-0.01em]">{fmtPct(share.client.pct)}</span>
            <Delta value={youDelta} unit="pt" good="up" />
            <span className="text-[11.5px] text-muted-foreground">of tracked conversation is you</span>
          </div>
        )}
        <ol className="-mx-2.5 flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto">
          {competitors.map((c, i) => (
            <li key={c.name}>
              {standingRow({ name: c.name, pct: c.pct, videos: c.videos, delta: pointDelta(c.pct, sharePrev?.competitors.find((p) => p.name === c.name)?.pct), rank: i + 1, color: c.name === lead ? THEM_COLOR : COMP_DIM, active: c.name === lead, href: href({ vs: c.name, ...keepFindings }) })}
            </li>
          ))}
          {share?.client && <li>{standingRow({ name: `${brandShort} · you`, you: true, pct: share.client.pct, videos: share.client.videos, delta: youDelta, color: YOU_COLOR, active: false })}</li>}
        </ol>
      </Tile>

      <Tile col={8} row={3} eyebrow={lead ? `Face-off · ${brandShort} vs ${lead}` : 'Face-off'}
        meta={layerWord}
        footer={lead && leadFindings > 0 ? <Link href={href({ vs: lead, about: lead }, 'findings')}>{leadFindings} finding{leadFindings === 1 ? '' : 's'} about {lead} ↓</Link> : undefined}
        footerNote={youDelta != null && themDelta != null ? `vs last update: ${brandShort} ${fmtDelta(youDelta, 'pt', 1)} · ${lead} ${fmtDelta(themDelta, 'pt', 1)}` : undefined}
        bodyClassName="min-h-0 overflow-y-auto">
        {lead && rows.length > 0 ? (
          <div className="flex flex-col gap-3">
            <FaceOffHeader
              you={`${brandShort} · you`} youLine={youPraise ? `Praised for ${youPraise.toLowerCase()}` : undefined}
              centre={faceLayer === 'period' ? 'This update' : 'All updates'}
              them={lead} themLine={themPraise ? `Praised for ${themPraise.toLowerCase()}` : undefined}
            />
            <div className="flex flex-col gap-3"><FaceOff rows={rows} /></div>
          </div>
        ) : <TileEmpty>Nothing to compare against {lead} yet — the face-off fills in as their videos are tracked and analysed.</TileEmpty>}
      </Tile>

      <Tile col={7} row={2} eyebrow="Share of tracked conversation over time"
        meta={series ? `${updatesCount} updates · ${series.layer === 'cumulative' ? 'all-time share' : 'share per update'}` : undefined}
        footerNote={series ? `since your first update: ${brandShort} ${fmtDelta(series.youDelta, 'pt', 1)}${series.themDelta != null ? ` · ${lead} ${fmtDelta(series.themDelta, 'pt', 1)}` : ''}` : undefined}
        bodyClassName="min-h-0 justify-center">
        {series && lead ? (
          <div className="overflow-x-auto">
            <LineChart
              series={[
                { label: brandShort, values: series.you, color: YOU_COLOR },
                ...(series.them ? [{ label: lead, values: series.them, color: THEM_COLOR }] : []),
              ]}
              labels={series.dates.map(shortDate)}
              format={(v) => `${round1(v)}%`}
              width={620} height={150} padL={40} padR={110}
            />
          </div>
        ) : <TileEmpty>Two updates are needed to draw a line — the first comparison lands with the next update.</TileEmpty>}
      </Tile>

      <Tile col={5} row={2} eyebrow="The full comparison" meta="incl. the wider category" bodyClassName="min-h-0 overflow-auto">
        {fieldRows.length > 0 ? (
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
              {fieldRows.map((r) => (
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
        {fieldRows.length > 0 && (
          <p className="text-[10.5px] leading-[1.45] text-muted-foreground">
            Videos and share are {faceLayer === 'period' ? 'this update’s' : 'all-time'} tracked conversation by who posted. Comments as platforms report them; engagement is the mean rate across this update’s videos that carry one. Positive is the share of rated videos, shown only with {SENTIMENT_MIN_JUDGED}+ rated{fieldRows.some((r) => r.judged > 0) ? ` — ${fieldRows.filter((r) => r.judged > 0).map((r) => `${r.label.replace(' · you', '')} ${fmtInt(r.judged)}`).join(', ')} rated` : ''}. Themes are those heard under each group’s videos in the latest analysed update.
          </p>
        )}
      </Tile>
    </>
  ) : (
    <Tile col={12} row={2} eyebrow="Where you stand" meta={layerWord}>
      <TileEmpty>The face-off starts once a competitor’s videos are tracked — add competitors in Settings, and the next update compares you side by side.</TileEmpty>
    </Tile>
  )

  // ── findings: rail ──────────────────────────────────────────────────────
  const rail = (
    <>
      <PaneHeader title="Findings" meta={insights.length > 0 ? `${insights.length} · ${weekdayDate(runDate)}` : undefined} />
      <PaneBody>
        <RailGroup>
          <RailLink href={href({ vs: lead })} active={!kind && !about} count={insights.length}>All findings</RailLink>
        </RailGroup>
        {kinds.length > 0 && (
          <RailGroup label="By kind">
            {kinds.map((g) => (
              <RailLink key={g.category} href={href({ vs: lead, kind: g.category })} active={kind === g.category} count={g.items.length}>{g.kind.label}</RailLink>
            ))}
          </RailGroup>
        )}
        {findingsByCompetitor.size > 0 && (
          <RailGroup label="About a competitor">
            {[...findingsByCompetitor.entries()].sort((a, b) => b[1] - a[1]).map(([name, n]) => (
              <RailLink key={name} href={href({ vs: lead, about: name })} active={about === name && !kind} count={n}>{name}</RailLink>
            ))}
          </RailGroup>
        )}
      </PaneBody>
    </>
  )

  // ── findings: list ──────────────────────────────────────────────────────
  const LIST_ID = 'competitive-list'
  const list = (
    <>
      <PaneHeader title={kind ? kinds.find((g) => g.category === kind)?.kind.label ?? 'Findings' : about ? `About ${about}` : 'All findings'} meta={findingsShown.length > 0 ? `${findingsShown.length} finding${findingsShown.length === 1 ? '' : 's'}` : undefined}>
        {findingsShown.length > 3 && <ListSearch scope={LIST_ID} placeholder="Search findings…" />}
        {kind && kinds.find((g) => g.category === kind)?.kind.blurb && <p className="text-[11.5px] text-muted-foreground">{kinds.find((g) => g.category === kind)!.kind.blurb}</p>}
      </PaneHeader>
      <PaneBody>
        <div id={LIST_ID}>
          {findingsShown.length > 0 ? (
            <ListRows>
              {findingsShown.map((ci) => {
                const cov = coverageFor(ci)
                return (
                  <ListRow key={ci.id} href={href({ vs: lead, kind, about, item: ci.id }, 'findings')} active={ci.id === itemId} search={`${ci.title} ${ci.finding} ${ci.competitor_name ?? ''} ${kindOf(ci.category).label}`}>
                    <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                      <KindChip category={ci.category} />
                      {ci.competitor_name && <span className="min-w-0 truncate">vs {ci.competitor_name}</span>}
                      {cov && <span className={`ml-auto shrink-0 font-mono text-[10.5px] ${cov.thin ? 'text-warning' : ''}`}>{cov.text}</span>}
                    </div>
                    <p className="mt-1 line-clamp-2 text-[13px] font-semibold leading-[1.3]">{ci.title}</p>
                    <p className="mt-0.5 line-clamp-1 text-[11.5px] text-muted-foreground">{ci.finding}</p>
                  </ListRow>
                )
              })}
            </ListRows>
          ) : <PaneEmpty>{insights.length === 0 ? `No cross-brand findings this update. ${emptyFindingsReason}` : 'No findings of this kind this update.'}</PaneEmpty>}
        </div>
      </PaneBody>
    </>
  )

  // ── findings: detail ────────────────────────────────────────────────────
  let detail: ReactNode = <PaneEmpty>Select a finding to read it with its voices.</PaneEmpty>
  if (selected) {
    const ci = selected
    const k = kindOf(ci.category)
    const cov = coverageFor(ci)
    const support = supportFor(ci)
    const impact = impactWord(ci.impact_level)
    detail = (
      <>
        <DetailHeader eyebrow={k.label} title={ci.title} meta={[ci.competitor_name ? `vs ${ci.competitor_name}` : null, cov ? cov.text : null, impact].filter(Boolean).join(' · ')}>
          {k.blurb && <p className="mt-1.5 text-[11.5px] text-muted-foreground">{k.blurb}</p>}
        </DetailHeader>
        <PaneBody>
          <DetailSection label="The finding">
            <p className="text-[13px] leading-[1.55]">{ci.finding}</p>
          </DetailSection>
          {quotes.length > 0 && (
            <DetailSection label={ci.competitor_name ? `${ci.competitor_name}’s audience, in their words` : 'In their words'}>
              <div className="flex flex-col gap-2.5">{quotes.map((q, i) => <Verbatim key={i} quote={q} />)}</div>
            </DetailSection>
          )}
          <DetailSection label="Grounded in">
            <p className="text-[12.5px] text-secondary-foreground">
              {voices > 0 ? <><span className="font-mono font-semibold text-foreground">{fmtInt(voices)}</span> {voices === 1 ? 'voice' : 'voices'}</> : 'its supporting themes'}
              {cov?.thin && <span className="text-warning"> · thin coverage — a hint, not a finding</span>}
            </p>
            {platforms.length > 0 && (
              <p className="mt-1 flex flex-wrap gap-x-3 font-mono text-[10.5px] tabular-nums text-muted-foreground">
                {platforms.map((p) => <span key={p.label}>{p.label} {p.count}</span>)}
              </p>
            )}
            {support.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {support.map((s) => <span key={s} className="rounded-full bg-inner px-2 py-px text-[10.5px] text-muted-foreground">{s.replace(/_/g, ' ')}</span>)}
              </div>
            )}
          </DetailSection>
          {ci.competitor_name && competitors.some((c) => c.name === ci.competitor_name) && ci.competitor_name !== lead && (
            <DetailSection className="border-t border-border/70">
              <Link href={href({ vs: ci.competitor_name, kind, about, item: ci.id })} className="text-[12.5px] font-medium hover:underline">Face-off vs {ci.competitor_name} ↑</Link>
            </DetailSection>
          )}
        </PaneBody>
      </>
    )
  }

  return (
    <PageFrame className="min-h-0 flex-1">
      <PageBar title="Competitive Intelligence" context={context}>
        {updatesCount > 1 && <BarPill>Last {updatesCount} updates</BarPill>}
        <HowToRead items={LEGEND_ITEMS} open={showLegend} basePath={BASE} />
      </PageBar>
      <PageGrid>{overview}</PageGrid>
      {/* The findings, as a page inside the page, beneath the overview. A fixed
          height on desktop so the three panes scroll inside themselves. */}
      <div id="findings" className="scroll-mt-3">
        <MasterDetail id="competitive-findings" className="md:h-[600px]" rail={rail} list={list} detail={detail} />
      </div>
    </PageFrame>
  )
}
