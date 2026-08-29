import type { SupabaseClient } from '@supabase/supabase-js'
import { CURATION_GATE, type GateTier } from '../curation'
import { type GlossaryKey } from '../calibration'
import { rankByTheme, fetchQuotesByAudience, fetchInsightsByIds, createCitedQuotePicker, bucketByAudienceId, scopeToClientVoices, cleanQuote, type ThemeBucketRow, type CitedQuote } from '../quotes'
import { quoteRef, type HeroTable } from '../renderables/quotes-freeze'
import type { Quote, Scope } from '../renderables/types'
import type { CiSummary, SayVsHearEntry } from '../pipeline/schemas'
import type { BrandVoiceSnapshot } from '../pipeline/claims'
import { weekdayDate, platformLabel } from '../format'
import {
  insightTiers, confirmedCompetitiveIds, orderAgenda, distinctVideos, claimCounts, ledgerRows, tierCounts,
  type AgendaItem,
} from '../market-tiles'
import type { MethodNoteData } from '../../components/print/method-note'
import { EXPORT_FULL_MAX_ITEMS } from '../config'

// Market Intelligence loader — the data half of the old app/dashboard/market/
// page.tsx (split 2026-08-29, Reports & Exports T5). "What should we do?": a
// rail of what this update produced, a searchable/filterable list, the
// selected item in full. Selection lives in the URL (?group=&item=, with the
// legacy ?detail=<group> and ?rec=<id> aliases), so a deep link — the
// Dashboard's ?rec=, the weekly email — always lands on an open item.
//
// Rules kept: scores gate and order but are never shown as numbers (evidence
// words from lib/curation replace them); the quote fetch for the selected
// item (wave 4) is selection-dependent and cannot join the earlier waves;
// client-facing claims (recs/insights) quote client + category-audience
// voices only (lib/quotes scopeToClientVoices).

export type Group = 'recs' | 'insights' | 'claims' | 'about'
export type Filter = 'all' | 'strong' | 'early'
export type MarketParams = { detail?: string; rec?: string; group?: string; item?: string; f?: string }

const GROUPS: Group[] = ['recs', 'insights', 'claims', 'about']
const isGroup = (s: string | undefined): s is Group => !!s && (GROUPS as string[]).includes(s)
const isFilter = (s: string | undefined): s is Filter => s === 'all' || s === 'strong' || s === 'early'

/** Single-source theme pills shown in the findings section before "+N more". */
const SINGLE_SOURCE_SHOWN = 12
/** News headlines kept (rings 0–2). */
const NEWS_SHOWN = 30
/** Audience-insight ids ranked and capped before a quote fetch — cost control,
 *  not a PostgREST limit (fetchQuotesByAudience chunks on its own). */
const QUOTE_POOL_CAP = 120

export const LEGEND_ITEMS: GlossaryKey[] = ['conversations', 'say_vs_hear', 'about_you', 'news', 'act_now', 'plan_next', 'worth_considering', 'strong_evidence', 'early_signal']

/** Hrefs that preserve group/item/filter. Pure — the renderers build every
 *  link with it. */
export function marketHref(group: Group, item?: string | null, filter?: Filter): string {
  const q = new URLSearchParams({ group })
  if (filter && filter !== 'all') q.set('f', filter)
  if (item) q.set('item', item)
  return `/dashboard/market?${q.toString()}`
}

/** Group + filter from the URL, with the legacy ?detail=<group> mapping (old
 *  drawer links land on their rail group). Item resolution needs the group's
 *  list ids, so it stays in the loader (below), which also honours the
 *  legacy ?rec= alias for the recs group. */
export function parseMarketSelection(sp: MarketParams): { group: Group; filter: Filter } {
  const legacy = sp.detail && isGroup(sp.detail) ? sp.detail : null
  const group: Group = isGroup(sp.group) ? sp.group : legacy ?? 'recs'
  const filter: Filter = isFilter(sp.f) ? sp.f : 'all'
  return { group, filter }
}

// ── row/detail shapes, one pair per rail group ─────────────────────────────

