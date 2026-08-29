import type { SupabaseClient } from '@supabase/supabase-js'
import { selectAll } from '../supabase-admin'
import { fetchInsightsByIds, fetchQuoteCitationsByAudience, readsAsHeroQuote, cleanQuote, type QuoteCitation } from '../quotes'
import { quoteRef } from '../renderables/quotes-freeze'
import type { Quote, Scope } from '../renderables/types'
import { prevalenceTier, type GlossaryKey, type PrevalenceTier } from '../calibration'
import { fmtCompact, weekdayDate, platformLabel } from '../format'
import {
  themeTrajectories, themeMovers, voiceTiers, pickVoiceCards, categoryTabs, categoryLabel, shortPhrases, topEmotions, bucketKind,
  type ThemeHistoryRow, type Trajectory, type Bucket,
} from '../voice-tiles'
import type { MethodNoteData } from '../../components/print/method-note'
import { EXPORT_FULL_MAX_ITEMS } from '../config'

// Voice of Customer loader — the data half of the old app/dashboard/voice/page.tsx
// (split 2026-08-29, Reports & Exports T4). "What are they saying?": the theme
// map is the hero (block = conversations, tint = whose audience), the selected
// theme in full beside it, gaining-and-fading, the customers' own phrases,
// audience mood, five verbatim voices across the bottom.
//
// Rules kept: theme identity is theme_registry (registry_id) — cross-update
// joins never use labels; strength_score gates and orders but is never
// printed (what you read is conversations, a count); ?themes=slug,slug deep
// links from the Dashboard narrow the map and the list to the themes behind
// that insight; an in-flight update is never read. The ribbon's ?seed= is
// random when absent in the app; an export carries the seed it was clicked
// with, so the snapshot renders the same five voices.

export interface ThemeRow {
  id: string
  bucket: string
  category: string
  label: string
  description: string | null
  member_themes: string[]
  registry_id: string | null
  supporting_insight_ids: string[]
  supporting_video_ids: string[]
  evidence_count: number
  strength_score: number | null
  rank_score: number | null
  dominant_emotion: string | null
  dominant_sentiment_impact: string | null
  single_source: boolean
  first_seen: boolean
}

/** Blocks on the map. */
export const MAP_BLOCKS = 13
/** Themes the quote ribbon draws from, and member insights sampled per theme (URL-length cap). */
const RIBBON_THEMES = 8
const QUOTE_IDS_PER_THEME = 12
const QUOTES_PER_THEME = 4
const RIBBON_CARDS = 5
/** Phrases on the language tile (picked shortest-first from a pool) / in its drawer. */
const PHRASES_SHOWN = 8
const PHRASES_POOL = 120
const PHRASES_DRAWER = 300
/** Quotes in a theme's pane. */
const DETAIL_QUOTES = 6

export const LEGEND_ITEMS: GlossaryKey[] = ['conversations', 'dominant', 'widespread', 'recurring', 'early_signal']

export type VoiceParams = { entity?: string; themes?: string; type?: string; stage?: string; min?: string; detail?: string; seed?: string; theme?: string }

/** The filters as the page read them, plus the pinned seed — what every href
 *  on the page preserves. */
export interface VoiceFilters {
  entity: string
  type: string
  stage: string
  min: number
  deepLinked: boolean
  themes: string | undefined
  seed: number
  theme: string | undefined
  detail: string | undefined
}

/** Hrefs that preserve the active view; null drops a key. Pure — the
 *  renderers call it with the data's filters. */
export function voiceHref(f: VoiceFilters, over: Partial<Record<'entity' | 'type' | 'themes' | 'stage' | 'min' | 'seed' | 'detail' | 'theme', string | null>> = {}): string {
  const params = new URLSearchParams()
  const base: Record<string, string | undefined> = {
    entity: f.entity === 'all' ? undefined : f.entity,
    type: f.type === 'all' ? undefined : f.type,
    themes: f.themes,
    stage: f.stage === 'all' ? undefined : f.stage,
    min: f.min ? String(f.min) : undefined,
    seed: String(f.seed),
    theme: f.theme,
  }
  for (const [k, v] of Object.entries({ ...base, ...over })) if (v) params.set(k, v)
  const qs = params.toString()
  return qs ? `/dashboard/voice?${qs}` : '/dashboard/voice'
}

