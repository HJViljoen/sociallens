import Link from 'next/link'
import type { ReactNode } from 'react'
import { getSessionContext } from '@/lib/auth'
import { CURATION_GATE, type GateTier } from '@/lib/curation'
import { priorityWord, glossaryRule, type GlossaryKey } from '@/lib/calibration'
import { HowToRead } from '@/components/how-to-read'
import { rankByTheme, fetchQuotesByAudience, fetchInsightsByIds, createQuotePicker, bucketByAudienceId, scopeToClientVoices, type ThemeBucketRow } from '@/lib/quotes'
import type { CiSummary, SayVsHearEntry } from '@/lib/pipeline/schemas'
import type { BrandVoiceSnapshot } from '@/lib/pipeline/claims'
import { weekdayDate, shortDate, platformLabel, fmtInt } from '@/lib/format'
import {
  insightTiers, confirmedCompetitiveIds, orderAgenda, priorityDot, distinctVideos,
  claimVerdict, claimCounts, claimCountsLine, ledgerRows, truncateWords, quadrantBullets, tierCounts, newsRingChip,
  type ClaimTone, type AgendaItem,
} from '@/lib/market-tiles'
import { PageFrame, PageGrid, PageBar, BarPill } from '@/components/shell/page-grid'
import { Tile, TileEmpty } from '@/components/shell/tile'
import { DetailDrawer } from '@/components/shell/detail-drawer'

// Market Intelligence — "What should we do?", on one screen: the decision
// ledger (one-screen redesign round 2, 2026-08-22). Left, the agenda: numbered
// recommendations, #1 featured with its voices and status pills, #2–#5 compact
// with what grounds them. Right: the short read as one 2×2 panel, the say-vs-
// hear ledger (you say · verdict · they hear), key insights, what others say
// about you, and the news as context. Every tile gates on its data and shows
// an honest one-line empty at its size; drawers (?detail=) hold the full lists.
// Scores gate and order but are never shown as numbers — evidence words from
// lib/curation replace them. Read-only server component; same auth/run-anchor
// pattern as the dashboard (latest COMPLETED update, so an in-flight update
// never blanks the page).

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

interface NewsRow {
  title: string
  url: string
  source_ref: string
  published_at: string | null
  ring: number
}

/** Single-source theme pills shown in the findings drawer before "+N more". */
const SINGLE_SOURCE_SHOWN = 12
/** News headlines kept for the tile + its drawer (rings 0–2, as Trends shows). */
const NEWS_SHOWN = 8

const BASE = '/dashboard/market'
const prettyType = (s: string) => s.replace(/_/g, ' ')
const plural = (n: number, one: string, many = `${one}s`) => (n === 1 ? one : many)

const LEGEND_ITEMS: GlossaryKey[] = ['conversations', 'say_vs_hear', 'about_you', 'news', 'act_now', 'plan_next', 'worth_considering', 'strong_evidence', 'early_signal']

// ── small page-local primitives (full class strings — Tailwind v4 scans them) ──

const TONE: Record<ClaimTone, string> = {
  positive: 'bg-positive/12 text-positive',
  clay: 'bg-clay/10 text-clay',
  sand: 'bg-muted text-muted-foreground',
}

function Chip({ tone = 'sand', title, children }: { tone?: ClaimTone | 'warning'; title?: string; children: ReactNode }) {
  const cls = tone === 'warning' ? 'bg-warning/15 text-warning' : TONE[tone]
  return <span title={title} className={`inline-flex shrink-0 items-center whitespace-nowrap rounded-full px-2 py-px text-[10.5px] font-medium ${cls}`}>{children}</span>
}

/** The score replacement: judgment as a word, never a number. */
function EvidenceChip({ tier }: { tier: GateTier }) {
  if (tier === 'confirmed') return <Chip tone="positive" title={glossaryRule('strong_evidence')}>Strong evidence</Chip>
  if (tier === 'early_signal') return <Chip tone="warning" title={glossaryRule('early_signal')}>Early signal</Chip>
  return null
}

const PRIORITY_TIP: Record<string, string> = {
  'Act now': glossaryRule('act_now'),
  'Plan next': glossaryRule('plan_next'),
  'Worth considering': glossaryRule('worth_considering'),
}

/** Calibrated, positional priority word — "Act now" appears once per update. */
function PriorityChip({ word }: { word: string }) {
  return <Chip tone={word === 'Act now' ? 'warning' : 'sand'} title={PRIORITY_TIP[word]}>{word}</Chip>
}

