import Link from 'next/link'
import { Target, TrendingUp, Sparkles, Lightbulb, AlertTriangle } from 'lucide-react'
import { getSessionContext } from '@/lib/auth'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { categoryTint } from '@/lib/ui-colors'
import { CURATION_GATE, gateTier, type GateTier } from '@/lib/curation'
import { priorityWord, glossaryRule } from '@/lib/calibration'
import { HowToRead } from '@/components/how-to-read'
import { Quotes } from '@/components/quotes'
import type { GlossaryKey } from '@/lib/calibration'
import { rankByTheme, fetchQuotesByAudience, createQuotePicker, bucketByAudienceId, scopeToClientVoices, type ThemeBucketRow } from '@/lib/quotes'
import type { CiSummary, SayVsHearEntry } from '@/lib/pipeline/schemas'

// Market Intelligence — "What should we do?" (Redesign Spec §3). The editorial
// layer over Pass D: the consumer-intelligence summary leads (the "someone
// already read everything for you" block), gate-passed recommendations are
// promoted above insights, then max-3 key insights, early signals honestly
// framed, and the full un-curated list demoted to a collapsed archive. Scores
// gate and order but are never displayed as numbers (spec §1) — evidence chips
// replace them. Read-only server component; same auth/run-anchor pattern as
// the dashboard.

interface MarketInsight {
  id: string
  insight_type: string
  title: string
  description: string
  evidence: { supporting_theme_ids?: string[]; supporting_competitive_insight_ids?: string[] } | null
  confidence_score: number | null
  opportunity_score: number | null
  hero_quote: string | null
}

interface Recommendation {
  id: string
  type: string
  title: string
  reasoning: string
  priority: string | null
  based_on: { insight_ids?: string[] } | null
  hero_quote: string | null
}

interface CompetitiveRef {
  id: string
  evidence: { supporting_theme_ids?: string[] } | null
  impact_level: string | null
}

interface SingleSourceTheme {
  label: string
  description: string | null
}

/** Single-source theme pills shown before the "+N more" overflow line. */
const SINGLE_SOURCE_SHOWN = 12

const prettyType = (s: string) => s.replace(/_/g, ' ')

const chipBase = 'px-2 py-0.5 rounded-full text-xs font-medium'

/** A stable coloured category chip (insight type, rec type). */
function CategoryChip({ children }: { children: string }) {
  return <span className={`${chipBase} capitalize ${categoryTint(children)}`}>{prettyType(children)}</span>
}

/** Calibrated priority word — positional, never the model's own rating
 *  (lib/calibration.ts): "Act now" appears exactly once per update. */
const PRIORITY_TIP: Record<string, string> = {
  'Act now': glossaryRule('act_now'),
  'Plan next': glossaryRule('plan_next'),
  'Worth considering': glossaryRule('worth_considering'),
}

function PriorityChip({ word }: { word: string }) {
  return (
    <span title={PRIORITY_TIP[word]} className={`${chipBase} ${word === 'Act now' ? 'bg-warning/15 text-warning' : 'bg-muted text-muted-foreground'}`}>
      {word}
    </span>
  )
}

/** The score replacement (spec §1): judgment as a chip, never a number. */
function EvidenceChip({ tier }: { tier: GateTier }) {
  if (tier === 'confirmed') return <span title={glossaryRule('strong_evidence')} className={`${chipBase} bg-positive/12 text-positive`}>Strong evidence</span>
  if (tier === 'early_signal') return <span title={glossaryRule('early_signal')} className={`${chipBase} bg-warning/15 text-warning`}>Early signal</span>
  return null
}

const LEGEND_ITEMS: GlossaryKey[] = ['conversations', 'say_vs_hear', 'act_now', 'plan_next', 'worth_considering', 'strong_evidence', 'early_signal']

