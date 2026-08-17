import Link from 'next/link'
import { MessagesSquare, Quote, Sparkles, BarChart3, Users, Target, Layers } from 'lucide-react'
import { getSessionContext } from '@/lib/auth'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { categoryTint, SENTIMENT_BADGE, PREVALENCE_BADGE } from '@/lib/ui-colors'
import { gateTier, CURATION_GATE } from '@/lib/curation'
import { prevalenceTier, PREVALENCE_LABEL, glossaryRule } from '@/lib/calibration'
import { VoiceFilters } from '@/components/voice-filters'
import { HowToRead } from '@/components/how-to-read'
import type { GlossaryKey } from '@/lib/calibration'
import { DetailOverlay } from '@/components/detail-overlay'

// Voice of Customer — "What are they actually saying?" (Redesign Spec §4).
// Themes are the organizing unit, not the raw insight list: each card is a
// Pass B-labelled theme with its synthesized description, emotion, video
// coverage, and expandable verbatim quotes (insight_evidence). Below the
// confirmed themes: "How your customers talk" (the language-samples panel —
// the signature panel for a product named Verbatim) and single-source early
// signals, honestly badged. Category filtering is a tab row (demo layout);
// journey-stage + strength filters stay URL-driven in the bar. Deep links from
// Market/Dashboard (?themes=slug1,slug2) narrow to the themes those insights
// are grounded in. Scores gate and order but are never shown as numbers.

interface ThemeRow {
  id: string
  bucket: string
  category: string
  label: string
  description: string | null
  member_themes: string[]
  supporting_insight_ids: string[]
  supporting_video_ids: string[]
  evidence_count: number
  strength_score: number | null
  dominant_emotion: string | null
  dominant_sentiment_impact: string | null
  single_source: boolean
  first_seen: boolean
}

/** Quotes shown per theme before the "+ more" line. */
const QUOTES_SHOWN = 5
/** Member-insight ids sampled per theme for the quote fetch (URL-length cap). */
const QUOTE_IDS_PER_THEME = 12
/** Early-signal cards shown before the "+N more" line. */
const EARLY_SHOWN = 12
/** Language-sample phrases shown before the "+N more" line. */
const PHRASES_SHOWN = 24

const prettyType = (s: string) => s.replace(/_/g, ' ')
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

const chipBase = 'px-2 py-0.5 rounded-full text-xs font-medium'

const LEGEND_ITEMS: GlossaryKey[] = ['conversations', 'dominant', 'widespread', 'recurring', 'early_signal', 'strong_evidence']

// Each entity bucket gets its own colour + icon so a client theme ("2 of 8 your-
// audience") never reads the same as a category one ("30 of 136 wider-category").
// Client = brand green, category = slate, competitor = clay.
function bucketMeta(bucket: string): { label: string; Icon: typeof Users; fg: string; bg: string; bar: string } {
  if (bucket === 'client') return { label: 'Your audience', Icon: Users, fg: 'text-primary', bg: 'bg-primary/10', bar: 'bg-primary/70' }
  if (bucket.startsWith('competitor:')) return { label: `${bucket.replace(/^competitor:/, '')}’s audience`, Icon: Target, fg: 'text-clay', bg: 'bg-clay/10', bar: 'bg-clay/70' }
  return { label: 'Wider category', Icon: Layers, fg: 'text-slate', bg: 'bg-slate/10', bar: 'bg-slate/70' }
}