function PriorityDot({ priority, className = '' }: { priority: string | null; className?: string }) {
  return <span className={`inline-block size-2 shrink-0 rounded-full ${className}`} style={{ background: priorityDot(priority) }} aria-hidden />
}

/** A verbatim voice — the clay rule is the signature; never model prose. */
function Quote({ text, who, clamp = true }: { text: string; who?: ReactNode; clamp?: boolean }) {
  return (
    <blockquote className="border-l-2 border-clay/70 pl-2.5 text-[12.5px] italic leading-[1.4] text-foreground/90">
      <span className={clamp ? 'line-clamp-2' : undefined}>“{text}”</span>
      {who && <span className="mt-0.5 block text-[10.5px] not-italic text-muted-foreground">{who}</span>}
    </blockquote>
  )
}

const voiceHref = (themes: string[]) => `/dashboard/voice?themes=${encodeURIComponent(themes.join(','))}#grounding`

function ThemeChips({ themes }: { themes: string[] }) {
  if (themes.length === 0) return null
  return (
    <div className="flex flex-wrap gap-1">
      {themes.map((t) => (
        <Link key={t} href={`/dashboard/voice?themes=${encodeURIComponent(t)}`} className="rounded-full bg-muted px-2 py-px text-[10.5px] text-muted-foreground transition-colors hover:bg-muted/70">
          {prettyType(t)}
        </Link>
      ))}
    </div>
  )
}

