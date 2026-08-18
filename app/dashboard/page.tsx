import { selectAll } from '@/lib/supabase-admin'
import Link from 'next/link'
import { getSessionContext } from '@/lib/auth'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { SENTIMENT_TIER_BADGE } from '@/lib/ui-colors'
import { sentimentTier, evidenceOf, SENTIMENT_TIER_LABEL, SENTIMENT_TIER_RULE, type GlossaryKey } from '@/lib/calibration'
import { HowToRead } from '@/components/how-to-read'
import { DetailOverlay } from '@/components/detail-overlay'
import { Quotes } from '@/components/quotes'
import { StatBand, type StatTile } from '@/components/stat-band'
import { DeltaBadge, MovementBadge } from '@/components/delta-badge'
import { proportionDelta, SENTIMENT_BAND, SHARE_BAND } from '@/lib/report-bands'
import { ProportionBar, BarLegend, type Segment } from '@/components/proportion-bar'
import { FindingTile } from '@/components/finding-tile'
import { InsightNarrative, type Verdict } from '@/components/insight-narrative'
import { composeDashboardNarrative, type NarrativeFigures } from '@/lib/dashboard-narrative'
import type { ExecutiveBrief } from '@/lib/pipeline/schemas'
import { rankByTheme, fetchQuotesByAudience, fetchInsightsByIds, createQuotePicker, bucketByAudienceId, scopeToClientVoices, type ThemeBucketRow } from '@/lib/quotes'

// Dashboard — the state snapshot ("Where do we stand?", Redesign Spec §2), NOT
// this week's news (that's the report's job) and no longer the pipeline readout
// it used to be. Four bands: deep-green welcome hero + human coverage line ·
// three where-you-stand stat cards, each with a small server-rendered chart
// (sentiment split · share of conversation · audience mood) · "what your market
// is talking about" (top-3 themes, editorial numerals, each routing to Voice) ·
// the single best-grounded recommendation. Themes prefer the persisted `themes`
// table (Pass B labels + first_seen "New" badges, populated from the 2026-07-06
// run onward) and degrade gracefully to slug-level grouping of audience_insights
// on older runs. Desktop-first. Chart hues validated (dataviz six checks):
// green #2E8B5E (bg-chart-2) · amber (warning) · terracotta (negative) · clay,
// with recessive sand (bg-input) for neutral/rest — legends + tooltips supply
// the required secondary encoding. Client-facing rules apply: no run ids, no
// scraped/analysed KPIs, no pipeline jargon — including empty states.

/** One entity bucket of run_summary.share_of_voice (Step 2a's output). */
interface SovEntry {
  videos: number
  pct_videos: number
}

/** The state numbers, straight from run_summary — the numbers rule: displayed
 *  values come from the pipeline's computed snapshot, never re-derived here. */
interface RunSummaryRow {
  run_id?: string
  total_videos: number | null
  total_comments: number | null
  /** Videos/comments gathered by this run only (null on pre-2026-07-09 rows). */
  period_videos: number | null
  period_comments: number | null
  share_of_voice: Record<string, SovEntry> | null
  sentiment_drivers: { video_sentiment_counts?: Record<string, number>; videos_judged?: number } | null
  /** Audience sentiment only — Pass A's comment-derived read, never
   *  classify-meta's caption framing (T0-8). Null on rows written before
   *  2026-08-18, whose sentiment_drivers blended the two. */
  audience_sentiment: { positive: number | null; judged: number; counts?: Record<string, number> } | null
  executive_brief?: ExecutiveBrief | null
}

/** A Step 2c owned-account event (Owned-Data-Plan) — candidate for the one-thing slot. */
interface AccountEventRow {
  severity: number
  explained: boolean
  magnitude_label: string
  explanation: string | null
  hero_quote: string | null
}

interface AudienceInsight {
  id: string
  category: string
  theme: string
  description: string
  strength_score: number | null
  emotion: string | null
}

interface ThemeRow {
  label: string
  description: string | null
  category: string
  member_themes: string[]
  evidence_count: number
  strength_score: number | null
  rank_score?: number | null
  first_seen: boolean
}