export default async function MarketIntelligencePage({
  searchParams,
}: {
  searchParams?: Promise<{ detail?: string }>
}) {
  const showLegend = ((await searchParams) ?? {}).detail === 'legend'
  // Auth + tenant via the RLS-enforced session client. See lib/auth.ts.
  const { supabase, clientId } = await getSessionContext()

  // Latest COMPLETED run — an in-flight run has no synthesis rows yet, so the
  // page keeps serving the previous run's read until the new one closes.
  const { data: latestRun } = await supabase
    .from('pipeline_runs').select('id')
    .eq('client_id', clientId).in('status', ['completed', 'partial'])
    .order('started_at', { ascending: false }).limit(1).maybeSingle()

  if (!latestRun) {
    return (
      <div className="space-y-8">
        <PageHeader showLegend={showLegend} />
        <EmptyState />
      </div>
    )
  }
  const runId = latestRun.id as string

  const [miRes, recRes, aiRes, ciRes, summaryRes, ssRes, bucketRes] = await Promise.all([
    supabase.from('market_insights')
      .select('id, insight_type, title, description, evidence, confidence_score, opportunity_score, hero_quote')
      .eq('client_id', clientId).eq('run_id', runId)
      .order('opportunity_score', { ascending: false }),
    supabase.from('recommendations')
      .select('id, type, title, reasoning, priority, based_on, hero_quote')
      .eq('client_id', clientId).eq('run_id', runId),
    supabase.from('audience_insights').select('id, theme, source_video_id')
      .eq('client_id', clientId).eq('run_id', runId),
    supabase.from('competitive_insights').select('id, evidence, impact_level')
      .eq('client_id', clientId).eq('run_id', runId),
    supabase.from('run_summary').select('consumer_intelligence_summary, say_vs_hear')
      .eq('client_id', clientId).eq('run_id', runId).maybeSingle(),
    // Single-source pills must clear the same strength bar as early-signal
    // insights — "Early signal" is a calibrated term, not a catch-all for
    // everything heard once (127 of 140 themes were single-source).
    supabase.from('themes')
      .select('label, description', { count: 'exact' })
      .eq('client_id', clientId).eq('run_id', runId).eq('single_source', true)
      .gte('strength_score', CURATION_GATE.earlySignalMinScore)
      .order('strength_score', { ascending: false }).limit(SINGLE_SOURCE_SHOWN),
    // Entity buckets per audience insight — quote pools on this page are
    // client-facing claims, so competitor-audience voices are scoped out.
    supabase.from('themes')
      .select('bucket, supporting_insight_ids')
      .eq('client_id', clientId).eq('run_id', runId),
  ])

  const insights = (miRes.data ?? []) as MarketInsight[]
  const recommendations = (recRes.data ?? []) as Recommendation[]
  const competitive = (ciRes.data ?? []) as CompetitiveRef[]
  const ciSummary = (summaryRes.data?.consumer_intelligence_summary ?? null) as CiSummary | null
  const sayVsHear = (summaryRes.data?.say_vs_hear ?? null) as SayVsHearEntry[] | null
  const singleSourceThemes = (ssRes.data ?? []) as SingleSourceTheme[]
  const singleSourceTotal = ssRes.count ?? singleSourceThemes.length

  const miById = new Map(insights.map((mi) => [mi.id, mi]))
  const competitiveById = new Map(competitive.map((c) => [c.id, c]))
  const audienceRows = (aiRes.data ?? []) as { id: string; theme: string; source_video_id: string | null }[]
  const themeSlugById = new Map(audienceRows.map((a) => [a.id, a.theme]))
  const videoByInsight = new Map(audienceRows.map((a) => [a.id, a.source_video_id]))

  /** Measured grounding: distinct conversations behind an insight's evidence. */
  const conversationCount = (mi: MarketInsight): number => {
    const vids = new Set<string>()
    for (const id of mi.evidence?.supporting_theme_ids ?? []) {
      const v = videoByInsight.get(id)
      if (v) vids.add(v)
    }
    return vids.size
  }

  // ---- Curation gate over the insights (already in opportunity order) ----
  const sourceCount = (mi: MarketInsight) =>
    (mi.evidence?.supporting_theme_ids?.length ?? 0) +
    (mi.evidence?.supporting_competitive_insight_ids?.length ?? 0)
  const tierOf = new Map(insights.map((mi) => [mi.id, gateTier(mi.confidence_score, sourceCount(mi))]))
  const confirmed = insights.filter((mi) => tierOf.get(mi.id) === 'confirmed')
  const keyInsights = confirmed.slice(0, 3)
  const earlyInsights = insights.filter((mi) => tierOf.get(mi.id) === 'early_signal')

  /** Deduped grounding theme slugs for an insight — chips + the Voice deep-link. */
  function insightThemes(mi: MarketInsight): string[] {
    const slugs = new Set<string>()
    for (const id of mi.evidence?.supporting_theme_ids ?? []) {
      const slug = themeSlugById.get(id)
      if (slug) slugs.add(slug)
    }
    return [...slugs].slice(0, 4)
  }

  // ---- Recommendations: gate-passed ones promoted (spec §3.2) ----
  // A recommendation passes when at least one insight behind it does: a
  // confirmed market insight, or — competitive insights carry no confidence
  // score — a high-impact competitive insight clearing the same source floor.
  const confirmedGroundIds = new Set<string>([
    ...confirmed.map((mi) => mi.id),
    ...competitive
      .filter((c) =>
        c.impact_level === 'high' &&
        (c.evidence?.supporting_theme_ids?.length ?? 0) >= CURATION_GATE.confirmedMinSources)
      .map((c) => c.id),
  ])
  const priorityRank: Record<string, number> = { high: 0, medium: 1, low: 2 }
  const recsSorted = [...recommendations].sort(
    (a, b) =>
      (priorityRank[a.priority ?? 'low'] ?? 3) - (priorityRank[b.priority ?? 'low'] ?? 3) ||
      (b.based_on?.insight_ids?.length ?? 0) - (a.based_on?.insight_ids?.length ?? 0),
  )
  const topRecs = recsSorted
    .filter((r) => (r.based_on?.insight_ids ?? []).some((id) => confirmedGroundIds.has(id)))
    .slice(0, 3)
  const topRecIds = new Set(topRecs.map((r) => r.id))
  const restRecs = recsSorted.filter((r) => !topRecIds.has(r.id))

  /** Grounding theme slugs behind a recommendation, via its supporting insights. */
  function recThemes(rec: Recommendation): string[] {
    const slugs = new Set<string>()
    for (const id of rec.based_on?.insight_ids ?? []) {
      for (const tid of miById.get(id)?.evidence?.supporting_theme_ids ?? []) {
        const slug = themeSlugById.get(tid)
        if (slug) slugs.add(slug)
      }
      for (const tid of competitiveById.get(id)?.evidence?.supporting_theme_ids ?? []) {
        const slug = themeSlugById.get(tid)
        if (slug) slugs.add(slug)
      }
    }
    return [...slugs].slice(0, 4)
  }

  // ---- verbatim quotes for the evidence-led cards (shared lib/quotes) ----
  // Pull the audience insights most on-topic for each card into the quote pool
  // (theme-ranked so the specific voices beat the generic, high-volume ones),
  // fetch once, and build a page-scoped picker. Cards lead with the pipeline's
  // hero_quote where present and fall back to the heuristic otherwise. Every
  // card here is a claim about the client, so pools keep client + category
  // voices only — a competitor's customers never speak under a client claim.
  const bucketById = bucketByAudienceId((bucketRes.data ?? []) as ThemeBucketRow[])
  function recSupportAudienceIds(rec: Recommendation): string[] {
    const ids: string[] = []
    for (const id of rec.based_on?.insight_ids ?? []) {
      ids.push(...(miById.get(id)?.evidence?.supporting_theme_ids ?? []))
      ids.push(...(competitiveById.get(id)?.evidence?.supporting_theme_ids ?? []))
    }
    return scopeToClientVoices(ids, bucketById)
  }
  const insightAudienceIds = (mi: MarketInsight): string[] =>
    scopeToClientVoices(mi.evidence?.supporting_theme_ids ?? [], bucketById)
  const cardSpecs: { ids: string[]; claim: string }[] = [
    ...[...keyInsights, ...earlyInsights].map((mi) => ({ ids: insightAudienceIds(mi), claim: `${mi.title} ${mi.description}` })),
    ...topRecs.map((rec) => ({ ids: recSupportAudienceIds(rec), claim: `${rec.title} ${rec.reasoning}` })),
  ]
  const poolIds = new Set<string>()
  for (const spec of cardSpecs) {
    for (const id of rankByTheme(spec.ids, spec.claim, themeSlugById).slice(0, 80)) {
      if (poolIds.size < 600) poolIds.add(id)
    }
  }
  const quotesByAudience = await fetchQuotesByAudience(supabase, [...poolIds])
  const pick = createQuotePicker(quotesByAudience, themeSlugById)

  const nothingYet = !ciSummary && insights.length === 0 && recommendations.length === 0

  return (
    <div className="space-y-8">
      <PageHeader showLegend={showLegend} />

      {nothingYet && <EmptyState />}

      {/* The short read — a tight at-a-glance digest (spec §3.1) */}
      {ciSummary && <ShortRead s={ciSummary} />}

      {/* Say vs hear (Step 2b) — the brand's own video claims set against the
          tracked conversation. Self-gates: null/empty renders nothing. */}
      {sayVsHear && sayVsHear.length > 0 && <SayVsHearSection entries={sayVsHear} themeSlugById={themeSlugById} />}

      {/* Top recommendations (spec §3.2) — the outcome, promoted above insights */}
      {recommendations.length > 0 && (
        <section className="space-y-4">
          <SectionHeading label="Top recommendations" />
          {topRecs.length > 0 ? (
            // #1 is featured full-width (voices in its own satellite); #2/#3 are
            // quiet equal-height cards beneath. Grid stretch equalises the pair —
            // no cross-row spans (the dashboard's failure mode).
            <div className="space-y-4">
              <FeaturedRec
                rec={topRecs[0]}
                word={priorityWord(0)}
                voices={recThemes(topRecs[0])}
                quotes={pick(recSupportAudienceIds(topRecs[0]), 2, `${topRecs[0].title} ${topRecs[0].reasoning}`, topRecs[0].hero_quote)}
              />
              {topRecs.length > 1 && (
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  {topRecs.slice(1).map((rec, i) => (
                    <RecCard key={rec.id} rec={rec} word={priorityWord(i + 1)} voices={recThemes(rec)} gatePassed clamp className="h-full" />
                  ))}
                </div>
              )}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Nothing has strong enough evidence to lead with yet — the full list is under &ldquo;All recommendations&rdquo;.
            </p>
          )}
          {restRecs.length > 0 && (
            <CollapsedSection label="All recommendations" count={restRecs.length}>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {restRecs.map((rec) => (
                  <RecCard key={rec.id} rec={rec} word="Worth considering" voices={recThemes(rec)} compact />
                ))}
              </div>
            </CollapsedSection>
          )}
        </section>
      )}

      {/* Key insights (spec §3.3) — max 3, gate-passed, by opportunity */}
      {keyInsights.length > 0 && (
        <section className="space-y-4">
          <SectionHeading label="Key insights" />
          {keyInsights.map((mi) => (
            <InsightCard key={mi.id} mi={mi} tier="confirmed" themes={insightThemes(mi)} conversations={conversationCount(mi)} quotes={pick(insightAudienceIds(mi), 2, `${mi.title} ${mi.description}`, mi.hero_quote)} />
          ))}
        </section>
      )}

      {/* Early signals (spec §3.4) — honestly framed, grouped in a shaded panel
          (the Meltwater "keyphrases" cluster: soft cards + a chip cloud on shade) */}
      {(earlyInsights.length > 0 || singleSourceThemes.length > 0) && (
        <section className="space-y-4 rounded-3xl bg-muted/40 p-4 sm:p-5">
          <SectionHeading label="Early signals" />
          {earlyInsights.map((mi) => (
            <InsightCard key={mi.id} mi={mi} tier="early_signal" themes={insightThemes(mi)} conversations={conversationCount(mi)} quotes={pick(insightAudienceIds(mi), 2, `${mi.title} ${mi.description}`, mi.hero_quote)} />
          ))}
          {singleSourceThemes.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">
                Each of these was heard in a single conversation so far:
              </p>
              <div className="flex flex-wrap items-center gap-1.5">
                {singleSourceThemes.map((t, i) => (
                  <span key={i} title={t.description ?? undefined} className="px-2 py-0.5 rounded-full text-xs bg-muted text-muted-foreground">
                    {t.label}
                  </span>
                ))}
                {singleSourceTotal > singleSourceThemes.length && (
                  <span className="text-xs text-muted-foreground">
                    +{singleSourceTotal - singleSourceThemes.length} more
                  </span>
                )}
              </div>
            </div>
          )}
        </section>
      )}

      {/* All findings (spec §3.5) — the un-curated list, demoted to an archive */}
      {insights.length > 0 && (
        <CollapsedSection label="All findings" count={insights.length}>
          <div className="space-y-4">
            {insights.map((mi) => (
              <InsightCard key={mi.id} mi={mi} tier={tierOf.get(mi.id) ?? 'archive'} themes={insightThemes(mi)} conversations={conversationCount(mi)} />
            ))}
          </div>
        </CollapsedSection>
      )}
    </div>
  )
}

