import { selectAll } from '@/lib/supabase-admin'
import { getSessionContext } from '@/lib/auth'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { categoryTint } from '@/lib/ui-colors'
import { Quotes } from '@/components/quotes'
import { evidenceOf } from '@/lib/calibration'

// Trends — how the market has moved across recent updates (Redesign Spec §6/§9,
// unlocked once a tenant has ≥2 comparable updates on record). The dashboard is
// this week's state; Trends is the trajectory. Everything is drawn from the
// per-update `run_summary` snapshots (share of conversation, sentiment, volume)
// and the `themes` table joined by label across updates — never recomputed from
// the corpus, which only exists for the latest update. Charts are server-rendered
// inline SVG in the shared green palette (no charting dependency); rates use a
// zoomed, labelled y-band, magnitudes get a zero baseline. Client-facing rules:
// no run ids, no scraped/analysed jargon — a tenant with one update sees the
// "your first comparison is coming" state, not an empty chart.

interface RunSummary {
  run_id: string
  run_date: string
  total_videos: number | null
  total_comments: number | null
  share_of_voice: Record<string, { pct_videos?: number }> | null
  overall_sentiment_positive: number | null
  overall_sentiment_negative: number | null
  /** This-run-only metrics (2026-07-09 split) — preferred for trend series:
   *  the cumulative columns are all-time stocks whose deltas damp toward zero
   *  as the corpus grows. Null on rows written before the split. */
  period_comments: number | null
  period_share_of_voice: Record<string, { pct_videos?: number }> | null
  period_sentiment_positive: number | null
  /** Audience sentiment only (T0-8). The legacy columns above blended Pass A's
   *  comment-derived read with classify-meta's caption framing on rows written
   *  before 2026-08-18, so a series that mixes the two fabricates a step
   *  change on the deploy. Null on those older rows. */
  audience_sentiment: { positive: number | null; judged: number } | null
  period_audience_sentiment: { positive: number | null; judged: number } | null
  period: string | null
}

interface ThemeRow {
  run_id: string
  registry_id: string | null
  label: string
  category: string
  bucket: string
  strength_score: number | null
  evidence_count: number | null
  first_seen: boolean
}

/** A weekly follower snapshot of one of the client's own accounts. */
interface SnapshotRow {
  platform: string
  snapshot_date: string
  followers: number | null
}

/** A Step 2c event: code-measured movement, explained (or honestly not). */
interface AccountEventRow {
  platform: string
  metric: string
  event_date: string
  direction: string
  severity: number
  magnitude_label: string
  explained: boolean
  explanation: string | null
  supporting_theme_labels: string[] | null
  hero_quote: string | null
}

/** A theme's trajectory across the updates it appeared in (chronological). */
interface Trajectory {
  label: string
  category: string
  bucket: string
  strength: number[]
  latestEvidence: number
  emerged: boolean
  movement: 'emerging' | 'gaining' | 'fading' | 'steady'
  delta: number
}

