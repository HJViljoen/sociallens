import { getSessionContext } from '@/lib/auth'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { categoryTint, levelBadge, accentSolid } from '@/lib/ui-colors'
import { HowToRead } from '@/components/how-to-read'
import type { GlossaryKey } from '@/lib/calibration'
import { Quotes } from '@/components/quotes'
import { rankByTheme, fetchQuotesByAudience, fetchInsightsByIds, createQuotePicker, bucketByAudienceId, scopeToCompetitor, type ThemeBucketRow } from '@/lib/quotes'

// Competitive Intelligence — renders Pass C's competitive_insights for the latest
// run: qualitative cross-bucket intelligence drawn from competitors' customers'
// voices (topic ownership, content gaps, threats, sentiment differentials), each
// grounded in supporting themes + verbatim quotes. Leads with the qualitative
// 4th-paradigm intelligence; Share of Tracked Conversation (per-bucket video
// share — scoped, NOT comprehensive web SOV) is the supporting context.
//
// Honest empty-state: Pass C SKIPS when the corpus has <2 entity buckets with
// analysable content (e.g. competitor accounts are comment-deserts). The SOV
// breakdown is always shown — it explains *why* a run is single-bucket.
// Read-only server component; same auth/data pattern as Market Intelligence.

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

interface AudienceInsight { id: string; category: string; theme: string; description: string }

/** The share fields of run_summary — the page's only number source. */
interface SummaryShareRow {
  total_videos: number | null
  share_of_voice: Record<string, { videos: number; pct_videos: number }> | null
}

// Category presentation. Order = the lead-with-strength reading order.
const CATEGORY_ORDER = ['topic_ownership', 'content_gap', 'competitive_threat', 'sentiment_differential'] as const
const CATEGORY_META: Record<string, { label: string; blurb: string }> = {
  topic_ownership: { label: 'Topic Ownership', blurb: 'Themes this brand owns vs competitors' },
  content_gap: { label: 'Content Gaps', blurb: 'What competitors’ audiences care about that this brand under-serves' },
  competitive_threat: { label: 'Competitive Threats', blurb: 'Where a competitor has an edge, momentum, or controversy' },
  sentiment_differential: { label: 'Sentiment Differentials', blurb: 'Where sentiment diverges between brands' },
}
const prettyType = (s: string) => s.replace(/_/g, ' ')

const chipBase = 'px-2 py-0.5 rounded-full text-xs font-medium capitalize'

const LEGEND_ITEMS: GlossaryKey[] = ['conversations']