export default async function MarketIntelligencePage({ searchParams }: { searchParams?: Promise<{ detail?: string }> }) {
  const sp = (await searchParams) ?? {}
  const showLegend = sp.detail === 'legend'
  // Auth + tenant via the RLS-enforced session client. See lib/auth.ts.
  const { supabase, clientId } = await getSessionContext()

  // Latest COMPLETED update — an in-flight one has no synthesis rows yet, so
  // the page keeps serving the previous read until the new one closes.
  const [{ data: client }, { data: latestRun }] = await Promise.all([
    supabase.from('clients').select('company_name').eq('id', clientId).maybeSingle(),
    supabase.from('pipeline_runs').select('id, started_at')
      .eq('client_id', clientId).in('status', ['completed', 'partial'])
      .order('started_at', { ascending: false }).limit(1).maybeSingle(),
  ])
  const brand = client?.company_name ?? 'Your brand'

  if (!latestRun) {
    return (
      <PageFrame>
        <PageBar title="Market Intelligence" context={`What should we do? · ${brand}`}>
          <HowToRead items={LEGEND_ITEMS} open={showLegend} basePath={BASE} />
        </PageBar>
        <PageGrid>
          <Tile col={12} row={2} eyebrow="Your first update">
            <TileEmpty>Your market intelligence lands with your first update — check back then.</TileEmpty>
          </Tile>
        </PageGrid>
      </PageFrame>
    )
  }
  const runId = latestRun.id as string

  const [miRes, recRes, ciRes, summaryRes, ssRes, bucketRes, newsRes] = await Promise.all([
    supabase.from('market_insights')
      .select('id, insight_type, title, description, evidence, confidence_score, opportunity_score, hero_quote')
      .eq('client_id', clientId).eq('run_id', runId)
      .order('opportunity_score', { ascending: false }),
    supabase.from('recommendations')
      .select('id, type, title, reasoning, priority, based_on, hero_quote')
      .eq('client_id', clientId).eq('run_id', runId),
    supabase.from('competitive_insights').select('id, evidence, impact_level')
      .eq('client_id', clientId).eq('run_id', runId),
    supabase.from('run_summary').select('run_date, consumer_intelligence_summary, say_vs_hear, brand_voice')
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
    // In the news — rings 0–2 only (brand / competitors / category), newest
    // first, the same read Trends had: context beside the conversation, never
    // a claimed cause.
    supabase.from('news_items')
      .select('title, url, source_ref, published_at, ring', { count: 'exact' })
      .eq('client_id', clientId).lte('ring', 2)
      .order('published_at', { ascending: false, nullsFirst: false })
      .limit(NEWS_SHOWN),
  ])

  const insights = (miRes.data ?? []) as MarketInsight[]
  const recommendations = (recRes.data ?? []) as Recommendation[]
  const competitive = (ciRes.data ?? []) as CompetitiveRef[]
  const ciSummary = (summaryRes.data?.consumer_intelligence_summary ?? null) as CiSummary | null
  const sayVsHear = ((summaryRes.data?.say_vs_hear ?? null) as SayVsHearEntry[] | null) ?? null
  const brandVoice = (summaryRes.data?.brand_voice ?? null) as BrandVoiceSnapshot | null
  const aboutYou = brandVoice?.about ?? []
  const singleSourceThemes = (ssRes.data ?? []) as SingleSourceTheme[]
  const singleSourceTotal = ssRes.count ?? singleSourceThemes.length
  const news = (newsRes.data ?? []) as NewsRow[]
  // The real total, not the fetch cap.
  const newsTotal = newsRes.count ?? news.length
  const runDate = (summaryRes.data?.run_date as string | undefined) ?? (latestRun.started_at as string)

  const miById = new Map(insights.map((mi) => [mi.id, mi]))
  const competitiveById = new Map(competitive.map((c) => [c.id, c]))
  // Slugs + source videos for the ids THIS update cites (market-insight
  // evidence and its themes' membership) — read by id from the base table
  // (fetchInsightsByIds), not the current view: a newer in-flight update may
  // have superseded some of those videos' rows, which would silently shrink
  // the measured grounding counts below (incremental Pass A, 2026-08-17).
  const citedIds = new Set<string>()
  for (const mi of insights) for (const id of mi.evidence?.supporting_theme_ids ?? []) citedIds.add(id)
  for (const t of (bucketRes.data ?? []) as ThemeBucketRow[]) for (const id of t.supporting_insight_ids ?? []) citedIds.add(id)
  const audienceRows = await fetchInsightsByIds<{ id: string; theme: string; source_video_id: string | null }>(
    supabase, [...citedIds], 'id, theme, source_video_id',
  )
  const themeSlugById = new Map(audienceRows.map((a) => [a.id, a.theme]))
  const videoByInsight = new Map(audienceRows.map((a) => [a.id, a.source_video_id]))

  // ── curation gate over the insights (already in opportunity order) ──────
  const tierById = insightTiers(insights)
  const tiers = tierCounts(tierById)
  const confirmed = insights.filter((mi) => tierById.get(mi.id) === 'confirmed')
  const keyInsights = confirmed.slice(0, 2)
  const earlyInsights = insights.filter((mi) => tierById.get(mi.id) === 'early_signal')
  const archiveInsights = insights.filter((mi) => tierById.get(mi.id) === 'archive')

  const insightConversations = (mi: MarketInsight) => distinctVideos(mi.evidence?.supporting_theme_ids ?? [], videoByInsight)
  /** Deduped grounding theme slugs for an insight — chips + the Voice deep-link. */
  function insightThemes(mi: MarketInsight): string[] {
    const slugs = new Set<string>()
    for (const id of mi.evidence?.supporting_theme_ids ?? []) {
      const slug = themeSlugById.get(id)
      if (slug) slugs.add(slug)
    }
    return [...slugs].slice(0, 4)
  }

  // ── recommendations: the agenda, ordered by evidence ────────────────────
  const agenda = orderAgenda(recommendations, tierById, confirmedCompetitiveIds(competitive))
  const featured = agenda[0] ?? null
  const compactRows = agenda.slice(1, 5)

  /** Every audience-insight id behind a recommendation, via its supporting insights. */
  function recSupportIds(rec: Recommendation): string[] {
    const ids: string[] = []
    for (const id of rec.based_on?.insight_ids ?? []) {
      ids.push(...(miById.get(id)?.evidence?.supporting_theme_ids ?? []))
      ids.push(...(competitiveById.get(id)?.evidence?.supporting_theme_ids ?? []))
    }
    return ids
  }
  /** Grounding theme slugs behind a recommendation. */
  function recThemes(rec: Recommendation): string[] {
    const slugs = new Set<string>()
    for (const id of recSupportIds(rec)) {
      const slug = themeSlugById.get(id)
      if (slug) slugs.add(slug)
    }
    return [...slugs].slice(0, 4)
  }
  const recConversations = (rec: Recommendation) => distinctVideos(recSupportIds(rec), videoByInsight)

  // ── verbatim quotes (shared lib/quotes) ─────────────────────────────────
  // Pool the audience insights most on-topic for the featured action and the
  // key insights (theme-ranked so the specific voices beat the generic ones),
  // fetch once, pick with a page-scoped picker. Every claim here is about the
  // client, so pools keep client + category voices only — a competitor's
  // customers never speak under a client claim.
  const bucketById = bucketByAudienceId((bucketRes.data ?? []) as ThemeBucketRow[])
  const recVoiceIds = (rec: Recommendation) => scopeToClientVoices(recSupportIds(rec), bucketById)
  const insightVoiceIds = (mi: MarketInsight) => scopeToClientVoices(mi.evidence?.supporting_theme_ids ?? [], bucketById)
  const cardSpecs: { ids: string[]; claim: string }[] = [
    ...(featured ? [{ ids: recVoiceIds(featured.rec), claim: `${featured.rec.title} ${featured.rec.reasoning}` }] : []),
    ...keyInsights.map((mi) => ({ ids: insightVoiceIds(mi), claim: `${mi.title} ${mi.description}` })),
  ]
  const poolIds = new Set<string>()
  for (const spec of cardSpecs) {
    for (const id of rankByTheme(spec.ids, spec.claim, themeSlugById).slice(0, 80)) {
      if (poolIds.size < 400) poolIds.add(id)
    }
  }
  const quotesByAudience = await fetchQuotesByAudience(supabase, [...poolIds])
  const pick = createQuotePicker(quotesByAudience, themeSlugById)
  const featuredQuotes = featured ? pick(recVoiceIds(featured.rec), 2, `${featured.rec.title} ${featured.rec.reasoning}`, featured.rec.hero_quote) : []
  const featuredVoices = featured ? recVoiceIds(featured.rec).length : 0
  const featuredConversations = featured ? recConversations(featured.rec) : 0
  const keyQuotes = new Map(keyInsights.map((mi) => [mi.id, pick(insightVoiceIds(mi), 1, `${mi.title} ${mi.description}`, mi.hero_quote)]))

  // ── say vs hear ─────────────────────────────────────────────────────────
  const claims = sayVsHear ?? []
  const counts = claimCounts(claims)
  const claimThemes = (e: SayVsHearEntry): string[] => {
    const slugs = new Set<string>()
    for (const id of e.supporting_theme_ids ?? []) {
      const s = themeSlugById.get(id)
      if (s) slugs.add(s)
    }
    return [...slugs].slice(0, 4)
  }

  // ── overlays ────────────────────────────────────────────────────────────
  const showRecs = sp.detail === 'recs'
  const showClaims = sp.detail === 'claims'
  const showInsights = sp.detail === 'insights'
  const showAbout = sp.detail === 'about'
  const showNews = sp.detail === 'news'

  const context = `What should we do? · ${brand} · ${weekdayDate(runDate)}`

  return (
    <PageFrame>
      <PageBar title="Market Intelligence" context={context}>
        <BarPill active>This update</BarPill>
        <HowToRead items={LEGEND_ITEMS} open={showLegend} basePath={BASE} />
      </PageBar>

      <PageGrid>
        {/* ── the agenda: what to do ─────────────────────────────────── */}
        <Tile col={5} row={6} variant={featured ? 'warm' : 'default'} eyebrow="What to do · this update"
          meta={agenda.length > 0 ? `${agenda.length} ${plural(agenda.length, 'recommendation')} · ordered by evidence` : undefined}
          footer={agenda.length > 0 ? <Link href={`${BASE}?detail=recs`} scroll={false}>All recommendations →</Link> : undefined}
          footerNote={agenda.length > 0 ? (
            <span className="flex items-center gap-2 text-[10.5px]">
              <span className="flex items-center gap-1"><PriorityDot priority="high" />high</span>
              <span className="flex items-center gap-1"><PriorityDot priority="medium" />medium</span>
              <span className="flex items-center gap-1"><PriorityDot priority="low" />low</span>
            </span>
          ) : undefined}
          bodyClassName="overflow-hidden"
        >
          {featured ? (
            <>
              {/* #1 — featured */}
              <div className="flex flex-col gap-2 pb-2">
                <div className="flex items-start gap-2.5">
                  <span className="w-3.5 shrink-0 font-mono text-[12px] font-semibold leading-[1.25] text-[#9AA39A]">1</span>
                  <PriorityDot priority={featured.rec.priority} className="mt-[7px]" />
                  <h3 className="line-clamp-3 flex-1 text-[17px] font-semibold leading-[1.25] tracking-[-0.01em] [text-wrap:balance]">{featured.rec.title}</h3>
                </div>
                <div className="flex flex-col gap-2 pl-[31px]">
                  <div className="flex flex-wrap items-center gap-1">
                    <PriorityChip word={priorityWord(0)} />
                    <EvidenceChip tier={featured.tier} />
                    {featuredConversations > 0 && <Chip title={glossaryRule('conversations')}>{fmtInt(featuredConversations)} {plural(featuredConversations, 'conversation')}</Chip>}
                    <Chip>{prettyType(featured.rec.type)}</Chip>
                  </div>
                  <p className="line-clamp-4 text-[12.5px] leading-[1.45] text-foreground/85">{featured.rec.reasoning}</p>
                  {featuredQuotes.length > 0 && (
                    <div className="flex flex-col gap-1.5">
                      {featuredQuotes.map((q, i) => (
                        <Quote key={i} text={q} who={i === featuredQuotes.length - 1 && featuredVoices > 0 ? `${featuredQuotes.length === 1 ? 'one' : 'two'} of ${fmtInt(featuredVoices)} voices behind this` : undefined} />
                      ))}
                    </div>
                  )}
                  <div className="flex flex-wrap items-center gap-2 text-[11px] font-medium text-primary">
                    {recThemes(featured.rec).length > 0 && (
                      <Link href={voiceHref(recThemes(featured.rec))}>See the voices{featuredVoices > 0 ? ` (${fmtInt(featuredVoices)})` : ''} →</Link>
                    )}
                  </div>
                </div>
              </div>

              {/* #2–#5 — compact */}
              {compactRows.map((a, i) => {
                const themes = recThemes(a.rec)
                const conv = recConversations(a.rec)
                return (
                  <div key={a.rec.id} className="flex flex-col gap-[3px] border-t border-border/80 py-2">
                    <div className="flex items-start gap-2.5">
                      <span className="w-3.5 shrink-0 font-mono text-[12px] font-semibold leading-[1.3] text-[#9AA39A]">{i + 2}</span>
                      <PriorityDot priority={a.rec.priority} className="mt-[6px]" />
                      <span className="line-clamp-2 flex-1 text-[13px] font-semibold leading-[1.3]">{a.rec.title}</span>
                      {conv > 0 && <span className="shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground">{fmtInt(conv)} conv.</span>}
                    </div>
                    <div className="flex items-center gap-2 pl-[31px]">
                      <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">
                        {themes.length > 0 ? `Grounded in ${themes.map(prettyType).join(' · ')}` : prettyType(a.rec.type)}
                      </span>
                      <EvidenceChip tier={a.tier} />
                    </div>
                  </div>
                )
              })}
            </>
          ) : (
            <TileEmpty>Recommendations land with your next update.</TileEmpty>
          )}
        </Tile>

        {/* ── the short read: one 2×2 panel ──────────────────────────── */}
        <Tile col={7} row={2} eyebrow="The short read" meta={ciSummary ? `what the market is telling ${brand}` : undefined} bodyClassName="overflow-hidden">
          {ciSummary ? (
            <div className="-mx-3.5 -mb-3 grid flex-1 grid-cols-1 border-t border-border/80 sm:grid-cols-2">
              <Quadrant title="Unmet needs" items={quadrantBullets(ciSummary.top_unmet_needs)} color="text-clay" dot="bg-clay" className="sm:border-r border-b border-border/80" />
              <Quadrant title="Buying triggers" items={quadrantBullets(ciSummary.top_buying_triggers)} color="text-primary" dot="bg-primary" className="border-b border-border/80" />
              <Quadrant title="Who stands out" items={quadrantBullets(ciSummary.top_differentiators)} color="text-slate" dot="bg-slate" className="sm:border-r border-b border-border/80 sm:border-b-0" />
              <Quadrant title="Threats to watch" items={quadrantBullets(ciSummary.threats)} color="text-warning" dot="bg-warning" />
            </div>
          ) : (
            <TileEmpty>The short read lands with your next update.</TileEmpty>
          )}
        </Tile>

        {/* ── say vs hear: the claims ledger ─────────────────────────── */}
        <Tile col={7} row={2} eyebrow="What you say vs what they hear"
          meta={claims.length > 0 ? claimCountsLine(counts) : undefined}
          footer={claims.length > 0 ? <Link href={`${BASE}?detail=claims`} scroll={false}>All {claims.length} {plural(claims.length, 'claim')} →</Link> : undefined}
          footerNote={claims.length > 0 ? 'your claims from your own videos · their side from the tracked conversation' : undefined}
          bodyClassName="overflow-hidden gap-1"
        >
          {claims.length > 0 ? (
            <>
              <div className="grid grid-cols-[1fr_108px_1.3fr] gap-2.5 text-[10.5px] font-semibold uppercase tracking-[0.05em] text-[#7A847A]">
                <span>You say</span><span className="text-center">Verdict</span><span>They hear</span>
              </div>
              <div className="flex min-h-0 flex-col">
                {ledgerRows(claims, 4).map((e, i) => {
                  const v = claimVerdict(e.audience)
                  const themes = claimThemes(e)
                  return (
                    <div key={i} className="grid grid-cols-[1fr_108px_1.3fr] items-center gap-2.5 border-t border-border/70 py-[5px]">
                      <span className="line-clamp-2 text-[12px] font-semibold leading-[1.35]">{e.you_say}</span>
                      <span className="text-center"><Chip tone={v.tone} title={glossaryRule('say_vs_hear')}>{v.label}</Chip></span>
                      {e.they_say ? (
                        <span className="line-clamp-2 border-l-2 border-clay/70 pl-2 text-[12px] leading-[1.35] text-foreground/90">
                          {e.they_say}
                          {themes.length > 0 && <> <Link href={voiceHref(themes)} className="whitespace-nowrap text-[10.5px] font-medium text-primary">voices →</Link></>}
                        </span>
                      ) : (
                        <span className="line-clamp-2 text-[12px] leading-[1.35] text-muted-foreground">— nobody in the tracked conversation mentions this yet</span>
                      )}
                    </div>
                  )
                })}
              </div>
            </>
          ) : (
            <TileEmpty>Lands once your own videos have been analysed.</TileEmpty>
          )}
        </Tile>

        {/* ── key insights ───────────────────────────────────────────── */}
        <Tile col={4} row={2} eyebrow="Key insights"
          meta={insights.length > 0 ? (
            <span className="flex items-center gap-1">
              <Chip tone="positive" title={glossaryRule('strong_evidence')}>{tiers.confirmed} confirmed</Chip>
              {tiers.early > 0 && <Chip tone="warning" title={glossaryRule('early_signal')}>{tiers.early} early</Chip>}
            </span>
          ) : undefined}
          footer={insights.length > 0 ? <Link href={`${BASE}?detail=insights`} scroll={false}>All {insights.length} {plural(insights.length, 'finding')} →</Link> : undefined}
          footerNote={tiers.early > 0 ? `${tiers.early} early ${plural(tiers.early, 'signal')} in the drawer` : undefined}
          bodyClassName="overflow-hidden"
        >
          {keyInsights.length > 0 ? (
            <div className="flex flex-col divide-y divide-border/70">
              {keyInsights.map((mi) => {
                const conv = insightConversations(mi)
                return (
                  <div key={mi.id} className="flex flex-col gap-[2px] py-1.5 first:pt-0">
                    <span className="line-clamp-2 text-[13px] font-semibold leading-[1.3]">{mi.title}</span>
                    <span className="line-clamp-1 text-[11px] text-muted-foreground">
                      {truncateWords(mi.description, 110)}{conv > 0 ? ` · ${fmtInt(conv)} ${plural(conv, 'conversation')}` : ''}
                    </span>
                  </div>
                )
              })}
            </div>
          ) : insights.length > 0 ? (
            <TileEmpty>Nothing has strong enough evidence to headline yet — the early signals are one click deeper.</TileEmpty>
          ) : (
            <TileEmpty>Findings land with your next update.</TileEmpty>
          )}
        </Tile>

        {/* ── said about you ─────────────────────────────────────────── */}
        <Tile col={3} row={1} eyebrow="Said about you"
          footer={aboutYou.length > 0 ? <Link href={`${BASE}?detail=about`} scroll={false}>All {aboutYou.length} →</Link> : undefined}
          bodyClassName="overflow-hidden"
        >
          {aboutYou.length > 0 ? (
            <Quote text={aboutYou[0].quote} who={`${aboutYou[0].account}${aboutYou[0].platform ? ` · ${platformLabel(aboutYou[0].platform)}` : ''}`} />
          ) : (
            <TileEmpty>Nothing said about you in other people’s videos yet.</TileEmpty>
          )}
        </Tile>

        {/* ── in the news ────────────────────────────────────────────── */}
        <Tile col={3} row={1} eyebrow="In the news" meta={news.length > 0 ? `${fmtInt(newsTotal)} · context, not cause` : undefined}
          footer={newsTotal > 1 ? <Link href={`${BASE}?detail=news`} scroll={false}>{fmtInt(newsTotal - 1)} more →</Link> : undefined}
          bodyClassName="overflow-hidden"
        >
          {news.length > 0 ? (
            <div className="flex items-start gap-2">
              <Chip tone={newsRingChip(news[0].ring).tone} title={glossaryRule('news')}>{newsRingChip(news[0].ring).label}</Chip>
              <a href={news[0].url} target="_blank" rel="noopener noreferrer" className="line-clamp-2 text-[12px] leading-[1.35] hover:underline">{news[0].title}</a>
            </div>
          ) : (
            <TileEmpty>Nothing in the news this week.</TileEmpty>
          )}
        </Tile>
      </PageGrid>

      {/* ── drawers: one click deeper ────────────────────────────────── */}
      <DetailDrawer open={showRecs} closeHref={BASE} title="All recommendations" description={`${agenda.length} this update · ordered by evidence, the best-grounded first`}>
        <ol className="space-y-4">
          {agenda.map((a, i) => (
            <RecDrawerRow key={a.rec.id} item={a} index={i} themes={recThemes(a.rec)} conversations={recConversations(a.rec)} />
          ))}
        </ol>
      </DetailDrawer>

      <DetailDrawer open={showClaims} closeHref={BASE} title="What you say vs what they hear" description={claims.length > 0 ? claimCountsLine(counts) : undefined}>
        <div className="space-y-4">
          {claims.map((e, i) => {
            const v = claimVerdict(e.audience)
            return (
              <div key={i} className="space-y-2 border-t border-border/70 pt-3 first:border-t-0 first:pt-0">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-[13px] font-semibold leading-[1.35]">{e.you_say}</p>
                  <Chip tone={v.tone} title={glossaryRule('say_vs_hear')}>{v.label}</Chip>
                </div>
                <Quote text={e.your_quote} who="your own video" clamp={false} />
                {e.they_say ? (
                  <p className="text-[12.5px] text-foreground/90"><span className="font-medium">They hear:</span> {e.they_say}</p>
                ) : (
                  <p className="text-[12.5px] text-muted-foreground">— nobody in the tracked conversation mentions this yet</p>
                )}
                <p className="text-[12px] text-muted-foreground">{e.gap}</p>
                <ThemeChips themes={claimThemes(e)} />
              </div>
            )
          })}
        </div>
      </DetailDrawer>

      <DetailDrawer open={showInsights} closeHref={BASE} title="All findings" description={`${insights.length} this update · ${tiers.confirmed} confirmed · ${tiers.early} early · ${tiers.archive} below the bar`}>
        <div className="space-y-5">
          {confirmed.length > 0 && (
            <DrawerSection label="Confirmed">
              {confirmed.map((mi) => <InsightDrawerRow key={mi.id} mi={mi} tier="confirmed" themes={insightThemes(mi)} conversations={insightConversations(mi)} quote={keyQuotes.get(mi.id)?.[0]} />)}
            </DrawerSection>
          )}
          {earlyInsights.length > 0 && (
            <DrawerSection label="Early signals" hint="worth watching, not yet confirmed">
              {earlyInsights.map((mi) => <InsightDrawerRow key={mi.id} mi={mi} tier="early_signal" themes={insightThemes(mi)} conversations={insightConversations(mi)} />)}
            </DrawerSection>
          )}
          {singleSourceThemes.length > 0 && (
            <DrawerSection label="Heard once" hint="each in a single conversation so far">
              <div className="flex flex-wrap items-center gap-1">
                {singleSourceThemes.map((t, i) => (
                  <span key={i} title={t.description ?? undefined} className="rounded-full bg-muted px-2 py-px text-[10.5px] text-muted-foreground">{t.label}</span>
                ))}
                {singleSourceTotal > singleSourceThemes.length && <span className="text-[10.5px] text-muted-foreground">+{singleSourceTotal - singleSourceThemes.length} more</span>}
              </div>
            </DrawerSection>
          )}
          {archiveInsights.length > 0 && (
            <DrawerSection label="Everything else" hint="below the evidence bar this update">
              {archiveInsights.map((mi) => <InsightDrawerRow key={mi.id} mi={mi} tier="archive" themes={insightThemes(mi)} conversations={insightConversations(mi)} />)}
            </DrawerSection>
          )}
        </div>
      </DetailDrawer>

      <DetailDrawer open={showAbout} closeHref={BASE} title="Said about you" description={glossaryRule('about_you')}>
        <div className="space-y-4">
          {aboutYou.map((e, i) => (
            <div key={i} className="space-y-1.5 border-t border-border/70 pt-3 first:border-t-0 first:pt-0">
              <Quote text={e.quote} clamp={false} />
              <p className="text-[12px] text-muted-foreground">{e.claim}</p>
              <p className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                <span className="font-medium text-foreground/80">{e.account}</span>
                {e.platform && <span>{platformLabel(e.platform)}</span>}
                {e.url && <a href={e.url} target="_blank" rel="noopener noreferrer" className="font-medium text-primary">Watch →</a>}
              </p>
            </div>
          ))}
        </div>
      </DetailDrawer>

      <DetailDrawer open={showNews} closeHref={BASE} title="In the news" description="coverage of your brand, competitors and category — context beside the conversation, not a cause of anything measured">
        <div className="space-y-3">
          {news.map((n) => {
            const chip = newsRingChip(n.ring)
            return (
              <div key={n.url} className="flex items-start justify-between gap-3 border-t border-border/70 pt-2.5 first:border-t-0 first:pt-0">
                <div className="min-w-0">
                  <a href={n.url} target="_blank" rel="noopener noreferrer" className="text-[12.5px] font-medium leading-[1.35] hover:underline">{n.title}</a>
                  <div className="mt-0.5 text-[11px] text-muted-foreground">{n.source_ref}{n.published_at ? ` · ${shortDate(n.published_at)}` : ''}</div>
                </div>
                <Chip tone={chip.tone}>{chip.label}</Chip>
              </div>
            )
          })}
        </div>
      </DetailDrawer>
    </PageFrame>
  )
}