// Deterministic formatters: Intl/toLocaleString draw on ICU data that differs
// between the Node server and the browser, so using them in hydrated output
// causes SSR mismatches. Format by hand and anchor dates to UTC (run_date is
// stored at a fixed UTC hour) so server and client always agree.
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const shortDate = (iso: string) => {
  const d = new Date(iso)
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`
}
const round1 = (n: number) => Math.round(n * 10) / 10
const fmtPct = (n: number) => `${round1(n)}%`
const fmtInt = (n: number) => Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')

/** Short brand label for prose — "Össur — Demo" → "Össur". */
const shortBrand = (name: string) => name.split(/[—–-]/)[0].trim() || name

export default async function TrendsPage() {
  // Auth + tenant via the RLS-enforced session client. See lib/auth.ts.
  const { supabase, clientId } = await getSessionContext()

  const [{ data: client }, summariesRaw, themesRaw, snapData, { data: eventData }, { data: newsData }] = await Promise.all([
    supabase.from('clients').select('company_name').eq('id', clientId).maybeSingle(),
    selectAll<RunSummary>(() =>
      supabase.from('run_summary')
        .select('run_id, run_date, total_videos, total_comments, share_of_voice, overall_sentiment_positive, overall_sentiment_negative, period_comments, period_share_of_voice, period_sentiment_positive, audience_sentiment, period_audience_sentiment, period')
        .eq('client_id', clientId).order('run_date', { ascending: true }),
    ),
    selectAll<ThemeRow>(() =>
      supabase.from('themes')
        .select('run_id, registry_id, label, category, bucket, strength_score, evidence_count, first_seen')
        .eq('client_id', clientId).order('run_id', { ascending: true }),
    ),
    // selectAll: daily snapshots (3 platforms) cross the 1000-row cap in
    // ~11 months — a bare select would freeze the charts at the cap.
    selectAll<{ platform: string; snapshot_date: string; followers: number | null }>(() =>
      supabase.from('account_snapshots')
        .select('platform, snapshot_date, followers')
        .eq('client_id', clientId).order('snapshot_date', { ascending: true }).order('platform', { ascending: true }),
    ),
    supabase.from('account_events')
      .select('platform, metric, event_date, direction, severity, magnitude_label, explained, explanation, supporting_theme_labels, hero_quote')
      .eq('client_id', clientId).order('event_date', { ascending: false }),
    // Rings 0-2 only (brand/competitors/category) — macro noise stays out.
    supabase.from('news_items')
      .select('title, url, source_ref, published_at, ring')
      .eq('client_id', clientId).lte('ring', 2)
      .order('published_at', { ascending: false, nullsFirst: false })
      .limit(8),
  ])

  const brand = client?.company_name ?? 'Your brand'
  const brandShort = shortBrand(brand)
  const summaries = summariesRaw

  // Need at least two comparable updates to trend anything.
  if (summaries.length < 2) {
    return (
      <div className="space-y-8">
        <HeroBand line={null} />
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            Trends compare your results across updates. Your first comparison lands with the next update — check back then.
          </CardContent>
        </Card>
      </div>
    )
  }

  const dates = summaries.map((s) => s.run_date)
  const first = summaries[0]
  const last = summaries[summaries.length - 1]
  const period = last.period === 'monthly' ? 'monthly' : 'weekly'
  // Denominator for "in N conversations now": videos tracked in the latest update.
  const latestTracked = Number(last.total_videos ?? 0)
  const heroLine = `Tracking since ${shortDate(first.run_date)} · ${summaries.length} ${period} updates`

  // Period-layer series when EVERY row has it (a whole series must come from one
  // layer — mixing period rows with cumulative rows would fabricate movement).
  // Pre-split rows (e.g. the seeded demo) fall back to the cumulative columns.
  const allPeriod = summaries.every(
    (s) => s.period_comments != null && s.period_share_of_voice != null && s.period_sentiment_positive != null,
  )
  const sovOf = (s: RunSummary) => (allPeriod ? s.period_share_of_voice : s.share_of_voice)

  // ---- share of conversation: brand vs the leading tracked competitor ----
  const clientShareOf = (s: RunSummary) => Number(sovOf(s)?.client?.pct_videos ?? 0)
  const competitorEntries = (s: RunSummary) =>
    Object.entries(sovOf(s) ?? {})
      .filter(([k]) => k.startsWith('competitor:'))
      .map(([k, v]) => ({ name: k.slice('competitor:'.length), pct: Number(v?.pct_videos ?? 0) }))
  // Lead competitor = highest share in the most recent update; tracked across all.
  const leadCompetitor = competitorEntries(last).sort((a, b) => b.pct - a.pct)[0]?.name ?? null
  const compShareOf = (s: RunSummary) =>
    leadCompetitor ? competitorEntries(s).find((c) => c.name === leadCompetitor)?.pct ?? 0 : 0

  const clientSeries = summaries.map(clientShareOf)
  const compSeries = summaries.map(compShareOf)
  // Sentiment charts from the AUDIENCE family alone (T0-8). The legacy columns
  // hold a blended number on rows written before 2026-08-18 (Össur: 1,155
  // judged videos blended vs 496 audience), so plotting old rows beside new
  // ones would draw a step change that is nothing but the provenance split and
  // narrate it as "eased N points". Until every row in the window carries the
  // family, the sentiment surfaces self-gate rather than lie — the same rule
  // that gates this whole page on having two comparable updates.
  const audienceOf = (s: RunSummary) =>
    (allPeriod ? s.period_audience_sentiment : s.audience_sentiment) ?? s.audience_sentiment
  const hasSentimentSeries = summaries.every((s) => audienceOf(s)?.positive != null)
  const sentSeries = hasSentimentSeries
    ? summaries.map((s) => Number(audienceOf(s)?.positive ?? 0))
    : []
  const volSeries = summaries.map((s) => Number((allPeriod ? s.period_comments : s.total_comments) ?? 0))

  const delta = (arr: number[]) => arr[arr.length - 1] - arr[0]
  const shareDelta = delta(clientSeries)
  const compDelta = delta(compSeries)
  const sentDelta = delta(sentSeries)
  const volDelta = delta(volSeries)

  // ---- theme trajectories ----
  // Joined on the theme's REGISTRY ID (stable across runs); the label is only a
  // fallback for rows written before the registry existed. Measured reason: on
  // two runs with identical inputs, 446 of 507 unchanged themes were relabelled,
  // so a label join drops most lines and invents new ones (2026-08-17).
  const runDate = new Map(summaries.map((s) => [s.run_id, s.run_date]))
  const earliestDate = dates[0]
  // Rows written before the registry existed carry no id, so bridge them onto
  // the identity by label where the label is unchanged — otherwise the same
  // theme would split into two disjoint series at the changeover and every line
  // would end at the previous update.
  const bridge = new Map<string, string>()
  for (const t of themesRaw) if (t.registry_id) bridge.set(t.label, t.registry_id)
  const byLabel = new Map<string, { date: string; strength: number; evidence: number; category: string; bucket: string; label: string; firstSeen: boolean }[]>()
  for (const t of themesRaw) {
    const d = runDate.get(t.run_id)
    if (!d) continue
    const key = t.registry_id ?? bridge.get(t.label) ?? `label:${t.label}`
    const arr = byLabel.get(key) ?? []
    arr.push({ date: d, strength: Number(t.strength_score ?? 0), evidence: Number(t.evidence_count ?? 0), category: t.category, bucket: t.bucket, label: t.label, firstSeen: t.first_seen })
    byLabel.set(key, arr)
  }

  const trajectories: Trajectory[] = [...byLabel.entries()]
    .map(([, ptsRaw]) => {
      const pts = ptsRaw.sort((a, b) => a.date.localeCompare(b.date))
      // Display the LATEST label — the identity is the key, the wording is
      // whatever this week's labeller chose.
      const label = pts[pts.length - 1].label
      const strength = pts.map((p) => p.strength)
      const d = strength[strength.length - 1] - strength[0]
      const emerged = pts[0].date > earliestDate && pts[0].firstSeen
      const movement: Trajectory['movement'] =
        emerged ? 'emerging' : d >= 1 ? 'gaining' : d <= -1 ? 'fading' : 'steady'
      return {
        label,
        category: pts[pts.length - 1].category,
        bucket: pts[pts.length - 1].bucket,
        strength,
        latestEvidence: pts[pts.length - 1].evidence,
        emerged,
        movement,
        delta: d,
      }
    })
    .filter((t) => t.strength.length >= 2)
    // Freshest signal first (emerging), then movers by size, then steady themes.
    .sort((a, b) => {
      const rank = (t: Trajectory) => (t.movement === 'emerging' ? 0 : t.movement === 'steady' ? 2 : 1)
      return rank(a) - rank(b) || Math.abs(b.delta) - Math.abs(a.delta) || b.strength[b.strength.length - 1] - a.strength[a.strength.length - 1]
    })

  // Nice y-bands: rates zoom to a padded window, counts sit on a zero baseline.
  const shareVals = [...clientSeries, ...compSeries]
  const shareMin = Math.max(0, Math.floor(Math.min(...shareVals) - 1))
  const shareMax = Math.ceil(Math.max(...shareVals) + 1)
  const sentMin = hasSentimentSeries ? Math.max(0, Math.floor(Math.min(...sentSeries) - 1)) : 0
  const sentMax = hasSentimentSeries ? Math.min(100, Math.ceil(Math.max(...sentSeries) + 1)) : 100
  const volMax = Math.ceil(Math.max(...volSeries) / 1000) * 1000

  const shareCaption =
    shareDelta < 0 && compDelta > 0 && leadCompetitor
      ? `${leadCompetitor} widened its lead in the tracked conversation while ${brandShort}'s share eased — ${brandShort} to ${fmtPct(clientSeries[clientSeries.length - 1])}, ${leadCompetitor} to ${fmtPct(compSeries[compSeries.length - 1])}.`
      : `Share of the tracked conversation for ${brandShort} and ${leadCompetitor ?? 'competitors'} across your recent updates.`

  // ---- on your accounts: follower series + measured events (Owned-Data-Plan) ----
  // Numbers come from account_snapshots; events from Step 2c (code measures,
  // one AI pass explains — or honestly doesn't). The section self-gates on
  // owned data existing, so tenants without connected accounts never see it.
  const snapshots = (snapData as SnapshotRow[]).filter((s) => s.followers != null)
  const accountEvents = (eventData ?? []) as AccountEventRow[]
  const snapsByPlatform = new Map<string, SnapshotRow[]>()
  for (const s of snapshots) {
    const arr = snapsByPlatform.get(s.platform) ?? []
    arr.push(s)
    snapsByPlatform.set(s.platform, arr)
  }
  const ownedCharts = [...snapsByPlatform.entries()]
    .filter(([, rows]) => rows.length >= 2)
    .map(([platform, rows]) => {
      const values = rows.map((r) => Number(r.followers))
      return {
        platform,
        dates: rows.map((r) => r.snapshot_date),
        values,
        delta: values[values.length - 1] - values[0],
        markers: accountEvents
          .filter((e) => e.platform === platform && e.metric === 'followers')
          .map((e) => ({ i: rows.findIndex((r) => r.snapshot_date === e.event_date), label: e.magnitude_label }))
          .filter((m) => m.i >= 0),
      }
    })
    .sort((a, b) => b.values[b.values.length - 1] - a.values[a.values.length - 1])
  const eventCards = [...accountEvents].sort(
    (a, b) => b.event_date.localeCompare(a.event_date) || b.severity - a.severity,
  )

  const sentAvg = hasSentimentSeries
    ? Math.round(sentSeries.reduce((a, b) => a + b, 0) / sentSeries.length)
    : 0

  return (
    <div className="space-y-8">
      <HeroBand line={heroLine} />

      {/* Movement at a glance */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTrend
          label={`${brandShort} share`} dot="bg-chart-2" value={fmtPct(clientSeries[clientSeries.length - 1])}
          series={clientSeries} stroke="var(--chart-2)" delta={shareDelta} good="up" unit="pt"
        />
        <StatTrend
          label={`${leadCompetitor ?? 'Competitor'} share`} dot="bg-clay" value={fmtPct(compSeries[compSeries.length - 1])}
          series={compSeries} stroke="var(--accent-clay)" delta={compDelta} good="down" unit="pt"
        />
        {hasSentimentSeries && (
          <StatTrend
            label="Positive sentiment" dot="bg-positive" value={fmtPct(sentSeries[sentSeries.length - 1])}
            series={sentSeries} stroke="var(--positive)" delta={sentDelta} good="up" unit="pt"
          />
        )}
        <StatTrend
          label="Conversation volume" dot="bg-pine" value={fmtInt(volSeries[volSeries.length - 1])}
          series={volSeries} stroke="var(--accent-pine)" delta={volDelta} good="neutral" unit="count"
        />
      </div>

      {/* Flagship: share of conversation over time */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
            <span className="size-2 rounded-full bg-chart-2" aria-hidden />
            Share of conversation over time
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <TrendChart
            dates={dates} yMin={shareMin} yMax={shareMax} format={fmtPct}
            series={[
              { label: brandShort, color: 'var(--chart-2)', values: clientSeries },
              ...(leadCompetitor ? [{ label: leadCompetitor, color: 'var(--accent-clay)', values: compSeries }] : []),
            ]}
          />
          <LineLegend items={[
            { label: brandShort, color: 'bg-chart-2' },
            ...(leadCompetitor ? [{ label: leadCompetitor, color: 'bg-clay' }] : []),
          ]} />
          <p className="text-xs text-muted-foreground">{shareCaption}</p>
        </CardContent>
      </Card>

      {/* Sentiment + volume */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <span className="size-2 rounded-full bg-positive" aria-hidden />
              Positive sentiment over time
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {hasSentimentSeries ? (
              <>
                <TrendChart
                  dates={dates} yMin={sentMin} yMax={sentMax} format={fmtPct}
                  series={[{ label: 'Positive', color: 'var(--positive)', values: sentSeries }]}
                />
                <p className="text-xs text-muted-foreground">
                  Positive sentiment {sentDelta < -0.05 ? `eased ${round1(Math.abs(sentDelta))} points` : sentDelta > 0.05 ? `rose ${round1(sentDelta)} points` : 'held steady'}, staying near {fmtPct(sentAvg)}.
                </p>
              </>
            ) : (
              <p className="text-xs text-muted-foreground">
                We changed how audience sentiment is measured, so this chart starts again from your
                next update. Earlier points were measured a different way and are not comparable.
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <span className="size-2 rounded-full bg-pine" aria-hidden />
              Conversation volume over time
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <TrendChart
              dates={dates} yMin={0} yMax={volMax} format={fmtInt} area
              series={[{ label: 'Conversations', color: 'var(--accent-pine)', values: volSeries }]}
            />
            <p className="text-xs text-muted-foreground">
              Conversation volume {volDelta > 0 ? 'grew' : 'moved'} from {fmtInt(volSeries[0])} to {fmtInt(volSeries[volSeries.length - 1])} as coverage widened.
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Themes gaining and fading */}
      {trajectories.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Themes gaining and fading
          </h2>
          <Card>
            <CardContent className="divide-y divide-border/60 p-0">
              {trajectories.map((t) => (
                <div key={t.label} className="flex items-center gap-4 px-5 py-4">
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium capitalize ${categoryTint(t.category)}`}>
                        {t.category.replace(/_/g, ' ')}
                      </span>
                      <MovementBadge movement={t.movement} />
                    </div>
                    <p className="truncate text-sm font-medium">{t.label}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {bucketLabel(t.bucket, brandShort)} · in {evidenceOf(t.latestEvidence, latestTracked)} now
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <Sparkline values={t.strength} color={movementStroke(t.movement)} />
                    {/* The raw strength score is an internal ranking number,
                        not something a reader can act on (calibration rule: no
                        raw scores on client surfaces). */}
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
          <p className="text-[11px] text-muted-foreground">
            The line is how widely a theme was heard in each update, tracked across the updates it appeared in.
          </p>
        </section>
      )}

      {/* In the news — published context, never a claimed cause */}
      {(newsData ?? []).length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            In the news
          </h2>
          <Card>
            <CardHeader className="pb-2">
              <p className="text-xs text-muted-foreground">
                Coverage of your brand, competitors and category published recently — shown as
                context alongside the conversation, not as a cause of anything you see above.
              </p>
            </CardHeader>
            <CardContent className="divide-y">
              {(newsData as { title: string; url: string; source_ref: string; published_at: string | null; ring: number }[]).map((n) => (
                <div key={n.url} className="flex items-start justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
                  <div className="min-w-0">
                    <a href={n.url} target="_blank" rel="noopener noreferrer" className="text-sm font-medium hover:underline">
                      {n.title}
                    </a>
                    <div className="mt-0.5 text-xs text-muted-foreground">
                      {n.source_ref}
                      {n.published_at ? ` · ${n.published_at.slice(0, 10)}` : ''}
                    </div>
                  </div>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${
                    n.ring === 0 ? 'bg-positive/12 text-positive'
                    : n.ring === 1 ? 'bg-clay/10 text-clay'
                    : 'bg-muted text-muted-foreground'
                  }`}>
                    {n.ring === 0 ? 'Your brand' : n.ring === 1 ? 'Competitors' : 'Category'}
                  </span>
                </div>
              ))}
            </CardContent>
          </Card>
        </section>
      )}

      {/* On your accounts — owned metric series with measured, explained events */}
      {ownedCharts.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            On your accounts
          </h2>
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            {ownedCharts.map((c) => {
              const fMin = Math.floor(Math.min(...c.values) * 0.995 / 100) * 100
              const fMax = Math.ceil(Math.max(...c.values) * 1.005 / 100) * 100
              return (
                <Card key={c.platform}>
                  <CardHeader className="pb-2">
                    <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                      <span className="size-2 rounded-full bg-chart-2" aria-hidden />
                      {platformName(c.platform)} followers
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <TrendChart
                      dates={c.dates} yMin={fMin} yMax={fMax} format={fmtInt}
                      series={[{ label: `${platformName(c.platform)} followers`, color: 'var(--chart-2)', values: c.values }]}
                      markers={c.markers}
                    />
                    <p className="text-xs text-muted-foreground">
                      {fmtInt(c.values[c.values.length - 1])} now · {c.delta >= 0 ? '+' : '−'}{fmtInt(Math.abs(c.delta))} since {shortDate(c.dates[0])}
                      {c.markers.length > 0 ? ' · the ringed point marks a measured event, explained below' : ''}
                    </p>
                  </CardContent>
                </Card>
              )
            })}
          </div>

          {eventCards.length > 0 && (
            <div className="space-y-3">
              {eventCards.map((e, i) => (
                <Card key={i}>
                  <CardContent className="space-y-3 py-5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium">{platformName(e.platform)}</span>
                      <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${e.explained ? 'bg-primary/12 text-primary' : 'bg-muted text-muted-foreground'}`}>
                        {e.explained ? 'Explained' : 'Unexplained'}
                      </span>
                      <span className="text-[11px] text-muted-foreground">{shortDate(e.event_date)}</span>
                    </div>
                    {e.hero_quote && <Quotes items={[e.hero_quote]} />}
                    <p className="text-sm font-semibold">{e.magnitude_label}</p>
                    {e.explained && e.explanation ? (
                      <p className="text-sm text-muted-foreground">{e.explanation}</p>
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        The conversation we track doesn&rsquo;t account for this move, so we&rsquo;re not guessing at a cause — it stays flagged as unexplained.
                      </p>
                    )}
                    {(e.supporting_theme_labels?.length ?? 0) > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {e.supporting_theme_labels!.map((label) => (
                          <span key={label} className="rounded-full bg-primary/8 px-2 py-0.5 text-[11px] text-primary">{label}</span>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          <p className="text-[11px] text-muted-foreground">
            Follower counts are measured on your own accounts. A movement is only flagged when it is well outside the account&rsquo;s typical week — and it is only given a cause when your audience&rsquo;s own words support one.
          </p>
        </section>
      )}
    </div>
  )
}

const PLATFORM_LABELS: Record<string, string> = { tiktok: 'TikTok', youtube: 'YouTube', instagram: 'Instagram', reddit: 'Reddit' }
function platformName(p: string): string {
  return PLATFORM_LABELS[p] ?? p.charAt(0).toUpperCase() + p.slice(1)
}

/** Who a theme is about, in plain terms. */
function bucketLabel(bucket: string, brandShort: string): string {
  if (bucket === 'client') return `about ${brandShort}`
  if (bucket.startsWith('competitor:')) return `about ${bucket.slice('competitor:'.length)}`
  return 'across the category'
}

const MOVEMENT_LABEL: Record<Trajectory['movement'], string> = {
  emerging: 'Emerging', gaining: 'Gaining', fading: 'Fading', steady: 'Steady',
}
const MOVEMENT_BADGE: Record<Trajectory['movement'], string> = {
  emerging: 'bg-warning/15 text-warning',
  gaining: 'bg-primary/12 text-primary',
  fading: 'bg-negative/12 text-negative',
  steady: 'bg-muted text-muted-foreground',
}
function movementStroke(m: Trajectory['movement']): string {
  return m === 'fading' ? 'var(--negative)' : m === 'steady' ? 'var(--muted-foreground)' : 'var(--chart-2)'
}
function MovementBadge({ movement }: { movement: Trajectory['movement'] }) {
  return <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${MOVEMENT_BADGE[movement]}`}>{MOVEMENT_LABEL[movement]}</span>
}

/** The deep-green hero — matches the dashboard's single stat-hero element. */
function HeroBand({ line }: { line: string | null }) {
  return (
    <div className="stat-hero rounded-2xl px-6 py-8 sm:px-10 sm:py-12">
      <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">How the conversation is shifting</h1>
      {line && <p className="mt-3 text-sm text-[#CFE3D6]">{line}</p>}
    </div>
  )
}

/** A summary stat with its trajectory sparkline + a favourability-coloured delta. */
function StatTrend({
  label, dot, value, series, stroke, delta, good, unit,
}: {
  label: string; dot: string; value: string; series: number[]; stroke: string
  delta: number; good: 'up' | 'down' | 'neutral'; unit: 'pt' | 'count'
}) {
  const flat = Math.abs(delta) < (unit === 'pt' ? 0.05 : 0.5)
  const up = delta > 0
  const favourable = good === 'neutral' || flat ? null : good === 'up' ? up : !up
  const cls = favourable === null ? 'text-muted-foreground' : favourable ? 'text-positive' : 'text-negative'
  const arrow = flat ? '→' : up ? '▲' : '▼'
  const mag = unit === 'pt' ? `${round1(Math.abs(delta))} pts` : fmtInt(Math.abs(delta))
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
          <span className={`size-2 rounded-full ${dot}`} aria-hidden />
          {label}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="flex items-end justify-between gap-2">
          <div className="text-2xl font-bold">{value}</div>
          <Sparkline values={series} color={stroke} />
        </div>
        <div className="flex items-center gap-1.5">
          <span className={`text-xs font-medium ${cls}`}>{arrow} {mag}</span>
          <span className="text-[11px] text-muted-foreground">since first update</span>
        </div>
      </CardContent>
    </Card>
  )
}

interface ChartSeries { label: string; color: string; values: number[] }

/** Multi-line trend chart with a labelled y-band and dated x-axis. Optional
 *  markers ring a point on the FIRST series — a measured event at that date. */
function TrendChart({
  dates, series, yMin, yMax, format, area = false, markers = [],
}: {
  dates: string[]; series: ChartSeries[]; yMin: number; yMax: number
  format: (n: number) => string; area?: boolean
  markers?: { i: number; label: string }[]
}) {
  const W = 720, H = 240, padL = 52, padR = 16, padT = 16, padB = 28
  const plotW = W - padL - padR, plotH = H - padT - padB
  const n = dates.length
  const span = yMax - yMin || 1
  const x = (i: number) => padL + (n === 1 ? plotW / 2 : (i / (n - 1)) * plotW)
  const y = (v: number) => padT + (1 - (v - yMin) / span) * plotH
  const gridVals = [yMin, yMin + span / 2, yMax]

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="trend chart">
      {gridVals.map((gv) => (
        <g key={gv}>
          <line x1={padL} x2={W - padR} y1={y(gv)} y2={y(gv)} stroke="var(--border)" strokeWidth={1} />
          <text x={padL - 8} y={y(gv) + 4} textAnchor="end" fontSize={12} fill="var(--muted-foreground)">{format(gv)}</text>
        </g>
      ))}
      {dates.map((d, i) => (
        <text key={i} x={x(i)} y={H - 8} textAnchor="middle" fontSize={12} fill="var(--muted-foreground)">{shortDate(d)}</text>
      ))}
      {series.map((s) => {
        const line = s.values.map((v, i) => `${x(i)},${y(v)}`).join(' ')
        return (
          <g key={s.label}>
            {area && (
              <polygon
                points={`${padL},${y(yMin)} ${line} ${x(n - 1)},${y(yMin)}`}
                fill={s.color} fillOpacity={0.12}
              />
            )}
            <polyline points={line} fill="none" stroke={s.color} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
            {s.values.map((v, i) => (
              <circle key={i} cx={x(i)} cy={y(v)} r={3.5} fill="var(--background)" stroke={s.color} strokeWidth={2}>
                {/* single string child — React can't reconcile an SVG <title> with a multi-node array */}
                <title>{`${s.label} · ${shortDate(dates[i])}: ${format(v)}`}</title>
              </circle>
            ))}
          </g>
        )
      })}
      {markers.map((m, k) => (
        <circle key={`marker-${k}`} cx={x(m.i)} cy={y(series[0].values[m.i])} r={8} fill="none" stroke="var(--warning)" strokeWidth={2.5}>
          <title>{m.label}</title>
        </circle>
      ))}
    </svg>
  )
}

/** Compact sparkline — last point marked. Fills its box (stroke stays crisp). */
function Sparkline({ values, color }: { values: number[]; color: string }) {
  const W = 96, H = 32, p = 4
  const min = Math.min(...values), max = Math.max(...values)
  const x = (i: number) => p + (values.length === 1 ? 0 : (i / (values.length - 1)) * (W - 2 * p))
  const y = (v: number) => p + (1 - (v - min) / ((max - min) || 1)) * (H - 2 * p)
  const line = values.map((v, i) => `${x(i)},${y(v)}`).join(' ')
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-8 w-24" preserveAspectRatio="none" aria-hidden>
      <polyline points={line} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      <circle cx={x(values.length - 1)} cy={y(values[values.length - 1])} r={2.5} fill={color} />
    </svg>
  )
}

/** Dot legend for a line chart — identity is never colour-alone. */
function LineLegend({ items }: { items: { label: string; color: string }[] }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1">
      {items.map((s) => (
        <span key={s.label} className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <span className={`size-2 rounded-full ${s.color}`} aria-hidden />
          {s.label}
        </span>
      ))}
    </div>
  )
}