export interface ThemeBlockData {
  id: string
  label: string
  count: number
  bucket: Bucket
  category: string
  isNew: boolean
  series?: number[]
}

export interface ThemeDetail {
  id: string
  label: string
  bucket: string
  bucketName: string
  groupName: string
  kind: Bucket
  category: string
  prevalence: PrevalenceTier
  emotion: string | null
  isNew: boolean
  description: string | null
  count: number
  denom: number
  pct: number
  history: { evidence: number[]; dates: string[] } | null
  quotes: Quote[]
  withheld: number
  memberThemes: string[]
}

export interface ThemeListRow {
  id: string
  label: string
  kind: Bucket
  category: string
  isNew: boolean
  count: number
}

export interface VoiceCardData {
  themeId: string
  themeLabel: string
  themeCategory: string
  quote: Quote
  who: string
}

export interface VoiceData {
  brand: string
  runDate: string
  updatesCount: number
  showNew: boolean
  filters: VoiceFilters
  /** Whether any insight this update carries a journey stage (hides the filter otherwise). */
  stagesPresent: boolean
  entities: { bucket: string; confirmed: number; pillLabel: string }[]
  pillsInBar: boolean
  leadCompetitorName: string | null
  tabs: { category: string; label: string; count: number }[]
  tiersEntityConfirmed: number
  map: {
    blocks: ThemeBlockData[]
    shownCount: number
    totalThemes: number
    tiersAll: { confirmed: number; early: number; heardOnce: number }
    emptyLine: string
  }
  theme: ThemeDetail | null
  movers: { rows: Trajectory[]; steadyCount: number }
  phrases: { shown: { phrase: string; platform: string | null }[]; all: { phrase: string; platform: string | null }[]; total: number }
  moods: { emotion: string; count: number; pct: number; total: number }[]
  ribbon: { cards: VoiceCardData[]; total: number }
  list: { confirmed: ThemeListRow[]; early: ThemeListRow[]; heardOnce: ThemeListRow[]; entityLabel: string; typeLabel: string | null }
  /** `full` variant only: every confirmed theme in full, one slide each. */
  allThemes?: ThemeDetail[]
  legendItems: GlossaryKey[]
  method: MethodNoteData
}

export type VoiceEmpty = { empty: true; legendItems: GlossaryKey[] }

export const isVoiceEmpty = (d: VoiceData | VoiceEmpty): d is VoiceEmpty => 'empty' in d

export function parseVoiceFilters(sp: VoiceParams): VoiceFilters {
  const groundingSlugs = (sp.themes ?? '').split(',').map((s) => s.trim()).filter(Boolean)
  // The ribbon rotates on every visit; ?seed= pins a draw so drawers and tabs
  // don't reshuffle it, and "Next five" advances it.
  const seed = sp.seed != null && sp.seed !== '' && Number.isFinite(Number(sp.seed)) ? Math.trunc(Number(sp.seed)) : Math.floor(Math.random() * 1_000_000)
  return {
    entity: sp.entity ?? 'all',
    type: sp.type ?? 'all',
    stage: sp.stage ?? 'all',
    min: Number(sp.min ?? '0') || 0,
    deepLinked: groundingSlugs.length > 0,
    themes: sp.themes,
    seed,
    theme: sp.theme,
    detail: sp.detail,
  }
}

const competitorName = (bucket: string) => bucket.replace(/^competitor:/, '')

