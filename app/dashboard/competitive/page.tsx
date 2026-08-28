import Link from 'next/link'
import { selectAll } from '@/lib/supabase-admin'
import { getSessionContext } from '@/lib/auth'
import { HowToRead } from '@/components/how-to-read'
import { Quotes } from '@/components/quotes'
import { rankByTheme, fetchQuotesByAudience, fetchInsightsByIds, createQuotePicker, bucketByAudienceId, scopeToCompetitor, type ThemeBucketRow } from '@/lib/quotes'
import type { GlossaryKey } from '@/lib/calibration'
import { fmtInt, fmtPct, fmtDelta, round1, weekdayDate, shortDate, cap } from '@/lib/format'
import { shareBreakdown, pointDelta, type Sov } from '@/lib/dashboard-tiles'
import {
  leadCompetitor, competitorShares, competitorBucket, bucketStats, themeCounts, faceOffRows, praisedFor, shareSeries,
  kindOf, orderInsights, groupByKind, coverageOf, coverageText, competitiveHref, SENTIMENT_MIN_JUDGED,
  type VideoStatRow, type KindTone,
} from '@/lib/competitive-tiles'
import { PageFrame, PageGrid, PageBar, BarPill } from '@/components/shell/page-grid'
import { Tile, TileEmpty } from '@/components/shell/tile'
import { DetailDrawer } from '@/components/shell/detail-drawer'
import { DrawerLink } from '@/components/shell/drawer-link'
import { LineChart } from '@/components/charts/line-chart'
import { FaceOff, FaceOffHeader, YOU_COLOR, THEM_COLOR } from './face-off'

// Competitive Intelligence — "where do we stand vs <competitor>?", on one screen
// (one-screen redesign, 2026-08-22). The face-off is the hero: you on the left,
// the faced competitor on the right, six counted metrics down the centre, each
// row grounded or dropped. Beneath it the share-of-tracked-conversation line
// across every update (one layer, ≥2 updates) and the cross-brand findings as
// one divided column. Every figure is a stored count or share (run_summary
// share_of_voice, this update's videos, themes); model judgments only gate,
// order and word. Client copy: no run / pass / gather / pipeline / corpus.

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

const LEGEND_ITEMS: GlossaryKey[] = ['conversations', 'sentiment']
// Three fit a 4-row tile at 1440×900 with two-line findings and quotes; the
// drawer has them all.
const VISIBLE_FINDINGS = 3

// Kind chips on the semantic tokens (2026-08-28): lead = green tint, threat =
// red tint, gap = amber tint, tone and the rest = grey. Class strings written
// out in full so Tailwind v4 sees them.
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