export default async function VoiceOfCustomerPage({
  searchParams,
}: {
  searchParams?: Promise<{ entity?: string; themes?: string; type?: string; stage?: string; min?: string; detail?: string }>
}) {
  // Auth + tenant via the RLS-enforced session client. See lib/auth.ts.
  const { supabase, clientId } = await getSessionContext()

  const sp = (await searchParams) ?? {}
  const showLegend = sp.detail === 'legend'
  const detailId = sp.detail
  // Deep-link from a Market/Dashboard insight: ?themes=slug1,slug2 narrows the
  // page to the theme(s) whose members ground that insight.
  const groundingSlugs = new Set((sp.themes ?? '').split(',').map((s) => s.trim()).filter(Boolean))
  const deepLinked = groundingSlugs.size > 0
  const entityFilter = sp.entity ?? 'all'
  const typeFilter = sp.type ?? 'all'
  const stageFilter = sp.stage ?? 'all'
  const minScore = Number(sp.min ?? '0') || 0

  // Latest COMPLETED run — an in-flight run has no themes yet, so the page
  // keeps serving the previous run's voices until the new one closes.
  const { data: latestRun } = await supabase
    .from('pipeline_runs').select('id')
    .eq('client_id', clientId).in('status', ['completed', 'partial'])
    .order('started_at', { ascending: false }).limit(1).maybeSingle()

  if (!latestRun) {
    return (
      <div className="space-y-6">
        <PageHeader showLegend={showLegend} legendItems={LEGEND_ITEMS} />
        <EmptyState>Your customer voices land with your first update — check back then.</EmptyState>
      </div>
    )
  }
  const runId = latestRun.id as string

  const [themesRes, earlierRes, insightsRes, samplesRes, clientRes] = await Promise.all([
    supabase.from('themes')
      .select('id, bucket, category, label, description, member_themes, supporting_insight_ids, supporting_video_ids, evidence_count, strength_score, dominant_emotion, dominant_sentiment_impact, single_source, first_seen')
      .eq('client_id', clientId).eq('run_id', runId)
      .order('strength_score', { ascending: false }).order('evidence_count', { ascending: false }),
    supabase.from('themes').select('id')
      .eq('client_id', clientId).neq('run_id', runId).limit(1),
    // Current rows (the *_current views: what each video's analyzed_run_id
    // names), not this run's stamps — Pass A is incremental since 2026-08-17.
    supabase.from('audience_insights_current').select('id, journey_stage')
      .eq('client_id', clientId),
    supabase.from('language_samples_current')
      .select('phrase, platform', { count: 'exact' })
      .eq('client_id', clientId)
      .limit(PHRASES_SHOWN),
    supabase.from('clients').select('company_name').eq('id', clientId).maybeSingle(),
  ])

  const themes = (themesRes.data ?? []) as ThemeRow[]
  const showNew = ((earlierRes.data ?? []).length) > 0
  const brand = clientRes.data?.company_name ?? 'your brand'

  // ---- Prevalence denominators (calibrated language) ----
  // A theme's reach is measured against its own entity group: the group's
  // distinct insight-bearing conversations = union of its themes' evidence
  // (clustering partitions every insight, so the union covers the group).
  const groupConversations = new Map<string, Set<string>>()
  for (const t of themes) {
    let set = groupConversations.get(t.bucket)
    if (!set) groupConversations.set(t.bucket, (set = new Set()))
    for (const id of t.supporting_video_ids ?? []) set.add(id)
  }
  const groupSize = (bucket: string) => groupConversations.get(bucket)?.size ?? 0
  const groupName = (bucket: string) =>
    bucket === 'client' ? brand : bucket === 'industry-other' ? 'category' : bucket.replace(/^competitor:/, '')
  // Human wording for the entity-bucket chip — raw bucket values ("industry-other",
  // "competitor:X") are pipeline vocabulary and never client-facing.
  const bucketChip = (bucket: string) =>
    bucket === 'client' ? 'Your audience'
      : bucket === 'industry-other' ? 'Wider category'
        : `${bucket.replace(/^competitor:/, '')}’s audience`
  const stageByInsight = new Map(
    ((insightsRes.data ?? []) as { id: string; journey_stage: string | null }[]).map((i) => [i.id, i.journey_stage]),
  )
  const stagesPresent = new Set([...stageByInsight.values()].filter(Boolean))
  const samples = (samplesRes.data ?? []) as { phrase: string; platform: string | null }[]
  const sampleTotal = samplesRes.count ?? samples.length

  // Entities present this run, for the top selector bar — the client first, then
  // the wider category, then competitors by audience size.
  const bucketRank = (b: string) => (b === 'client' ? 0 : b === 'industry-other' ? 1 : 2)
  const entities = [...groupConversations.keys()]
    .map((b) => ({ bucket: b, size: groupSize(b), meta: bucketMeta(b) }))
    .sort((a, z) => bucketRank(a.bucket) - bucketRank(z.bucket) || z.size - a.size)

  // ---- Filters (applied to both tiers) ----
  const inEntity = (t: ThemeRow) => entityFilter === 'all' || t.bucket === entityFilter
  const shown = themes.filter((t) =>
    inEntity(t) &&
    (!deepLinked || t.member_themes.some((slug) => groundingSlugs.has(slug))) &&
    (typeFilter === 'all' || t.category === typeFilter) &&
    (stageFilter === 'all' || t.supporting_insight_ids.some((id) => stageByInsight.get(id) === stageFilter)) &&
    Number(t.strength_score ?? 0) >= minScore,
  )
  const confirmed = shown.filter((t) => !t.single_source)
  // Priority by SHARE of the entity's conversations, not raw count: a theme
  // 3-of-6 (50%) in a small competitor bucket outranks one 50-of-136 (37%) in
  // the big category bucket. "Confirmed" (multi-source) is the sample floor that
  // keeps a 1-of-1 fluke out. Featured = the calibrated high-prevalence tiers
  // (themselves share-based) or the client's own audience; the rest stay confirmed
  // but compact (full detail one click away in the overlay). A grounding deep-link
  // shows everything in full — the reader came for exactly those themes.
  const share = (t: ThemeRow) => { const d = groupSize(t.bucket); return d > 0 ? t.evidence_count / d : 0 }
  const byShare = (a: ThemeRow, b: ThemeRow) => share(b) - share(a) || b.evidence_count - a.evidence_count
  const isFeatured = (t: ThemeRow) => {
    const prevalence = prevalenceTier(t.evidence_count, groupSize(t.bucket))
    return t.bucket === 'client' || prevalence === 'dominant' || prevalence === 'widespread'
  }
  const featured = (deepLinked ? confirmed : confirmed.filter(isFeatured)).sort(byShare)
  const tail = deepLinked ? [] : confirmed.filter((t) => !isFeatured(t)).sort(byShare)
  const detailTheme = detailId ? themes.find((t) => t.id === detailId) ?? null : null
  // "Early signal" is a calibrated term — a single-source theme must also clear
  // the strength bar to carry it (same knob as the insight gate). The rest are
  // kept honest but demoted to a collapsed "also heard once" archive.
  const singles = shown.filter((t) => t.single_source)
  const early = singles.filter((t) => Number(t.strength_score ?? 0) >= CURATION_GATE.earlySignalMinScore)
  const heardOnce = singles.filter((t) => Number(t.strength_score ?? 0) < CURATION_GATE.earlySignalMinScore)

  // ---- The shape of this update's corpus (unfiltered — describes the run) ----
  // Most of what a market says is said once; the chart makes that honest and
  // shows how much repetition sits behind the confirmed tier.
  const confirmedAllCount = themes.filter((t) => !t.single_source).length
  const earlyAllCount = themes.filter((t) => t.single_source && Number(t.strength_score ?? 0) >= CURATION_GATE.earlySignalMinScore).length
  const onceAllCount = themes.length - confirmedAllCount - earlyAllCount
  const shapeSorted = [...themes].sort((a, b) => b.evidence_count - a.evidence_count || Number(b.strength_score ?? 0) - Number(a.strength_score ?? 0))
  const shapeMax = shapeSorted[0]?.evidence_count ?? 1

  // Category tabs count CONFIRMED themes in the SELECTED ENTITY, so a tab's
  // number matches what the explorer shows and switching entity re-scopes them.
  // (Single-source themes live in the Early-signals / Also-heard-once sections.)
  const categoryCounts = new Map<string, number>()
  for (const t of themes) if (!t.single_source && inEntity(t)) categoryCounts.set(t.category, (categoryCounts.get(t.category) ?? 0) + 1)
  const tabs = [...categoryCounts.entries()].sort((a, b) => b[1] - a[1])
  const entityConfirmedCount = [...categoryCounts.values()].reduce((a, n) => a + n, 0)

  // ---- Verbatim quotes for the confirmed themes on display ----
  // Sample a capped slice of member insights per theme (URL-length safety),
  // then group the ranked evidence back per theme.
  const quoteIds = [...new Set([
    ...confirmed.flatMap((t) => t.supporting_insight_ids.slice(0, QUOTE_IDS_PER_THEME)),
    ...(detailTheme?.supporting_insight_ids.slice(0, QUOTE_IDS_PER_THEME) ?? []),
  ])]
  const quoteByInsight = new Map<string, string[]>()
  const CHUNK = 100
  for (let i = 0; i < quoteIds.length; i += CHUNK) {
    const { data } = await supabase
      .from('insight_evidence').select('audience_insight_id, quote, relevance_rank')
      .in('audience_insight_id', quoteIds.slice(i, i + CHUNK))
      .order('relevance_rank', { ascending: true })
    for (const ev of (data ?? []) as { audience_insight_id: string; quote: string }[]) {
      const arr = quoteByInsight.get(ev.audience_insight_id)
      if (arr) arr.push(ev.quote)
      else quoteByInsight.set(ev.audience_insight_id, [ev.quote])
    }
  }
  const quotesFor = (t: ThemeRow): string[] => {
    const out: string[] = []
    for (const id of t.supporting_insight_ids.slice(0, QUOTE_IDS_PER_THEME)) {
      for (const q of quoteByInsight.get(id) ?? []) {
        if (out.length >= QUOTES_SHOWN) return out
        if (!out.includes(q)) out.push(q)
      }
    }
    return out
  }

  // Theme history for the overlay — same-label rows across earlier runs
  // (labels are how Trends joins trajectories too). Self-gates: with one
  // themed run there is no history and nothing renders.
  let detailHistory: number[] = []
  if (detailTheme) {
    const { data: hist } = await supabase.from('themes')
      .select('evidence_count, created_at')
      .eq('client_id', clientId).eq('label', detailTheme.label)
      .order('created_at', { ascending: true })
    detailHistory = ((hist ?? []) as { evidence_count: number }[]).map((h) => h.evidence_count)
  }

  // Hrefs that preserve the active filters; detail=… opens a theme's overlay.
  const voiceHref = (detail: string | null) => {
    const params = new URLSearchParams()
    if (sp.entity) params.set('entity', sp.entity)
    if (sp.type) params.set('type', sp.type)
    if (sp.themes) params.set('themes', sp.themes)
    if (sp.stage) params.set('stage', sp.stage)
    if (sp.min) params.set('min', sp.min)
    if (detail) params.set('detail', detail)
    const qs = params.toString()
    return qs ? `/dashboard/voice?${qs}` : '/dashboard/voice'
  }
  // Switching entity re-scopes the page: keep journey/strength, drop the category
  // tab + any grounding deep-link so you land on a clean view of that audience.
  const entityHref = (bucket: string | null) => {
    const params = new URLSearchParams()
    if (bucket) params.set('entity', bucket)
    if (sp.stage) params.set('stage', sp.stage)
    if (sp.min) params.set('min', sp.min)
    const qs = params.toString()
    return qs ? `/dashboard/voice?${qs}` : '/dashboard/voice'
  }

  return (
    <div className="space-y-6">
      <PageHeader showLegend={showLegend} legendItems={showNew ? [...LEGEND_ITEMS, 'new'] : LEGEND_ITEMS} />

      {/* The shape of the conversation — every theme this update, by evidence */}
      {!deepLinked && themes.length > 0 && (
        <Card className="py-4">
          <CardContent className="space-y-2">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <BarChart3 className="size-4 text-primary" aria-hidden /> The shape of this update
            </div>
            <p className="text-sm">
              <span className="font-bold tabular-nums">{themes.length}</span> themes heard this update
              <span className="text-muted-foreground"> · </span>
              <span className="font-semibold text-primary tabular-nums">{confirmedAllCount}</span> confirmed
              <span className="text-muted-foreground"> · </span>
              <span className="font-semibold text-warning tabular-nums">{earlyAllCount}</span> early signals
              <span className="text-muted-foreground"> · </span>
              <span className="font-semibold text-muted-foreground tabular-nums">{onceAllCount}</span> heard once
            </p>
            <div className="flex h-14 items-end gap-px">
              {shapeSorted.map((t) => {
                const tone = !t.single_source
                  ? 'bg-primary/70'
                  : Number(t.strength_score ?? 0) >= CURATION_GATE.earlySignalMinScore ? 'bg-warning/60' : 'bg-muted-foreground/25'
                return (
                  <div
                    key={t.id}
                    title={`${t.label} · ${t.evidence_count} conversation${t.evidence_count === 1 ? '' : 's'}`}
                    className={`min-w-0 flex-1 rounded-t-sm ${tone}`}
                    style={{ height: `${Math.max(7, Math.round((t.evidence_count / shapeMax) * 100))}%` }}
                  />
                )
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {themes.length === 0 && (
        <EmptyState>Your customer voices are being organised into themes — they land with your next update.</EmptyState>
      )}

      {/* Entity selector — the primary axis: whose audience are we reading. A
          horizontal bar above the block; the category / journey / strength filters
          live inside the block and narrow within the chosen audience. */}
      {themes.length > 0 && entities.length > 1 && (
        <div className="flex flex-wrap items-center gap-2">
          <EntityChip label="All audiences" href={entityHref(null)} active={entityFilter === 'all'} />
          {entities.map((e) => (
            <EntityChip
              key={e.bucket}
              label={e.meta.label}
              count={e.size}
              href={entityHref(e.bucket)}
              active={entityFilter === e.bucket}
              Icon={e.meta.Icon}
              fg={e.meta.fg}
              bg={e.meta.bg}
            />
          ))}
        </div>
      )}

      {/* The theme explorer — an interactive subsection: the filter controls live
          inside the block with the themes they narrow (Meltwater-style). */}
      {themes.length > 0 && (
        <section id="grounding" className="space-y-4 rounded-xl border bg-muted/40 p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <MessagesSquare className="size-4 text-primary" aria-hidden />
              What your market is saying <span className="text-foreground">· {confirmed.length}</span>
            </div>
            <VoiceFilters stage={stageFilter} min={String(minScore)} deepLinked={deepLinked} showStage={stagesPresent.size > 0} />
          </div>
          {tabs.length > 0 && (
            <div className="flex flex-wrap gap-2">
              <TabLink label="All" count={entityConfirmedCount} active={typeFilter === 'all'} category={null} sp={sp} />
              {tabs.map(([category, n]) => (
                <TabLink key={category} label={cap(prettyType(category))} count={n} active={typeFilter === category} category={category} sp={sp} />
              ))}
            </div>
          )}
          {confirmed.length === 0 && (
            <p className="py-2 text-sm text-muted-foreground">
              {shown.length === 0 ? 'No themes match these filters.' : 'No confirmed themes match these filters — see early signals below.'}
            </p>
          )}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {featured.map((t) => {
              const quotes = quotesFor(t)
              const denom = groupSize(t.bucket)
              // Calibrated prevalence: word by rule, count next to it (never the model's wording).
              const prevalence = prevalenceTier(t.evidence_count, denom)
              const bm = bucketMeta(t.bucket)
              return (
                <Card key={t.id}>
                  <CardContent className="space-y-3 py-6 sm:px-6">
                    {/* Bucket identity leads, colour-coded, so a client theme never
                        reads the same as a category or competitor one */}
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-semibold ${bm.bg} ${bm.fg}`}>
                          <bm.Icon className="size-3.5" aria-hidden />
                          {bm.label}
                        </span>
                        <span title={glossaryRule(prevalence)} className={`${chipBase} ${PREVALENCE_BADGE[prevalence]}`}>{PREVALENCE_LABEL[prevalence]}</span>
                        <span className={`${chipBase} capitalize ${categoryTint(t.category)}`}>{prettyType(t.category)}</span>
                        {t.dominant_emotion && (
                          <span className={`${chipBase} capitalize ${categoryTint(t.dominant_emotion)}`}>{t.dominant_emotion}</span>
                        )}
                      </div>
                      {showNew && t.first_seen && (
                        <span title={glossaryRule('new')} className={`${chipBase} shrink-0 font-semibold bg-warning/15 text-warning`}>New</span>
                      )}
                    </div>
                    {/* The theme is the headline; its synthesized read beneath */}
                    <h3 className="text-base font-semibold leading-snug">{t.label}</h3>
                    {t.description && <p className="text-sm leading-relaxed text-muted-foreground">{t.description}</p>}
                    {/* Number-anchor coloured by bucket — client/category/competitor read apart */}
                    <div className="space-y-1.5 border-t pt-3">
                      <div className="flex items-baseline gap-1.5">
                        <span className={`text-2xl font-bold tabular-nums ${bm.fg}`}>{t.evidence_count}</span>
                        <span className="text-xs text-muted-foreground">of {denom} {groupName(t.bucket)} conversations</span>
                      </div>
                      <EvidenceBar count={t.evidence_count} denom={denom} tone={bm.bar} />
                    </div>
                    {quotes.length > 0 && (
                      <details className="group">
                        <summary className="flex cursor-pointer list-none items-center gap-1.5 text-xs font-medium text-primary [&::-webkit-details-marker]:hidden">
                          <span className="text-[9px] transition-transform group-open:rotate-90" aria-hidden>▶</span>
                          Hear these voices
                        </summary>
                        <div className="mt-2 space-y-1.5">
                          {quotes.map((q, n) => (
                            <p key={n} className="text-xs text-muted-foreground italic">&ldquo;{q}&rdquo;</p>
                          ))}
                        </div>
                      </details>
                    )}
                  </CardContent>
                </Card>
              )
            })}
          </div>

          {/* The confirmed tail — same standing, compact form; the overlay has the full picture */}
          {tail.length > 0 && (
            <div className="space-y-2 pt-1">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                More confirmed themes <span className="opacity-60">· {tail.length}</span>
              </h3>
              <Card className="py-0">
                <CardContent className="divide-y p-0">
                  {tail.map((t) => {
                    const denom = groupSize(t.bucket)
                    const prevalence = prevalenceTier(t.evidence_count, denom)
                    const bm = bucketMeta(t.bucket)
                    return (
                      <Link
                        key={t.id}
                        href={voiceHref(t.id)}
                        scroll={false}
                        className="flex items-center justify-between gap-3 px-4 py-2.5 transition-colors hover:bg-muted/30"
                      >
                        <span className="flex min-w-0 items-center gap-2">
                          <bm.Icon className={`size-3.5 shrink-0 ${bm.fg}`} aria-hidden />
                          <span className="min-w-0 truncate text-sm font-medium">{t.label}</span>
                        </span>
                        <span className="flex shrink-0 items-center gap-2">
                          <span className={`hidden sm:inline ${chipBase} capitalize ${categoryTint(t.category)}`}>{prettyType(t.category)}</span>
                          <span title={glossaryRule(prevalence)} className={`${chipBase} ${PREVALENCE_BADGE[prevalence]}`}>{PREVALENCE_LABEL[prevalence]}</span>
                          <span className={`text-[11px] font-medium tabular-nums ${bm.fg}`}>{t.evidence_count} of {denom}</span>
                          <span className="text-muted-foreground" aria-hidden>→</span>
                        </span>
                      </Link>
                    )
                  })}
                </CardContent>
              </Card>
            </div>
          )}
        </section>
      )}

      {/* How your customers talk — the signature panel */}
      {samples.length > 0 && (
        <Card className="ring-1 ring-primary/20">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Quote className="size-4 text-primary" aria-hidden /> How your customers talk
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap items-center gap-2">
              {samples.map((s, i) => (
                <span
                  key={i}
                  title={s.platform ? cap(s.platform) : undefined}
                  className="rounded-full bg-secondary px-3 py-1 text-xs italic text-secondary-foreground"
                >
                  &ldquo;{s.phrase}&rdquo;
                </span>
              ))}
              {sampleTotal > samples.length && (
                <span className="text-xs text-muted-foreground">+{sampleTotal - samples.length} more collected</span>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Early signals — single-source themes, honestly framed */}
      {early.length > 0 && (
        <section className="space-y-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            <Sparkles className="size-4 text-warning" aria-hidden />
            Early signals <span className="opacity-60">· {early.length}</span>
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {early.slice(0, EARLY_SHOWN).map((t) => (
              <Card key={t.id} className="py-4">
                <CardContent className="space-y-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`${chipBase} capitalize ${categoryTint(t.category)}`}>{prettyType(t.category)}</span>
                    <span title={glossaryRule('early_signal')} className={`${chipBase} bg-warning/15 text-warning`}>Early signal</span>
                  </div>
                  <p className="text-sm font-medium">{t.label}</p>
                  {t.description && <p className="text-xs text-muted-foreground line-clamp-2">{t.description}</p>}
                </CardContent>
              </Card>
            ))}
          </div>
          {early.length > EARLY_SHOWN && (
            <p className="text-xs text-muted-foreground">+{early.length - EARLY_SHOWN} more early signals in this update</p>
          )}
        </section>
      )}

      {/* Also heard once — single mentions below the signal bar, kept for the record */}
      {heardOnce.length > 0 && (
        <details className="group">
          <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground [&::-webkit-details-marker]:hidden">
            <span className="text-[10px] transition-transform group-open:rotate-90" aria-hidden>▶</span>
            Also heard once <span className="opacity-60">· {heardOnce.length}</span>
            <span className="normal-case font-normal tracking-normal text-xs opacity-70">single mentions that didn&rsquo;t clear the signal bar</span>
          </summary>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {heardOnce.map((t) => (
              <span key={t.id} title={t.description ?? undefined} className="px-2 py-0.5 rounded-full text-xs bg-muted text-muted-foreground">
                {t.label}
              </span>
            ))}
          </div>
        </details>
      )}

      {/* Theme detail overlay — URL-driven (?detail=theme-id), everything the
          full card shows, for themes that render compact in the tail list. */}
      {detailTheme && (
        <DetailOverlay closeHref={voiceHref(null)}>
          {(() => {
            const tier = gateTier(detailTheme.strength_score, detailTheme.evidence_count)
            const denom = groupSize(detailTheme.bucket)
            const prevalence = prevalenceTier(detailTheme.evidence_count, denom)
            const quotes = quotesFor(detailTheme)
            return (
              <div className="space-y-3 pr-6">
                <ThemeChips t={detailTheme} tier={tier} prevalence={prevalence} showNew={showNew} bucketLabel={bucketChip(detailTheme.bucket)} />
                <h3 className="text-lg font-semibold">{detailTheme.label}</h3>
                {detailTheme.description && <p className="text-sm text-muted-foreground">{detailTheme.description}</p>}
                <div className="border-t pt-3 space-y-1">
                  <EvidenceBar count={detailTheme.evidence_count} denom={denom} />
                  <p className="text-[10px] text-muted-foreground">
                    heard in {detailTheme.evidence_count} of {denom} {groupName(detailTheme.bucket)} conversations
                  </p>
                </div>
                {detailHistory.length >= 2 && (
                  <div className="flex items-center gap-3 border-t pt-3">
                    <span className="text-primary"><Sparkline values={detailHistory} /></span>
                    <p className="text-[10px] text-muted-foreground">
                      conversations per update, across the {detailHistory.length} updates this theme has appeared in
                    </p>
                  </div>
                )}
                {quotes.length > 0 && (
                  <div className="space-y-1.5">
                    <p className="text-xs font-medium">The voices behind it</p>
                    {quotes.map((q, n) => (
                      <p key={n} className="text-xs text-muted-foreground italic">&ldquo;{q}&rdquo;</p>
                    ))}
                    <p className="text-[10px] text-muted-foreground">a sample of the conversations behind this theme</p>
                  </div>
                )}
              </div>
            )
          })()}
        </DetailOverlay>
      )}
    </div>
  )
}

/** The calibrated chip row a theme carries everywhere it appears in full. */
function ThemeChips({ t, tier, prevalence, showNew, bucketLabel }: {
  t: ThemeRow
  tier: ReturnType<typeof gateTier>
  prevalence: ReturnType<typeof prevalenceTier>
  showNew: boolean
  bucketLabel: string
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span title={glossaryRule(prevalence)} className={`${chipBase} ${PREVALENCE_BADGE[prevalence]}`}>{PREVALENCE_LABEL[prevalence]}</span>
      <span className={`${chipBase} capitalize ${categoryTint(t.category)}`}>{prettyType(t.category)}</span>
      <span className={`${chipBase} bg-muted text-muted-foreground`}>{bucketLabel}</span>
      {t.dominant_emotion && (
        <span className={`${chipBase} capitalize ${categoryTint(t.dominant_emotion)}`}>{t.dominant_emotion}</span>
      )}
      {t.dominant_sentiment_impact && (
        <span className={`${chipBase} capitalize ${SENTIMENT_BADGE[t.dominant_sentiment_impact] ?? 'bg-muted text-muted-foreground'}`}>
          {t.dominant_sentiment_impact}
        </span>
      )}
      {tier === 'confirmed' && <span title={glossaryRule('strong_evidence')} className={`${chipBase} bg-positive/12 text-positive`}>Strong evidence</span>}
      {showNew && t.first_seen && (
        <span title={glossaryRule('new')} className={`${chipBase} font-semibold bg-warning/15 text-warning`}>New</span>
      )}
    </div>
  )
}

/** Tiny evidence-over-updates line for the overlay (Trends' sparkline shape). */
function Sparkline({ values }: { values: number[] }) {
  const W = 96, H = 32, p = 4
  const min = Math.min(...values), max = Math.max(...values)
  const x = (i: number) => p + (values.length === 1 ? 0 : (i / (values.length - 1)) * (W - 2 * p))
  const y = (v: number) => p + (1 - (v - min) / ((max - min) || 1)) * (H - 2 * p)
  const line = values.map((v, i) => `${x(i)},${y(v)}`).join(' ')
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-8 w-24" preserveAspectRatio="none" aria-hidden>
      <polyline points={line} fill="none" stroke="currentColor" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      <circle cx={x(values.length - 1)} cy={y(values[values.length - 1])} r={2.5} fill="currentColor" />
    </svg>
  )
}

/** Evidence weight, visually: the theme's conversations against its group. */
function EvidenceBar({ count, denom, tone = 'bg-primary/60' }: { count: number; denom: number; tone?: string }) {
  const pct = denom > 0 ? Math.min(100, Math.round((count / denom) * 100)) : 0
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted" aria-hidden>
      <div className={`h-full rounded-full ${tone}`} style={{ width: `${Math.max(3, pct)}%` }} />
    </div>
  )
}

function PageHeader({ showLegend, legendItems }: { showLegend: boolean; legendItems: GlossaryKey[] }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <h1 className="text-2xl font-bold">Voice of Customer</h1>
      <HowToRead items={legendItems} open={showLegend} basePath="/dashboard/voice" />
    </div>
  )
}

/** A category tab — a Link so the server filters; preserves the other params. */
function TabLink({ label, count, active, category, sp }: {
  label: string
  count: number
  active: boolean
  category: string | null
  sp: { entity?: string; themes?: string; stage?: string; min?: string }
}) {
  const params = new URLSearchParams()
  if (sp.entity) params.set('entity', sp.entity)
  if (category) params.set('type', category)
  if (sp.themes) params.set('themes', sp.themes)
  if (sp.stage) params.set('stage', sp.stage)
  if (sp.min) params.set('min', sp.min)
  const qs = params.toString()
  return (
    <Link
      href={qs ? `/dashboard/voice?${qs}` : '/dashboard/voice'}
      className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-medium transition-colors ${
        active
          ? 'bg-primary text-primary-foreground'
          : 'bg-card text-foreground ring-1 ring-border hover:bg-muted/40'
      }`}
    >
      {label}
      <span className={active ? 'opacity-70' : 'text-muted-foreground'}>{count}</span>
    </Link>
  )
}

/** A big entity segment for the top selector bar — colour-coded per bucket, with
 *  its conversation count (the same denominator the theme cards read "N of"). */
function EntityChip({ label, count, href, active, Icon, fg, bg }: {
  label: string
  count?: number
  href: string
  active: boolean
  Icon?: typeof Users
  fg?: string
  bg?: string
}) {
  return (
    <Link
      href={href}
      scroll={false}
      className={`inline-flex items-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium transition-colors ${
        active ? `${bg ?? 'bg-primary/10'} ${fg ?? 'text-primary'} border-transparent` : 'border-border text-foreground hover:bg-muted/40'
      }`}
    >
      {Icon && <Icon className={`size-4 ${active ? '' : fg}`} aria-hidden />}
      {label}
      {count != null && <span className={active ? 'opacity-70' : 'text-muted-foreground'}>· {count}</span>}
    </Link>
  )
}

function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <Card>
      <CardContent className="py-10 text-center text-sm text-muted-foreground">{children}</CardContent>
    </Card>
  )
}