/** Say vs hear (Step 2b) — two-panel contrast per claim: what the brand's own
 *  video says (verbatim, from its transcript) against what the tracked
 *  conversation says. Entries arrive pre-validated from the pipeline
 *  (run_summary.say_vs_hear); silence is a real verdict, rendered honestly —
 *  never fabricated audience voice. */
function SayVsHearSection({ entries, themeSlugById }: { entries: SayVsHearEntry[]; themeSlugById: Map<string, string> }) {
  const verdict = (a: SayVsHearEntry['audience']) =>
    a === 'echoes'
      ? { text: 'They echo it', cls: 'bg-positive/12 text-positive' }
      : a === 'contradicts'
        ? { text: 'They push back', cls: 'bg-warning/15 text-warning' }
        : { text: 'Not talked about yet', cls: 'bg-muted text-muted-foreground' }
  const themesOf = (e: SayVsHearEntry): string[] => {
    const slugs = new Set<string>()
    for (const id of e.supporting_theme_ids) {
      const s = themeSlugById.get(id)
      if (s) slugs.add(s)
    }
    return [...slugs].slice(0, 4)
  }
  return (
    <section className="space-y-4">
      <SectionHeading label="What you say vs what they hear" hint="Your own videos&rsquo; words, set against the tracked conversation" />
      <div className="space-y-4">
        {entries.map((e, i) => {
          const chip = verdict(e.audience)
          const themes = themesOf(e)
          return (
            <Card key={i}>
              <CardContent className="pt-6 space-y-4">
                <div className="grid gap-6 lg:grid-cols-2">
                  <div className="space-y-2">
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">You say</p>
                    <p className="text-sm font-medium">{e.you_say}</p>
                    <blockquote className="border-l-2 pl-3 text-sm italic text-muted-foreground">&ldquo;{e.your_quote}&rdquo;</blockquote>
                  </div>
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">What your audience says</p>
                      <span title={glossaryRule('say_vs_hear')} className={`${chipBase} ${chip.cls}`}>{chip.text}</span>
                    </div>
                    {e.they_say ? (
                      <p className="text-sm">{e.they_say}</p>
                    ) : (
                      <p className="text-sm text-muted-foreground">The tracked conversation doesn&rsquo;t engage with this claim yet.</p>
                    )}
                    {themes.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {themes.map((t) => (
                          <Link
                            key={t}
                            href={`/dashboard/voice?themes=${encodeURIComponent(t)}`}
                            className="px-2 py-0.5 rounded-full text-xs bg-muted text-muted-foreground hover:bg-muted/70"
                          >
                            {prettyType(t)}
                          </Link>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
                <p className="border-t pt-3 text-sm text-muted-foreground">{e.gap}</p>
              </CardContent>
            </Card>
          )
        })}
      </div>
    </section>
  )
}

function PageHeader({ showLegend }: { showLegend: boolean }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <h1 className="text-2xl font-bold">Market Intelligence</h1>
      <HowToRead items={LEGEND_ITEMS} open={showLegend} basePath="/dashboard/market" />
    </div>
  )
}

function SectionHeading({ label, hint }: { label: string; hint?: string }) {
  return (
    <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
      {label}
      {hint && <span className="ml-2 normal-case font-normal tracking-normal text-xs opacity-70">{hint}</span>}
    </h2>
  )
}

/** Native details/summary — collapsed archives without client JS. */
function CollapsedSection({ label, count, children }: { label: string; count: number; children: React.ReactNode }) {
  return (
    <details className="group">
      <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground [&::-webkit-details-marker]:hidden">
        <span className="text-[10px] transition-transform group-open:rotate-90" aria-hidden>▶</span>
        {label} <span className="opacity-60">· {count}</span>
      </summary>
      <div className="mt-4">{children}</div>
    </details>
  )
}

/** §3.1 — the "someone already read everything for you" headline block. */
function ShortRead({ s }: { s: CiSummary }) {
  // A tight "at a glance" digest — four equal icon-anchored cards, no dead space.
  // The woven read lives on the dashboard; this page shows the specifics behind
  // the recommendations, not a second narrative. ("Who stands out" not "Your
  // differentiators": the list includes competitor standouts.)
  const facets = [
    { label: 'Unmet needs', items: s.top_unmet_needs, Icon: Target, fg: 'text-clay', bg: 'bg-clay/10' },
    { label: 'Buying triggers', items: s.top_buying_triggers, Icon: TrendingUp, fg: 'text-pine', bg: 'bg-pine/10' },
    { label: 'Who stands out', items: s.top_differentiators, Icon: Sparkles, fg: 'text-plum', bg: 'bg-plum/10' },
    { label: 'Threats to watch', items: s.threats, Icon: AlertTriangle, fg: 'text-warning', bg: 'bg-warning/15' },
  ].filter((f) => (f.items?.length ?? 0) > 0)
  if (facets.length === 0) return null
  return (
    <section className="space-y-3">
      <h2 className="text-base font-semibold">The short read</h2>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {facets.map((f) => (
          <Card key={f.label} className={f.label === 'Threats to watch' ? 'rounded-lg ring-1 ring-warning/25' : 'rounded-lg'}>
            <CardContent className="space-y-3 py-5">
              {/* Colored icon badge + hued label so each facet reads distinctly */}
              <div className="flex items-center gap-2.5">
                <span className={`inline-flex size-7 shrink-0 items-center justify-center rounded-md ${f.bg}`}>
                  <f.Icon className={`size-4 ${f.fg}`} aria-hidden />
                </span>
                <span className={`text-xs font-semibold uppercase tracking-wide ${f.fg}`}>{f.label}</span>
              </div>
              <ul className="space-y-2">
                {f.items.slice(0, 3).map((item, i) => (
                  <li key={i} className="text-sm leading-snug text-foreground/85">{item}</li>
                ))}
              </ul>
            </CardContent>
          </Card>
        ))}
      </div>
    </section>
  )
}

/** Shared "see the voices" pill used by both rec card variants. */
function VoicesLink({ voices }: { voices: string[] }) {
  if (voices.length === 0) return null
  return (
    <Link
      href={`/dashboard/voice?themes=${encodeURIComponent(voices.join(','))}#grounding`}
      className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium text-primary ring-1 ring-primary/25 transition-colors hover:bg-primary/5"
    >
      See the voices behind this <span aria-hidden>→</span>
    </Link>
  )
}

/** The #1 action — a featured two-panel card: recommendation on the left, an
 *  "In their words" quote satellite on the right (Meltwater main-plus-satellite).
 *  The one place raw voices lead a rec, so the secondary cards stay quiet. */
function FeaturedRec({ rec, word, voices, quotes }: {
  rec: Recommendation
  word: string
  voices: string[]
  quotes: string[]
}) {
  return (
    <Card className="ring-1 ring-primary/15">
      <CardContent className="space-y-4 py-6 sm:px-8">
        <div className="flex flex-wrap items-center gap-2">
          <PriorityChip word={word} />
          <CategoryChip>{rec.type}</CategoryChip>
          <EvidenceChip tier="confirmed" />
        </div>
        <div className="grid gap-6 lg:grid-cols-[1.7fr_1fr]">
          <div className="space-y-2">
            <h3 className="text-lg font-semibold leading-snug">{rec.title}</h3>
            <p className="text-sm leading-relaxed text-muted-foreground">{rec.reasoning}</p>
            <div className="pt-1"><VoicesLink voices={voices} /></div>
          </div>
          {quotes.length > 0 && (
            <div className="space-y-2 rounded-xl bg-muted/50 p-4">
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">In their words</div>
              <Quotes items={quotes} />
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

function RecCard({ rec, word, voices, gatePassed, compact, quotes = [], className, clamp }: {
  rec: Recommendation
  /** Calibrated priority word — positional (Act now / Plan next / Worth considering). */
  word: string
  voices: string[]
  gatePassed?: boolean
  compact?: boolean
  /** Verbatim voices that lead the card (evidence-led); empty on compact/archive. */
  quotes?: string[]
  /** Grid placement / sizing from the caller. */
  className?: string
  /** Clamp the reasoning so a secondary card never becomes a wall of text. */
  clamp?: boolean
}) {
  return (
    <Card className={className}>
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-center gap-2">
          <PriorityChip word={word} />
          <CategoryChip>{rec.type}</CategoryChip>
          {gatePassed && <EvidenceChip tier="confirmed" />}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {!compact && quotes.length > 0 && <Quotes items={quotes} />}
        <div className="space-y-1">
          <h3 className={`font-semibold ${compact ? 'text-sm' : 'text-base'}`}>{rec.title}</h3>
          <p className={`text-muted-foreground ${compact ? 'text-xs' : 'text-sm'} ${clamp ? 'line-clamp-6' : ''}`}>{rec.reasoning}</p>
        </div>
        <VoicesLink voices={voices} />
      </CardContent>
    </Card>
  )
}

// Icon per insight type for the Meltwater-style eyebrow (safe lucide names).
const INSIGHT_ICON = {
  unmet_need: Target,
  sentiment_trajectory: TrendingUp,
  sentiment_differential: TrendingUp,
  industry_signal: Sparkles,
  platform_pattern: Sparkles,
  cross_platform_synthesis: Sparkles,
} as const

function InsightCard({ mi, tier, themes, conversations, quotes = [] }: {
  mi: MarketInsight
  tier: GateTier
  themes: string[]
  /** Measured: distinct conversations behind this insight's evidence. */
  conversations: number
  /** Verbatim voices that lead the card (evidence-led); empty in the archive. */
  quotes?: string[]
}) {
  const Icon = INSIGHT_ICON[mi.insight_type as keyof typeof INSIGHT_ICON] ?? Lightbulb
  return (
    <Card>
      <CardContent className="space-y-4 py-6 sm:px-7">
        {/* Icon eyebrow + evidence chip */}
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <Icon className="size-4 text-primary" aria-hidden />
            {prettyType(mi.insight_type)}
          </div>
          <EvidenceChip tier={tier} />
        </div>
        {/* The finding — the headline — then the read */}
        <div className="space-y-1.5">
          <h3 className="text-lg font-semibold leading-snug">{mi.title}</h3>
          <p className="text-sm leading-relaxed text-muted-foreground">{mi.description}</p>
        </div>
        {/* One voice */}
        {quotes.length > 0 && <Quotes items={quotes.slice(0, 1)} />}
        {themes.length > 0 && (
          <div className="space-y-3 border-t pt-4">
            <div className="flex flex-wrap items-end justify-between gap-3">
              {/* The grounded-in count, promoted to the card's number-anchor */}
              {conversations > 0 ? (
                <div className="flex items-baseline gap-1.5">
                  <span className="text-2xl font-bold tabular-nums">{conversations}</span>
                  <span className="text-xs text-muted-foreground">conversation{conversations === 1 ? '' : 's'} grounding this</span>
                </div>
              ) : (
                <span className="text-xs font-medium text-muted-foreground">Grounded in supporting themes</span>
              )}
              <Link
                href={`/dashboard/voice?themes=${encodeURIComponent(themes.join(','))}#grounding`}
                className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium text-primary ring-1 ring-primary/25 transition-colors hover:bg-primary/5"
              >
                See supporting voices <span aria-hidden>→</span>
              </Link>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {themes.map((theme, i) => (
                <span key={i} className={`px-2 py-0.5 rounded-full text-xs capitalize ${categoryTint(theme)}`}>{theme.replace(/_/g, ' ')}</span>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function EmptyState() {
  return (
    <Card>
      <CardContent className="py-10 text-center text-sm text-muted-foreground">
        Your market intelligence lands with your first update — check back then.
      </CardContent>
    </Card>
  )
}
