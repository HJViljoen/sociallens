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
import { PageFrame, PageBar, BarPill } from '@/components/shell/page-grid'
import { MasterDetail } from '@/components/shell/master-detail'
import { PaneHeader, PaneBody, RailGroup, RailLink, ListRows, ListRow, PaneEmpty, DetailHeader, DetailSection, Verbatim } from '@/components/shell/master-list'
import { ListSearch } from '@/components/shell/list-search'
import { LineChart } from '@/components/charts/line-chart'
import { Delta } from '@/components/charts/stat'
import { FaceOff, FaceOffHeader, YOU_COLOR, THEM_COLOR } from './face-off'

// Competitive Intelligence — "where do we stand vs <competitor>?", as a page
// inside the page (component-map §2, 2026-08-28). The rail holds the
// face-off (one row per competitor) and the findings (all · by kind · per
// competitor); the list shows the rows of the chosen group; the detail pane
// shows the butterfly + share line + full comparison for a competitor, or a
// finding with its voices. Every figure is a stored count or share; model
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

type Group = 'faceoff' | 'findings'
const BASE = '/dashboard/competitive'
const LEGEND_ITEMS: GlossaryKey[] = ['conversations', 'sentiment']

const href = (group: Group, item?: string | null, extra?: Record<string, string | undefined>) => {
  const q = new URLSearchParams({ group })
  for (const [k, v] of Object.entries(extra ?? {})) if (v) q.set(k, v)
  if (item) q.set('item', item)
  return `${BASE}?${q.toString()}`
}

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

