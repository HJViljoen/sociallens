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
import { DrawerLink } from '@/components/shell/drawer-link'
import { Sparkline } from '@/components/charts/sparkline'
import { StatValue, StatSentence, Delta } from '@/components/charts/stat'
import { RankedBar } from '@/components/charts/ranked-bar'
import { Ring } from '@/components/charts/ring'
import { RingSync } from '@/components/charts/ring-sync'
import { ClaimPopover } from '@/components/claim-popover'
import { Mover } from '@/components/charts/mover'
import { PlatformIcon } from '@/components/charts/platform-icon'

// Dashboard — "where do we stand?" (one-screen composition 2026-08-22; visual
// identity 2026-08-28, MASTER.md §Visual identity). A strip of counted receipts
// · the executive brief as a white hero with a serif lead line · sentiment ·
// share of tracked conversation · what the market is talking about · movement
// since the first update · the top recommendation · your own accounts.
// Colour means something here: you = green, competitor = orange, category =
// grey; the only underlined claim is the one that opens its voices (rule 5). Every tile gates on its
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

const BUCKET_COLOR: Record<Bucket, string> = { client: 'var(--you)', category: 'var(--cat)', competitor: 'var(--comp)' }
// First competitor in the full orange; further ones step toward the surface so
// they stay "competitor" in hue without competing with the first.
const COMPETITOR_COLORS = ['var(--comp)', 'color-mix(in srgb, var(--comp) 70%, var(--tile))', 'color-mix(in srgb, var(--comp) 48%, var(--tile))', 'var(--mixed)']
const REST_COLOR = 'var(--neutral-seg)'

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
  //
  // Round trips are the cost here, not rows: the DB answers in ~10ms warm but
  // the first requests after an idle spell pay a ~0.5s wake-up, and every
  // sequential wave pays it again. So everything keyed on client_id alone
  // (the whole history, the snapshots, the theme tiers) goes out in this
  // first wave; only what needs the anchored run id waits for the second.
  const SUMMARY_COLS = 'run_id, run_date, total_videos, total_comments, period_videos, period_comments, share_of_voice, period_share_of_voice, period_sentiment_positive, audience_sentiment, period_audience_sentiment'
  const [{ data: client }, { data: tc }, { data: latestRun }, runningRes, registryRes, historyRaw, snapRows, tierRows] = await Promise.all([
    supabase.from('clients').select('company_name').eq('id', clientId).maybeSingle(),
    supabase.from('tracking_configs')
      .select('brand_keywords, competitor_keywords, industry_keywords, platforms, report_day, report_period')
      .eq('client_id', clientId).maybeSingle(),
    supabase.from('pipeline_runs').select('id, started_at')
      .eq('client_id', clientId).in('status', ['completed', 'partial'])
      .order('started_at', { ascending: false }).limit(1).maybeSingle(),
    supabase.from('pipeline_runs').select('id').eq('client_id', clientId).eq('status', 'running'),
    supabase.from('theme_registry').select('id', { count: 'exact', head: true }).eq('client_id', clientId),
    selectAll<SummaryRow>(() =>
      supabase.from('run_summary').select(`${SUMMARY_COLS}, executive_brief`).eq('client_id', clientId).order('run_date', { ascending: true }),
    ),
    // Daily follower snapshots (three platforms cross the 1000-row cap in ~11 months).
    selectAll<{ platform: string; snapshot_date: string; followers: number | null }>(() =>
      supabase.from('account_snapshots').select('platform, snapshot_date, followers').eq('client_id', clientId).order('snapshot_date', { ascending: true }),
    ),
    // Themes confirmed per update (for the movement row) + tiers for the strip.
    selectAll<{ run_id: string; single_source: boolean | null; strength_score: number | null }>(() =>
      supabase.from('themes').select('run_id, single_source, strength_score').eq('client_id', clientId).order('run_id').order('id'),
    ),
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

  // ── everything keyed on the anchored run, in one wave ──────────────────
  let themedQ = supabase.from('themes').select('run_id').eq('client_id', clientId)
  if (notRunning) themedQ = themedQ.not('run_id', 'in', notRunning)
  let latestVidQ = supabase.from('videos').select('run_id').eq('client_id', clientId)
  if (notRunning) latestVidQ = latestVidQ.not('run_id', 'in', notRunning)
  let earlierThemesQ = supabase.from('themes').select('run_id').eq('client_id', clientId)
  if (notRunning) earlierThemesQ = earlierThemesQ.not('run_id', 'in', notRunning)
  const [recRes, latestThemedRes, miRes, latestVidRes, eventsRes, bucketRes] = await Promise.all([
    supabase.from('recommendations').select('id, title, reasoning, priority, based_on, hero_quote').eq('client_id', clientId).eq('run_id', runId),
    themedQ.order('created_at', { ascending: false }).limit(1).maybeSingle(),
    supabase.from('market_insights').select('id, evidence').eq('client_id', clientId).eq('run_id', runId),
    // The newest update that gathered videos (an analysis-only update re-reads
    // old videos and gathers none) — anchors the platform split below.
    latestVidQ.order('scraped_at', { ascending: false }).limit(1).maybeSingle(),
    supabase.from('account_events').select('platform, severity, explained, magnitude_label, explanation')
      .eq('client_id', clientId).eq('run_id', runId).order('severity', { ascending: false }).limit(3),
    // Theme buckets for scoping the recommendation's voices (used below only
    // when there is a recommendation; cheap, and it saves a wave).
    supabase.from('themes').select('bucket, supporting_insight_ids').eq('client_id', clientId).eq('run_id', runId),
  ])

  // ── the third wave: what depends on the second ─────────────────────────
  // Videos by platform (counted rows, not an estimate) need the gathering
  // run; the theme list needs the themed run; the recommendation's supporting
  // insights need the market-insight evidence. Independent of each other, so
  // they go together.
  const videoRunId = (latestVidRes.data?.run_id as string | undefined) ?? runId
  const themedRunId = latestThemedRes.data?.run_id as string | undefined
  const recs = (recRes.data ?? []) as RecRow[]
  const oneThing = topRecommendation(recs)
  const marketInsights = (miRes.data ?? []) as { id: string; evidence: { supporting_theme_ids?: string[] } | null }[]
  const miEvidenceById = new Map(marketInsights.map((m) => [m.id, m.evidence]))
  const supportIds: string[] = []
  if (oneThing) for (const id of oneThing.based_on?.insight_ids ?? []) supportIds.push(...(miEvidenceById.get(id)?.supporting_theme_ids ?? []))
  const [platformRows, themeRowsRes, earlierRes, supportInsights] = await Promise.all([
    selectAll<{ platform: string | null }>(() =>
      supabase.from('videos').select('platform').eq('client_id', clientId).eq('run_id', videoRunId),
    ),
    themedRunId
      ? supabase.from('themes')
          .select('label, description, category, bucket, member_themes, evidence_count, strength_score, rank_score, first_seen')
          .eq('client_id', clientId).eq('run_id', themedRunId)
      : Promise.resolve({ data: null }),
    themedRunId ? earlierThemesQ.neq('run_id', themedRunId).limit(1) : Promise.resolve({ data: null }),
    oneThing ? fetchInsightsByIds<{ id: string; theme: string; platform: string | null }>(supabase, supportIds, 'id, theme, platform') : Promise.resolve([]),
  ])

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
  const historyLabels = history.map((s) => shortDate(s.run_date))
  const platforms = platformSplit(platformRows)
  const platformMax = platforms[0]?.count ?? 0

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
        { label: 'Positive', count: sent.counts.positive, color: 'bg-positive' },
        { label: 'Mixed', count: sent.counts.mixed, color: 'bg-warning' },
        { label: 'Neutral', count: sent.counts.neutral, color: 'bg-neutral-seg' },
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
        ...(share.client ? [{ label: brandShort, value: share.client.videos, pct: share.client.pct, color: 'var(--you)', delta: clientShareDelta, good: 'up' as const }] : []),
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
    themes = topThemes((themeRowsRes.data ?? []) as ThemeRankRow[], 8, (earlierRes.data?.length ?? 0) > 0)
    analysedConversations = Object.values(summary?.share_of_voice ?? {}).reduce((t, e) => t + Number(e?.analysed_videos ?? 0), 0)
  }
  const themeMax = themes[0]?.conversations ?? 0

  // ── the one thing to do + the voices behind it (shared lib/quotes) ─────
  let oneThingQuotes: string[] = []
  let oneThingVoices = 0
  let oneThingPlatforms: { label: string; count: number }[] = []
  if (oneThing) {
    const bucketById = bucketByAudienceId((bucketRes.data ?? []) as ThemeBucketRow[])
    const themeSlugById = new Map(supportInsights.map((a) => [a.id, a.theme]))
    const scopedIds = scopeToClientVoices(supportIds, bucketById)
    oneThingVoices = scopedIds.length
    // Where those voices were heard — a count per platform over the same ids
    // the "N voices" figure counts, so the split always sums to N.
    const platformById = new Map(supportInsights.map((a) => [a.id, a.platform]))
    const byPlatform = new Map<string, number>()
    for (const id of scopedIds) { const pl = platformById.get(id) ?? 'other'; byPlatform.set(pl, (byPlatform.get(pl) ?? 0) + 1) }
    oneThingPlatforms = [...byPlatform.entries()].sort((a, b) => b[1] - a[1]).map(([pl, count]) => ({ label: pl === 'other' ? 'Other' : platformLabel(pl), count }))
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
    yourShare: { color: 'var(--you)', good: 'up', unit: 'pt', fmt: (n) => fmtPct(n) },
    compShare: { color: 'var(--comp)', good: 'down', unit: 'pt', fmt: (n) => fmtPct(n) },
    positive: { color: 'var(--positive)', good: 'up', unit: 'pt', fmt: (n) => fmtPct(n, 0) },
    volume: { color: 'var(--you)', good: 'up', unit: '', fmt: fmtCompact },
    themes: { color: 'var(--cat)', good: 'up', unit: '', fmt: fmtInt },
  }

  // ── your accounts ──────────────────────────────────────────────────────
  const accounts = accountSeries(snapRows, 30)
  const events = (eventsRes.data ?? []) as { platform: string; severity: number; explained: boolean; magnitude_label: string; explanation: string | null }[]
  const topEvent = events.find((e) => e.explained && e.severity >= 2) ?? null

  // ── overlays ───────────────────────────────────────────────────────────
  const showLegend = sp.detail === 'legend'
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

  const claimEvidence = oneThing && oneThingVoices > 0
    ? { voices: oneThingVoices, platforms: oneThingPlatforms, quotes: oneThingQuotes, href: `/dashboard/market?rec=${encodeURIComponent(oneThing.id)}`, hrefLabel: 'See all the voices in Market Intelligence →' }
    : null

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
              <StatSentence
                value={termTotal}
                unit="terms"
                base={<span className="text-secondary-foreground">{termCounts.brand} brand · {termCounts.competitor} competitor · {termCounts.category} category</span>}
                aside={<span className="ml-auto flex items-center gap-1 text-muted-foreground">{(tc?.platforms ?? []).map((p: string) => <PlatformIcon key={p} platform={p} />)}{cadence && <span className="ml-1 text-[11px]">{cadence}</span>}</span>}
              />
            ) : <TileEmpty>Add search terms in Settings to start tracking.</TileEmpty>}
          </StripCell>
          <StripCell eyebrow={periodVideos ? "Videos this update" : "Videos tracked"}>
            {videosNow != null ? (
              <StatSentence
                value={fmtInt(videosNow)}
                delta={videosPrev != null ? videosNow - videosPrev : null}
                good="neutral"
                base={periodVideos ? (summary?.total_videos != null ? `vs last update · ${fmtInt(summary.total_videos)} all-time` : 'vs last update') : 'all-time, across every update'}
                aside={videoSeries.length > 1 ? <Sparkline values={videoSeries} color="var(--you)" fill hover={{ labels: historyLabels }} /> : undefined}
              />
            ) : <TileEmpty>Counted with the first update.</TileEmpty>}
          </StripCell>
          <StripCell eyebrow={periodComments ? "Comments analysed" : "Comments read"}>
            {commentsNow != null ? (
              <StatSentence
                value={fmtInt(commentsNow)}
                delta={commentsPrev != null ? commentsNow - commentsPrev : null}
                good="up"
                base={periodComments ? (summary?.total_comments != null ? `vs last update · ${fmtInt(summary.total_comments)} all-time` : 'vs last update') : 'all-time, across every update'}
                aside={commentSeries.length > 1 ? <Sparkline values={commentSeries} color="var(--you)" fill hover={{ labels: historyLabels }} /> : undefined}
              />
            ) : <TileEmpty>Counted with the first update.</TileEmpty>}
          </StripCell>
          <StripCell eyebrow="Themes heard">
            {tiers.confirmed + tiers.early + tiers.once > 0 ? (
              <StatSentence
                value={tiers.confirmed}
                unit="confirmed"
                base={<span className="font-mono tabular-nums text-secondary-foreground">{tiers.early} early · {tiers.once} heard once{registryCount > 0 ? ` · ${fmtInt(registryCount)} followed over time` : ''}</span>}
              />
            ) : <TileEmpty>Themes land with the first analysed update.</TileEmpty>}
          </StripCell>
          <StripCell eyebrow="Where the conversation is">
            {platforms.length > 0 ? (
              <div className="flex flex-col gap-[3px] text-[11.5px] leading-[1.3]">
                {platforms.slice(0, 4).map((p) => (
                  <RankedBar key={p.platform} label={<span className="flex items-center gap-1.5"><PlatformIcon platform={p.platform} className="text-muted-foreground" />{platformLabel(p.platform)}</span>} pct={(p.count / platformMax) * 100} color="var(--you)" count={p.count} barWidth={70} />
                ))}
              </div>
            ) : <TileEmpty>Counted with the first update.</TileEmpty>}
          </StripCell>
        </Tile>

        {/* ── hero: the executive brief ──────────────────────────────── */}
        <Tile col={7} row={3} variant="hero" distribute="between" eyebrow="Executive brief · this update" meta={weekdayDate(runDate)}
          lead={showHero ? narrative.headline : undefined}
          footer={oneThing ? (
            <span className="inline-flex max-w-full items-baseline gap-2">
              <span className="font-mono text-muted-foreground">→</span>
              <span className="min-w-0 truncate">
                The one thing to do:{' '}
                {claimEvidence
                  ? <ClaimPopover evidence={claimEvidence}>{oneThing.title}</ClaimPopover>
                  : <Link href="/dashboard/market" className="hover:underline">{oneThing.title}</Link>}
              </span>
            </span>
          ) : null}
          footerNote={<DrawerLink href="/dashboard?detail=brief" className="font-medium text-foreground hover:underline">Read the full brief →</DrawerLink>}
        >
          {showHero ? (
            <>
              {narrative.beats.length > 0 && (
                <div className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-3">
                  {narrative.beats.slice(0, 3).map((b) => (
                    <div key={b.metric} className="min-w-0">
                      <div className="font-mono text-[18px] font-semibold leading-none tabular-nums tracking-[-0.02em]">{b.figure}</div>
                      <p className="mt-1.5 line-clamp-3 text-[12.5px] leading-[1.55] text-secondary-foreground">{b.before}<span className="font-semibold text-foreground">{b.figure}</span>{b.after}</p>
                    </div>
                  ))}
                </div>
              )}
              {oneThingQuotes.length > 0 && (
                <div className="flex flex-col gap-1.5 border-l-2 border-border pl-3">
                  {oneThingQuotes.slice(0, 2).map((q, i) => (
                    <blockquote key={i} className="max-w-[44rem] font-serif text-[14px] leading-[1.45] text-foreground">
                      <span className="line-clamp-1">“{q}”</span>
                    </blockquote>
                  ))}
                  {oneThingVoices > 0 && <span className="font-mono text-[10.5px] text-muted-foreground">{oneThingQuotes.length > 1 ? 'two' : 'one'} of {fmtInt(oneThingVoices)} voices behind the top recommendation</span>}
                </div>
              )}
            </>
          ) : (
            <TileEmpty>Your first brief lands with the next update.</TileEmpty>
          )}
        </Tile>

        {/* ── sentiment ──────────────────────────────────────────────── */}
        <Tile col={5} row={1} eyebrow="Audience sentiment" meta={sent ? `${fmtInt(sent.judged)} judged · to date` : undefined} distribute="center">
          {sent ? (
            <>
              <div className="flex items-end gap-3">
                <StatValue size="lg" unit="positive">{fmtPct(sent.positivePct, 0)}</StatValue>
                {sentDeltaText && (
                  <span className={`mb-0.5 font-mono text-[11px] ${sentDeltaText.good === null ? 'text-muted-foreground' : sentDeltaText.good ? 'text-positive' : 'text-negative'}`}>{sentDeltaText.text}</span>
                )}
                {sentTier && <span className="mb-0.5 ml-auto text-[11px] text-muted-foreground">{SENTIMENT_TIER_LABEL[sentTier]}</span>}
              </div>
              <ProportionBar segments={sentimentSegments} of="videos" />
              <div className="flex flex-wrap gap-x-3 text-[11px] text-secondary-foreground">
                {sentimentSegments.map((s) => (
                  <span key={s.label} className="flex items-center gap-1"><span className={`size-1.5 rounded-[2px] ${s.color}`} aria-hidden />{s.label} {fmtInt(s.count)}</span>
                ))}
              </div>
            </>
          ) : <TileEmpty>Sentiment lands with the next update.</TileEmpty>}
        </Tile>

        {/* ── share of tracked conversation ──────────────────────────── */}
        <Tile col={5} row={2} eyebrow="Share of tracked conversation" meta={usePeriodShare ? 'by videos · this update' : 'by videos · all updates'}
          footer={<Link href="/dashboard/competitive">Where you stand{topCompetitor ? ` vs ${topCompetitor.name}` : ''} →</Link>}
          distribute="center"
        >
          {share && shareSegments.length > 0 ? (
            <RingSync className="flex flex-1 items-center gap-4">
              <Ring interactive segments={shareSegments.map((s) => ({ label: s.label, value: s.value, color: s.color }))} size={128} thickness={16} center={share.client ? fmtPct(share.client.pct) : undefined} sub={share.client ? 'you' : undefined} />
              <div role="list" className="flex min-w-0 flex-1 flex-col gap-1 text-[11.5px]">
                {shareSegments.map((s, i) => (
                  <div key={s.label} data-seg={i} tabIndex={0} role="listitem" aria-label={`${s.label} ${fmtPct(s.pct)}`} className="flex items-center gap-1.5 px-1.5 py-0.5 -mx-1.5 outline-none focus-visible:ring-1 focus-visible:ring-ring">
                    <span className="size-2 shrink-0 rounded-[2px]" style={{ background: s.color }} aria-hidden />
                    <span className="min-w-0 flex-1 truncate text-secondary-foreground">{s.label}</span>
                    <span className="font-mono text-[11.5px] font-semibold tabular-nums">{fmtPct(s.pct)}</span>
                    <span className="w-14 text-right"><Delta value={s.delta} unit="pt" good={s.good} /></span>
                  </div>
                ))}
                <p className="mt-1 line-clamp-2 px-0 text-[11px] leading-[1.4] text-muted-foreground">
                  {share.client ? `${fmtInt(share.client.videos)} of your videos` : 'none of your videos'}{topCompetitor ? ` · ${fmtInt(topCompetitor.videos)} ${topCompetitor.name}` : ''}{share.rest ? ` · ${fmtInt(share.rest.videos)} category` : ''}.
                  {share.client && topCompetitor ? (share.client.pct >= topCompetitor.pct ? ` You lead the tracked brands; ${topCompetitor.name} follows.` : ` ${topCompetitor.name} leads the tracked brands.`) : ''}
                </p>
              </div>
            </RingSync>
          ) : <TileEmpty>Share lands once a competitor is tracked and analysed.</TileEmpty>}
        </Tile>

        {/* ── what your market is talking about ─────────────────────── */}
        <Tile col={5} row={2} eyebrow="What your market is talking about" meta="conversations per theme"
          footer={<Link href="/dashboard/voice">All {tiers.confirmed > 0 ? `${tiers.confirmed} confirmed ` : ''}themes →</Link>}
          footerNote={
            <span className="flex items-center gap-2.5">
              <span className="flex items-center gap-1"><span className="size-2 rounded-[2px]" style={{ background: BUCKET_COLOR.client }} aria-hidden />you</span>
              <span className="flex items-center gap-1"><span className="size-2 rounded-[2px]" style={{ background: BUCKET_COLOR.category }} aria-hidden />category</span>
              {topCompetitor && <span className="flex items-center gap-1"><span className="size-2 rounded-[2px]" style={{ background: BUCKET_COLOR.competitor }} aria-hidden />{topCompetitor.name}</span>}
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
                  badge={t.isNew ? <span className="rounded-full bg-accent px-1.5 py-px text-[10px] font-medium text-accent-foreground">New</span> : undefined}
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
          distribute="center"
        >
          {mv ? (
            <div className="flex flex-col gap-3">
              {mv.rows.map((r) => {
                const st = MOVE_STYLE[r.key]
                return <Mover key={r.key} label={r.label} series={r.series} value={st.fmt(r.value)} delta={r.delta} unit={st.unit} good={st.good} color={st.color} />
              })}
            </div>
          ) : <TileEmpty>Your first comparison lands with the next update — two updates are needed to show movement.</TileEmpty>}
        </Tile>

        {/* ── top recommendation ─────────────────────────────────────── */}
        <Tile col={3} row={1} distribute="center" hoverable={!!oneThing} className="py-3" eyebrow="Top recommendation" meta={oneThing ? priorityWord(oneThing.priority) : undefined}
          footer={oneThing ? (
            <Link href={`/dashboard/market?rec=${encodeURIComponent(oneThing.id)}`} className="after:absolute after:inset-0">
              {oneThingVoices > 0 ? `Grounded in ${fmtInt(oneThingVoices)} voices${oneThingPlatforms.length > 1 ? ` · ${oneThingPlatforms.length} platforms` : ''} →` : 'Why, and the voices →'}
            </Link>
          ) : undefined}
        >
          {oneThing ? (
            <p className="line-clamp-2 text-[12.5px] font-semibold leading-[1.2] tracking-[-0.01em]">{oneThing.title}</p>
          ) : <TileEmpty>Recommendations land with the next update.</TileEmpty>}
        </Tile>

        {/* ── your accounts ──────────────────────────────────────────── */}
        <Tile col={3} row={1} distribute="center" eyebrow="On your accounts" meta={accounts.length > 0 ? 'followers · 30 days' : undefined}
          footer={topEvent ? <Link href="/dashboard/videos">{topEvent.magnitude_label} →</Link> : undefined}
        >
          {accounts.length > 0 ? (
            <div className="flex flex-col gap-[3px]">
              {accounts.slice(0, 3).map((a) => (
                <div key={a.platform} className="flex items-center gap-2 text-[12px]">
                  <PlatformIcon platform={a.platform} className="text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate text-[11.5px]">{platformLabel(a.platform)}</span>
                  <Sparkline values={a.values} color="var(--you)" width={48} height={16} />
                  <span className="w-10 text-right font-mono text-[11.5px] font-semibold tabular-nums">{fmtCompact(a.latest)}</span>
                  <span className="w-11 text-right"><Delta value={a.deltaPct} unit="%" decimals={1} good="up" /></span>
                </div>
              ))}
            </div>
          ) : <TileEmpty>Add your own handles in Settings to follow your accounts here.</TileEmpty>}
        </Tile>
      </PageGrid>

      {/* ── drawers: one click deeper ────────────────────────────────── */}
      <DetailDrawer value="brief" closeHref="/dashboard" title="The executive brief" description={`${brand} · ${weekdayDate(runDate)}`}>
        <div className="space-y-4">
          <p className="font-serif text-[17px] font-medium leading-snug">{narrative.headline}</p>
          {narrative.beats.map((b) => (
            <p key={b.metric} className="text-[13px] leading-[1.5]">{b.before}<strong className="font-semibold">{b.figure}</strong>{b.after}</p>
          ))}
          {narrative.fallback && <p className="text-[11px] text-muted-foreground">Composed from this update’s counted figures.</p>}
          {oneThing && (
            <div className="rounded-[4px] bg-inner p-3">
              <p className="text-[10.5px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">{priorityWord(oneThing.priority)}</p>
              <p className="mt-1 text-[13.5px] font-semibold">{oneThing.title}</p>
              <p className="mt-1 text-[12.5px] text-secondary-foreground">{oneThing.reasoning}</p>
              <Link href={`/dashboard/market?rec=${encodeURIComponent(oneThing.id)}`} className="mt-2 inline-block text-[12px] font-medium underline underline-offset-2">See the full picture →</Link>
            </div>
          )}
          {oneThingQuotes.length > 0 && (
            <div>
              <p className="mb-2 text-[10.5px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">In their words</p>
              <Quotes items={oneThingQuotes} />
            </div>
          )}
          {funnel.length > 0 && (
            <DrawerLink href="/dashboard?detail=funnel" className="inline-block text-[12px] font-medium underline underline-offset-2">How this update was built →</DrawerLink>
          )}
        </div>
      </DetailDrawer>

      <DetailDrawer value="funnel" closeHref="/dashboard" title="How this update was built" description="every figure is counted from stored data — nothing is estimated">
        <ol className="space-y-2.5 border-l-2 border-border pl-4">
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