/** One quadrant of the short read — a hued eyebrow and two honest bullets. */
function Quadrant({ title, items, color, dot, className = '' }: { title: string; items: string[]; color: string; dot: string; className?: string }) {
  return (
    <div className={`flex min-h-0 flex-col gap-0.5 overflow-hidden px-3.5 py-1.5 ${className}`}>
      <span className={`text-[10.5px] font-semibold uppercase tracking-[0.07em] ${color}`}>{title}</span>
      {items.length > 0 ? items.map((it, i) => (
        <span key={i} className="flex items-start gap-1.5">
          <span className={`mt-[6px] size-1.5 shrink-0 rounded-full ${dot}`} aria-hidden />
          <span className="line-clamp-2 text-[11.5px] leading-[1.4] text-foreground/85">{it}</span>
        </span>
      )) : (
        <span className="text-[11.5px] text-muted-foreground">— nothing stood out here this update</span>
      )}
    </div>
  )
}

function DrawerSection({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <section className="space-y-2.5">
      <h3 className="text-[10.5px] font-semibold uppercase tracking-[0.07em] text-muted-foreground">
        {label}{hint && <span className="ml-1.5 font-normal normal-case tracking-normal opacity-80">· {hint}</span>}
      </h3>
      {children}
    </section>
  )
}