export default async function CompetitiveIntelligencePage({
  searchParams,
}: {
  searchParams?: Promise<{ detail?: string }>
}) {
  const showLegend = ((await searchParams) ?? {}).detail === 'legend'
  // Auth + tenant via the RLS-enforced session client. See lib/auth.ts.
  const { supabase, clientId } = await getSessionContext()

  // Latest COMPLETED run — an in-flight run has no competitive rows yet, so the
  // page keeps serving the previous run's findings until the new one closes.
  const { data: latestRun } = await supabase
    .from('pipeline_runs').select('id, started_at')
    .eq('client_id', clientId).in('status', ['completed', 'partial'])
    .order('started_at', { ascending: false }).limit(1).maybeSingle()
  if (!latestRun) return <Shell showLegend={showLegend}><EmptyRun /></Shell>
  const runId = latestRun.id as string

  // Insights + grounding themes for this run; Share of Tracked Conversation
  // comes from run_summary (the pipeline's corpus-computed snapshot — the
  // numbers rule: never recounted per page, and owned-account posts stay out).
  const [{ data: ciData }, { data: summaryData }, { data: bucketData }, { data: clientRow }] = await Promise.all([
    supabase.from('competitive_insights').select('*').eq('client_id', clientId).eq('run_id', runId),
    supabase.from('run_summary').select('total_videos, share_of_voice').eq('client_id', clientId).eq('run_id', runId).maybeSingle(),
    // Entity buckets per audience insight — a card about a competitor quotes
    // THAT competitor's audience, never the client's own customers.
    supabase.from('themes').select('bucket, supporting_insight_ids').eq('client_id', clientId).eq('run_id', runId),
    supabase.from('clients').select('company_name').eq('id', clientId).maybeSingle(),
  ])
  const brand = (clientRow?.company_name as string | undefined) ?? 'Your brand'

  const insights = (ciData ?? []) as CompetitiveInsight[]
  // Grounding slugs for the ids THIS run's insights/themes cite — read by id
  // from the base table (fetchInsightsByIds), not the current view: a newer
  // in-flight run may already have superseded some of those videos' rows
  // (incremental Pass A, 2026-08-17).
  const citedIds = new Set<string>()
  for (const ci of insights) for (const id of ci.evidence?.supporting_theme_ids ?? []) citedIds.add(id)
  for (const t of (bucketData ?? []) as ThemeBucketRow[]) for (const id of t.supporting_insight_ids ?? []) citedIds.add(id)
  const audienceInsights = await fetchInsightsByIds<AudienceInsight>(supabase, [...citedIds], 'id, category, theme, description')
  const aiById = new Map(audienceInsights.map((a) => [a.id, a]))

  // Supporting themes (deduped) per competitive insight — grounding shown as chips.
  function supportFor(ci: CompetitiveInsight): string[] {
    const themes = new Set<string>()
    for (const id of ci.evidence?.supporting_theme_ids ?? []) {
      const ai = aiById.get(id)
      if (ai) themes.add(ai.theme)
    }
    return [...themes].slice(0, 4)
  }

  // Share of Tracked Conversation — per-bucket video share from run_summary.
  const sov = shareFromSummary((summaryData ?? null) as SummaryShareRow | null)

  // ---- verbatim quotes for the evidence-led cards (shared lib/quotes) ----
  // Each card's pool is scoped to the competitor it names (falling back to
  // non-client buckets for cross-bucket findings) — presenting one brand's
  // audience as another's is the run-1 misattribution defect.
  const themeSlugById = new Map(audienceInsights.map((a) => [a.id, a.theme]))
  const bucketById = bucketByAudienceId((bucketData ?? []) as ThemeBucketRow[])
  const cardAudienceIds = (ci: CompetitiveInsight) =>
    scopeToCompetitor(ci.evidence?.supporting_theme_ids ?? [], bucketById, ci.competitor_name)
  const claimOf = (ci: CompetitiveInsight) => `${ci.title} ${ci.finding}`
  const poolIds = new Set<string>()
  for (const ci of insights) {
    for (const id of rankByTheme(cardAudienceIds(ci), claimOf(ci), themeSlugById).slice(0, 80)) {
      if (poolIds.size < 600) poolIds.add(id)
    }
  }
  const quotesByAudience = await fetchQuotesByAudience(supabase, [...poolIds])
  const pick = createQuotePicker(quotesByAudience, themeSlugById)
  const quotesFor = (ci: CompetitiveInsight) => pick(cardAudienceIds(ci), 2, claimOf(ci), ci.hero_quote)

  const byCategory = CATEGORY_ORDER
    .map((cat) => ({ cat, items: insights.filter((c) => c.category === cat) }))
    .filter((g) => g.items.length > 0)
  // Any insights with an unrecognised category still get shown under "Other".
  const otherItems = insights.filter((c) => !CATEGORY_ORDER.includes(c.category as typeof CATEGORY_ORDER[number]))

  return (
    <Shell showLegend={showLegend}>
      <ShareOfVoice sov={sov} brand={brand} />

      {insights.length === 0 ? (
        <EmptyInsights sov={sov} />
      ) : (
        <>
          {byCategory.map(({ cat, items }) => (
            <section key={cat} className="space-y-3">
              <div>
                <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">{CATEGORY_META[cat].label}</h2>
                <p className="text-xs text-muted-foreground">{CATEGORY_META[cat].blurb}</p>
              </div>
              {items.map((ci) => <InsightCard key={ci.id} ci={ci} support={supportFor(ci)} quotes={quotesFor(ci)} />)}
            </section>
          ))}
          {otherItems.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Other</h2>
              {otherItems.map((ci) => <InsightCard key={ci.id} ci={ci} support={supportFor(ci)} quotes={quotesFor(ci)} />)}
            </section>
          )}
        </>
      )}
    </Shell>
  )
}

