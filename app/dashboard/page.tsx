import Link from 'next/link'
import { selectAll } from '@/lib/supabase-admin'
import { getSessionContext } from '@/lib/auth'
import { HowToRead } from '@/components/how-to-read'
import { Quotes } from '@/components/quotes'
import { ProportionBar, type Segment } from '@/components/proportion-bar'
import { proportionDelta, SENTIMENT_BAND, SHARE_BAND, type DeltaVerdict } from '@/lib/report-bands'
import { composeDashboardNarrative, type NarrativeFigures } from '@/lib/dashboard-narrative'
import type { ExecutiveBrief } from '@/lib/pipeline/schemas'
import { rankByTheme, fetchQuotesByAudience, fetchInsightsByIds, createQuotePicker, bucketByAudienceId, scopeToClientVoices, type ThemeBucketRow } from '@/lib/quotes'
import { sentimentTier, SENTIMENT_TIER_LABEL, type GlossaryKey } from '@/lib/calibration'
import { fmtInt, fmtCompact, fmtPct, weekdayDate, shortDate, platformLabel, cap } from '@/lib/format'
import {
  themeTiers, topThemes, platformSplit, sentimentSplit, shareBreakdown, pointDelta, movement, accountSeries, topRecommendation,
  type ThemeRankRow, type HistoryRow, type Sov, type AudienceSentiment, type Bucket,
} from '@/lib/dashboard-tiles'
import { PageFrame, PageGrid, PageBar, BarPill } from '@/components/shell/page-grid'
import { Tile, StripCell, TileEmpty } from '@/components/shell/tile'
import { DetailDrawer } from '@/components/shell/detail-drawer'
import { Sparkline } from '@/components/charts/sparkline'
import { StatValue, Delta } from '@/components/charts/stat'
import { RankedBar } from '@/components/charts/ranked-bar'
import { Ring } from '@/components/charts/ring'
import { Mover } from '@/components/charts/mover'
import { PlatformIcon } from '@/components/charts/platform-icon'

// Dashboard — "where do we stand?", on one screen (one-screen redesign,
// 2026-08-22). A strip of counted receipts · the executive brief as the dark
// hero · sentiment · share of tracked conversation · what the market is talking
// about · movement since the first update (the part of Trends that belongs
// here) · the top recommendation · your own accounts. Every tile gates on its
// data and shows an honest empty line at its size — the grid never collapses.
// Numbers rule: every figure is a stored count or share (run_summary, themes,
// snapshots); model scores only gate and order. Client-facing copy: no run /
// pass / gather / pipeline / corpus; a "conversation" is a video + its comments.

interface SummaryRow {
  run_id: string
  run_date: string
  total_videos: number | null
  total_comments: number | null
  period_videos: number | null
  period_comments: number | null
  share_of_voice: Sov | null
  period_share_of_voice: Sov | null
  period_sentiment_positive: number | null
  audience_sentiment: AudienceSentiment | null
  period_audience_sentiment: AudienceSentiment | null
  executive_brief?: ExecutiveBrief | null
}

interface RecRow {
  id: string
  title: string
  reasoning: string
  priority: string | null
  based_on: { insight_ids?: string[] } | null
  hero_quote: string | null
}

const BUCKET_COLOR: Record<Bucket, string> = { client: 'var(--positive)', category: 'var(--accent-slate)', competitor: 'var(--accent-clay)' }
const COMPETITOR_COLORS = ['var(--accent-clay)', 'var(--accent-ochre)', 'var(--accent-plum)', 'var(--accent-slate)']
const REST_COLOR = 'var(--input)'

const priorityWord = (p: string | null | undefined) => (p === 'high' ? 'Act now' : p === 'medium' ? 'Plan next' : 'Worth considering')

/** A band-gated proportion verdict as a short phrase. */
function verdictDelta(v: DeltaVerdict | null): { text: string; good: boolean | null } | null {
  if (!v) return null
  if (v.state === 'moved') {
    const d = Math.round(v.change * 10) / 10
    return { text: `${d > 0 ? '+' : '−'}${Math.abs(d)} pt since last update`, good: d > 0 }
  }
  if (v.state === 'no_clear_change') return { text: 'no clear change since last update', good: null }
  return null
}