export default async function CompetitiveIntelligencePage({ searchParams }: { searchParams?: Promise<{ detail?: string; vs?: string }> }) {
  const sp = (await searchParams) ?? {}
  const vsParam = sp.vs?.trim() || null
  const { supabase, clientId } = await getSessionContext()

  // Anchor on the newest update WITH analysis; an in-flight one has no
  // findings yet and would blank the page for the duration of every update.
  // The share history is keyed on client_id alone, so it rides in this first
  // wave rather than waiting a round trip for the run id (round trips, not
  // rows, are what a cold request pays for).
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

  if (!runId) {
    return (
      <PageFrame>
        <PageBar title="Competitive Intelligence" context={brand} />
        <PageGrid>
          <Tile col={12} row={2} eyebrow="The face-off">
            <TileEmpty>Your first comparison lands with {nextUpdate} — check back then.</TileEmpty>
          </Tile>
        </PageGrid>
      </PageFrame>
    )
  }

  // ── the update's state + its history + this update's videos, in parallel ──
  let themedQ = supabase.from('themes').select('run_id').eq('client_id', clientId)
  if (notRunning) themedQ = themedQ.not('run_id', 'in', notRunning)
  let latestVidQ = supabase.from('videos').select('run_id').eq('client_id', clientId)
  if (notRunning) latestVidQ = latestVidQ.not('run_id', 'in', notRunning)
  const [ciRes, latestThemedRes, latestVidRes] = await Promise.all([
    supabase.from('competitive_insights').select('id, category, competitor_name, title, finding, evidence, impact_level, hero_quote')
      .eq('client_id', clientId).eq('run_id', runId),
    themedQ.order('created_at', { ascending: false }).limit(1).maybeSingle(),
    // The newest update that gathered videos (an analysis-only update re-reads
    // old videos and gathers none) — comments, engagement and sentiment per
    // bucket are counted across its rows.
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

  // A summary is written before its update closes, so an in-flight update can
  // already have a row — keep it out of everything the page draws.
  const history = historyRaw.filter((s) => s.run_id && !runningIds.includes(s.run_id))
  const summary = history.find((s) => s.run_id === runId) ?? history[history.length - 1] ?? null
  const summaryIdx = summary ? history.indexOf(summary) : -1
  const prev = summaryIdx > 0 ? history[summaryIdx - 1] : null
  const runDate = summary?.run_date ?? (latestRun?.started_at as string)
  const updatesCount = history.length

  // ── who we face, and on which layer ────────────────────────────────────
  // This update's share when the row has the period layer, else cumulative —
  // and if the period layer tracked no competitor at all, fall back to the
  // cumulative map so a quiet week still has a face-off (labelled as all-time).
  const hasKeys = (o: Sov | null | undefined) => !!o && Object.keys(o).length > 0
  let faceLayer: 'period' | 'cumulative' = hasKeys(summary?.period_share_of_voice) ? 'period' : 'cumulative'
  let faceSov = faceLayer === 'period' ? summary?.period_share_of_voice : summary?.share_of_voice
  let lead = leadCompetitor(faceSov, vsParam)
  if (!lead && faceLayer === 'period' && leadCompetitor(summary?.share_of_voice, vsParam)) {
    faceLayer = 'cumulative'
    faceSov = summary?.share_of_voice
    lead = leadCompetitor(faceSov, vsParam)
  }
  const prevSov = faceLayer === 'period' ? prev?.period_share_of_voice : prev?.share_of_voice
  const competitors = competitorShares(faceSov)
  const vs = lead && vsParam && lead.toLowerCase() === vsParam.toLowerCase() ? lead : null
  const base = competitiveHref(vs)

  // Per-bucket comment/engagement/sentiment rows only when the videos belong
  // to the SAME update as the share — an analysis-only update would otherwise
  // mix this update's share with an older update's videos.
  const stats = videoRows.length > 0 && videoRunId === runId ? bucketStats(videoRows) : null
  const themesByBucket = themeRows.length > 0 ? themeCounts(themeRows) : null
  const rows = lead ? faceOffRows({ sov: faceSov, layer: faceLayer, competitor: lead, stats, themes: themesByBucket, fmtInt, fmtPct }) : []
  const youPraise = praisedFor(themeRows, 'client')
  const themPraise = lead ? praisedFor(themeRows, competitorBucket(lead)) : null
  const share = shareBreakdown(faceSov)
  const sharePrev = shareBreakdown(prevSov)
  const youDelta = pointDelta(share?.client?.pct, sharePrev?.client?.pct)
  const themDelta = lead ? pointDelta(share?.competitors.find((c) => c.name === lead)?.pct, sharePrev?.competitors.find((c) => c.name === lead)?.pct) : null
  const shareNote = youDelta != null && themDelta != null && lead
    ? `${brandShort} ${fmtDelta(youDelta, 'pt', 1)} · ${lead} ${fmtDelta(themDelta, 'pt', 1)} vs last update`
    : null

  // ── share over time ────────────────────────────────────────────────────
  const series = shareSeries(history, lead)

  // ── the findings + the voices behind them (shared lib/quotes) ──────────
  const insights = orderInsights((ciRes.data ?? []) as CompetitiveInsight[])
  // Grounding slugs for the ids these findings cite — read by id from the base
  // table, not the current view: a newer in-flight update may already have
  // superseded some of those videos' rows (incremental analysis, 2026-08-17).
  const citedIds = new Set<string>()
  for (const ci of insights) for (const id of ci.evidence?.supporting_theme_ids ?? []) citedIds.add(id)
  for (const t of themeRows) for (const id of t.supporting_insight_ids ?? []) citedIds.add(id)
  const audienceInsights = insights.length > 0
    ? await fetchInsightsByIds<{ id: string; theme: string }>(supabase, [...citedIds], 'id, theme')
    : []
  const themeSlugById = new Map(audienceInsights.map((a) => [a.id, a.theme]))
  // A finding about a competitor quotes THAT competitor's audience, never your
  // own customers — presenting one brand's voices as another's is the defect.
  const bucketById = bucketByAudienceId(themeRows)
  const audienceIdsFor = (ci: CompetitiveInsight) => scopeToCompetitor(ci.evidence?.supporting_theme_ids ?? [], bucketById, ci.competitor_name)
  const claimOf = (ci: CompetitiveInsight) => `${ci.title} ${ci.finding}`
  const quotesFor = new Map<string, string[]>()
  if (insights.length > 0) {
    const poolIds = new Set<string>()
    for (const ci of insights) {
      for (const id of rankByTheme(audienceIdsFor(ci), claimOf(ci), themeSlugById).slice(0, 80)) {
        if (poolIds.size < 600) poolIds.add(id)
      }
    }
    const quotesByAudience = await fetchQuotesByAudience(supabase, [...poolIds])
    const pick = createQuotePicker(quotesByAudience, themeSlugById)
    for (const ci of insights) quotesFor.set(ci.id, pick(audienceIdsFor(ci), 2, claimOf(ci), ci.hero_quote))
  }
  const supportFor = (ci: CompetitiveInsight) => [...new Set((ci.evidence?.supporting_theme_ids ?? []).map((id) => themeSlugById.get(id)).filter((s): s is string => !!s))].slice(0, 4)
  // Coverage against the all-time map — the one the findings were drawn from.
  const coverageFor = (ci: CompetitiveInsight) => coverageText(coverageOf(summary?.share_of_voice, ci.competitor_name))
  const emptyFindingsReason = competitors.length === 0
    ? 'No competitor videos drew enough comments this update — the consumer voice about them mostly lives in creator and category content not yet tied to a competitor.'
    : 'Competitor videos were tracked, but not enough of them drew comments to form a comparable theme — so there was only one brand to read, and the cross-brand analysis waited.'

  // ── the three-way field (drawer) ───────────────────────────────────────
  const fieldRows = share
    ? [
        ...(share.client ? [{ key: 'client', label: `${brandShort} · you`, color: YOU_COLOR, videos: share.client.videos, pct: share.client.pct }] : []),
        ...share.competitors.map((c) => ({ key: competitorBucket(c.name), label: c.name, color: c.name === lead ? THEM_COLOR : 'var(--accent-ochre)', videos: c.videos, pct: c.pct })),
        ...(share.rest ? [{ key: 'industry-other', label: 'Wider category', color: 'var(--accent-slate)', videos: share.rest.videos, pct: share.rest.pct }] : []),
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

  // ── overlays ───────────────────────────────────────────────────────────
  const showLegend = sp.detail === 'legend'
  const context = `${lead ? `Where do we stand vs ${lead}?` : 'Where do we stand?'} · ${weekdayDate(runDate)}`
  const layerWord = faceLayer === 'period' ? 'this update' : 'all updates'

  return (
    <PageFrame>
      <PageBar title="Competitive Intelligence" context={context}>
        {competitors.length > 1 ? (
          competitors.slice(0, 4).map((c) => (
            <Link key={c.name} href={competitiveHref(c.name)} scroll={false} className="rounded-full">
              <BarPill active={c.name === lead}>vs {c.name}</BarPill>
            </Link>
          ))
        ) : lead ? <BarPill active>vs {lead}</BarPill> : null}
        {updatesCount > 1 && <BarPill>Last {updatesCount} updates</BarPill>}
        <HowToRead items={LEGEND_ITEMS} open={showLegend} basePath="/dashboard/competitive" />
      </PageBar>

      <PageGrid>
        {/* ── hero: the face-off ─────────────────────────────────────── */}
        <Tile col={12} row={2} distribute="between" bodyClassName="gap-2"
          footer={lead && share ? (
            <DrawerLink href={competitiveHref(vs, 'field')}>
              Full comparison{share.rest ? `, incl. the wider category (${fmtInt(share.rest.videos)} videos · ${fmtPct(share.rest.pct)})` : ''} →
            </DrawerLink>
          ) : undefined}
          footerNote={lead && rows.length > 0 && shareNote ? shareNote : undefined}
        >
          {lead && rows.length > 0 ? (
            <>
              <FaceOffHeader
                you={`${brandShort} · you`} youLine={youPraise ? `Praised for ${youPraise.toLowerCase()}` : undefined}
                centre={faceLayer === 'period' ? 'This update' : 'All updates'}
                them={lead} themLine={themPraise ? `Praised for ${themPraise.toLowerCase()}` : undefined}
              />
              <FaceOff rows={rows} />
            </>
          ) : lead ? (
            <TileEmpty>Nothing to compare against {lead} yet — the face-off fills in as their videos are tracked and analysed.</TileEmpty>
          ) : (
            <TileEmpty>The face-off starts once a competitor’s videos are tracked — add competitors in Settings, and the next update compares you side by side.</TileEmpty>
          )}
        </Tile>

        {/* ── share of tracked conversation over time ────────────────── */}
        <Tile col={7} row={4} eyebrow="Share of tracked conversation over time"
          meta={series ? `${updatesCount} updates · ${series.layer === 'cumulative' ? 'all-time share' : 'share per update'}` : undefined}
          footer={series ? (
            <span className="font-normal text-muted-foreground">
              Since your first update: {brandShort} {fmtDelta(series.youDelta, 'pt', 1)}{lead && series.themDelta != null ? ` · ${lead} ${fmtDelta(series.themDelta, 'pt', 1)}` : ''}
            </span>
          ) : undefined}
        >
          {series ? (
            <div className="flex min-h-0 flex-1 flex-col justify-center">
              <LineChart
                series={[
                  { label: brandShort, values: series.you, color: YOU_COLOR },
                  ...(lead && series.them ? [{ label: lead, values: series.them, color: THEM_COLOR }] : []),
                ]}
                labels={series.dates.map(shortDate)}
                format={(v) => `${round1(v)}%`}
                width={620} height={300} padL={40} padR={110}
              />
            </div>
          ) : (
            <TileEmpty>Your first comparison lands with the next update — two updates are needed to draw a line.</TileEmpty>
          )}
        </Tile>

        {/* ── what the voices say about the match-up ─────────────────── */}
        <Tile col={5} row={4} eyebrow="What the voices say about the match-up"
          meta={insights.length > 0 ? `${insights.length} finding${insights.length === 1 ? '' : 's'}` : undefined}
          bodyClassName="gap-0"
          footer={insights.length > 0 ? <DrawerLink href={competitiveHref(vs, 'findings')}>All {insights.length} findings →</DrawerLink> : undefined}
        >
          {insights.length > 0 ? (
            // Equal bands, one finding each, so the column never leaves its
            // air at the bottom: chips on one row, title one line, finding and
            // quote two lines each.
            <div className="flex min-h-0 flex-1 flex-col divide-y divide-border/70 overflow-hidden">
              {insights.slice(0, VISIBLE_FINDINGS).map((ci) => {
                const cov = coverageFor(ci)
                const quote = quotesFor.get(ci.id)?.[0]
                return (
                  <div key={ci.id} className="flex min-h-0 flex-1 flex-col justify-center gap-1 py-2 first:pt-0 last:pb-0">
                    <div className="flex items-center gap-1.5 overflow-hidden whitespace-nowrap text-[11px] text-muted-foreground">
                      <KindChip category={ci.category} />
                      {ci.competitor_name && <span className="min-w-0 truncate">vs {ci.competitor_name}</span>}
                      {cov && <span className={`shrink-0 ${cov.thin ? 'text-warning' : ''}`} title={cov.thin ? `Only ${cov.text.replace(' · thin', '')} about ${ci.competitor_name} produced anything we could read — a hint, not a finding.` : `Drawn from ${cov.text} about ${ci.competitor_name} that produced readable signal.`}>· {cov.text}</span>}
                    </div>
                    <p className="truncate text-[13px] font-semibold leading-[1.3] tracking-[-0.01em]">{ci.title}</p>
                    <p className="line-clamp-2 text-[11.5px] leading-[1.4] text-foreground/80">{ci.finding}</p>
                    {quote && <blockquote className="line-clamp-2 border-l-2 border-clay pl-2 text-[11.5px] italic leading-[1.4] text-foreground/85">“{quote}”</blockquote>}
                  </div>
                )
              })}
            </div>
          ) : (
            <TileEmpty>No cross-brand findings this update. {emptyFindingsReason}</TileEmpty>
          )}
        </Tile>
      </PageGrid>

      {/* ── drawers: one click deeper ────────────────────────────────── */}
      <DetailDrawer value="field" closeHref={base} title="The full comparison" description={`${brand}${lead ? ` vs ${lead}` : ''} · ${layerWord} · ${weekdayDate(runDate)}`}>
        {fieldRows.length > 0 ? (
          <div className="space-y-4">
            <div className="overflow-x-auto">
              <table className="w-full text-[12px]">
                <thead>
                  <tr className="border-b text-[10.5px] uppercase tracking-[0.05em] text-muted-foreground">
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
                    <tr key={r.key} className="border-b last:border-0">
                      <td className="py-1.5 pr-2 font-sans"><span className="flex items-center gap-1.5"><span className="size-1.5 shrink-0 rounded-full" style={{ background: r.color }} aria-hidden />{r.label}</span></td>
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
            <p className="text-[11px] leading-[1.45] text-muted-foreground">
              Videos and share are {faceLayer === 'period' ? 'this update’s' : 'all-time'} tracked conversation by who posted. Comments are as platforms report them and engagement is the mean rate across this update’s videos that carry one. Positive is the share of rated videos (how commenters received them), shown only with {SENTIMENT_MIN_JUDGED} or more rated{fieldRows.some((r) => r.judged > 0) ? ` — ${fieldRows.filter((r) => r.judged > 0).map((r) => `${r.label.replace(' · you', '')} ${fmtInt(r.judged)}`).join(', ')} rated` : ''}. Themes are those heard under each group’s videos in the latest analysed update.
            </p>
          </div>
        ) : <p className="text-[12px] text-muted-foreground">Nothing to compare yet.</p>}
      </DetailDrawer>

      <DetailDrawer value="findings" closeHref={base} title="What the voices say about the match-up" description={`${insights.length} finding${insights.length === 1 ? '' : 's'} · ${weekdayDate(runDate)}`}>
        <div className="space-y-5">
          {groupByKind(insights).map((g) => (
            <section key={g.category} className="space-y-3">
              <div>
                <h3 className="text-[10.5px] font-semibold uppercase tracking-[0.07em] text-muted-foreground">{g.kind.label}</h3>
                {g.kind.blurb && <p className="text-[11px] text-muted-foreground">{g.kind.blurb}</p>}
              </div>
              {g.items.map((ci) => {
                const cov = coverageFor(ci)
                const support = supportFor(ci)
                const impact = impactWord(ci.impact_level)
                return (
                  <div key={ci.id} className="space-y-1.5 rounded-lg bg-muted/40 p-3">
                    <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                      <KindChip category={ci.category} />
                      {ci.competitor_name && <span>vs {ci.competitor_name}</span>}
                      {cov && <span className={cov.thin ? 'text-warning' : ''}>· {cov.text}</span>}
                      {impact && <span className="ml-auto" title="The analysis’s judgment of likely effect on your position — a read on the finding, not a counted measure.">{impact}</span>}
                    </div>
                    <p className="text-[13.5px] font-semibold leading-[1.3]">{ci.title}</p>
                    <p className="text-[12.5px] leading-[1.45] text-foreground/85">{ci.finding}</p>
                    {(quotesFor.get(ci.id)?.length ?? 0) > 0 && <Quotes items={quotesFor.get(ci.id) ?? []} />}
                    {support.length > 0 && (
                      <p className="text-[11px] text-muted-foreground">Grounded in {support.map((s) => s.replace(/_/g, ' ')).join(' · ')}</p>
                    )}
                  </div>
                )
              })}
            </section>
          ))}
          {insights.length === 0 && <p className="text-[12px] text-muted-foreground">No cross-brand findings this update. {emptyFindingsReason}</p>}
        </div>
      </DetailDrawer>
    </PageFrame>
  )
}
