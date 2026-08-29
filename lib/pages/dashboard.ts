import type { SupabaseClient } from '@supabase/supabase-js'
import { selectAll } from '../supabase-admin'
import type { Segment } from '../../components/proportion-bar'
import { proportionDelta, SENTIMENT_BAND, SHARE_BAND, type DeltaVerdict } from '../report-bands'
import { composeDashboardNarrative, type NarrativeFigures, type ResolvedBeat } from '../dashboard-narrative'
import type { ExecutiveBrief } from '../pipeline/schemas'
import { rankByTheme, fetchQuotesByAudience, fetchInsightsByIds, createCitedQuotePicker, bucketByAudienceId, scopeToClientVoices, cleanQuote, type ThemeBucketRow } from '../quotes'
import { quoteRef } from '../renderables/quotes-freeze'
import type { Quote, Scope } from '../renderables/types'
import { sentimentTier, SENTIMENT_TIER_LABEL, type GlossaryKey } from '../calibration'
import { fmtInt, fmtCompact, fmtPct, weekdayDate, shortDate, platformLabel, cap } from '../format'
import {
  themeTiers, topThemes, platformSplit, sentimentSplit, shareBreakdown, pointDelta, movement, accountSeries, topRecommendation,
  type ThemeRankRow, type HistoryRow, type Sov, type AudienceSentiment, type Bucket, type Movement, type AccountSeries,
} from '../dashboard-tiles'
import type { MethodNoteData } from '../../components/print/method-note'

// Dashboard loader — the data half of app/dashboard/page.tsx (split 2026-08-29,
// Reports & Exports T3). Everything below the session line of the old page,
// wave for wave: round trips are the cost here, not rows (the DB answers in
// ~10ms warm but the first requests after an idle spell pay a ~0.5s wake-up,
// and every sequential wave pays it again). The output is TILE-READY — what
// the renderers in components/pages/dashboard consume and what a snapshot
// stores. Quotes travel as { ref, text } so a snapshot can freeze them.
//
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

export const BUCKET_COLOR: Record<Bucket, string> = { client: 'var(--you)', category: 'var(--cat)', competitor: 'var(--comp)' }
// First competitor in the full orange; further ones step toward the surface so
// they stay "competitor" in hue without competing with the first.
const COMPETITOR_COLORS = ['var(--comp)', 'color-mix(in srgb, var(--comp) 70%, var(--tile))', 'color-mix(in srgb, var(--comp) 48%, var(--tile))', 'var(--mixed)']
const REST_COLOR = 'var(--neutral-seg)'

/** The stored priority as the client's word. Distinct from
 *  lib/calibration.ts::priorityWord, which takes a RANK (Market's list). */
export const priorityLabel = (p: string | null | undefined) => (p === 'high' ? 'Act now' : p === 'medium' ? 'Plan next' : 'Worth considering')

/** A band-gated proportion verdict as a short phrase. */
export function verdictDelta(v: DeltaVerdict | null): { text: string; good: boolean | null } | null {
  if (!v) return null
  if (v.state === 'moved') {
    const d = Math.round(v.change * 10) / 10
    return { text: `${d > 0 ? '+' : '−'}${Math.abs(d)} pt since last update`, good: d > 0 }
  }
  if (v.state === 'no_clear_change') return { text: 'no clear change since last update', good: null }
  return null
}

export interface StripFigure {
  now: number | null
  prev: number | null
  series: number[]
  /** True when the figure is this update's period layer (else cumulative). */
  period: boolean
  allTime: number | null
}

export interface ShareSeg {
  label: string
  value: number
  pct: number
  color: string
  delta: number | null
  good: 'up' | 'neutral'
}

export interface TopTheme {
  label: string
  description: string
  category: string | null
  bucket: Bucket
  memberThemes: string[]
  conversations: number
  isNew: boolean
}