function InsightCard({ ci, support, quotes }: { ci: CompetitiveInsight; support: string[]; quotes: string[] }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-4">
          <div className="flex flex-wrap items-center gap-2">
            {ci.competitor_name && <span className={`${chipBase} ${categoryTint(ci.competitor_name)}`}>vs {ci.competitor_name}</span>}
            <span className={`${chipBase} ${categoryTint(ci.category)}`}>{prettyType(ci.category)}</span>
          </div>
          {ci.impact_level && (
            <span
              title="The analysis's judgment of likely effect on your position — a read on the finding, not a counted measure."
              className={`${chipBase} shrink-0 ${levelBadge(ci.impact_level)}`}
            >{ci.impact_level} impact</span>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <Quotes items={quotes} />
        <div className="space-y-1">
          <h3 className="text-base font-semibold">{ci.title}</h3>
          <p className="text-sm text-muted-foreground">{ci.finding}</p>
        </div>
        {support.length > 0 && (
          <div className="border-t pt-3 space-y-2">
            <div className="text-xs font-medium text-muted-foreground">Grounded in</div>
            <div className="flex flex-wrap gap-1.5">
              {support.map((theme, i) => (
                <span key={i} className={`px-2 py-0.5 rounded-full text-xs capitalize ${categoryTint(theme)}`}>{theme.replace(/_/g, ' ')}</span>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// --- Share of Tracked Conversation -----------------------------------------

interface Share {
  total: number
  client: number
  industry: number
  competitors: { name: string; count: number }[]
  competitorCount: number
}

function shareFromSummary(summary: SummaryShareRow | null): Share {
  const sov = summary?.share_of_voice ?? {}
  const client = sov.client?.videos ?? 0
  const industry = sov['industry-other']?.videos ?? 0
  const competitors = Object.entries(sov)
    .filter(([key]) => key.startsWith('competitor:'))
    .map(([key, e]) => ({ name: key.slice('competitor:'.length), count: e.videos }))
    .sort((a, b) => b.count - a.count)
  return {
    total: Number(summary?.total_videos ?? 0),
    client,
    industry,
    competitors,
    competitorCount: competitors.length,
  }
}

function ShareOfVoice({ sov, brand }: { sov: Share; brand: string }) {
  const pct = (n: number) => (sov.total ? Math.round((n / sov.total) * 1000) / 10 : 0)
  const segments = [
    { label: brand, count: sov.client, color: 'bg-primary' },
    ...sov.competitors.map((c, i) => ({ label: c.name, count: c.count, color: accentSolid(i) })),
    { label: 'Rest of category', count: sov.industry, color: 'bg-muted-foreground/40' },
  ].filter((s) => s.count > 0)

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Share of Tracked Conversation</CardTitle>
        <p className="text-xs text-muted-foreground">
          Share of {sov.total.toLocaleString()} tracked conversations by brand. Scoped to your tracked keywords — not comprehensive web share of voice.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex h-3 w-full overflow-hidden rounded-full bg-muted">
          {segments.map((s, i) => (
            <div key={i} className={s.color} style={{ width: `${pct(s.count)}%` }} title={`${s.label}: ${pct(s.count)}%`} />
          ))}
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1.5">
          {segments.map((s, i) => (
            <div key={i} className="flex items-center gap-1.5 text-xs">
              <span className={`inline-block h-2.5 w-2.5 rounded-sm ${s.color}`} />
              <span className="font-medium">{s.label}</span>
              <span className="text-muted-foreground">{pct(s.count)}% ({s.count})</span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

// --- Shell + empty states ---------------------------------------------------

function Shell({ children, showLegend }: { children: React.ReactNode; showLegend: boolean }) {
  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <h1 className="text-2xl font-bold">Competitive Intelligence</h1>
        <HowToRead items={LEGEND_ITEMS} open={showLegend} basePath="/dashboard/competitive" />
      </div>
      {children}
    </div>
  )
}

function EmptyRun() {
  return (
    <Card>
      <CardContent className="py-10 text-center text-sm text-muted-foreground">
        Your competitive intelligence lands with your first update.
      </CardContent>
    </Card>
  )
}

function EmptyInsights({ sov }: { sov: Share }) {
  const reason = sov.competitorCount === 0
    ? 'No competitor-tagged content cleared analysis this update — competitor accounts typically attract few comments, so the consumer voice about them lives in creator and category content that isn’t yet attributed to a competitor.'
    : 'Competitor content was tracked, but not enough of it drew comments to form a comparable theme — so there was only one brand group to read, and cross-brand analysis was skipped this update.'
  return (
    <Card>
      <CardContent className="py-8 space-y-2 text-sm text-muted-foreground">
        <p className="font-medium text-foreground">No cross-brand insights this update.</p>
        <p>
          Competitive intelligence compares your brand against tracked competitors using their customers’ comments.
          It needs at least two brands’ audiences with enough comment-bearing content.
        </p>
        <p>{reason}</p>
        <p className="text-xs">The Share of Tracked Conversation above shows the current bucket balance.</p>
      </CardContent>
    </Card>
  )
}