/** A dashboard-ready theme, from either the themes table or the slug fallback. */
interface TopTheme {
  label: string
  description: string
  category: string
  memberThemes: string[]
  evidenceLabel: string
  /** Distinct conversations behind the theme — the figure the brief substitutes. */
  conversations: number
  isNew: boolean
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
const PLATFORM_NAMES: Record<string, string> = { tiktok: 'TikTok', youtube: 'YouTube', instagram: 'Instagram', reddit: 'Reddit' }

/** "TikTok, YouTube & Instagram" */
function listNames(platforms: string[]): string {
  const names = platforms.map((p) => PLATFORM_NAMES[p] ?? cap(p))
  if (names.length <= 1) return names.join('')
  return `${names.slice(0, -1).join(', ')} & ${names[names.length - 1]}`
}

const shortDate = (iso: string) =>
  new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' }).format(new Date(iso))

export default async function DashboardPage({
  searchParams,
}: {
  searchParams?: Promise<{ detail?: string }>
}) {
  const sp = (await searchParams) ?? {}
  // Auth + tenant via the RLS-enforced session client. See lib/auth.ts.
  const { supabase, clientId } = await getSessionContext()

  // Anchor on the newest run WITH DATA: an in-flight run has no analysis rows
  // yet, so anchoring on it blanks the site for the duration of every run. The
  // page keeps serving the previous completed run until the new one closes;
  // the same guard keeps a mid-gather partial corpus out of the stats.
  const [{ data: client }, { data: tc }, { data: latestRun }, runningRes] = await Promise.all([
    supabase.from('clients').select('company_name').eq('id', clientId).maybeSingle(),
    supabase.from('tracking_configs')
      .select('brand_keywords, competitor_keywords, industry_keywords, platforms, report_day, report_period')
      .eq('client_id', clientId).maybeSingle(),
    supabase.from('pipeline_runs').select('id, started_at')
      .eq('client_id', clientId).in('status', ['completed', 'partial'])
      .order('started_at', { ascending: false }).limit(1).maybeSingle(),
    supabase.from('pipeline_runs').select('id')
      .eq('client_id', clientId).eq('status', 'running'),
  ])
  const runningIds = ((runningRes.data ?? []) as { id: string }[]).map((r) => r.id)
  const notRunning = runningIds.length ? `(${runningIds.join(',')})` : null

  let vidQ = supabase.from('videos').select('run_id, scraped_at').eq('client_id', clientId)
  if (notRunning) vidQ = vidQ.not('run_id', 'in', notRunning)
  const { data: latestVid } = await vidQ.order('scraped_at', { ascending: false }).limit(1).maybeSingle()

  const brand = client?.company_name ?? 'Your brand'
  const keywordCount =
    (tc?.brand_keywords?.length ?? 0) + (tc?.competitor_keywords?.length ?? 0) + (tc?.industry_keywords?.length ?? 0)
  const nextUpdate =
    tc?.report_period === 'weekly' && tc?.report_day ? `next update ${cap(tc.report_day)}`
    : tc?.report_period === 'monthly' ? 'updates monthly'
    : null

  const runId = latestRun?.id as string | undefined
  const videoRunId = latestVid?.run_id as string | undefined

  if (!runId || !videoRunId) {
    return (
      <div className="space-y-8">
        <HeroBand line={null} />
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            Your first analysis {nextUpdate ? `lands with the ${nextUpdate.replace('next update ', '')} update` : 'is on its way'} — check back then.
          </CardContent>
        </Card>
      </div>
    )
  }

  // State snapshot + insight reads for the latest run, in parallel. Numbers come
  // from run_summary (the pipeline's corpus-computed snapshot) — never recounted
  // from videos/comments here, so every page shows the same figures.
  let themedQ = supabase.from('themes').select('run_id').eq('client_id', clientId)
  if (notRunning) themedQ = themedQ.not('run_id', 'in', notRunning)
  const [summaryRes, prevSummaryRes, aiRes, recRes, latestThemedRes, miRes, eventsRes] = await Promise.all([
    supabase.from('run_summary')
      .select('total_videos, total_comments, period_videos, period_comments, share_of_voice, sentiment_drivers, audience_sentiment, executive_brief')
      .eq('client_id', clientId).eq('run_id', runId).maybeSingle(),
    // The update before this one — every "since last update" delta self-gates
    // on this row existing, so first runs simply show no comparison.
    supabase.from('run_summary')
      .select('run_id, total_videos, total_comments, period_videos, period_comments, share_of_voice, sentiment_drivers, audience_sentiment')
      .eq('client_id', clientId).neq('run_id', runId)
      .order('run_date', { ascending: false }).limit(1).maybeSingle(),
    // Current insights of the corpus (audience_insights_current — the rows each
    // video's analyzed_run_id names), not "rows stamped with this run": Pass A
    // is incremental since 2026-08-17, so a run only rewrites changed videos.
    // selectAll: Össur has 1,351 current insights and Sealand 1,110, both past
    // the 1000-row cap — and T1-11 now PRINTS this set's size to the client, so
    // a bare select would render "share of 1,000 feelings" forever.
    selectAll<AudienceInsight>(() =>
      supabase.from('audience_insights_current')
        .select('id, category, theme, description, strength_score, emotion')
        .eq('client_id', clientId).order('id', { ascending: true }),
    ),
    supabase.from('recommendations')
      .select('id, type, title, reasoning, priority, based_on, hero_quote')
      .eq('client_id', clientId).eq('run_id', runId),
    themedQ.order('created_at', { ascending: false }).limit(1).maybeSingle(),
    supabase.from('market_insights').select('id, evidence')
      .eq('client_id', clientId).eq('run_id', runId),
    supabase.from('account_events')
      .select('severity, explained, magnitude_label, explanation, hero_quote')
      .eq('client_id', clientId).eq('run_id', runId)
      .order('severity', { ascending: false }),
  ])

  const audienceInsights = aiRes
  // The denominator behind "heard in N conversations": every video we track.
  const summary = (summaryRes.data ?? null) as RunSummaryRow | null
  const prevSummary = (prevSummaryRes.data ?? null) as RunSummaryRow | null
  const commentCount = Number(summary?.total_comments ?? 0)
  // Videos that produced an insight — the only pool a theme's evidence_count
  // can be drawn from. total_videos is everything gathered (Sealand 1,734 vs
  // ~351 analysed), so using it understated a theme's reach ~5x.
  const analysedConversations = Object.values(
    (summary?.share_of_voice ?? {}) as Record<string, { videos?: number; analysed_videos?: number }>,
  ).reduce((t, e) => t + Number(e?.analysed_videos ?? 0), 0)

  // Previous-update counts for the themes/recommendations tiles — anchored on
  // the same "last update" (prevSummary's run) as every other delta. A zero
  // prev count means that run predates the themes pipeline: no comparison.
  let prevThemeCount = 0
  let prevRecCount = 0
  if (prevSummary?.run_id) {
    const [prevThemesRes, prevRecsRes] = await Promise.all([
      supabase.from('themes').select('id', { count: 'exact', head: true })
        .eq('client_id', clientId).eq('run_id', prevSummary.run_id).gte('evidence_count', 2),
      supabase.from('recommendations').select('id', { count: 'exact', head: true })
        .eq('client_id', clientId).eq('run_id', prevSummary.run_id),
    ])
    prevThemeCount = prevThemesRes.count ?? 0
    prevRecCount = prevRecsRes.count ?? 0
  }
  // New conversations gathered by this update — distinct from the all-time
  // corpus, so the coverage line never passes a cumulative total off as fresh.
  const newCommentCount = Number(summary?.period_comments ?? 0)

  // ---- Welcome hero coverage line (human terms, per spec) ----
  const lineParts = [
    keywordCount > 0 && tc?.platforms?.length
      ? `Tracking ${keywordCount} search terms across ${listNames(tc.platforms)}`
      : null,
    commentCount > 0
      ? newCommentCount > 0 && newCommentCount !== commentCount
        ? `${newCommentCount.toLocaleString('en-US')} new comments this update · ${commentCount.toLocaleString('en-US')} analysed to date`
        : `${commentCount.toLocaleString('en-US')} comments analysed to date`
      : null,
    latestVid?.scraped_at ? `data through ${shortDate(latestVid.scraped_at as string)}` : null,
    nextUpdate,
  ].filter(Boolean) as string[]

  // ---- Where you stand: sentiment split · share of tracked videos · mood ----
  // sentiment_drivers has held the AUDIENCE family alone since 2026-08-18
  // (T0-8); audience_sentiment is the explicit copy of the same numbers and is
  // what the delta below insists on, since rows written before that date
  // blended in classify-meta's caption framing and are not comparable.
  const vsCounts =
    summary?.audience_sentiment?.counts ?? summary?.sentiment_drivers?.video_sentiment_counts ?? {}
  const sentimentCounts = {
    positive: Number(vsCounts.positive ?? 0),
    neutral: Number(vsCounts.neutral ?? 0),
    mixed: Number(vsCounts.mixed ?? 0),
    negative: Number(vsCounts.negative ?? 0),
  }
  const analysedCount =
    Number(summary?.audience_sentiment?.judged ?? summary?.sentiment_drivers?.videos_judged ?? 0) ||
    sentimentCounts.positive + sentimentCounts.neutral + sentimentCounts.mixed + sentimentCounts.negative
  const pctOf = (n: number, total: number) => (total > 0 ? Math.round((n / total) * 100) : 0)
  const positiveShare = analysedCount > 0 ? pctOf(sentimentCounts.positive, analysedCount) : null
  // Calibrated sentiment word — fixed cutoffs on the measured split, never worded by the model.
  const sentTier = positiveShare != null
    ? sentimentTier(positiveShare, pctOf(sentimentCounts.negative, analysedCount))
    : null
  const sentimentSegments: Segment[] = (
    [
      { label: 'Positive', count: sentimentCounts.positive, color: 'bg-chart-2' },
      { label: 'Neutral', count: sentimentCounts.neutral, color: 'bg-input' },
      { label: 'Mixed', count: sentimentCounts.mixed, color: 'bg-warning' },
      { label: 'Negative', count: sentimentCounts.negative, color: 'bg-negative' },
    ] as const
  )
    .filter((s) => s.count > 0)
    .map((s) => ({ ...s, pct: pctOf(s.count, analysedCount) }))

  // Share of tracked conversation, straight from run_summary.share_of_voice.
  const sov = summary?.share_of_voice ?? {}
  const clientEntry = sov.client
  const clientShare = clientEntry ? Math.round(Number(clientEntry.pct_videos)) : null
  // Colour follows the entity: the brand is always green, competitors take the
  // earthy accents in volume order, the rest of the category stays recessive.
  const COMPETITOR_COLORS = ['bg-clay', 'bg-ochre', 'bg-plum', 'bg-slate'] as const
  const competitorSegs = Object.entries(sov)
    .filter(([key]) => key.startsWith('competitor:'))
    .sort((a, b) => b[1].videos - a[1].videos)
    .map(([key, e], i) => ({
      label: key.slice('competitor:'.length), count: e.videos, pct: Math.round(Number(e.pct_videos)),
      color: COMPETITOR_COLORS[Math.min(i, COMPETITOR_COLORS.length - 1)],
    }))
  const restEntry = sov['industry-other']
  const shareSegments: Segment[] = [
    ...(clientEntry ? [{ label: brand, count: clientEntry.videos, pct: Math.round(Number(clientEntry.pct_videos)), color: 'bg-chart-2' }] : []),
    ...competitorSegs,
    ...(restEntry ? [{ label: 'Rest of category', count: restEntry.videos, pct: Math.round(Number(restEntry.pct_videos)), color: 'bg-input' }] : []),
  ].filter((s) => s.count > 0)

  // ---- "Since last update" deltas + competitor reference point ----
  // Numbers rule: counted, denominated, comparable. The comparator is a real
  // reference (top competitor now; the previous update once one exists).
  // Sentiment's previous side comes from audience_sentiment alone (below) —
  // recomputing it from the previous row's sentiment_drivers would silently
  // compare against a blended pre-2026-08-18 number.
  const prevClientShare = prevSummary?.share_of_voice?.client
    ? Math.round(Number(prevSummary.share_of_voice.client.pct_videos))
    : null
  // Proportion movement is band-gated (T0-8): an arrow means the shift cleared
  // 2xSE on denominators of at least 100 per side. Both sides must carry the
  // audience family — a pre-split row is a different measurement.
  const nowAudience = summary?.audience_sentiment ?? null
  const prevAudience = prevSummary?.audience_sentiment ?? null
  const sentimentVerdict =
    nowAudience?.positive != null && prevAudience?.positive != null
      ? proportionDelta(
          { nowPct: nowAudience.positive, nowN: nowAudience.judged, prevPct: prevAudience.positive, prevN: prevAudience.judged },
          SENTIMENT_BAND,
        )
      : null
  const trackedNow = Object.values(sov).reduce((t, e) => t + Number(e?.videos ?? 0), 0)
  const trackedPrev = Object.values(prevSummary?.share_of_voice ?? {}).reduce((t, e) => t + Number(e?.videos ?? 0), 0)
  const shareVerdict =
    clientShare != null && prevClientShare != null
      ? proportionDelta(
          {
            nowPct: clientShare, nowN: trackedNow, nowK: Number(clientEntry?.videos ?? 0),
            prevPct: prevClientShare, prevN: trackedPrev, prevK: Number(prevSummary?.share_of_voice?.client?.videos ?? 0),
          },
          SHARE_BAND,
        )
      : null
  const topCompetitor = competitorSegs[0] ?? null

  const emotionCounts = new Map<string, number>()
  for (const i of audienceInsights) {
    if (i.emotion) emotionCounts.set(i.emotion, (emotionCounts.get(i.emotion) ?? 0) + 1)
  }
  const topEmotions = [...emotionCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3)
  // Every feeling counted, so a top-3 bar can say what it is 3 of.
  const emotionTotal = [...emotionCounts.values()].reduce((a, b) => a + b, 0)
  const maxEmotion = topEmotions[0]?.[1] ?? 0

  // ---- What your market is talking about: top 3 themes ----
  // Prefer the persisted themes table (Pass B labels + first_seen); fall back to
  // slug-level grouping of audience_insights for runs before it existed. "New"
  // badges only when an earlier themed run exists to compare against.
  let topThemes: TopTheme[] = []
  // Counted for the "how this update was built" funnel overlay.
  let themeTotal = 0
  let themeMultiSource = 0
  const themedRunId = latestThemedRes.data?.run_id as string | undefined
  if (themedRunId) {
    const [{ data: themeRows }, { data: earlier }] = await Promise.all([
      supabase.from('themes')
        .select('label, description, category, member_themes, evidence_count, strength_score, rank_score, first_seen')
        .eq('client_id', clientId).eq('run_id', themedRunId),
      supabase.from('themes').select('id')
        .eq('client_id', clientId).neq('run_id', themedRunId).limit(1),
    ])
    const showNew = (earlier?.length ?? 0) > 0
    themeTotal = (themeRows ?? []).length
    themeMultiSource = ((themeRows ?? []) as ThemeRow[]).filter((t) => t.evidence_count >= 2).length
    topThemes = ((themeRows ?? []) as ThemeRow[])
      // Same key as everywhere else (Tier 1). This was the last surface still
      // ranking its own way, so the dashboard and the weekly email could name
      // different "top themes" from the same run.
      .sort((a, b) =>
        (b.rank_score ?? b.evidence_count * (b.strength_score ?? 0)) -
        (a.rank_score ?? a.evidence_count * (a.strength_score ?? 0)))
      .slice(0, 3)
      .map((t) => ({
        label: t.label,
        description: t.description ?? '',
        category: t.category,
        memberThemes: t.member_themes,
        // N of M, not a bare N: "heard in 3 conversations" reads the same
        // whether it is 3 of 4 or 3 of 400 (Tier 1).
        evidenceLabel: `in ${evidenceOf(t.evidence_count, analysedConversations)}`,
        conversations: t.evidence_count,
        isNew: showNew && t.first_seen,
      }))
  } else {
    const bySlug = new Map<string, AudienceInsight[]>()
    for (const i of audienceInsights) {
      const arr = bySlug.get(i.theme)
      if (arr) arr.push(i)
      else bySlug.set(i.theme, [i])
    }
    topThemes = [...bySlug.values()]
      .map((group) => {
        const strongest = group.reduce((a, b) => (Number(b.strength_score ?? 0) > Number(a.strength_score ?? 0) ? b : a))
        return { group, strongest, score: group.length * Number(strongest.strength_score ?? 0) }
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)
      .map(({ group, strongest }) => ({
        label: cap(strongest.theme.replace(/_/g, ' ')),
        description: strongest.description,
        category: strongest.category,
        memberThemes: [strongest.theme],
        evidenceLabel: `${group.length} mention${group.length === 1 ? '' : 's'}`,
        conversations: group.length,
        isNew: false,
      }))
  }

  // ---- The one thing: top-priority, best-grounded recommendation — unless a
  // major explained event on the client's OWN account outranks it (code
  // ranking: severity 3 + explained takes the slot; anything less defers).
  const events = (eventsRes.data ?? []) as AccountEventRow[]
  const topEvent = events.find((e) => e.explained && e.severity >= 3) ?? null

  const priorityRank: Record<string, number> = { high: 0, medium: 1, low: 2 }
  const recs = (recRes.data ?? []) as {
    id: string; type: string; title: string; reasoning: string
    priority: string | null; based_on: { insight_ids?: string[] } | null; hero_quote: string | null
  }[]
  const oneThing = [...recs].sort(
    (a, b) =>
      (priorityRank[a.priority ?? 'low'] ?? 3) - (priorityRank[b.priority ?? 'low'] ?? 3) ||
      (b.based_on?.insight_ids?.length ?? 0) - (a.based_on?.insight_ids?.length ?? 0),
  )[0]

  // Evidence-led: lead the recommendation with the real voices behind it (shared
  // lib/quotes) — the pipeline's hero_quote where present, heuristic otherwise.
  // The "one thing" is a claim about the client, so the pool keeps client +
  // category voices only (entity-bucket scoping, teardown §Run 1 defect 1).
  // The brief leads with the recommendation's real voices whether or not an
  // account event also claims a card below, so fetch whenever a rec exists.
  let oneThingQuotes: string[] = []
  if (oneThing) {
    const marketInsights = (miRes.data ?? []) as { id: string; evidence: { supporting_theme_ids?: string[] } | null }[]
    const miEvidenceById = new Map(marketInsights.map((m) => [m.id, m.evidence]))
    const { data: bucketData } = await supabase.from('themes')
      .select('bucket, supporting_insight_ids')
      .eq('client_id', clientId).eq('run_id', runId)
    const bucketById = bucketByAudienceId((bucketData ?? []) as ThemeBucketRow[])
    const supportIds: string[] = []
    for (const id of oneThing.based_on?.insight_ids ?? []) supportIds.push(...(miEvidenceById.get(id)?.supporting_theme_ids ?? []))
    // Slug map for the ids THIS run's recommendation cites — read by id from the
    // base table (see fetchInsightsByIds): a newer in-flight run may already
    // have superseded some of those videos' rows in the current view.
    const themeSlugById = new Map(
      (await fetchInsightsByIds<{ id: string; theme: string }>(supabase, supportIds, 'id, theme')).map((a) => [a.id, a.theme]),
    )
    const scopedIds = scopeToClientVoices(supportIds, bucketById)
    const claim = `${oneThing.title} ${oneThing.reasoning}`
    const pool = rankByTheme(scopedIds, claim, themeSlugById).slice(0, 120)
    const quotesByAudience = await fetchQuotesByAudience(supabase, pool)
    const pick = createQuotePicker(quotesByAudience, themeSlugById)
    oneThingQuotes = pick(scopedIds, 2, claim, oneThing.hero_quote)
  }

  // ---- Executive brief — the woven hero narrative. The model authored the
  // prose and left `[[n]]` tokens; every figure below is substituted HERE from
  // run_summary (the numbers rule holds — the model never supplies a rendered
  // number). A null/unusable brief falls back to a code-composed narrative.
  const narrativeFigures: NarrativeFigures = {
    brand,
    topTheme: topThemes[0]
      ? { label: topThemes[0].label, description: topThemes[0].description, conversations: topThemes[0].conversations }
      : null,
    sentiment: positiveShare != null ? { positivePct: positiveShare } : null,
    shareOfVoice: clientShare != null ? { clientPct: clientShare, hasCompetitors: competitorSegs.length > 0 } : null,
  }
  const narrative = composeDashboardNarrative(summary?.executive_brief, narrativeFigures)
  const priorityWordFor = (p: string | null | undefined) =>
    p === 'high' ? 'Act now' : p === 'medium' ? 'Plan next' : 'Worth considering'
  const verdict: Verdict | null = oneThing
    ? { word: priorityWordFor(oneThing.priority), title: oneThing.title, href: '/dashboard/market', cta: 'See the full picture' }
    : null
  // Skip the hero entirely on a thin run with nothing to say (no beats, no
  // action, no voice) — the counted strip + cards below still carry the page.
  const showInsight = narrative.beats.length > 0 || !!verdict || oneThingQuotes.length > 0

  // ---- "How this update was built" — the counted evidence funnel ----
  // Every row is a stored figure (tracking config, run_summary, themes) —
  // the credibility answer to "where do these numbers come from?".
  const funnelSteps = [
    keywordCount > 0 && tc?.platforms?.length
      ? { n: keywordCount, label: `search terms tracked across ${listNames(tc.platforms)}`, delta: null }
      : null,
    summary?.total_videos
      ? {
          n: Number(summary.total_videos), label: 'conversations gathered into your tracked corpus',
          delta: prevSummary?.total_videos ? Number(summary.total_videos) - Number(prevSummary.total_videos) : null,
        }
      : null,
    commentCount > 0
      ? { n: commentCount, label: 'comments analysed inside them', delta: prevSummary?.total_comments ? commentCount - Number(prevSummary.total_comments) : null }
      : null,
    summary?.period_videos
      ? {
          n: Number(summary.period_videos), label: 'conversations from this update’s period',
          delta: prevSummary?.period_videos ? Number(summary.period_videos) - Number(prevSummary.period_videos) : null,
        }
      : null,
    analysedCount > 0
      ? {
          n: analysedCount, label: 'videos rated on how their audience reacted',
          delta: prevAudience?.judged ? analysedCount - prevAudience.judged : null,
        }
      : null,
    themeTotal > 0 ? { n: themeTotal, label: 'themes heard across the conversation', delta: null } : null,
    themeMultiSource > 0 ? { n: themeMultiSource, label: 'confirmed by more than one conversation', delta: null } : null,
  ].filter(Boolean) as { n: number; label: string; delta: number | null }[]
  const showFunnel = sp.detail === 'funnel' && funnelSteps.length > 0
  const showLegend = sp.detail === 'legend'
  const legendItems: GlossaryKey[] = topThemes.some((t) => t.isNew) ? ['conversations', 'sentiment', 'new'] : ['conversations', 'sentiment']

  // Keyword coverage for the funnel overlay — fetched only when it's open.
  // Keyword rows live on the run whose GATHER produced them, and analysis-only
  // re-runs skip gather, so anchor on the newest run that has rows.
  let keywordCoverage: { keyword: string; found: number; relevant: number }[] = []
  if (showFunnel) {
    const { data: kpRows } = await supabase.from('keyword_performance')
      .select('run_id, keyword, videos_found, gate_survived, created_at')
      .eq('client_id', clientId)
      .order('created_at', { ascending: false }).limit(400)
    const rows = (kpRows ?? []) as { run_id: string; keyword: string; videos_found: number; gate_survived: number }[]
    const latestKpRun = rows[0]?.run_id
    const byKeyword = new Map<string, { keyword: string; found: number; relevant: number }>()
    // Reddit community harvests are stored as keyword rows ('r/amputee') so the
    // ROI tooling works, but they are NOT search terms and this overlay says
    // they are. They're also deliberately unfiltered, so their gate-survival
    // rate is low BY DESIGN — showing it to a client next to their own keywords
    // reads as a quality failure. Operator-only: scripts/subreddit-roi.ts.
    for (const r of rows.filter((r) => r.run_id === latestKpRun && !r.keyword.startsWith('r/'))) {
      const agg = byKeyword.get(r.keyword) ?? { keyword: r.keyword, found: 0, relevant: 0 }
      agg.found += r.videos_found
      agg.relevant += r.gate_survived
      byKeyword.set(r.keyword, agg)
    }
    keywordCoverage = [...byKeyword.values()].sort((a, b) => b.relevant - a.relevant)
  }

  return (
    <div className="space-y-8">
      {sentTier && (
        <div className="flex justify-end -mb-4">
          <HowToRead items={legendItems} open={showLegend} basePath="/dashboard" />
        </div>
      )}
      <HeroBand
        line={lineParts.length ? lineParts.join(' · ') : null}
        detailHref={funnelSteps.length > 0 ? '/dashboard?detail=funnel' : null}
      />

      {/* The executive brief — the woven read of this update, one big block leading the page */}
      {showInsight && <InsightNarrative narrative={narrative} verdict={verdict} quotes={oneThingQuotes} />}

      {/* This update, in counted figures — deltas appear once a previous update exists */}
      <StatBand
        tiles={[
          summary?.period_videos
            ? { n: Number(summary.period_videos), label: 'conversations', delta: prevSummary?.period_videos ? Number(summary.period_videos) - Number(prevSummary.period_videos) : null }
            : null,
          newCommentCount > 0
            ? { n: newCommentCount, label: 'new comments', delta: prevSummary?.period_comments ? newCommentCount - Number(prevSummary.period_comments) : null }
            : null,
          themeMultiSource > 0
            ? { n: themeMultiSource, label: 'confirmed themes', delta: prevThemeCount > 0 ? themeMultiSource - prevThemeCount : null }
            : null,
          (recRes.data ?? []).length > 0
            ? { n: (recRes.data ?? []).length, label: 'recommendations', delta: prevRecCount > 0 ? (recRes.data ?? []).length - prevRecCount : null }
            : null,
        ].filter(Boolean) as StatTile[]}
      />

      {/* Where you stand — the state snapshot, the secondary tier under the hero */}
      <section className="space-y-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Where you stand</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card className="md:grid md:grid-rows-subgrid md:row-span-2 md:gap-6">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-start gap-2 text-sm font-medium text-muted-foreground">
              <span className="mt-1.5 size-2 shrink-0 rounded-full bg-chart-2" aria-hidden />
              Sentiment
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-baseline gap-2">
              <div className="text-3xl font-bold text-positive">{positiveShare != null ? `${positiveShare}%` : '—'}</div>
              <MovementBadge verdict={sentimentVerdict} unit="pts" />
            </div>
            {sentTier && (
              <div>
                <span title={SENTIMENT_TIER_RULE[sentTier]} className={`px-2 py-0.5 rounded-full text-xs font-medium ${SENTIMENT_TIER_BADGE[sentTier]}`}>
                  {SENTIMENT_TIER_LABEL[sentTier]}
                </span>
              </div>
            )}
            {sentimentSegments.length > 0 ? (
              <>
                <ProportionBar segments={sentimentSegments} of="videos" />
                <BarLegend segments={sentimentSegments} />
              </>
            ) : (
              <p className="text-xs text-muted-foreground">lands with the next update</p>
            )}
            {positiveShare != null && (
              <p className="text-xs text-muted-foreground">positive across {analysedCount} videos rated on how their audience reacted</p>
            )}
          </CardContent>
        </Card>

        <Card className="md:grid md:grid-rows-subgrid md:row-span-2 md:gap-6">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-start gap-2 text-sm font-medium text-muted-foreground">
              <span className="mt-1.5 size-2 shrink-0 rounded-full bg-clay" aria-hidden />
              Share of tracked videos
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-baseline gap-2">
              <div className="text-3xl font-bold">{clientShare != null ? `${clientShare}%` : '—'}</div>
              <MovementBadge verdict={shareVerdict} unit="pts" />
            </div>
            {shareSegments.length > 0 ? (
              <>
                <ProportionBar segments={shareSegments} of="videos" />
                <BarLegend segments={shareSegments} />
              </>
            ) : (
              <p className="text-xs text-muted-foreground">no competitors tracked yet</p>
            )}
            {clientShare != null && (
              <p className="text-xs text-muted-foreground">of the {trackedNow.toLocaleString('en-US')} videos you track are about {brand}</p>
            )}
            {clientShare != null && topCompetitor && (
              <p className="text-xs text-muted-foreground">
                {clientShare >= topCompetitor.pct
                  ? `you lead the tracked brands — ${topCompetitor.label} follows at ${topCompetitor.pct}%`
                  : `${topCompetitor.label} leads the tracked brands at ${topCompetitor.pct}%`}
              </p>
            )}
          </CardContent>
        </Card>

        <Card className="md:grid md:grid-rows-subgrid md:row-span-2 md:gap-6">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-start gap-2 text-sm font-medium text-muted-foreground">
              <span className="mt-1.5 size-2 shrink-0 rounded-full bg-plum" aria-hidden />
              Audience mood
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="text-3xl font-bold capitalize">{topEmotions[0] ? topEmotions[0][0] : '—'}</div>
            {topEmotions.length > 0 ? (
              <div className="space-y-1.5">
                {topEmotions.map(([emotion, n]) => (
                  <div key={emotion} className="flex items-center gap-2" title={`${cap(emotion)} · ${evidenceOf(n, emotionTotal, 'mentions')} across everything we have read`}>
                    <span className="w-20 shrink-0 text-xs capitalize text-muted-foreground">{emotion}</span>
                    {/* bar needs its own track: a % width on the row itself gets flex-shrunk
                        to the same leftover space for every row on narrow screens */}
                    <span className="min-w-0 flex-1" aria-hidden>
                      <span className="block h-2 rounded-full bg-chart-2" style={{ width: `${Math.max(8, (n / maxEmotion) * 100)}%` }} />
                    </span>
                    <span className="shrink-0 text-[11px] text-muted-foreground">{n}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">lands with the next update</p>
            )}
            {topEmotions.length > 0 && (
              <p className="text-xs text-muted-foreground">
                the three most common feelings, of {emotionTotal.toLocaleString('en-US')} mentioned across everything we have read.
                Bars are relative to the most common one.
              </p>
            )}
          </CardContent>
        </Card>
        </div>
      </section>

      {/* What your market is talking about */}
      {topThemes.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            What your market is talking about
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {topThemes.map((t, i) => (
              <FindingTile
                key={t.label}
                finding={{
                  label: t.label,
                  description: t.description,
                  category: t.category,
                  href: `/dashboard/voice?themes=${encodeURIComponent(t.memberThemes.join(','))}`,
                  evidenceLabel: t.evidenceLabel,
                  rank: i + 1,
                  isNew: t.isNew,
                }}
              />
            ))}
          </div>
        </section>
      )}

      {/* A major explained movement on the client's OWN account — a distinct
          alert from the corpus brief above; the recommendation now leads the
          brief, so this slot is the account-event case only. */}
      {topEvent && (
        <Card className="ring-2 ring-primary/30">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold uppercase tracking-wide text-primary">The one thing on your account</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {topEvent.hero_quote && <Quotes items={[topEvent.hero_quote]} />}
            <p className="text-xl font-bold">{topEvent.magnitude_label}</p>
            {topEvent.explanation && <p className="text-sm text-muted-foreground">{topEvent.explanation}</p>}
            <Link
              href="/dashboard/trends"
              className="inline-flex items-center gap-1 rounded-full bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90"
            >
              See what moved <span aria-hidden>→</span>
            </Link>
          </CardContent>
        </Card>
      )}

      {/* "How this update was built" — counted provenance, one click off the hero */}
      {showFunnel && (
        <DetailOverlay closeHref="/dashboard">
          <div className="space-y-4 pr-6">
            <div>
              <h3 className="text-lg font-semibold">How this update was built</h3>
              <p className="text-xs text-muted-foreground">every figure below is counted from stored data — nothing is estimated</p>
            </div>
            <ol className="space-y-2.5 border-l-2 border-primary/20 pl-4">
              {funnelSteps.map((s) => (
                <li key={s.label} className="flex items-baseline gap-3">
                  <span className="w-16 shrink-0 text-right text-xl font-bold tabular-nums">{s.n.toLocaleString('en-US')}</span>
                  <span className="text-sm text-muted-foreground">
                    {s.label} {s.delta != null && <DeltaBadge delta={s.delta} />}
                  </span>
                </li>
              ))}
            </ol>
            {keywordCoverage.length > 0 && (
              <div className="space-y-1.5 border-t pt-3">
                <p className="text-xs font-medium">What each search term brought in</p>
                {keywordCoverage.map((k) => (
                  <div key={k.keyword} className="flex items-center justify-between gap-3 text-xs">
                    <span className="min-w-0 truncate">{k.keyword}</span>
                    <span className="flex shrink-0 items-center gap-2 tabular-nums text-muted-foreground">
                      <span className="inline-block h-1.5 w-14 overflow-hidden rounded-full bg-muted" aria-hidden>
                        <span
                          className="block h-full rounded-full bg-primary/60"
                          style={{ width: `${k.found > 0 ? Math.max(4, Math.round((k.relevant / k.found) * 100)) : 0}%` }}
                        />
                      </span>
                      <span>{k.found} found · {k.relevant} relevant{k.found > 0 ? ` (${Math.round((k.relevant / k.found) * 100)}%)` : ''}</span>
                    </span>
                  </div>
                ))}
                <p className="text-[10px] text-muted-foreground">
                  counted when this update was gathered — relevance is the automated on-topic check every conversation must clear
                </p>
              </div>
            )}
            <p className="text-[10px] text-muted-foreground">
              a conversation is one video and the comments it sparked; themes are confirmed only when heard in more than one conversation
            </p>
          </div>
        </DetailOverlay>
      )}
    </div>
  )
}

/** The deep-green welcome hero — the page's single stat-hero element. */
function HeroBand({ line, detailHref }: { line: string | null; detailHref?: string | null }) {
  return (
    <div className="stat-hero rounded-2xl px-6 py-8 sm:px-10 sm:py-12">
      <h1 className="text-3xl sm:text-4xl font-bold tracking-tight">What your market is saying</h1>
      {line && <p className="mt-3 text-sm text-[#CFE3D6]">{line}</p>}
      {detailHref && (
        <Link
          href={detailHref}
          scroll={false}
          className="mt-2 inline-block text-xs text-[#CFE3D6] underline decoration-[#CFE3D6]/50 underline-offset-4 hover:text-white"
        >
          How this update was built →
        </Link>
      )}
    </div>
  )
}