export interface DashboardData {
  brand: string
  brandShort: string
  runId: string
  runDate: string
  updatesCount: number
  nextUpdate: string | null
  /** The page bar line: brand · updated … · next update … */
  context: string
  strip: {
    termTotal: number
    termCounts: { brand: number; competitor: number; category: number }
    platformsTracked: string[]
    cadence: string | null
    videos: StripFigure
    comments: StripFigure
    historyLabels: string[]
    tiers: { confirmed: number; early: number; once: number }
    registryCount: number
    platforms: { platform: string; count: number }[]
  }
  hero: {
    show: boolean
    headline: string
    beats: ResolvedBeat[]
    fallback: boolean
    oneThing: { id: string; title: string; reasoning: string; priority: string | null } | null
    quotes: Quote[]
    voices: number
    platforms: { label: string; count: number }[]
  }
  sentiment: {
    positivePct: number
    judged: number
    deltaText: { text: string; good: boolean | null } | null
    tierLabel: string | null
    segments: Segment[]
  } | null
  share: {
    usePeriodShare: boolean
    segments: ShareSeg[]
    client: { videos: number; pct: number } | null
    topCompetitor: { name: string; videos: number; pct: number } | null
    rest: { videos: number; pct: number } | null
  } | null
  themes: {
    rows: TopTheme[]
    max: number
    analysedConversations: number
    confirmed: number
    topCompetitorName: string | null
  }
  movement: Movement | null
  accounts: {
    series: AccountSeries[]
    topEvent: { platform: string; magnitude_label: string; explanation: string | null } | null
  }
  legendItems: GlossaryKey[]
  funnel: { n: number; label: string }[]
  method: MethodNoteData
}

export type DashboardEmpty = { empty: true; brand: string; nextUpdate: string | null }

/** Loads the Dashboard. Returns the empty-state shape (not null) before the
 *  first analysed update so the page can still say when to come back. */
