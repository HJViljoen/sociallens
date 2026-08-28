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
  insightTiers, confirmedCompetitiveIds, orderAgenda, distinctVideos,
  claimVerdict, claimCounts, claimCountsLine, ledgerRows, tierCounts, newsRingChip,
  type ClaimTone,
} from '@/lib/market-tiles'
import { PageFrame, PageBar, BarPill } from '@/components/shell/page-grid'
import { MasterDetail } from '@/components/shell/master-detail'
import { PaneHeader, PaneBody, RailGroup, RailLink, Segmented, ListRows, ListRow, PaneEmpty, DetailHeader, DetailSection, Verbatim } from '@/components/shell/master-list'
import { ListSearch } from '@/components/shell/list-search'

// Market Intelligence — "What should we do?", as a page inside the page
// (component-map §2, 2026-08-28): a rail of what this update produced, with
// counts · a searchable, filterable list · the selected item in full. The
// selection is in the URL (?group=&item=), so the page stays a server
// component and every deep link (the Dashboard's ?rec=, the weekly email)
// lands on an open item. Scores gate and order but are never shown as numbers
// — evidence words from lib/curation replace them. Same auth/run-anchor
// pattern as the dashboard (latest COMPLETED update).

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

type Group = 'recs' | 'insights' | 'claims' | 'about' | 'news' | 'read'
type Filter = 'all' | 'strong' | 'early'

const GROUPS: Group[] = ['recs', 'insights', 'claims', 'about', 'news', 'read']
const isGroup = (s: string | undefined): s is Group => !!s && (GROUPS as string[]).includes(s)
const isFilter = (s: string | undefined): s is Filter => s === 'all' || s === 'strong' || s === 'early'

/** Single-source theme pills shown in the findings section before "+N more". */
const SINGLE_SOURCE_SHOWN = 12
/** News headlines kept (rings 0–2). */
const NEWS_SHOWN = 30

const BASE = '/dashboard/market'
const prettyType = (s: string) => s.replace(/_/g, ' ')
const plural = (n: number, one: string, many = `${one}s`) => (n === 1 ? one : many)
const LEGEND_ITEMS: GlossaryKey[] = ['conversations', 'say_vs_hear', 'about_you', 'news', 'act_now', 'plan_next', 'worth_considering', 'strong_evidence', 'early_signal']

const href = (group: Group, item?: string | null, filter?: Filter) => {
  const q = new URLSearchParams({ group })
  if (filter && filter !== 'all') q.set('f', filter)
  if (item) q.set('item', item)
  return `${BASE}?${q.toString()}`
}

// ── small page-local primitives (full class strings — Tailwind v4 scans them) ──

const TONE: Record<ClaimTone | 'warning', string> = {
  positive: 'bg-accent text-accent-foreground',
  clay: 'bg-negative/12 text-negative',
  sand: 'bg-inner text-muted-foreground',
  warning: 'bg-warning/15 text-warning',
}