export default async function CompetitiveIntelligencePage({ searchParams }: { searchParams?: Promise<{ detail?: string; vs?: string; group?: string; item?: string; kind?: string }> }) {
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
  const group: Group = sp.group === 'findings' ? 'findings' : 'faceoff'
  const kind = sp.kind && kinds.some((g) => g.category === sp.kind) ? sp.kind : null
  const knownNames = [...new Set([...competitors.map((c) => c.name), ...findingsByCompetitor.keys()])]
  const vsFilter = sp.vs ? knownNames.find((n) => n.toLowerCase() === sp.vs!.toLowerCase()) ?? null : null
  const findingsShown = insights.filter((ci) => (!kind || ci.category === kind) && (!vsFilter || group !== 'findings' || ci.competitor_name === vsFilter))
  const listIds = group === 'faceoff' ? competitors.map((c) => c.name) : findingsShown.map((ci) => ci.id)
  const requested = sp.item ?? (group === 'faceoff' ? vsFilter ?? undefined : undefined)
  const itemId = requested && listIds.includes(requested) ? requested : (listIds[0] ?? null)

  // ── the face-off vs the selected competitor ────────────────────────────
  const lead = group === 'faceoff' ? itemId : null
  const rows = lead ? faceOffRows({ sov: faceSov, layer: faceLayer, competitor: lead, stats, themes: themesByBucket, fmtInt, fmtPct }) : []
  const youPraise = praisedFor(themeRows, 'client')
  const themPraise = lead ? praisedFor(themeRows, competitorBucket(lead)) : null
  const youDelta = pointDelta(share?.client?.pct, sharePrev?.client?.pct)
  const themDelta = lead ? pointDelta(share?.competitors.find((c) => c.name === lead)?.pct, sharePrev?.competitors.find((c) => c.name === lead)?.pct) : null
  const series = lead ? shareSeries(history, lead) : null
  const fieldRows = share
    ? [
        ...(share.client ? [{ key: 'client', label: `${brandShort} · you`, color: YOU_COLOR, videos: share.client.videos, pct: share.client.pct }] : []),
        ...share.competitors.map((c) => ({ key: competitorBucket(c.name), label: c.name, color: c.name === lead ? THEM_COLOR : 'color-mix(in srgb, var(--comp) 55%, var(--tile))', videos: c.videos, pct: c.pct })),
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

  // ── the selected finding + its voices (shared lib/quotes) ──────────────
  const selected = group === 'findings' ? insights.find((ci) => ci.id === itemId) ?? null : null
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

  // ── rail ────────────────────────────────────────────────────────────────
  const rail = (
    <>
      <PaneHeader title="This update" meta={weekdayDate(runDate)} />
      <PaneBody>
        <RailGroup label="Where you stand">
          <RailLink href={href('faceoff')} active={group === 'faceoff'} count={competitors.length}>Face-off</RailLink>
        </RailGroup>
        <RailGroup label="Findings">
          <RailLink href={href('findings')} active={group === 'findings' && !kind && !vsFilter} count={insights.length}>All findings</RailLink>
          {kinds.map((g) => (
            <RailLink key={g.category} href={href('findings', undefined, { kind: g.category })} active={group === 'findings' && kind === g.category} count={g.items.length}>{g.kind.label}</RailLink>
          ))}
        </RailGroup>
        {findingsByCompetitor.size > 0 && (
          <RailGroup label="By competitor">
            {[...findingsByCompetitor.entries()].sort((a, b) => b[1] - a[1]).map(([name, n]) => (
              <RailLink key={name} href={href('findings', undefined, { vs: name })} active={group === 'findings' && vsFilter === name && !kind} count={n}>vs {name}</RailLink>
            ))}
          </RailGroup>
        )}
      </PaneBody>
    </>
  )

  // ── list ────────────────────────────────────────────────────────────────
  const LIST_ID = 'competitive-list'
  const list = group === 'faceoff' ? (
    <>
      <PaneHeader title="Competitors" meta={competitors.length > 0 ? `by videos · ${layerWord}` : undefined} />
      <PaneBody>
        <div id={LIST_ID}>
          {competitors.length > 0 ? (
            <ListRows>
              {competitors.map((c, i) => {
                const delta = pointDelta(c.pct, sharePrev?.competitors.find((p) => p.name === c.name)?.pct)
                return (
                  <ListRow key={c.name} href={href('faceoff', c.name)} active={c.name === itemId} search={c.name}>
                    <div className="flex items-center gap-2.5">
                      <span className="w-4 shrink-0 font-mono text-[12px] font-semibold tabular-nums text-muted-foreground">{i + 1}</span>
                      <span className="size-2 shrink-0 rounded-[2px]" style={{ background: c.name === itemId ? THEM_COLOR : 'color-mix(in srgb, var(--comp) 55%, var(--tile))' }} aria-hidden />
                      <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">{c.name}</span>
                      <span className="font-mono text-[12px] font-semibold tabular-nums">{fmtPct(c.pct)}</span>
                      <span className="w-14 text-right"><Delta value={delta} unit="pt" good="down" /></span>
                    </div>
                    <p className="mt-0.5 pl-[26px] font-mono text-[10.5px] text-muted-foreground">{fmtInt(c.videos)} videos · {findingsByCompetitor.get(c.name) ?? 0} findings</p>
                  </ListRow>
                )
              })}
              {share?.client && (
                <li className="px-2 pb-2">
                  <div className="flex items-center gap-2.5 rounded-[4px] px-3 py-2.5 text-[12px] text-muted-foreground">
                    <span className="w-4" /><span className="size-2 shrink-0 rounded-[2px]" style={{ background: YOU_COLOR }} aria-hidden />
                    <span className="min-w-0 flex-1 truncate">{brandShort} · you</span>
                    <span className="font-mono text-[12px] font-semibold tabular-nums text-foreground">{fmtPct(share.client.pct)}</span>
                    <span className="w-14 text-right"><Delta value={youDelta} unit="pt" good="up" /></span>
                  </div>
                </li>
              )}
            </ListRows>
          ) : <PaneEmpty>The face-off starts once a competitor’s videos are tracked — add competitors in Settings, and the next update compares you side by side.</PaneEmpty>}
        </div>
      </PaneBody>
    </>
  ) : (
    <>
      <PaneHeader title={kind ? kinds.find((g) => g.category === kind)?.kind.label ?? 'Findings' : vsFilter ? `vs ${vsFilter}` : 'All findings'} meta={findingsShown.length > 0 ? `${findingsShown.length} finding${findingsShown.length === 1 ? '' : 's'} · ${weekdayDate(runDate)}` : undefined}>
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
                  <ListRow key={ci.id} href={href('findings', ci.id, { kind: kind ?? undefined, vs: vsFilter ?? undefined })} active={ci.id === itemId} search={`${ci.title} ${ci.finding} ${ci.competitor_name ?? ''} ${kindOf(ci.category).label}`}>
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

  // ── detail ──────────────────────────────────────────────────────────────
  let detail: ReactNode = <PaneEmpty>Select a competitor or a finding.</PaneEmpty>

  if (group === 'faceoff' && lead) {
    detail = (
      <>
        <DetailHeader eyebrow={`Face-off · ${layerWord}`} title={`${brandShort} vs ${lead}`}
          meta={youDelta != null && themDelta != null ? `${brandShort} ${fmtDelta(youDelta, 'pt', 1)} · ${lead} ${fmtDelta(themDelta, 'pt', 1)} vs last update` : undefined} />
        <PaneBody>
          <DetailSection>
            {rows.length > 0 ? (
              <div className="flex flex-col gap-3">
                <FaceOffHeader
                  you={`${brandShort} · you`} youLine={youPraise ? `Praised for ${youPraise.toLowerCase()}` : undefined}
                  centre={faceLayer === 'period' ? 'This update' : 'All updates'}
                  them={lead} themLine={themPraise ? `Praised for ${themPraise.toLowerCase()}` : undefined}
                />
                <div className="flex flex-col gap-3"><FaceOff rows={rows} /></div>
              </div>
            ) : <p className="text-[12px] text-muted-foreground">Nothing to compare against {lead} yet — the face-off fills in as their videos are tracked and analysed.</p>}
          </DetailSection>
          <DetailSection label="Share of tracked conversation over time" className="border-t border-border/70">
            {series ? (
              <div className="overflow-x-auto">
                <LineChart
                  series={[
                    { label: brandShort, values: series.you, color: YOU_COLOR },
                    ...(series.them ? [{ label: lead, values: series.them, color: THEM_COLOR }] : []),
                  ]}
                  labels={series.dates.map(shortDate)}
                  format={(v) => `${round1(v)}%`}
                  width={620} height={220} padL={40} padR={110}
                />
                <p className="mt-1 font-mono text-[10.5px] text-muted-foreground">
                  {updatesCount} updates · {series.layer === 'cumulative' ? 'all-time share' : 'share per update'} · since your first update: {brandShort} {fmtDelta(series.youDelta, 'pt', 1)}{series.themDelta != null ? ` · ${lead} ${fmtDelta(series.themDelta, 'pt', 1)}` : ''}
                </p>
              </div>
            ) : <p className="text-[12px] text-muted-foreground">Two updates are needed to draw a line — the first comparison lands with the next update.</p>}
          </DetailSection>
          {fieldRows.length > 0 && (
            <DetailSection label="The full comparison, incl. the wider category" className="border-t border-border/70">
              <div className="overflow-x-auto">
                <table className="w-full text-[12px]">
                  <thead>
                    <tr className="border-b border-border/70 text-[10.5px] uppercase tracking-[0.05em] text-muted-foreground">
                      <th className="pb-1.5 pr-2 text-left font-semibold">Who</th>
                      <th className="pb-1.5 pr-2 text-right font-semibold">Videos</th>
                      <th className="pb-1.5 pr-2 text-right font-semibold">Share</th>
                      <th className="pb-1.5 pr-2 text-right font-semibold">Comments</th>
                      <th className="pb-1.5 pr-2 text-right font-semibold">Engagement</th>
                      <th className="pb-1.5 pr-2 text-right font-semibold">Positive</th>
                      <th className="pb-1.5 text-right font-semibold">Themes</th>
                    </tr>
                  </thead>
                  <tbody className="font-mono tabular-nums">
                    {fieldRows.map((r) => (
                      <tr key={r.key} className={`border-b border-border/70 last:border-0 ${r.key === competitorBucket(lead) || r.key === 'client' ? 'font-semibold' : ''}`}>
                        <td className="py-1.5 pr-2 font-sans"><span className="flex items-center gap-1.5"><span className="size-2 shrink-0 rounded-[2px]" style={{ background: r.color }} aria-hidden />{r.label}</span></td>
                        <td className="py-1.5 pr-2 text-right">{fmtInt(r.videos)}</td>
                        <td className="py-1.5 pr-2 text-right">{fmtPct(r.pct)}</td>
                        <td className="py-1.5 pr-2 text-right">{r.comments != null ? fmtInt(r.comments) : '—'}</td>
                        <td className="py-1.5 pr-2 text-right">{r.engagement != null ? fmtPct(r.engagement) : '—'}</td>
                        <td className="py-1.5 pr-2 text-right">{r.positive != null ? fmtPct(r.positive, 0) : '—'}</td>
                        <td className="py-1.5 text-right">{r.themes != null ? fmtInt(r.themes) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-2 text-[11px] leading-[1.45] text-muted-foreground">
                Videos and share are {faceLayer === 'period' ? 'this update’s' : 'all-time'} tracked conversation by who posted. Comments are as platforms report them and engagement is the mean rate across this update’s videos that carry one. Positive is the share of rated videos, shown only with {SENTIMENT_MIN_JUDGED} or more rated{fieldRows.some((r) => r.judged > 0) ? ` — ${fieldRows.filter((r) => r.judged > 0).map((r) => `${r.label.replace(' · you', '')} ${fmtInt(r.judged)}`).join(', ')} rated` : ''}. Themes are those heard under each group’s videos in the latest analysed update.
              </p>
            </DetailSection>
          )}
          {(findingsByCompetitor.get(lead) ?? 0) > 0 && (
            <DetailSection className="border-t border-border/70">
              <Link href={href('findings', undefined, { vs: lead })} className="text-[12.5px] font-medium hover:underline">{findingsByCompetitor.get(lead)} finding{findingsByCompetitor.get(lead) === 1 ? '' : 's'} about {lead} →</Link>
            </DetailSection>
          )}
        </PaneBody>
      </>
    )
  }

  if (group === 'findings' && selected) {
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
          {ci.competitor_name && competitors.some((c) => c.name === ci.competitor_name) && (
            <DetailSection className="border-t border-border/70">
              <Link href={href('faceoff', ci.competitor_name)} className="text-[12.5px] font-medium hover:underline">Face-off vs {ci.competitor_name} →</Link>
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
      <MasterDetail id="competitive" rail={rail} list={list} detail={detail} />
    </PageFrame>
  )
}