export default async function DashboardPage({ searchParams }: { searchParams?: Promise<{ detail?: string }> }) {
  const sp = (await searchParams) ?? {}
  const { supabase, clientId } = await getSessionContext()

  // Anchor on the newest run WITH DATA; an in-flight run has no analysis rows
  // yet, so anchoring on it would blank the page for the duration of every run.
  const [{ data: client }, { data: tc }, { data: latestRun }, runningRes, registryRes] = await Promise.all([
    supabase.from('clients').select('company_name').eq('id', clientId).maybeSingle(),
    supabase.from('tracking_configs')
      .select('brand_keywords, competitor_keywords, industry_keywords, platforms, report_day, report_period')
      .eq('client_id', clientId).maybeSingle(),
    supabase.from('pipeline_runs').select('id, started_at')
      .eq('client_id', clientId).in('status', ['completed', 'partial'])
      .order('started_at', { ascending: false }).limit(1).maybeSingle(),
    supabase.from('pipeline_runs').select('id').eq('client_id', clientId).eq('status', 'running'),
    supabase.from('theme_registry').select('id', { count: 'exact', head: true }).eq('client_id', clientId),
  ])
  const runningIds = ((runningRes.data ?? []) as { id: string }[]).map((r) => r.id)
  const notRunning = runningIds.length ? `(${runningIds.join(',')})` : null
  const brand = client?.company_name ?? 'Your brand'
  const brandShort = brand.split(/\s[—–-]\s/)[0].trim() || brand
  const runId = latestRun?.id as string | undefined
  const registryCount = registryRes.count ?? 0

  const termCounts = {
    brand: tc?.brand_keywords?.length ?? 0,
    competitor: tc?.competitor_keywords?.length ?? 0,
    category: tc?.industry_keywords?.length ?? 0,
  }
  const termTotal = termCounts.brand + termCounts.competitor + termCounts.category
  const cadence = tc?.report_period === 'weekly' ? `weekly${tc?.report_day ? `, ${cap(tc.report_day)}s` : ''}` : tc?.report_period === 'monthly' ? 'monthly' : null
  const nextUpdate = tc?.report_period === 'weekly' && tc?.report_day ? `next update ${cap(tc.report_day)}` : tc?.report_period === 'monthly' ? 'updates monthly' : null

  if (!runId) {
    return (
      <PageFrame>
        <PageBar title="Dashboard" context={brand} />
        <PageGrid>
          <Tile col={12} row={2} eyebrow="Your first update">
            <TileEmpty>Your first analysis {nextUpdate ? `lands with the ${nextUpdate.replace('next update ', '')} update` : 'is on its way'} — check back then.</TileEmpty>
          </Tile>
        </PageGrid>
      </PageFrame>
    )
  }

  // ── the state snapshot + its history, in parallel ──────────────────────
  let themedQ = supabase.from('themes').select('run_id').eq('client_id', clientId)
  if (notRunning) themedQ = themedQ.not('run_id', 'in', notRunning)
  const SUMMARY_COLS = 'run_id, run_date, total_videos, total_comments, period_videos, period_comments, share_of_voice, period_share_of_voice, period_sentiment_positive, audience_sentiment, period_audience_sentiment'
  let latestVidQ = supabase.from('videos').select('run_id').eq('client_id', clientId)
  if (notRunning) latestVidQ = latestVidQ.not('run_id', 'in', notRunning)
  let earlierThemesQ = supabase.from('themes').select('run_id').eq('client_id', clientId)
  if (notRunning) earlierThemesQ = earlierThemesQ.not('run_id', 'in', notRunning)
  const [historyRaw, recRes, latestThemedRes, miRes, latestVidRes, snapRows, eventsRes, tierRows] = await Promise.all([
    selectAll<SummaryRow>(() =>
      supabase.from('run_summary').select(`${SUMMARY_COLS}, executive_brief`).eq('client_id', clientId).order('run_date', { ascending: true }),
    ),
    supabase.from('recommendations').select('id, title, reasoning, priority, based_on, hero_quote').eq('client_id', clientId).eq('run_id', runId),
    themedQ.order('created_at', { ascending: false }).limit(1).maybeSingle(),
    supabase.from('market_insights').select('id, evidence').eq('client_id', clientId).eq('run_id', runId),
    // The newest update that gathered videos (an analysis-only update re-reads
    // old videos and gathers none) — anchors the platform split below.
    latestVidQ.order('scraped_at', { ascending: false }).limit(1).maybeSingle(),
    // Daily follower snapshots (three platforms cross the 1000-row cap in ~11 months).
    selectAll<{ platform: string; snapshot_date: string; followers: number | null }>(() =>
      supabase.from('account_snapshots').select('platform, snapshot_date, followers').eq('client_id', clientId).order('snapshot_date', { ascending: true }),
    ),
    supabase.from('account_events').select('platform, severity, explained, magnitude_label, explanation')
      .eq('client_id', clientId).eq('run_id', runId).order('severity', { ascending: false }).limit(3),
    // Themes confirmed per update (for the movement row) + tiers for the strip.
    selectAll<{ run_id: string; single_source: boolean | null; strength_score: number | null }>(() =>
      supabase.from('themes').select('run_id, single_source, strength_score').eq('client_id', clientId).order('run_id').order('id'),
    ),
  ])

  // Videos by platform — counted rows, not an estimate.
  const videoRunId = (latestVidRes.data?.run_id as string | undefined) ?? runId
  const platformRows = await selectAll<{ platform: string | null }>(() =>
    supabase.from('videos').select('platform').eq('client_id', clientId).eq('run_id', videoRunId),
  )

  // The latest update = the run we anchored on; everything before it is history.
  // A run's summary is written before the run closes, so an in-flight run can
  // already have a row — keep it out of the history every series is drawn from.
  const history = historyRaw.filter((s) => s.run_id && !runningIds.includes(s.run_id))
  const summary = history.find((s) => s.run_id === runId) ?? history[history.length - 1] ?? null
  const summaryIdx = summary ? history.indexOf(summary) : -1
  const prev = summaryIdx > 0 ? history[summaryIdx - 1] : null
  const runDate = summary?.run_date ?? (latestRun?.started_at as string)

  // ── strip ──────────────────────────────────────────────────────────────
  const periodVideos = summary?.period_videos ? Number(summary.period_videos) : null
  const videosNow = periodVideos ?? (summary?.total_videos != null ? Number(summary.total_videos) : null)
  const videosPrev = periodVideos ? (prev?.period_videos ? Number(prev.period_videos) : null) : (prev?.total_videos != null ? Number(prev.total_videos) : null)
  const periodComments = summary?.period_comments ? Number(summary.period_comments) : null
  const commentsNow = periodComments ?? (summary?.total_comments != null ? Number(summary.total_comments) : null)
  const commentsPrev = periodComments ? (prev?.period_comments ? Number(prev.period_comments) : null) : (prev?.total_comments != null ? Number(prev.total_comments) : null)
  // Sparklines follow the layer the big number is on — period when this update
  // gathered, else the cumulative totals — one layer per series, zeros kept.
  const videoSeries = history.map((s) => Number((periodVideos ? s.period_videos : s.total_videos) ?? 0))
  const commentSeries = history.map((s) => Number((periodComments ? s.period_comments : s.total_comments) ?? 0))
  const platforms = platformSplit(platformRows)
  const platformMax = platforms[0]?.count ?? 0

  const themedRunId = latestThemedRes.data?.run_id as string | undefined
  const tiers = themeTiers(tierRows.filter((t) => t.run_id === themedRunId))
  const confirmedByRun = new Map<string, number>()
  for (const t of tierRows) if (!t.single_source) confirmedByRun.set(t.run_id, (confirmedByRun.get(t.run_id) ?? 0) + 1)

  // ── where you stand ────────────────────────────────────────────────────
  const sent = sentimentSplit(summary?.audience_sentiment)
  const sentPrev = sentimentSplit(prev?.audience_sentiment)
  const sentimentVerdict = sent && sentPrev
    ? proportionDelta({ nowPct: sent.positivePct, nowN: sent.judged, prevPct: sentPrev.positivePct, prevN: sentPrev.judged }, SENTIMENT_BAND)
    : null
  const sentDeltaText = verdictDelta(sentimentVerdict)
  const sentTier = sent ? sentimentTier(Math.round(sent.positivePct), Math.round((sent.counts.negative / sent.judged) * 100)) : null
  const sentimentSegments: Segment[] = sent
    ? ([
        { label: 'Positive', count: sent.counts.positive, color: 'bg-chart-2' },
        { label: 'Mixed', count: sent.counts.mixed, color: 'bg-warning' },
        { label: 'Neutral', count: sent.counts.neutral, color: 'bg-input' },
        { label: 'Negative', count: sent.counts.negative, color: 'bg-negative' },
      ] as const)
        .filter((s) => s.count > 0)
        .map((s) => ({ ...s, pct: Math.round((s.count / sent.judged) * 100) }))
    : []

  // Share this update: the period layer when this row has it, else cumulative —
  // and the previous update compared on the SAME layer.
  const hasKeys = (o: Sov | null | undefined) => !!o && Object.keys(o).length > 0
  const usePeriodShare = hasKeys(summary?.period_share_of_voice)
  const shareNowSov = usePeriodShare ? summary?.period_share_of_voice : summary?.share_of_voice
  const sharePrevSov = usePeriodShare ? prev?.period_share_of_voice : prev?.share_of_voice
  const share = shareBreakdown(shareNowSov)
  const sharePrev = shareBreakdown(sharePrevSov)
  const briefShare = shareBreakdown(summary?.share_of_voice)
  // Your share moves only when it clears the band (T0-8): arrows are earned.
  const shareVerdict = share?.client && sharePrev?.client
    ? proportionDelta({ nowPct: share.client.pct, nowN: share.tracked, nowK: share.client.videos, prevPct: sharePrev.client.pct, prevN: sharePrev.tracked, prevK: sharePrev.client.videos }, SHARE_BAND)
    : null
  const clientShareDelta = shareVerdict?.state === 'moved' ? shareVerdict.change : null
  const shareSegments = share
    ? [
        ...(share.client ? [{ label: brandShort, value: share.client.videos, pct: share.client.pct, color: 'var(--primary)', delta: clientShareDelta, good: 'up' as const }] : []),
        ...share.competitors.map((c, i) => ({
          label: c.name, value: c.videos, pct: c.pct, color: COMPETITOR_COLORS[Math.min(i, COMPETITOR_COLORS.length - 1)],
          delta: pointDelta(c.pct, sharePrev?.competitors.find((p) => p.name === c.name)?.pct), good: 'neutral' as const,
        })),
        ...(share.rest ? [{ label: 'Rest of the category', value: share.rest.videos, pct: share.rest.pct, color: REST_COLOR, delta: pointDelta(share.rest.pct, sharePrev?.rest?.pct), good: 'neutral' as const }] : []),
      ].filter((s) => s.value > 0)
    : []
  const topCompetitor = share?.competitors[0] ?? null

  // ── what the market is talking about ───────────────────────────────────
  let themes: ReturnType<typeof topThemes> = []
  let analysedConversations = 0
  if (themedRunId) {
    const [{ data: themeRows }, { data: earlier }] = await Promise.all([
      supabase.from('themes')
        .select('label, description, category, bucket, member_themes, evidence_count, strength_score, rank_score, first_seen')
        .eq('client_id', clientId).eq('run_id', themedRunId),
      earlierThemesQ.neq('run_id', themedRunId).limit(1),
    ])
    themes = topThemes((themeRows ?? []) as ThemeRankRow[], 8, (earlier?.length ?? 0) > 0)
    analysedConversations = Object.values(summary?.share_of_voice ?? {}).reduce((t, e) => t + Number(e?.analysed_videos ?? 0), 0)
  }
  const themeMax = themes[0]?.conversations ?? 0

  // ── the one thing to do + the voices behind it (shared lib/quotes) ─────
  const recs = (recRes.data ?? []) as RecRow[]
  const oneThing = topRecommendation(recs)
  let oneThingQuotes: string[] = []
  let oneThingVoices = 0
  if (oneThing) {
    const marketInsights = (miRes.data ?? []) as { id: string; evidence: { supporting_theme_ids?: string[] } | null }[]
    const miEvidenceById = new Map(marketInsights.map((m) => [m.id, m.evidence]))
    const { data: bucketData } = await supabase.from('themes').select('bucket, supporting_insight_ids').eq('client_id', clientId).eq('run_id', runId)
    const bucketById = bucketByAudienceId((bucketData ?? []) as ThemeBucketRow[])
    const supportIds: string[] = []
    for (const id of oneThing.based_on?.insight_ids ?? []) supportIds.push(...(miEvidenceById.get(id)?.supporting_theme_ids ?? []))
    const themeSlugById = new Map(
      (await fetchInsightsByIds<{ id: string; theme: string }>(supabase, supportIds, 'id, theme')).map((a) => [a.id, a.theme]),
    )
    const scopedIds = scopeToClientVoices(supportIds, bucketById)
    oneThingVoices = scopedIds.length
    const claim = `${oneThing.title} ${oneThing.reasoning}`
    const pool = rankByTheme(scopedIds, claim, themeSlugById).slice(0, 120)
    const quotesByAudience = await fetchQuotesByAudience(supabase, pool)
    const pick = createQuotePicker(quotesByAudience, themeSlugById)
    oneThingQuotes = pick(scopedIds, 3, claim, oneThing.hero_quote)
  }

  // ── executive brief: the model's prose, the figures from run_summary ───
  const figures: NarrativeFigures = {
    brand,
    topTheme: themes[0] ? { label: themes[0].label, description: themes[0].description, conversations: themes[0].conversations } : null,
    sentiment: sent ? { positivePct: Math.round(sent.positivePct) } : null,
    // Pass D authored the brief against the cumulative share_of_voice — substitute
    // the same layer, whatever the ring shows.
    shareOfVoice: briefShare?.client ? { clientPct: Math.round(briefShare.client.pct), hasCompetitors: briefShare.competitors.length > 0 } : null,
  }
  const narrative = composeDashboardNarrative(summary?.executive_brief, figures)
  const showHero = narrative.beats.length > 0 || !!oneThing || oneThingQuotes.length > 0

  // ── movement since the first update (Trends' numbers, on the page they belong to) ──
  const mv = movement(history as HistoryRow[], confirmedByRun)
  const MOVE_STYLE: Record<string, { color: string; good: 'up' | 'down' | 'neutral'; unit: string; fmt: (n: number) => string }> = {
    yourShare: { color: 'var(--primary)', good: 'up', unit: 'pt', fmt: (n) => fmtPct(n) },
    compShare: { color: 'var(--accent-clay)', good: 'down', unit: 'pt', fmt: (n) => fmtPct(n) },
    positive: { color: 'var(--positive)', good: 'up', unit: 'pt', fmt: (n) => fmtPct(n, 0) },
    volume: { color: 'var(--primary)', good: 'up', unit: '', fmt: fmtCompact },
    themes: { color: 'var(--accent-slate)', good: 'up', unit: '', fmt: fmtInt },
  }

  // ── your accounts ──────────────────────────────────────────────────────
  const accounts = accountSeries(snapRows, 30)
  const events = (eventsRes.data ?? []) as { platform: string; severity: number; explained: boolean; magnitude_label: string; explanation: string | null }[]
  const topEvent = events.find((e) => e.explained && e.severity >= 2) ?? null

  // ── overlays ───────────────────────────────────────────────────────────
  const showLegend = sp.detail === 'legend'
  const showBrief = sp.detail === 'brief'
  const showFunnel = sp.detail === 'funnel'
  const legendItems: GlossaryKey[] = themes.some((t) => t.isNew) ? ['conversations', 'sentiment', 'new'] : ['conversations', 'sentiment']
  const funnel = [
    termTotal > 0 && tc?.platforms?.length ? { n: termTotal, label: `search terms tracked across ${tc.platforms.map(platformLabel).join(', ')}` } : null,
    summary?.total_videos ? { n: Number(summary.total_videos), label: 'conversations now in your tracked set' } : null,
    summary?.total_comments ? { n: Number(summary.total_comments), label: 'comments read inside them' } : null,
    summary?.period_videos ? { n: Number(summary.period_videos), label: 'conversations from this update’s period' } : null,
    sent ? { n: sent.judged, label: 'videos rated on how their audience reacted' } : null,
    tiers.confirmed + tiers.early + tiers.once > 0 ? { n: tiers.confirmed + tiers.early + tiers.once, label: 'themes heard across the conversation' } : null,
    tiers.confirmed > 0 ? { n: tiers.confirmed, label: 'confirmed by more than one conversation' } : null,
  ].filter(Boolean) as { n: number; label: string }[]

  const updatesCount = history.length
  const context = `${brand} · updated ${weekdayDate(runDate)}${nextUpdate ? ` · ${nextUpdate}` : ''}`

  return (
    <PageFrame>
      <PageBar title="Dashboard" context={context}>
        {updatesCount > 1 && <BarPill>Last {updatesCount} updates</BarPill>}
        <HowToRead items={legendItems} open={showLegend} basePath="/dashboard" />
      </PageBar>

      <PageGrid>
        {/* ── strip: five counted receipts ───────────────────────────── */}
        <Tile col={12} row={1} variant="strip">
          <StripCell eyebrow="Tracking">
            {termTotal > 0 ? (
              <>
                <StatValue unit="terms">{termTotal}</StatValue>
                <span className="truncate text-[11.5px] text-muted-foreground">{termCounts.brand} brand · {termCounts.competitor} competitor · {termCounts.category} category</span>
                <span className="flex items-center gap-1.5 truncate text-[11.5px] text-muted-foreground">
                  <span className="flex items-center gap-1 text-[#55605A]">{(tc?.platforms ?? []).map((p: string) => <PlatformIcon key={p} platform={p} />)}</span>
                  {(tc?.platforms?.length ?? 0)} platforms{cadence ? ` · ${cadence}` : ''}
                </span>
              </>
            ) : <TileEmpty>Add search terms in Settings to start tracking.</TileEmpty>}
          </StripCell>
          <StripCell eyebrow={periodVideos ? "Videos this update" : "Videos tracked"}>
            {videosNow != null ? (
              <>
                <span className="flex items-center gap-2"><StatValue>{fmtInt(videosNow)}</StatValue>{videoSeries.length > 1 && <Sparkline values={videoSeries} fill />}</span>
                <Delta value={videosPrev != null ? videosNow - videosPrev : null} good="neutral" suffix={periodVideos ? 'vs last update' : 'added since last update'} />
                <span className="truncate text-[11.5px] text-muted-foreground">{periodVideos && summary?.total_videos != null ? `${fmtInt(summary.total_videos)} all-time` : 'all-time, across every update'}</span>
              </>
            ) : <TileEmpty>Counted with the first update.</TileEmpty>}
          </StripCell>
          <StripCell eyebrow={periodComments ? "Comments analysed" : "Comments read"}>
            {commentsNow != null ? (
              <>
                <span className="flex items-center gap-2"><StatValue>{fmtInt(commentsNow)}</StatValue>{commentSeries.length > 1 && <Sparkline values={commentSeries} fill />}</span>
                <Delta value={commentsPrev != null ? commentsNow - commentsPrev : null} good="up" suffix={periodComments ? 'vs last update' : 'added since last update'} />
                <span className="truncate text-[11.5px] text-muted-foreground">{periodComments && summary?.total_comments != null ? `${fmtInt(summary.total_comments)} all-time` : 'all-time, across every update'}</span>
              </>
            ) : <TileEmpty>Counted with the first update.</TileEmpty>}
          </StripCell>
          <StripCell eyebrow="Themes heard">
            {tiers.confirmed + tiers.early + tiers.once > 0 ? (
              <>
                <StatValue unit="confirmed">{tiers.confirmed}</StatValue>
                <span className="truncate font-mono text-[11.5px] tabular-nums text-[#3F4B44]">{tiers.early} early <span className="text-muted-foreground/70">·</span> {tiers.once} heard once</span>
                {registryCount > 0 && <span className="truncate text-[11.5px] text-muted-foreground">{fmtInt(registryCount)} themes followed over time</span>}
              </>
            ) : <TileEmpty>Themes land with the first analysed update.</TileEmpty>}
          </StripCell>
          <StripCell eyebrow="Where the conversation is">
            {platforms.length > 0 ? (
              <div className="flex flex-col gap-[2px] text-[11.5px] leading-[1.3]">
                {platforms.slice(0, 4).map((p) => (
                  <RankedBar key={p.platform} label={<span className="flex items-center gap-1.5"><PlatformIcon platform={p.platform} className="text-[#55605A]" />{platformLabel(p.platform)}</span>} pct={(p.count / platformMax) * 100} color="var(--primary)" count={p.count} barWidth={70} />
                ))}
              </div>
            ) : <TileEmpty>Counted with the first update.</TileEmpty>}
          </StripCell>
        </Tile>

        {/* ── hero: the executive brief ──────────────────────────────── */}
        <Tile col={7} row={3} variant="hero" eyebrow="Executive brief · this update" meta={`${weekdayDate(runDate)} · read 1 min`}
          footer={oneThing ? (
            <Link href="/dashboard/market" className="inline-flex max-w-full items-center rounded-full bg-[#F5F1E6]/10 px-3 py-1 text-[12px] font-medium text-[#F5F1E6] ring-1 ring-[#F5F1E6]/35 hover:bg-[#F5F1E6]/15">
              <span className="truncate">The one thing to do → {oneThing.title}</span>
            </Link>
          ) : null}
          footerNote={<Link href="/dashboard?detail=brief" scroll={false} className="font-medium text-[#DCE8DD] hover:text-white">Read the full brief →</Link>}
        >
          {showHero ? (
            <>
              <p className="line-clamp-3 max-w-[36rem] text-[17px] font-semibold leading-[1.25] tracking-[-0.012em] [text-wrap:balance]">{narrative.headline}</p>
              {narrative.beats.length > 0 && (
                <div className="grid grid-cols-1 gap-x-4 gap-y-2 sm:grid-cols-3">
                  {narrative.beats.slice(0, 3).map((b) => (
                    <div key={b.metric} className="min-w-0">
                      <div className="font-mono text-[17px] font-semibold leading-none tabular-nums tracking-[-0.02em]">{b.figure}</div>
                      <p className="mt-1 line-clamp-4 text-[12px] leading-[1.45] text-[#F5F1E6]/88">{b.before}<span className="font-semibold text-[#F5F1E6]">{b.figure}</span>{b.after}</p>
                    </div>
                  ))}
                </div>
              )}
              {oneThingQuotes.length > 0 && (
                <div className="flex flex-col gap-2">
                  {oneThingQuotes.slice(0, 2).map((q, i) => (
                    <blockquote key={i} className="max-w-[38rem] border-l-2 border-[#D99A7A] pl-2.5 text-[12.5px] italic leading-[1.4] text-[#F1EBDD]">
                      <span className="line-clamp-2">“{q}”</span>
                    </blockquote>
                  ))}
                  {oneThingVoices > 0 && <span className="text-[10.5px] text-[#F5F1E6]/60">{oneThingQuotes.length > 1 ? 'two' : 'one'} of {oneThingVoices} voices behind the top recommendation</span>}
                </div>
              )}
            </>
          ) : (
            <TileEmpty>Your first brief lands with the next update.</TileEmpty>
          )}
        </Tile>

        {/* ── sentiment ──────────────────────────────────────────────── */}
        <Tile col={5} row={1} eyebrow="Audience sentiment" meta={sent ? `${fmtInt(sent.judged)} judged · to date` : undefined}>
          {sent ? (
            <>
              <div className="flex items-end gap-3">
                <StatValue size="lg" unit="positive">{fmtPct(sent.positivePct, 0)}</StatValue>
                {sentDeltaText && (
                  <span className={`mb-0.5 font-mono text-[11px] ${sentDeltaText.good === null ? 'text-muted-foreground' : sentDeltaText.good ? 'text-positive' : 'text-clay'}`}>{sentDeltaText.text}</span>
                )}
                {sentTier && <span className="mb-0.5 ml-auto text-[11px] text-muted-foreground">{SENTIMENT_TIER_LABEL[sentTier]}</span>}
              </div>
              <ProportionBar segments={sentimentSegments} of="videos" />
              <div className="flex flex-wrap gap-x-3 text-[11px] text-[#3F4B44]">
                {sentimentSegments.map((s) => (
                  <span key={s.label} className="flex items-center gap-1"><span className={`size-1.5 rounded-full ${s.color}`} aria-hidden />{s.label} {fmtInt(s.count)}</span>
                ))}
              </div>
            </>
          ) : <TileEmpty>Sentiment lands with the next update.</TileEmpty>}
        </Tile>

        {/* ── share of tracked conversation ──────────────────────────── */}
        <Tile col={5} row={2} eyebrow="Share of tracked conversation" meta={usePeriodShare ? 'by videos · this update' : 'by videos · all updates'}
          footer={<Link href="/dashboard/competitive">Where you stand{topCompetitor ? ` vs ${topCompetitor.name}` : ''} →</Link>}
          footerNote="share of tracked volume, not the whole web"
        >
          {share && shareSegments.length > 0 ? (
            <div className="flex flex-1 items-center gap-4">
              <Ring segments={shareSegments.map((s) => ({ label: s.label, value: s.value, color: s.color }))} size={128} thickness={16} center={share.client ? fmtPct(share.client.pct) : undefined} sub={share.client ? 'you' : undefined} />
              <div className="flex min-w-0 flex-1 flex-col gap-1.5 text-[11.5px]">
                {shareSegments.map((s) => (
                  <div key={s.label} className="flex items-center gap-1.5">
                    <span className="size-1.5 shrink-0 rounded-full" style={{ background: s.color }} aria-hidden />
                    <span className="min-w-0 flex-1 truncate text-[#3F4B44]">{s.label}</span>
                    <span className="font-mono text-[11.5px] font-semibold tabular-nums">{fmtPct(s.pct)}</span>
                    <span className="w-14 text-right"><Delta value={s.delta} unit="pt" good={s.good} /></span>
                  </div>
                ))}
                <p className="mt-1 line-clamp-2 text-[11px] leading-[1.4] text-muted-foreground">
                  {share.client ? `${fmtInt(share.client.videos)} of your videos` : 'none of your videos'}{topCompetitor ? ` · ${fmtInt(topCompetitor.videos)} ${topCompetitor.name}` : ''}{share.rest ? ` · ${fmtInt(share.rest.videos)} category` : ''}.
                  {share.client && topCompetitor ? (share.client.pct >= topCompetitor.pct ? ` You lead the tracked brands; ${topCompetitor.name} follows.` : ` ${topCompetitor.name} leads the tracked brands.`) : ''}
                </p>
              </div>
            </div>
          ) : <TileEmpty>Share lands once a competitor is tracked and analysed.</TileEmpty>}
        </Tile>

        {/* ── what your market is talking about ─────────────────────── */}
        <Tile col={5} row={2} eyebrow="What your market is talking about" meta="conversations per theme"
          footer={<Link href="/dashboard/voice">All {tiers.confirmed > 0 ? `${tiers.confirmed} confirmed ` : ''}themes →</Link>}
          footerNote={
            <span className="flex items-center gap-2">
              <span className="flex items-center gap-1"><span className="size-1.5 rounded-full" style={{ background: BUCKET_COLOR.client }} aria-hidden />your audience</span>
              <span className="flex items-center gap-1"><span className="size-1.5 rounded-full" style={{ background: BUCKET_COLOR.category }} aria-hidden />category</span>
              {topCompetitor && <span className="flex items-center gap-1"><span className="size-1.5 rounded-full" style={{ background: BUCKET_COLOR.competitor }} aria-hidden />{topCompetitor.name}’s</span>}
            </span>
          }
        >
          {themes.length > 0 ? (
            <div className="flex flex-col gap-[5px]">
              {themes.map((t, i) => (
                <RankedBar
                  key={`${i}-${t.label}`}
                  label={t.label}
                  dot
                  color={BUCKET_COLOR[t.bucket]}
                  pct={(t.conversations / themeMax) * 100}
                  count={t.conversations}
                  badge={t.isNew ? <span className="rounded-full bg-sidebar-accent px-1.5 py-px text-[10px] font-medium text-primary">New</span> : undefined}
                  href={`/dashboard/voice?themes=${encodeURIComponent(t.memberThemes.join(','))}`}
                />
              ))}
              {analysedConversations > 0 && <span className="sr-only">of {analysedConversations} conversations analysed</span>}
            </div>
          ) : <TileEmpty>Themes land with the first analysed update.</TileEmpty>}
        </Tile>

        {/* ── movement since the first update ────────────────────────── */}
        <Tile col={4} row={2} eyebrow="Since your first update"
          meta={mv ? `${updatesCount} updates · ${shortDate(mv.dates[0])} → ${shortDate(mv.dates[mv.dates.length - 1])}` : undefined}
          footer={mv ? <Link href="/dashboard/competitive">Where you stand over time →</Link> : undefined}
          footerNote={mv ? 'deltas vs last update' : undefined}
        >
          {mv ? (
            <div className="flex flex-col gap-[9px] pt-0.5">
              {mv.rows.map((r) => {
                const st = MOVE_STYLE[r.key]
                return <Mover key={r.key} label={r.label} series={r.series} value={st.fmt(r.value)} delta={r.delta} unit={st.unit} good={st.good} color={st.color} />
              })}
            </div>
          ) : <TileEmpty>Your first comparison lands with the next update — two updates are needed to show movement.</TileEmpty>}
        </Tile>

        {/* ── top recommendation ─────────────────────────────────────── */}
        <Tile col={3} row={1} variant={oneThing ? 'warm' : 'default'} eyebrow="Top recommendation" meta={oneThing ? priorityWord(oneThing.priority) : undefined}
          footer={oneThing ? <Link href="/dashboard/market">Why, and the voices{oneThingVoices > 0 ? ` (${oneThingVoices})` : ''} →</Link> : undefined}
        >
          {oneThing ? (
            <p className="line-clamp-3 text-[13.5px] font-semibold leading-[1.3] tracking-[-0.01em]">{oneThing.title}</p>
          ) : <TileEmpty>Recommendations land with the next update.</TileEmpty>}
        </Tile>

        {/* ── your accounts ──────────────────────────────────────────── */}
        <Tile col={3} row={1} eyebrow="On your accounts" meta={accounts.length > 0 ? 'followers · 30 days' : undefined}
          footer={topEvent ? <Link href="/dashboard/videos">{topEvent.magnitude_label} →</Link> : undefined}
        >
          {accounts.length > 0 ? (
            <div className="flex flex-col gap-[3px]">
              {accounts.slice(0, 3).map((a) => (
                <div key={a.platform} className="flex items-center gap-2 text-[12px]">
                  <PlatformIcon platform={a.platform} className="text-[#55605A]" />
                  <span className="min-w-0 flex-1 truncate text-[11.5px]">{platformLabel(a.platform)}</span>
                  <Sparkline values={a.values} width={48} height={16} />
                  <span className="w-10 text-right font-mono text-[11.5px] font-semibold tabular-nums">{fmtCompact(a.latest)}</span>
                  <span className="w-11 text-right"><Delta value={a.deltaPct} unit="%" decimals={1} good="up" /></span>
                </div>
              ))}
            </div>
          ) : <TileEmpty>Add your own handles in Settings to follow your accounts here.</TileEmpty>}
        </Tile>
      </PageGrid>

      {/* ── drawers: one click deeper ────────────────────────────────── */}
      <DetailDrawer open={showBrief} closeHref="/dashboard" title="The executive brief" description={`${brand} · ${weekdayDate(runDate)}`}>
        <div className="space-y-4">
          <p className="text-[16px] font-semibold leading-snug">{narrative.headline}</p>
          {narrative.beats.map((b) => (
            <p key={b.metric} className="text-[13px] leading-[1.5]">{b.before}<strong className="font-semibold">{b.figure}</strong>{b.after}</p>
          ))}
          {narrative.fallback && <p className="text-[11px] text-muted-foreground">Composed from this update’s counted figures.</p>}
          {oneThing && (
            <div className="rounded-lg bg-muted/40 p-3">
              <p className="text-[10.5px] font-semibold uppercase tracking-[0.07em] text-muted-foreground">{priorityWord(oneThing.priority)}</p>
              <p className="mt-1 text-[13.5px] font-semibold">{oneThing.title}</p>
              <p className="mt-1 text-[12.5px] text-foreground/85">{oneThing.reasoning}</p>
              <Link href="/dashboard/market" className="mt-2 inline-block text-[12px] font-medium text-primary">See the full picture →</Link>
            </div>
          )}
          {oneThingQuotes.length > 0 && (
            <div>
              <p className="mb-2 text-[10.5px] font-semibold uppercase tracking-[0.07em] text-muted-foreground">In their words</p>
              <Quotes items={oneThingQuotes} />
            </div>
          )}
          {funnel.length > 0 && (
            <Link href="/dashboard?detail=funnel" scroll={false} className="inline-block text-[12px] font-medium text-primary">How this update was built →</Link>
          )}
        </div>
      </DetailDrawer>

      <DetailDrawer open={showFunnel} closeHref="/dashboard" title="How this update was built" description="every figure is counted from stored data — nothing is estimated">
        <ol className="space-y-2.5 border-l-2 border-primary/20 pl-4">
          {funnel.map((s) => (
            <li key={s.label} className="flex items-baseline gap-3">
              <span className="w-16 shrink-0 text-right font-mono text-[18px] font-semibold tabular-nums">{fmtInt(s.n)}</span>
              <span className="text-[12.5px] text-muted-foreground">{s.label}</span>
            </li>
          ))}
        </ol>
        <p className="mt-4 text-[11px] text-muted-foreground">a conversation is one video and the comments it sparked; themes are confirmed only when heard in more than one conversation</p>
      </DetailDrawer>
    </PageFrame>
  )
}