export interface RecRow { id: string; rank: number; title: string; reasoning: string; type: string; tier: GateTier; conversations: number }
export interface RecDetail extends RecRow {
  kind: 'rec'
  total: number
  voices: number
  platforms: { label: string; count: number }[]
  themes: string[]
  quotes: Quote[]
}

export interface InsightRow { id: string; title: string; description: string; type: string; tier: GateTier; conversations: number }
export interface InsightDetail extends InsightRow {
  kind: 'insight'
  voices: number
  platforms: { label: string; count: number }[]
  themes: string[]
  quotes: Quote[]
}

export interface ClaimRow { id: string; youSay: string; yourQuote: string; theySay: string | null; gap: string; audience: string }
export interface ClaimDetail extends ClaimRow { kind: 'claim'; themes: string[] }

/** `quote` is a creator's own words about the brand, quoted from their video
 *  (run_summary.brand_voice.about[n]). It travels as a Quote with a
 *  `b:<run id>:<n>` ref, resolved live through the same row — no stored
 *  export carries the words. */
export interface AboutRow { id: string; claim: string; quote: Quote; account: string; platform: string | null; url: string | null }
export interface AboutDetail extends AboutRow { kind: 'about' }

export type MarketDetail = RecDetail | InsightDetail | ClaimDetail | AboutDetail | { kind: 'empty' }

export type MarketList =
  | { group: 'recs'; total: number; filterCounts: { strong: number; early: number }; rows: RecRow[] }
  | { group: 'insights'; total: number; tierTotals: { confirmed: number; early: number; archive: number }; rows: InsightRow[] }
  | { group: 'claims'; total: number; counts: { total: number; echoed: number; pushedBack: number; silent: number }; rows: ClaimRow[] }
  | { group: 'about'; total: number; rows: AboutRow[] }

export interface MarketData {
  brand: string
  runDate: string
  context: string
  selection: { group: Group; itemId: string | null; filter: Filter }
  legendItems: GlossaryKey[]
  rail: { recs: number; insights: number; claims: number; about: number; newsTotal: number }
  list: MarketList
  detail: MarketDetail
  /** null when the update carries no consumer-intelligence summary yet — the
   *  whole tile shows one empty line; a present-but-thin quadrant shows its
   *  own ("nothing stood out here this update"), which is why this isn't
   *  just `Record<key, string[]>`. */
  shortRead: { key: keyof CiSummary; items: string[] }[] | null
  news: { items: { title: string; url: string; sourceRef: string; publishedAt: string | null; ring: number }[]; total: number }
  singleSourceThemes: { label: string; description: string | null }[]
  singleSourceTotal: number
  method: MethodNoteData
  /** `full` variant only: every item of the selected group, in full — recs
   *  and insights carry their own fetched quotes; claims/about are already
   *  fully loaded so every item is included with no extra fetch. */
  fullItems?: MarketDetail[]
}

export type MarketEmpty = { empty: true; brand: string; legendItems: GlossaryKey[] }

export const isMarketEmpty = (d: MarketData | MarketEmpty): d is MarketEmpty => 'empty' in d

// ── row shapes read straight off the tables ────────────────────────────────

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
interface CompetitiveRef { id: string; evidence: { supporting_theme_ids?: string[] } | null; impact_level: string | null }
interface SingleSourceTheme { label: string; description: string | null }
interface NewsRow { title: string; url: string; source_ref: string; published_at: string | null; ring: number }