export async function loadDashboard(scope: Scope): Promise<DashboardData | DashboardEmpty> {
  const supabase = scope.supabase as SupabaseClient
  const clientId = scope.clientId

  // Anchor on the newest run WITH DATA; an in-flight run has no analysis rows
  // yet, so anchoring on it would blank the page for the duration of every run.
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

  if (!runId) return { empty: true, brand, nextUpdate }

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

  const tiers = themeTiers(tierRows.filter((t) => t.run_id === themedRunId))
  const confirmedByRun = new Map<string, number>()
  for (const t of tierRows) if (!t.single_source) confirmedByRun.set(t.run_id, (confirmedByRun.get(t.run_id) ?? 0) + 1)

  // ── where you stand ────────────────────────────────────────────────────
  const sent = sentimentSplit(summary?.audience_sentiment)
  const sentPrev = sentimentSplit(prev?.audience_sentiment)
  const sentimentVerdict = sent && sentPrev
    ? proportionDelta({ nowPct: sent.positivePct, nowN: sent.judged, prevPct: sentPrev.positivePct, prevN: sentPrev.judged }, SENTIMENT_BAND)
    : null
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
  const shareSegments: ShareSeg[] = share
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
  let themes: TopTheme[] = []
  let analysedConversations = 0
  if (themedRunId) {
    themes = topThemes((themeRowsRes.data ?? []) as ThemeRankRow[], 8, (earlierRes.data?.length ?? 0) > 0)
    analysedConversations = Object.values(summary?.share_of_voice ?? {}).reduce((t, e) => t + Number(e?.analysed_videos ?? 0), 0)
  }

  // ── the one thing to do + the voices behind it (shared lib/quotes) ─────
  let oneThingQuotes: Quote[] = []
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
    const pick = createCitedQuotePicker(quotesByAudience, themeSlugById)
    const cited = pick(scopedIds, 3, claim, oneThing.hero_quote)
    // The hero leads when the pool vouched for it; otherwise it is cited
    // through its own row (h:recommendations:<id>), which the erasure sweep
    // nulls by string match — same words, same guarantee.
    const hero = oneThing.hero_quote ? cleanQuote(oneThing.hero_quote) : ''
    const heroCited = hero && cited.some((q) => q.text.toLowerCase() === hero.toLowerCase())
    oneThingQuotes = hero && !heroCited
      ? [{ ref: quoteRef.hero('recommendations', oneThing.id), text: hero }, ...cited].slice(0, 3)
      : cited
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

  // ── movement since the first update ────────────────────────────────────
  const mv = movement(history as HistoryRow[], confirmedByRun)

  // ── your accounts ──────────────────────────────────────────────────────
  const accounts = accountSeries(snapRows, 30)
  const events = (eventsRes.data ?? []) as { platform: string; severity: number; explained: boolean; magnitude_label: string; explanation: string | null }[]
  const topEvent = events.find((e) => e.explained && e.severity >= 2) ?? null

  // ── overlays ───────────────────────────────────────────────────────────
  const legendItems: GlossaryKey[] = themes.some((t) => t.isNew) ? ['conversations', 'sentiment', 'new'] : ['conversations', 'sentiment']
  const platformsTracked: string[] = tc?.platforms ?? []
  const funnel = [
    termTotal > 0 && platformsTracked.length ? { n: termTotal, label: `search terms tracked across ${platformsTracked.map(platformLabel).join(', ')}` } : null,
    summary?.total_videos ? { n: Number(summary.total_videos), label: 'conversations now in your tracked set' } : null,
    summary?.total_comments ? { n: Number(summary.total_comments), label: 'comments read inside them' } : null,
    summary?.period_videos ? { n: Number(summary.period_videos), label: 'conversations from this update’s period' } : null,
    sent ? { n: sent.judged, label: 'videos rated on how their audience reacted' } : null,
    tiers.confirmed + tiers.early + tiers.once > 0 ? { n: tiers.confirmed + tiers.early + tiers.once, label: 'themes heard across the conversation' } : null,
    tiers.confirmed > 0 ? { n: tiers.confirmed, label: 'confirmed by more than one conversation' } : null,
  ].filter(Boolean) as { n: number; label: string }[]

  const updatesCount = history.length
  const context = `${brand} · updated ${weekdayDate(runDate)}${nextUpdate ? ` · ${nextUpdate}` : ''}`

  return {
    brand, brandShort, runId, runDate, updatesCount, nextUpdate, context,
    strip: {
      termTotal, termCounts, platformsTracked, cadence,
      videos: { now: videosNow, prev: videosPrev, series: videoSeries, period: !!periodVideos, allTime: summary?.total_videos != null ? Number(summary.total_videos) : null },
      comments: { now: commentsNow, prev: commentsPrev, series: commentSeries, period: !!periodComments, allTime: summary?.total_comments != null ? Number(summary.total_comments) : null },
      historyLabels, tiers, registryCount, platforms,
    },
    hero: {
      show: showHero, headline: narrative.headline, beats: narrative.beats, fallback: narrative.fallback,
      oneThing: oneThing ? { id: oneThing.id, title: oneThing.title, reasoning: oneThing.reasoning, priority: oneThing.priority } : null,
      quotes: oneThingQuotes, voices: oneThingVoices, platforms: oneThingPlatforms,
    },
    sentiment: sent ? {
      positivePct: sent.positivePct, judged: sent.judged, deltaText: verdictDelta(sentimentVerdict),
      tierLabel: sentTier ? SENTIMENT_TIER_LABEL[sentTier] : null, segments: sentimentSegments,
    } : null,
    share: share ? {
      usePeriodShare, segments: shareSegments,
      client: share.client ? { videos: share.client.videos, pct: share.client.pct } : null,
      topCompetitor: topCompetitor ? { name: topCompetitor.name, videos: topCompetitor.videos, pct: topCompetitor.pct } : null,
      rest: share.rest ? { videos: share.rest.videos, pct: share.rest.pct } : null,
    } : null,
    themes: { rows: themes, max: themes[0]?.conversations ?? 0, analysedConversations, confirmed: tiers.confirmed, topCompetitorName: topCompetitor?.name ?? null },
    movement: mv,
    accounts: { series: accounts, topEvent: topEvent ? { platform: topEvent.platform, magnitude_label: topEvent.magnitude_label, explanation: topEvent.explanation } : null },
    legendItems,
    funnel,
    method: {
      company: brand,
      period: `Update of ${weekdayDate(runDate)}`,
      platforms: platformsTracked,
      videos: summary?.total_videos != null ? Number(summary.total_videos) : null,
      comments: summary?.total_comments != null ? Number(summary.total_comments) : null,
      note: 'A conversation is one video and the comments it sparked; themes are confirmed only when heard in more than one conversation.',
    },
  }
}

export const isDashboardEmpty = (d: DashboardData | DashboardEmpty): d is DashboardEmpty => 'empty' in d

export const dashboardFmt = { fmtInt, fmtCompact, fmtPct, weekdayDate, shortDate, platformLabel }