function Chip({ tone = 'sand', title, children }: { tone?: ClaimTone | 'warning'; title?: string; children: ReactNode }) {
  return <span title={title} className={`inline-flex shrink-0 items-center whitespace-nowrap rounded-full px-2 py-px text-[10.5px] font-medium ${TONE[tone]}`}>{children}</span>
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

const voiceHref = (themes: string[]) => `/dashboard/voice?themes=${encodeURIComponent(themes.join(','))}#grounding`

function ThemeChips({ themes }: { themes: string[] }) {
  if (themes.length === 0) return null
  return (
    <div className="flex flex-wrap gap-1">
      {themes.map((t) => (
        <Link key={t} href={`/dashboard/voice?themes=${encodeURIComponent(t)}`} className="rounded-full bg-inner px-2 py-px text-[10.5px] text-muted-foreground transition-colors hover:text-foreground">
          {prettyType(t)}
        </Link>
      ))}
    </div>
  )
}

const QUADRANTS: { key: keyof CiSummary; title: string; dot: string }[] = [
  { key: 'top_unmet_needs', title: 'Unmet needs', dot: 'bg-comp' },
  { key: 'top_buying_triggers', title: 'Buying triggers', dot: 'bg-you' },
  { key: 'top_differentiators', title: 'Who stands out', dot: 'bg-cat' },
  { key: 'threats', title: 'Threats to watch', dot: 'bg-warning' },
]
const quadrantItems = (ci: CiSummary | null, key: keyof CiSummary): string[] =>
  (((ci?.[key] ?? []) as unknown as string[]) || []).filter((s) => typeof s === 'string' && s.trim().length > 0)

export default async function MarketIntelligencePage({ searchParams }: { searchParams?: Promise<{ detail?: string; rec?: string; group?: string; item?: string; f?: string }> }) {
  const sp = (await searchParams) ?? {}
  const showLegend = sp.detail === 'legend'
  // Auth + tenant via the RLS-enforced session client. See lib/auth.ts.
  const { supabase, clientId } = await getSessionContext()

  // Latest COMPLETED update — an in-flight one has no synthesis rows yet, so
  // the page keeps serving the previous read until the new one closes.
  const [{ data: client }, { data: latestRun }, newsRes] = await Promise.all([
    supabase.from('clients').select('company_name').eq('id', clientId).maybeSingle(),
    supabase.from('pipeline_runs').select('id, started_at')
      .eq('client_id', clientId).in('status', ['completed', 'partial'])
      .order('started_at', { ascending: false }).limit(1).maybeSingle(),
    // In the news — rings 0–2 only (brand / competitors / category), newest
    // first: context beside the conversation, never a claimed cause. Keyed on
    // the client, not the run, so it rides this first wave.
    supabase.from('news_items')
      .select('title, url, source_ref, published_at, ring', { count: 'exact' })
      .eq('client_id', clientId).lte('ring', 2)
      .order('published_at', { ascending: false, nullsFirst: false })
      .limit(NEWS_SHOWN),
  ])
  const brand = client?.company_name ?? 'Your brand'

  if (!latestRun) {
    return (
      <PageFrame>
        <PageBar title="Market Intelligence" context={`What should we do? · ${brand}`}>
          <HowToRead items={LEGEND_ITEMS} open={showLegend} basePath={BASE} />
        </PageBar>
        <section className="rounded-lg bg-tile p-6 shadow-tile">
          <p className="text-[12px] text-muted-foreground">Your market intelligence lands with your first update — check back then.</p>
        </section>
      </PageFrame>
    )
  }
  const runId = latestRun.id as string

  const [miRes, recRes, ciRes, summaryRes, ssRes, bucketRes] = await Promise.all([
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
    // insights — "Early signal" is a calibrated term, not a catch-all.
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
  const sayVsHear = ((summaryRes.data?.say_vs_hear ?? null) as SayVsHearEntry[] | null) ?? null
  const brandVoice = (summaryRes.data?.brand_voice ?? null) as BrandVoiceSnapshot | null
  const aboutYou = brandVoice?.about ?? []
  const singleSourceThemes = (ssRes.data ?? []) as SingleSourceTheme[]
  const singleSourceTotal = ssRes.count ?? singleSourceThemes.length
  const news = (newsRes.data ?? []) as NewsRow[]
  const newsTotal = newsRes.count ?? news.length
  const runDate = (summaryRes.data?.run_date as string | undefined) ?? (latestRun.started_at as string)

  const miById = new Map(insights.map((mi) => [mi.id, mi]))
  const competitiveById = new Map(competitive.map((c) => [c.id, c]))
  // Slugs + source videos for the ids THIS update cites — read by id from the
  // base table (fetchInsightsByIds), not the current view (incremental Pass A).
  const citedIds = new Set<string>()
  for (const mi of insights) for (const id of mi.evidence?.supporting_theme_ids ?? []) citedIds.add(id)
  for (const t of (bucketRes.data ?? []) as ThemeBucketRow[]) for (const id of t.supporting_insight_ids ?? []) citedIds.add(id)
  const audienceRows = await fetchInsightsByIds<{ id: string; theme: string; source_video_id: string | null; platform: string | null }>(
    supabase, [...citedIds], 'id, theme, source_video_id, platform',
  )
  const themeSlugById = new Map(audienceRows.map((a) => [a.id, a.theme]))
  const videoByInsight = new Map(audienceRows.map((a) => [a.id, a.source_video_id]))
  const platformById = new Map(audienceRows.map((a) => [a.id, a.platform]))

  // ── curation gate over the insights (already in opportunity order) ──────
  const tierById = insightTiers(insights)
  const tiers = tierCounts(tierById)
  const slugsOf = (ids: Iterable<string>): string[] => {
    const slugs = new Set<string>()
    for (const id of ids) { const s = themeSlugById.get(id); if (s) slugs.add(s) }
    return [...slugs].slice(0, 4)
  }
  const insightIds = (mi: MarketInsight) => mi.evidence?.supporting_theme_ids ?? []

  // ── recommendations: the agenda, ordered by evidence ────────────────────
  const agenda = orderAgenda(recommendations, tierById, confirmedCompetitiveIds(competitive))
  function recSupportIds(rec: Recommendation): string[] {
    const ids: string[] = []
    for (const id of rec.based_on?.insight_ids ?? []) {
      ids.push(...(miById.get(id)?.evidence?.supporting_theme_ids ?? []))
      ids.push(...(competitiveById.get(id)?.evidence?.supporting_theme_ids ?? []))
    }
    return ids
  }
  const bucketById = bucketByAudienceId((bucketRes.data ?? []) as ThemeBucketRow[])
  const recVoiceIds = (rec: Recommendation) => scopeToClientVoices(recSupportIds(rec), bucketById)
  const insightVoiceIds = (mi: MarketInsight) => scopeToClientVoices(insightIds(mi), bucketById)

  // ── say vs hear ─────────────────────────────────────────────────────────
  const claims = ledgerRows(sayVsHear ?? [], Number.MAX_SAFE_INTEGER)
  const counts = claimCounts(claims)

  // ── selection: ?group= & ?item= (with ?rec= from the Dashboard/email) ───
  const filter: Filter = isFilter(sp.f) ? sp.f : 'all'
  // Old drawer links (?detail=recs|claims|insights|about|news) land on their group.
  const legacy = sp.detail && isGroup(sp.detail) ? sp.detail : null
  const group: Group = isGroup(sp.group) ? sp.group : legacy ?? 'recs'
  const tierPass = (tier: GateTier) => filter === 'all' || (filter === 'strong' && tier === 'confirmed') || (filter === 'early' && tier === 'early_signal')
  const agendaShown = agenda.filter((a) => tierPass(a.tier))
  const insightsShown = insights.filter((mi) => tierPass(tierById.get(mi.id) ?? 'archive'))
  const listIds: string[] = (
    group === 'recs' ? agendaShown.map((a) => a.rec.id)
    : group === 'insights' ? insightsShown.map((mi) => mi.id)
    : group === 'claims' ? claims.map((_, i) => `c${i}`)
    : group === 'about' ? aboutYou.map((_, i) => `a${i}`)
    : group === 'news' ? news.map((_, i) => `n${i}`)
    : QUADRANTS.map((q) => q.key as string)
  )
  const requested = sp.item ?? (group === 'recs' ? sp.rec : undefined)
  const itemId = requested && listIds.includes(requested) ? requested : (listIds[0] ?? null)

  // ── verbatim quotes for the selected item only (shared lib/quotes) ──────
  let quotes: string[] = []
  let voices = 0
  let platforms: { label: string; count: number }[] = []
  const selectedRec = group === 'recs' ? agenda.find((a) => a.rec.id === itemId) ?? null : null
  const selectedInsight = group === 'insights' ? miById.get(itemId ?? '') ?? null : null
  const spec = selectedRec
    ? { ids: recVoiceIds(selectedRec.rec), claim: `${selectedRec.rec.title} ${selectedRec.rec.reasoning}`, hero: selectedRec.rec.hero_quote }
    : selectedInsight
      ? { ids: insightVoiceIds(selectedInsight), claim: `${selectedInsight.title} ${selectedInsight.description}`, hero: selectedInsight.hero_quote }
      : null
  if (spec) {
    voices = spec.ids.length
    const byPlatform = new Map<string, number>()
    for (const id of spec.ids) { const pl = platformById.get(id) ?? 'other'; byPlatform.set(pl, (byPlatform.get(pl) ?? 0) + 1) }
    platforms = [...byPlatform.entries()].sort((a, b) => b[1] - a[1]).map(([pl, count]) => ({ label: pl === 'other' ? 'Other' : platformLabel(pl), count }))
    const pool = rankByTheme(spec.ids, spec.claim, themeSlugById).slice(0, 120)
    const quotesByAudience = await fetchQuotesByAudience(supabase, pool)
    const pick = createQuotePicker(quotesByAudience, themeSlugById)
    quotes = pick(spec.ids, 3, spec.claim, spec.hero)
  }

  const context = `What should we do? · ${brand} · ${weekdayDate(runDate)}`

  // ── rail ────────────────────────────────────────────────────────────────
  const rail = (
    <>
      <PaneHeader title="This update" meta={weekdayDate(runDate)} />
      <PaneBody>
        <RailGroup label="Decide">
          <RailLink href={href('recs')} active={group === 'recs'} count={agenda.length}>Recommendations</RailLink>
          <RailLink href={href('insights')} active={group === 'insights'} count={insights.length}>Key insights</RailLink>
          <RailLink href={href('read')} active={group === 'read'} count={ciSummary ? 4 : 0}>The short read</RailLink>
        </RailGroup>
        <RailGroup label="Your brand">
          <RailLink href={href('claims')} active={group === 'claims'} count={claims.length}>Say vs hear</RailLink>
          <RailLink href={href('about')} active={group === 'about'} count={aboutYou.length}>Said about you</RailLink>
        </RailGroup>
        <RailGroup label="Context">
          <RailLink href={href('news')} active={group === 'news'} count={newsTotal}>In the news</RailLink>
        </RailGroup>
      </PaneBody>
    </>
  )

  // ── list ────────────────────────────────────────────────────────────────
  const LIST_ID = 'market-list'
  const listTitle: Record<Group, string> = { recs: 'Recommendations', insights: 'Key insights', claims: 'What you say vs what they hear', about: 'Said about you', news: 'In the news', read: 'The short read' }
  const listMeta: Record<Group, string | undefined> = {
    recs: agenda.length > 0 ? `${agenda.length} ${plural(agenda.length, 'recommendation')} · ordered by evidence` : undefined,
    insights: insights.length > 0 ? `${tiers.confirmed} confirmed · ${tiers.early} early · ${tiers.archive} below the bar` : undefined,
    claims: claims.length > 0 ? claimCountsLine(counts) : undefined,
    about: aboutYou.length > 0 ? `${aboutYou.length} ${plural(aboutYou.length, 'mention')} in other people’s videos` : undefined,
    news: newsTotal > 0 ? `${fmtInt(newsTotal)} ${plural(newsTotal, 'headline')}` : undefined,
    read: undefined,
  }
  const tierFilter = (group === 'recs' || group === 'insights') ? (
    <Segmented items={[
      { href: href(group, undefined, 'all'), label: 'All', active: filter === 'all' },
      { href: href(group, undefined, 'strong'), label: 'Strong evidence', active: filter === 'strong', count: group === 'recs' ? agenda.filter((a) => a.tier === 'confirmed').length : tiers.confirmed },
      { href: href(group, undefined, 'early'), label: 'Early signal', active: filter === 'early', count: group === 'recs' ? agenda.filter((a) => a.tier === 'early_signal').length : tiers.early },
    ]} />
  ) : null

  const list = (
    <>
      <PaneHeader title={listTitle[group]} meta={listMeta[group]}>
        {listIds.length > 3 && <ListSearch scope={LIST_ID} placeholder={`Search ${listTitle[group].toLowerCase()}…`} />}
        {tierFilter}
      </PaneHeader>
      <PaneBody>
        <div id={LIST_ID}>
          {group === 'recs' && (agendaShown.length > 0 ? (
            <ListRows>
              {agendaShown.map((a, i) => {
                const conv = distinctVideos(recSupportIds(a.rec), videoByInsight)
                const idx = agenda.findIndex((x) => x.rec.id === a.rec.id)
                return (
                  <ListRow key={a.rec.id} href={href('recs', a.rec.id, filter)} active={a.rec.id === itemId} search={`${a.rec.title} ${a.rec.reasoning} ${prettyType(a.rec.type)}`}>
                    <div className="flex items-start gap-2.5">
                      <span className="w-4 shrink-0 font-mono text-[12px] font-semibold tabular-nums text-muted-foreground">{idx + 1}</span>
                      <div className="min-w-0 flex-1">
                        <p className="line-clamp-2 text-[13px] font-semibold leading-[1.3]">{a.rec.title}</p>
                        <p className="mt-0.5 line-clamp-1 text-[11.5px] text-muted-foreground">{a.rec.reasoning}</p>
                        <div className="mt-1.5 flex flex-wrap items-center gap-1">
                          <PriorityChip word={priorityWord(idx)} />
                          <EvidenceChip tier={a.tier} />
                          {conv > 0 && <span className="font-mono text-[10.5px] tabular-nums text-muted-foreground">{fmtInt(conv)} conv.</span>}
                        </div>
                      </div>
                    </div>
                  </ListRow>
                )
              })}
            </ListRows>
          ) : <PaneEmpty>{agenda.length > 0 ? 'Nothing at this evidence level.' : 'Recommendations land with your next update.'}</PaneEmpty>)}

          {group === 'insights' && (insightsShown.length > 0 ? (
            <ListRows>
              {insightsShown.map((mi) => {
                const conv = distinctVideos(insightIds(mi), videoByInsight)
                return (
                  <ListRow key={mi.id} href={href('insights', mi.id, filter)} active={mi.id === itemId} search={`${mi.title} ${mi.description} ${prettyType(mi.insight_type)}`}>
                    <p className="line-clamp-2 text-[13px] font-semibold leading-[1.3]">{mi.title}</p>
                    <p className="mt-0.5 line-clamp-1 text-[11.5px] text-muted-foreground">{mi.description}</p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-1">
                      <EvidenceChip tier={tierById.get(mi.id) ?? 'archive'} />
                      <span className="text-[10.5px] capitalize text-muted-foreground">{prettyType(mi.insight_type)}</span>
                      {conv > 0 && <span className="font-mono text-[10.5px] tabular-nums text-muted-foreground">· {fmtInt(conv)} conv.</span>}
                    </div>
                  </ListRow>
                )
              })}
            </ListRows>
          ) : <PaneEmpty>{insights.length > 0 ? 'Nothing at this evidence level.' : 'Findings land with your next update.'}</PaneEmpty>)}

          {group === 'claims' && (claims.length > 0 ? (
            <ListRows>
              {claims.map((e, i) => {
                const v = claimVerdict(e.audience)
                return (
                  <ListRow key={i} href={href('claims', `c${i}`)} active={`c${i}` === itemId} search={`${e.you_say} ${e.your_quote} ${e.they_say ?? ''} ${e.gap}`}>
                    <div className="flex items-start justify-between gap-2">
                      <p className="line-clamp-2 text-[13px] font-semibold leading-[1.3]">{e.you_say}</p>
                      <Chip tone={v.tone} title={glossaryRule('say_vs_hear')}>{v.label}</Chip>
                    </div>
                    <p className="mt-0.5 line-clamp-1 text-[11.5px] text-muted-foreground">{e.they_say ?? 'nobody in the tracked conversation mentions this yet'}</p>
                  </ListRow>
                )
              })}
            </ListRows>
          ) : <PaneEmpty>Lands once your own videos have been analysed.</PaneEmpty>)}

          {group === 'about' && (aboutYou.length > 0 ? (
            <ListRows>
              {aboutYou.map((e, i) => (
                <ListRow key={i} href={href('about', `a${i}`)} active={`a${i}` === itemId} search={`${e.quote} ${e.claim} ${e.account}`}>
                  <p className="line-clamp-2 font-serif text-[13px] leading-[1.4]">“{e.quote}”</p>
                  <p className="mt-1 font-mono text-[10.5px] text-muted-foreground">{e.account}{e.platform ? ` · ${platformLabel(e.platform)}` : ''}</p>
                </ListRow>
              ))}
            </ListRows>
          ) : <PaneEmpty>Nothing said about you in other people’s videos yet.</PaneEmpty>)}

          {group === 'news' && (news.length > 0 ? (
            <ListRows>
              {news.map((n, i) => {
                const chip = newsRingChip(n.ring)
                return (
                  <ListRow key={i} href={href('news', `n${i}`)} active={`n${i}` === itemId} search={`${n.title} ${n.source_ref}`}>
                    <div className="flex items-start justify-between gap-2">
                      <p className="line-clamp-2 text-[12.5px] font-medium leading-[1.35]">{n.title}</p>
                      <Chip tone={chip.tone} title={glossaryRule('news')}>{chip.label}</Chip>
                    </div>
                    <p className="mt-0.5 font-mono text-[10.5px] text-muted-foreground">{n.source_ref}{n.published_at ? ` · ${shortDate(n.published_at)}` : ''}</p>
                  </ListRow>
                )
              })}
            </ListRows>
          ) : <PaneEmpty>Nothing in the news this week.</PaneEmpty>)}

          {group === 'read' && (ciSummary ? (
            <ListRows>
              {QUADRANTS.map((q) => {
                const items = quadrantItems(ciSummary, q.key)
                return (
                  <ListRow key={q.key} href={href('read', q.key as string)} active={q.key === itemId} search={`${q.title} ${items.join(' ')}`}>
                    <p className="flex items-center gap-1.5 text-[13px] font-semibold"><span className={`size-1.5 rounded-full ${q.dot}`} aria-hidden />{q.title}</p>
                    <p className="mt-0.5 line-clamp-1 text-[11.5px] text-muted-foreground">{items[0] ?? '— nothing stood out here this update'}</p>
                  </ListRow>
                )
              })}
            </ListRows>
          ) : <PaneEmpty>The short read lands with your next update.</PaneEmpty>)}
        </div>
      </PaneBody>
    </>
  )

  // ── detail ──────────────────────────────────────────────────────────────
  let detail: ReactNode = <PaneEmpty>Select an item to read it in full.</PaneEmpty>

  if (group === 'recs' && selectedRec) {
    const { rec, tier } = selectedRec
    const idx = agenda.findIndex((x) => x.rec.id === rec.id)
    const conv = distinctVideos(recSupportIds(rec), videoByInsight)
    const themes = slugsOf(recSupportIds(rec))
    detail = (
      <>
        <DetailHeader eyebrow={`Recommendation ${idx + 1} of ${agenda.length}`} title={rec.title}>
          <div className="mt-2 flex flex-wrap items-center gap-1">
            <PriorityChip word={priorityWord(idx)} />
            <EvidenceChip tier={tier} />
            <Chip>{prettyType(rec.type)}</Chip>
          </div>
        </DetailHeader>
        <PaneBody>
          <DetailSection label="Why">
            <p className="text-[13px] leading-[1.55] text-foreground">{rec.reasoning}</p>
          </DetailSection>
          <DetailSection label="Grounded in">
            <p className="text-[12.5px] text-secondary-foreground">
              {conv > 0 ? <><span className="font-mono font-semibold text-foreground">{fmtInt(conv)}</span> {plural(conv, 'conversation')}</> : 'its supporting insights'}
              {voices > 0 && <> · <span className="font-mono font-semibold text-foreground">{fmtInt(voices)}</span> {plural(voices, 'voice')}</>}
            </p>
            {platforms.length > 0 && (
              <p className="mt-1 flex flex-wrap gap-x-3 font-mono text-[10.5px] tabular-nums text-muted-foreground">
                {platforms.map((p) => <span key={p.label}>{p.label} {p.count}</span>)}
              </p>
            )}
            <div className="mt-2"><ThemeChips themes={themes} /></div>
          </DetailSection>
          {quotes.length > 0 && (
            <DetailSection label="In their words">
              <div className="flex flex-col gap-2.5">{quotes.map((q, i) => <Verbatim key={i} quote={q} />)}</div>
            </DetailSection>
          )}
          {themes.length > 0 && (
            <DetailSection>
              <Link href={voiceHref(themes)} className="text-[12.5px] font-medium hover:underline">See all the voices in Voice of Customer →</Link>
            </DetailSection>
          )}
        </PaneBody>
      </>
    )
  }

  if (group === 'insights' && selectedInsight) {
    const mi = selectedInsight
    const tier = tierById.get(mi.id) ?? 'archive'
    const conv = distinctVideos(insightIds(mi), videoByInsight)
    const themes = slugsOf(insightIds(mi))
    detail = (
      <>
        <DetailHeader eyebrow={prettyType(mi.insight_type)} title={mi.title}>
          <div className="mt-2 flex flex-wrap items-center gap-1"><EvidenceChip tier={tier} />{tier === 'archive' && <Chip>Below the evidence bar this update</Chip>}</div>
        </DetailHeader>
        <PaneBody>
          <DetailSection label="What we heard">
            <p className="text-[13px] leading-[1.55] text-foreground">{mi.description}</p>
          </DetailSection>
          <DetailSection label="Grounded in">
            <p className="text-[12.5px] text-secondary-foreground">
              {conv > 0 ? <><span className="font-mono font-semibold text-foreground">{fmtInt(conv)}</span> {plural(conv, 'conversation')}</> : 'its supporting themes'}
              {voices > 0 && <> · <span className="font-mono font-semibold text-foreground">{fmtInt(voices)}</span> {plural(voices, 'voice')}</>}
            </p>
            {platforms.length > 0 && (
              <p className="mt-1 flex flex-wrap gap-x-3 font-mono text-[10.5px] tabular-nums text-muted-foreground">
                {platforms.map((p) => <span key={p.label}>{p.label} {p.count}</span>)}
              </p>
            )}
            <div className="mt-2"><ThemeChips themes={themes} /></div>
          </DetailSection>
          {quotes.length > 0 && (
            <DetailSection label="In their words">
              <div className="flex flex-col gap-2.5">{quotes.map((q, i) => <Verbatim key={i} quote={q} />)}</div>
            </DetailSection>
          )}
          {themes.length > 0 && (
            <DetailSection>
              <Link href={voiceHref(themes)} className="text-[12.5px] font-medium hover:underline">See supporting voices in Voice of Customer →</Link>
            </DetailSection>
          )}
          {singleSourceThemes.length > 0 && filter !== 'strong' && (
            <DetailSection label="Heard once this update">
              <div className="flex flex-wrap items-center gap-1">
                {singleSourceThemes.map((t, i) => (
                  <span key={i} title={t.description ?? undefined} className="rounded-full bg-inner px-2 py-px text-[10.5px] text-muted-foreground">{t.label}</span>
                ))}
                {singleSourceTotal > singleSourceThemes.length && <span className="text-[10.5px] text-muted-foreground">+{singleSourceTotal - singleSourceThemes.length} more</span>}
              </div>
            </DetailSection>
          )}
        </PaneBody>
      </>
    )
  }

  if (group === 'claims' && itemId) {
    const i = Number(itemId.slice(1))
    const e = claims[i]
    if (e) {
      const v = claimVerdict(e.audience)
      const themes = slugsOf(e.supporting_theme_ids ?? [])
      detail = (
        <>
          <DetailHeader eyebrow="You say" title={e.you_say}>
            <div className="mt-2"><Chip tone={v.tone} title={glossaryRule('say_vs_hear')}>{v.label}</Chip></div>
          </DetailHeader>
          <PaneBody>
            <DetailSection label="In your own video">
              <Verbatim quote={e.your_quote} cite="your own video" />
            </DetailSection>
            <DetailSection label="They hear">
              {e.they_say ? <p className="text-[13px] leading-[1.55]">{e.they_say}</p> : <p className="text-[13px] text-muted-foreground">— nobody in the tracked conversation mentions this yet</p>}
            </DetailSection>
            <DetailSection label="The gap">
              <p className="text-[12.5px] leading-[1.5] text-secondary-foreground">{e.gap}</p>
              <div className="mt-2"><ThemeChips themes={themes} /></div>
              {themes.length > 0 && <Link href={voiceHref(themes)} className="mt-2 inline-block text-[12.5px] font-medium hover:underline">See the voices →</Link>}
            </DetailSection>
          </PaneBody>
        </>
      )
    }
  }

  if (group === 'about' && itemId) {
    const e = aboutYou[Number(itemId.slice(1))]
    if (e) {
      detail = (
        <>
          <DetailHeader eyebrow="Said about you" title={e.claim} meta={`${e.account}${e.platform ? ` · ${platformLabel(e.platform)}` : ''}`} />
          <PaneBody>
            <DetailSection label="In their words">
              <Verbatim quote={e.quote} cite={e.account} />
            </DetailSection>
            {e.url && (
              <DetailSection>
                <a href={e.url} target="_blank" rel="noopener noreferrer" className="text-[12.5px] font-medium hover:underline">Watch the video →</a>
              </DetailSection>
            )}
          </PaneBody>
        </>
      )
    }
  }

  if (group === 'news' && itemId) {
    const n = news[Number(itemId.slice(1))]
    if (n) {
      const chip = newsRingChip(n.ring)
      detail = (
        <>
          <DetailHeader eyebrow={chip.label} title={n.title} meta={`${n.source_ref}${n.published_at ? ` · ${shortDate(n.published_at)}` : ''}`} />
          <PaneBody>
            <DetailSection>
              <p className="text-[12.5px] leading-[1.5] text-secondary-foreground">Coverage of your brand, competitors and category — context beside the conversation, not a cause of anything measured.</p>
              <a href={n.url} target="_blank" rel="noopener noreferrer" className="mt-3 inline-block text-[12.5px] font-medium hover:underline">Read the article →</a>
            </DetailSection>
          </PaneBody>
        </>
      )
    }
  }

  if (group === 'read' && itemId && ciSummary) {
    const q = QUADRANTS.find((x) => x.key === itemId)
    if (q) {
      const items = quadrantItems(ciSummary, q.key)
      detail = (
        <>
          <DetailHeader eyebrow="The short read" title={q.title} meta={weekdayDate(runDate)} />
          <PaneBody>
            <DetailSection>
              {items.length > 0 ? (
                <ul className="flex flex-col gap-2.5">
                  {items.map((it, i) => (
                    <li key={i} className="flex items-start gap-2.5 text-[13px] leading-[1.5]">
                      <span className={`mt-[7px] size-1.5 shrink-0 rounded-full ${q.dot}`} aria-hidden />
                      <span>{it}</span>
                    </li>
                  ))}
                </ul>
              ) : <p className="text-[12.5px] text-muted-foreground">— nothing stood out here this update</p>}
            </DetailSection>
          </PaneBody>
        </>
      )
    }
  }

  return (
    <PageFrame className="min-h-0 flex-1">
      <PageBar title="Market Intelligence" context={context}>
        <BarPill active>This update</BarPill>
        <HowToRead items={LEGEND_ITEMS} open={showLegend} basePath={BASE} />
      </PageBar>
      <MasterDetail id="market" rail={rail} list={list} detail={detail} />
    </PageFrame>
  )
}