export async function loadMarket(scope: Scope): Promise<MarketData | MarketEmpty> {
  const supabase = scope.supabase as SupabaseClient
  const clientId = scope.clientId
  const sp = scope.params as MarketParams
  const full = scope.variant === 'full'
  const { group, filter } = parseMarketSelection(sp)

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

  if (!latestRun) return { empty: true, brand, legendItems: LEGEND_ITEMS }
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

  function recDetail(a: AgendaItem<Recommendation>, rank: number, total: number, voices: number, platforms: { label: string; count: number }[], quotes: Quote[]): RecDetail {
    const { rec, tier } = a
    return {
      kind: 'rec', id: rec.id, rank, total, title: rec.title, reasoning: rec.reasoning, type: rec.type, tier,
      conversations: distinctVideos(recSupportIds(rec), videoByInsight), voices, platforms, themes: slugsOf(recSupportIds(rec)), quotes,
    }
  }
  function insightDetail(mi: MarketInsight, tier: GateTier, voices: number, platforms: { label: string; count: number }[], quotes: Quote[]): InsightDetail {
    return {
      kind: 'insight', id: mi.id, title: mi.title, description: mi.description, type: mi.insight_type, tier,
      conversations: distinctVideos(insightIds(mi), videoByInsight), voices, platforms, themes: slugsOf(insightIds(mi)), quotes,
    }
  }
  function voicesAndPlatforms(ids: string[]): { voices: number; platforms: { label: string; count: number }[] } {
    const byPlatform = new Map<string, number>()
    for (const id of ids) { const pl = platformById.get(id) ?? 'other'; byPlatform.set(pl, (byPlatform.get(pl) ?? 0) + 1) }
    const platforms = [...byPlatform.entries()].sort((a, b) => b[1] - a[1]).map(([pl, count]) => ({ label: pl === 'other' ? 'Other' : platformLabel(pl), count }))
    return { voices: ids.length, platforms }
  }
  /** The hero quote leads when the pool can vouch for it; otherwise it is
   *  cited through its own row (h:<table>:<id>), which the erasure sweep
   *  nulls by string match — same words, same guarantee. */
  function pickQuotes(
    pick: (ids: string[], n: number, claim: string, hero?: string | null) => CitedQuote[],
    ids: string[], claim: string, hero: string | null, heroTable: HeroTable, heroId: string,
  ): Quote[] {
    const cited = pick(ids, 3, claim, hero)
    const h = hero ? cleanQuote(hero) : ''
    const heroCited = h && cited.some((q) => q.text.toLowerCase() === h.toLowerCase())
    return h && !heroCited ? [{ ref: quoteRef.hero(heroTable, heroId), text: h }, ...cited].slice(0, 3) : cited
  }

  // ── say vs hear ─────────────────────────────────────────────────────────
  const claims = ledgerRows(sayVsHear ?? [], Number.MAX_SAFE_INTEGER)
  const counts = claimCounts(claims)

  // ── selection: group/filter parsed above; item needs the group's list ids
  const tierPass = (tier: GateTier) => filter === 'all' || (filter === 'strong' && tier === 'confirmed') || (filter === 'early' && tier === 'early_signal')
  const agendaShown = agenda.filter((a) => tierPass(a.tier))
  const insightsShown = insights.filter((mi) => tierPass(tierById.get(mi.id) ?? 'archive'))
  const listIds: string[] = (
    group === 'recs' ? agendaShown.map((a) => a.rec.id)
    : group === 'insights' ? insightsShown.map((mi) => mi.id)
    : group === 'claims' ? claims.map((_, i) => `c${i}`)
    : aboutYou.map((_, i) => `a${i}`)
  )
  const requested = sp.item ?? (group === 'recs' ? sp.rec : undefined)
  const itemId = requested && listIds.includes(requested) ? requested : (listIds[0] ?? null)

  // ── verbatim quotes for the selected item only (wave 4 — selection-
  // dependent, cannot join the waves above: it needs itemId) ──────────────
  let quotes: Quote[] = []
  let voices = 0
  let platforms: { label: string; count: number }[] = []
  const selectedRec = group === 'recs' ? agenda.find((a) => a.rec.id === itemId) ?? null : null
  const selectedInsight = group === 'insights' ? miById.get(itemId ?? '') ?? null : null
  const spec = selectedRec
    ? { ids: recVoiceIds(selectedRec.rec), claim: `${selectedRec.rec.title} ${selectedRec.rec.reasoning}`, hero: selectedRec.rec.hero_quote, heroTable: 'recommendations' as HeroTable, heroId: selectedRec.rec.id }
    : selectedInsight
      ? { ids: insightVoiceIds(selectedInsight), claim: `${selectedInsight.title} ${selectedInsight.description}`, hero: selectedInsight.hero_quote, heroTable: 'market_insights' as HeroTable, heroId: selectedInsight.id }
      : null
  if (spec) {
    ;({ voices, platforms } = voicesAndPlatforms(spec.ids))
    const pool = rankByTheme(spec.ids, spec.claim, themeSlugById).slice(0, QUOTE_POOL_CAP)
    const quotesByAudience = await fetchQuotesByAudience(supabase, pool)
    const pick = createCitedQuotePicker(quotesByAudience, themeSlugById)
    quotes = pickQuotes(pick, spec.ids, spec.claim, spec.hero, spec.heroTable, spec.heroId)
  }

  // ── detail: exactly one of the four kinds, or empty ─────────────────────
  let detail: MarketDetail = { kind: 'empty' }
  if (group === 'recs' && selectedRec) {
    detail = recDetail(selectedRec, agenda.findIndex((x) => x.rec.id === selectedRec.rec.id), agenda.length, voices, platforms, quotes)
  }
  if (group === 'insights' && selectedInsight) {
    detail = insightDetail(selectedInsight, tierById.get(selectedInsight.id) ?? 'archive', voices, platforms, quotes)
  }
  if (group === 'claims' && itemId) {
    const e = claims[Number(itemId.slice(1))]
    if (e) detail = { kind: 'claim', id: itemId, youSay: e.you_say, yourQuote: e.your_quote, theySay: e.they_say, gap: e.gap, audience: e.audience, themes: slugsOf(e.supporting_theme_ids ?? []) }
  }
  if (group === 'about' && itemId) {
    const e = aboutYou[Number(itemId.slice(1))]
    if (e) detail = { kind: 'about', id: itemId, claim: e.claim, quote: { ref: quoteRef.brandVoice(runId, Number(itemId.slice(1))), text: cleanQuote(e.quote) }, account: e.account, platform: e.platform || null, url: e.url }
  }

  // ── list: only the selected group's rows travel (the others' rows are
  // never rendered, so they are never fetched into the tile-ready shape) ──
  let list: MarketList
  if (group === 'recs') {
    list = {
      group: 'recs', total: agenda.length,
      filterCounts: { strong: agenda.filter((a) => a.tier === 'confirmed').length, early: agenda.filter((a) => a.tier === 'early_signal').length },
      rows: agendaShown.map((a) => ({
        id: a.rec.id, rank: agenda.findIndex((x) => x.rec.id === a.rec.id), title: a.rec.title, reasoning: a.rec.reasoning, type: a.rec.type,
        tier: a.tier, conversations: distinctVideos(recSupportIds(a.rec), videoByInsight),
      })),
    }
  } else if (group === 'insights') {
    list = {
      group: 'insights', total: insights.length, tierTotals: tiers,
      rows: insightsShown.map((mi) => ({
        id: mi.id, title: mi.title, description: mi.description, type: mi.insight_type,
        tier: tierById.get(mi.id) ?? 'archive', conversations: distinctVideos(insightIds(mi), videoByInsight),
      })),
    }
  } else if (group === 'claims') {
    list = {
      group: 'claims', total: claims.length, counts,
      rows: claims.map((e, i) => ({ id: `c${i}`, youSay: e.you_say, yourQuote: e.your_quote, theySay: e.they_say, gap: e.gap, audience: e.audience })),
    }
  } else {
    list = {
      group: 'about', total: aboutYou.length,
      rows: aboutYou.map((e, i) => ({ id: `a${i}`, claim: e.claim, quote: { ref: quoteRef.brandVoice(runId, i), text: cleanQuote(e.quote) }, account: e.account, platform: e.platform || null, url: e.url })),
    }
  }

  // ── full (print): every item of the selected group, in full ────────────
  let fullItems: MarketDetail[] | undefined
  if (full) {
    if (group === 'recs') {
      const wanted = agendaShown.slice(0, EXPORT_FULL_MAX_ITEMS).map((a) => {
        const ids = recVoiceIds(a.rec)
        const claim = `${a.rec.title} ${a.rec.reasoning}`
        return { a, idx: agenda.findIndex((x) => x.rec.id === a.rec.id), ids, claim, pool: rankByTheme(ids, claim, themeSlugById).slice(0, QUOTE_POOL_CAP) }
      })
      const quotesByAudience = await fetchQuotesByAudience(supabase, [...new Set(wanted.flatMap((w) => w.pool))])
      const pick = createCitedQuotePicker(quotesByAudience, themeSlugById)
      fullItems = wanted.map((w) => {
        const { voices: v, platforms: p } = voicesAndPlatforms(w.ids)
        const q = pickQuotes(pick, w.ids, w.claim, w.a.rec.hero_quote, 'recommendations', w.a.rec.id)
        return recDetail(w.a, w.idx, agenda.length, v, p, q)
      })
    } else if (group === 'insights') {
      const wanted = insightsShown.slice(0, EXPORT_FULL_MAX_ITEMS).map((mi) => {
        const ids = insightVoiceIds(mi)
        const claim = `${mi.title} ${mi.description}`
        return { mi, ids, claim, pool: rankByTheme(ids, claim, themeSlugById).slice(0, QUOTE_POOL_CAP) }
      })
      const quotesByAudience = await fetchQuotesByAudience(supabase, [...new Set(wanted.flatMap((w) => w.pool))])
      const pick = createCitedQuotePicker(quotesByAudience, themeSlugById)
      fullItems = wanted.map((w) => {
        const { voices: v, platforms: p } = voicesAndPlatforms(w.ids)
        const q = pickQuotes(pick, w.ids, w.claim, w.mi.hero_quote, 'market_insights', w.mi.id)
        return insightDetail(w.mi, tierById.get(w.mi.id) ?? 'archive', v, p, q)
      })
    } else if (group === 'claims') {
      // Already fully loaded (say_vs_hear is the whole ledger, no per-item
      // fetch) — no quote fetch needed for a full claims deck.
      fullItems = claims.map((e, i) => ({ kind: 'claim' as const, id: `c${i}`, youSay: e.you_say, yourQuote: e.your_quote, theySay: e.they_say, gap: e.gap, audience: e.audience, themes: slugsOf(e.supporting_theme_ids ?? []) }))
    } else if (group === 'about') {
      fullItems = aboutYou.map((e, i) => ({ kind: 'about' as const, id: `a${i}`, claim: e.claim, quote: { ref: quoteRef.brandVoice(runId, i), text: cleanQuote(e.quote) }, account: e.account, platform: e.platform || null, url: e.url }))
    }
  }

  // ── the short read: four quadrants from the model's own consumer-
  // intelligence summary ──────────────────────────────────────────────────
  const QUADRANT_KEYS: (keyof CiSummary)[] = ['top_unmet_needs', 'top_buying_triggers', 'top_differentiators', 'threats']
  const quadrantItems = (key: keyof CiSummary): string[] =>
    (((ciSummary?.[key] ?? []) as unknown as string[]) || []).filter((s) => typeof s === 'string' && s.trim().length > 0)
  const shortRead = ciSummary ? QUADRANT_KEYS.map((key) => ({ key, items: quadrantItems(key) })) : null

  const platformsSeen = [...new Set(audienceRows.map((a) => a.platform).filter((p): p is string => !!p))]

  return {
    brand, runDate,
    context: `What should we do? · ${brand} · ${weekdayDate(runDate)}`,
    selection: { group, itemId, filter },
    legendItems: LEGEND_ITEMS,
    rail: { recs: agenda.length, insights: insights.length, claims: claims.length, about: aboutYou.length, newsTotal },
    list,
    detail,
    shortRead,
    news: { items: news.map((n) => ({ title: n.title, url: n.url, sourceRef: n.source_ref, publishedAt: n.published_at, ring: n.ring })), total: newsTotal },
    singleSourceThemes,
    singleSourceTotal,
    method: {
      company: brand,
      period: `Update of ${weekdayDate(runDate)}`,
      platforms: platformsSeen,
      videos: null,
      comments: null,
      note: `${tiers.confirmed} insights confirmed by two or more sources · ${tiers.early} early signals; recommendations ordered by evidence, not preference.`,
    },
    ...(fullItems ? { fullItems } : {}),
  }
}