function RecDrawerRow({ item, index, themes, conversations }: { item: AgendaItem<Recommendation>; index: number; themes: string[]; conversations: number }) {
  const { rec, tier } = item
  return (
    <li className="flex gap-2.5 border-t border-border/70 pt-3 first:border-t-0 first:pt-0">
      <span className="w-4 shrink-0 font-mono text-[12px] font-semibold text-[#9AA39A]">{index + 1}</span>
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="flex flex-wrap items-center gap-1">
          <PriorityDot priority={rec.priority} />
          <PriorityChip word={priorityWord(index)} />
          <EvidenceChip tier={tier} />
          <Chip>{prettyType(rec.type)}</Chip>
        </div>
        <p className="text-[13px] font-semibold leading-[1.35]">{rec.title}</p>
        <p className="text-[12.5px] text-foreground/85">{rec.reasoning}</p>
        <p className="text-[11px] text-muted-foreground">
          {conversations > 0 ? `${fmtInt(conversations)} ${plural(conversations, 'conversation')} behind this` : 'Grounded in its supporting insights'}
          {themes.length > 0 && <> · <Link href={voiceHref(themes)} className="font-medium text-primary">See the voices →</Link></>}
        </p>
        <ThemeChips themes={themes} />
      </div>
    </li>
  )
}

function InsightDrawerRow({ mi, tier, themes, conversations, quote }: { mi: MarketInsight; tier: GateTier; themes: string[]; conversations: number; quote?: string }) {
  return (
    <div className="space-y-1.5 border-t border-border/70 pt-2.5 first:border-t-0 first:pt-0">
      <div className="flex items-start justify-between gap-2">
        <p className="text-[13px] font-semibold leading-[1.35]">{mi.title}</p>
        <EvidenceChip tier={tier} />
      </div>
      <p className="text-[12.5px] text-foreground/85">{mi.description}</p>
      {quote && <Quote text={quote} clamp={false} />}
      <p className="text-[11px] text-muted-foreground">
        <span className="capitalize">{prettyType(mi.insight_type)}</span>
        {conversations > 0 && <> · {fmtInt(conversations)} {plural(conversations, 'conversation')} grounding this</>}
        {themes.length > 0 && <> · <Link href={voiceHref(themes)} className="font-medium text-primary">See supporting voices →</Link></>}
      </p>
      <ThemeChips themes={themes} />
    </div>
  )
}