export async function loadVoice(scope: Scope): Promise<VoiceData | VoiceEmpty> {
  const supabase = scope.supabase as SupabaseClient
  const clientId = scope.clientId
  const sp = scope.params as VoiceParams
  const f = parseVoiceFilters(sp)
  const detail = sp.detail
  const groundingSlugs = new Set((sp.themes ?? '').split(',').map((s) => s.trim()).filter(Boolean))
  const { deepLinked, entity: entityFilter, type: typeFilter, stage: stageFilter, min: minScore, seed } = f
  const full = scope.variant === 'full'

  // Latest COMPLETED update — an in-flight one has no themes yet, so the page
  // keeps serving the previous update's voices until the new one closes.
  //
  // Round trips, not rows, are the cost (the DB pays a ~0.5s wake-up on the
  // first requests after idle, and every sequential wave pays it again), so
  // everything keyed on client_id alone — theme history, update dates, the
  // phrase pool, the mood read — goes out here, with the run lookup; only
  // this update's themes wait for the run id.
  const [{ data: latestRun }, runningRes, { data: client }, historyRows, summaryRows, samplesRes, emotionRows] = await Promise.all([
    supabase.from('pipeline_runs').select('id, started_at')
      .eq('client_id', clientId).in('status', ['completed', 'partial'])
      .order('started_at', { ascending: false }).limit(1).maybeSingle(),
    supabase.from('pipeline_runs').select('id').eq('client_id', clientId).eq('status', 'running'),
    supabase.from('clients').select('company_name').eq('id', clientId).maybeSingle(),
    // Every update's themes, for the per-theme sparks and the movers (joined on
    // registry_id in lib/voice-tiles). selectAll: a tenant crosses 1000 rows in
    // three updates.
    selectAll<ThemeHistoryRow>(() =>
      supabase.from('themes').select('run_id, registry_id, label, category, bucket, strength_score, evidence_count, first_seen')
        .eq('client_id', clientId).order('run_id', { ascending: true }).order('id', { ascending: true }),
    ),
    selectAll<{ run_id: string; run_date: string }>(() =>
      supabase.from('run_summary').select('run_id, run_date').eq('client_id', clientId).order('run_date', { ascending: true }),
    ),
    supabase.from('language_samples_current')
      .select('phrase, platform', { count: 'exact' })
      .eq('client_id', clientId)
      .order('phrase')
      .limit(detail === 'language' ? PHRASES_DRAWER : PHRASES_POOL),
    // Population read of the current analysis → the *_current view (AGENTS.md).
    selectAll<{ id: string; emotion: string | null }>(() =>
      supabase.from('audience_insights_current').select('id, emotion').eq('client_id', clientId).order('id', { ascending: true }),
    ),
  ])
  const runningIds = ((runningRes.data ?? []) as { id: string }[]).map((r) => r.id)
  const brand = client?.company_name ?? 'your brand'

  if (!latestRun) return { empty: true, legendItems: LEGEND_ITEMS }
  const runId = latestRun.id as string

  const themesRes = await supabase.from('themes')
    .select('id, registry_id, bucket, category, label, description, member_themes, supporting_insight_ids, supporting_video_ids, evidence_count, strength_score, rank_score, dominant_emotion, dominant_sentiment_impact, single_source, first_seen')
    .eq('client_id', clientId).eq('run_id', runId)
    .order('evidence_count', { ascending: false })
    .order('rank_score', { ascending: false, nullsFirst: false })

  const themes = (themesRes.data ?? []) as ThemeRow[]
  // The updates that count for movement: closed updates that produced themes
  // (an update from before themes existed is no baseline for "new").
  const themedRunIds = new Set(historyRows.map((r) => r.run_id))
  themedRunIds.add(runId)
  const runDates = new Map(
    summaryRows.filter((s) => s.run_id && themedRunIds.has(s.run_id) && !runningIds.includes(s.run_id)).map((s) => [s.run_id, s.run_date]),
  )
  if (!runDates.has(runId)) runDates.set(runId, (latestRun.started_at as string).slice(0, 10))
  const updatesCount = runDates.size
  const runDate = runDates.get(runId) ?? (latestRun.started_at as string)
  const showNew = updatesCount > 1
  const samples = (samplesRes.data ?? []) as { phrase: string; platform: string | null }[]
  const sampleTotal = samplesRes.count ?? samples.length
  const phrases = shortPhrases(samples, PHRASES_SHOWN)

  // ---- bucket vocabulary (raw bucket values are never client-facing) ----
  const bucketName = (bucket: string) =>
    bucket === 'client' ? 'Your audience' : bucket === 'industry-other' ? 'Wider category' : `${competitorName(bucket)}’s audience`
  const groupName = (bucket: string) => (bucket === 'client' ? brand : bucket === 'industry-other' ? 'category' : competitorName(bucket))

  // A theme's reach is measured against its own entity group: the group's
  // distinct insight-bearing conversations = union of its themes' evidence.
  const groupConversations = new Map<string, Set<string>>()
  for (const t of themes) {
    let set = groupConversations.get(t.bucket)
    if (!set) groupConversations.set(t.bucket, (set = new Set()))
    for (const id of t.supporting_video_ids ?? []) set.add(id)
  }
  const groupSize = (bucket: string) => groupConversations.get(bucket)?.size ?? 0

  // ---- filters ----
  // The visible set depends on the per-insight journey stage ONLY when a
  // stage filter is active — so in the common case the map pool, and with it
  // the ribbon's insight ids, are known before the insight read returns, and
  // the ribbon's quotes can be fetched in the same wave as the insight meta
  // instead of two round trips later.
  type InsightMeta = { id: string; journey_stage: string | null; platform: string | null }
  const inEntity = (t: ThemeRow) => entityFilter === 'all' || t.bucket === entityFilter
  const shownFor = (meta: Map<string, InsightMeta>) => themes.filter((t) =>
    inEntity(t) &&
    (!deepLinked || t.member_themes.some((slug) => groundingSlugs.has(slug))) &&
    (typeFilter === 'all' || t.category === typeFilter) &&
    (stageFilter === 'all' || t.supporting_insight_ids.some((id) => meta.get(id)?.journey_stage === stageFilter)) &&
    Number(t.strength_score ?? 0) >= minScore,
  )
  // The map: the widest-heard confirmed themes under the current filters. A
  // deep link shows exactly the themes behind that insight, singles included.
  const poolFor = (shownThemes: ThemeRow[]) => (deepLinked ? shownThemes : voiceTiers(shownThemes).confirmed)
    .slice()
    .sort((a, b) => b.evidence_count - a.evidence_count || Number(b.rank_score ?? 0) - Number(a.rank_score ?? 0))
  const ribbonIdsFor = (pool: ThemeRow[]) => pool.slice(0, RIBBON_THEMES).flatMap((t) => t.supporting_insight_ids.slice(0, QUOTE_IDS_PER_THEME))
  // The theme pane (2026-08-28): ?theme=<id> selects a theme beside the map —
  // the old ?detail=<themeId> drawer links still land — and the widest-heard
  // block is open by default, so the pane is never empty.
  const themeParam = sp.theme ?? (detail && !['list', 'movers', 'language', 'legend'].includes(detail) ? detail : undefined)
  const defaultTheme = poolFor(shownFor(new Map()))[0] ?? themes[0] ?? null
  const detailTheme = (themeParam ? themes.find((t) => t.id === themeParam) ?? null : null) ?? defaultTheme

  // Journey stage + platform per insight, read by id from the base table (the
  // ids come from THIS update's themes; a newer in-flight update may already
  // have superseded some of those videos' rows in the current view). In the
  // same wave: the ribbon's citations (when the pool is already known) and the
  // open theme pane's evidence — none of the three depends on another.
  type EvidenceRow = { id: string; audience_insight_id: string; quote: string; redacted: boolean | null }
  const [insightRows, earlyCitations, detailEvidenceRes] = await Promise.all([
    fetchInsightsByIds<InsightMeta>(supabase, themes.flatMap((t) => t.supporting_insight_ids ?? []), 'id, journey_stage, platform'),
    stageFilter === 'all'
      ? fetchQuoteCitationsByAudience(supabase, ribbonIdsFor(poolFor(shownFor(new Map()))))
      : Promise.resolve(null),
    // Counts-not-quotes: demographic evidence cites but never quotes — its rows
    // carry redacted = true and an empty quote; counted here, never rendered.
    detailTheme
      ? supabase
          .from('insight_evidence').select('id, audience_insight_id, quote, relevance_rank, redacted')
          .in('audience_insight_id', detailTheme.supporting_insight_ids.slice(0, QUOTE_IDS_PER_THEME))
          .order('relevance_rank', { ascending: true })
      : Promise.resolve({ data: null }),
  ])
  const insightMeta = new Map(insightRows.map((i) => [i.id, i]))
  const stagesPresent = new Set([...insightMeta.values()].map((i) => i.journey_stage).filter(Boolean))
  const shown = shownFor(insightMeta)
  const tiers = voiceTiers(shown)
  const tiersAll = voiceTiers(themes)
  const tiersEntity = voiceTiers(themes.filter(inEntity))

  // Entities this update, for the page bar: you first, then competitors by
  // confirmed themes, then the wider category. The number is confirmed themes.
  const confirmedByBucket = new Map<string, number>()
  for (const t of tiersAll.confirmed) confirmedByBucket.set(t.bucket, (confirmedByBucket.get(t.bucket) ?? 0) + 1)
  const bucketRank = (b: string) => (b === 'client' ? 0 : b === 'industry-other' ? 2 : 1)
  const entities = [...groupConversations.keys()]
    .map((bucket) => ({ bucket, confirmed: confirmedByBucket.get(bucket) ?? 0 }))
    .sort((a, z) => bucketRank(a.bucket) - bucketRank(z.bucket) || z.confirmed - a.confirmed)
  const leadCompetitor = entities.find((e) => e.bucket.startsWith('competitor:'))?.bucket ?? null

  // Category tabs count CONFIRMED themes in the SELECTED ENTITY, so a tab's
  // number matches what the map shows and switching entity re-scopes them.
  const categoryCounts = new Map<string, number>()
  for (const t of tiersEntity.confirmed) categoryCounts.set(t.category, (categoryCounts.get(t.category) ?? 0) + 1)
  const tabs = categoryTabs(categoryCounts)

  // ---- trajectories across updates (sparks + movers) ----
  const { trajectories, keyOf } = themeTrajectories(historyRows.filter((r) => !runningIds.includes(r.run_id)), runDates)
  const trajectoryByKey = new Map(trajectories.map((t) => [t.key, t]))
  const historyOf = (t: ThemeRow): Trajectory | undefined => trajectoryByKey.get(keyOf(t))
  const moversAll = themeMovers(trajectories).filter((t) => entityFilter === 'all' || t.bucket === entityFilter)
  const movers = moversAll.filter((t) => t.movement !== 'steady')
  const steadyCount = moversAll.length - movers.length

  // ---- the map (pool defined with the filters above) ----
  const mapPool = poolFor(shown)
  const blocks: ThemeBlockData[] = mapPool.slice(0, MAP_BLOCKS).map((t) => ({
    id: t.id,
    label: t.label,
    count: t.evidence_count,
    bucket: bucketKind(t.bucket),
    category: categoryLabel(t.category),
    isNew: showNew && t.first_seen,
    series: historyOf(t)?.evidence,
  }))

  // ---- the ribbon: five verbatim voices from the top themes, scoped to the
  // current audience; redacted (demographic) evidence never reaches it.
  const ribbonThemes = mapPool.slice(0, RIBBON_THEMES)
  // Fetched a wave earlier unless a stage filter made the pool wait for the
  // insight meta — then it is fetched now, against the real pool.
  const citations = earlyCitations ?? await fetchQuoteCitationsByAudience(supabase, ribbonIdsFor(mapPool))
  type Cand = { theme: ThemeRow; quote: string; citation: QuoteCitation; insightId: string }
  const seenQuote = new Set<string>()
  const candidatesByTheme: Cand[][] = ribbonThemes.map((theme) => {
    const out: Cand[] = []
    const pool: Cand[] = []
    for (const insightId of theme.supporting_insight_ids.slice(0, QUOTE_IDS_PER_THEME)) {
      for (const c of citations.get(insightId) ?? []) {
        const q = cleanQuote(c.quote)
        if (!readsAsHeroQuote(q)) continue
        pool.push({ theme, quote: q, citation: c, insightId })
      }
    }
    pool.sort((a, b) => a.citation.rank - b.citation.rank)
    for (const c of pool) {
      const key = c.quote.toLowerCase()
      if (seenQuote.has(key)) continue
      seenQuote.add(key)
      out.push(c)
      if (out.length >= QUOTES_PER_THEME) break
    }
    return out
  })
  const ribbon = pickVoiceCards(candidatesByTheme, seed, RIBBON_CARDS)
  // Platform + likes for the five shown: the comment behind each quote.
  const commentIds = ribbon.cards.map((c) => c.quote.citation.commentId).filter((id): id is string => !!id)
  const commentMeta = new Map<string, { likes: number | null; platform: string | null }>()
  if (commentIds.length > 0) {
    const { data } = await supabase.from('comments').select('id, likes, platform').in('id', commentIds)
    for (const c of (data ?? []) as { id: string; likes: number | null; platform: string | null }[]) commentMeta.set(c.id, c)
  }
  const cards: VoiceCardData[] = ribbon.cards.map(({ quote: c }) => {
    const meta = c.citation.commentId ? commentMeta.get(c.citation.commentId) : undefined
    const platform = meta?.platform ?? insightMeta.get(c.insightId)?.platform ?? null
    const who = [
      platform ? platformLabel(platform) : null,
      meta?.likes && meta.likes > 0 ? `${fmtCompact(meta.likes)} likes` : null,
      c.theme.bucket === 'client' ? 'your audience' : c.theme.bucket.startsWith('competitor:') ? `${competitorName(c.theme.bucket)}’s audience` : null,
    ].filter(Boolean).join(' · ')
    return { themeId: c.theme.id, themeLabel: c.theme.label, themeCategory: c.theme.category, quote: { ref: quoteRef.evidence(c.citation.evidenceId), text: c.quote }, who }
  })

  // ---- audience mood: the feeling Pass A read on each insight, counted —
  // scoped to the selected audience through its themes' member insights.
  const entityInsightIds = entityFilter === 'all' ? null : new Set(themes.filter(inEntity).flatMap((t) => t.supporting_insight_ids))
  const moods = topEmotions(emotionRows.filter((r) => !entityInsightIds || entityInsightIds.has(r.id)).map((r) => r.emotion), 3)

  // ---- the theme pane — evidence fetched above ----
  const themeDetail = (t: ThemeRow, evidence: EvidenceRow[]): ThemeDetail => {
    const quotes: Quote[] = []
    let withheld = 0
    const seen = new Set<string>()
    for (const ev of evidence) {
      if (ev.redacted || !ev.quote) { withheld++; continue }
      const q = cleanQuote(ev.quote)
      if (seen.has(q.toLowerCase()) || quotes.length >= DETAIL_QUOTES) continue
      seen.add(q.toLowerCase())
      quotes.push({ ref: quoteRef.evidence(ev.id), text: q })
    }
    const denom = groupSize(t.bucket)
    const h = historyOf(t)
    return {
      id: t.id, label: t.label, bucket: t.bucket, bucketName: bucketName(t.bucket), groupName: groupName(t.bucket), kind: bucketKind(t.bucket),
      category: t.category, prevalence: prevalenceTier(t.evidence_count, denom), emotion: t.dominant_emotion, isNew: showNew && t.first_seen,
      description: t.description, count: t.evidence_count, denom, pct: denom > 0 ? Math.min(100, Math.round((t.evidence_count / denom) * 100)) : 0,
      history: h && h.evidence.length >= 2 ? { evidence: h.evidence, dates: h.dates } : null,
      quotes, withheld, memberThemes: t.member_themes,
    }
  }
  const theme = detailTheme ? themeDetail(detailTheme, (detailEvidenceRes.data ?? []) as EvidenceRow[]) : null

  // `full` (print): every confirmed theme under the current filters, in full —
  // one evidence read for all of them, grouped per theme. Capped: a deck with
  // sixty theme slides is one nobody presents.
  let allThemes: ThemeDetail[] | undefined
  if (full) {
    const wanted = [...tiers.confirmed].sort((a, b) => b.evidence_count - a.evidence_count).slice(0, EXPORT_FULL_MAX_ITEMS)
    const ids = wanted.flatMap((t) => t.supporting_insight_ids.slice(0, QUOTE_IDS_PER_THEME))
    const rows: EvidenceRow[] = []
    for (let i = 0; i < ids.length; i += 120) {
      const { data } = await supabase.from('insight_evidence').select('id, audience_insight_id, quote, relevance_rank, redacted')
        .in('audience_insight_id', ids.slice(i, i + 120)).order('relevance_rank', { ascending: true })
      rows.push(...((data ?? []) as EvidenceRow[]))
    }
    const byInsight = new Map<string, EvidenceRow[]>()
    for (const r of rows) byInsight.set(r.audience_insight_id, [...(byInsight.get(r.audience_insight_id) ?? []), r])
    allThemes = wanted.map((t) => themeDetail(t, t.supporting_insight_ids.slice(0, QUOTE_IDS_PER_THEME).flatMap((id) => byInsight.get(id) ?? [])))
  }

  const legendItems: GlossaryKey[] = showNew ? [...LEGEND_ITEMS, 'new'] : LEGEND_ITEMS
  const mapEmptyLine = themes.length === 0
    ? 'Your customer voices are being organised into themes — they land with your next update.'
    : deepLinked && shown.length === 0
      ? 'None of this update’s themes sit behind that insight any more — clear the filter to see the whole conversation.'
      : shown.length === 0 ? 'No themes match these filters.' : 'No confirmed theme matches these filters — the early signals and single mentions are in the list.'

  const listRow = (t: ThemeRow): ThemeListRow => ({ id: t.id, label: t.label, kind: bucketKind(t.bucket), category: t.category, isNew: showNew && t.first_seen, count: t.evidence_count })
  const platformsSeen = [...new Set([...insightMeta.values()].map((i) => i.platform).filter((p): p is string => !!p))]

  return {
    brand, runDate, updatesCount, showNew, filters: f,
    stagesPresent: stagesPresent.size > 0,
    entities: themes.length > 0 && entities.length > 1
      ? entities.map((e) => ({ ...e, pillLabel: e.bucket === 'client' ? 'Yours' : e.bucket === 'industry-other' ? 'Category' : `${competitorName(e.bucket)}’s` }))
      : [],
    pillsInBar: entities.length <= 3,
    leadCompetitorName: leadCompetitor ? competitorName(leadCompetitor) : null,
    tabs,
    tiersEntityConfirmed: tiersEntity.confirmed.length,
    map: {
      blocks, shownCount: shown.length, totalThemes: themes.length,
      tiersAll: { confirmed: tiersAll.confirmed.length, early: tiersAll.early.length, heardOnce: tiersAll.heardOnce.length },
      emptyLine: mapEmptyLine,
    },
    theme,
    movers: { rows: movers, steadyCount },
    phrases: { shown: phrases, all: samples, total: sampleTotal },
    moods,
    ribbon: { cards, total: ribbon.total },
    list: {
      confirmed: [...tiers.confirmed].sort((a, b) => b.evidence_count - a.evidence_count).map(listRow),
      early: tiers.early.map(listRow),
      heardOnce: tiers.heardOnce.map(listRow),
      entityLabel: entityFilter === 'all' ? 'every audience' : bucketName(entityFilter).toLowerCase(),
      typeLabel: typeFilter !== 'all' ? categoryLabel(typeFilter).toLowerCase() : null,
    },
    allThemes,
    legendItems,
    method: {
      company: brand,
      period: `Update of ${weekdayDate(runDate)}`,
      platforms: platformsSeen,
      videos: null,
      comments: null,
      note: `${tiersAll.confirmed.length} themes confirmed by more than one conversation · ${tiersAll.early.length} early signals · ${tiersAll.heardOnce.length} heard once. Block size is conversations, a count.`,
    },
  }
}
