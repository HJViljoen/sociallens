import Link from 'next/link'
import { getSessionContext } from '@/lib/auth'
import { selectAll } from '@/lib/supabase-admin'
import { fetchInsightsByIds, fetchQuoteCitationsByAudience, readsAsHeroQuote, cleanQuote, type QuoteCitation } from '@/lib/quotes'
import { categoryTint, PREVALENCE_BADGE } from '@/lib/ui-colors'
import { prevalenceTier, PREVALENCE_LABEL, glossaryRule, type GlossaryKey } from '@/lib/calibration'
import { fmtInt, fmtCompact, fmtPct, weekdayDate, shortDate, platformLabel, cap } from '@/lib/format'
import {
  themeTrajectories, themeMovers, voiceTiers, pickVoiceCards, categoryTabs, categoryLabel, topEmotions, emotionTone, bucketKind,
  type ThemeHistoryRow, type Trajectory,
} from '@/lib/voice-tiles'
import { VoiceFilters } from '@/components/voice-filters'
import { HowToRead } from '@/components/how-to-read'
import { PageFrame, PageGrid, PageBar, BarPill } from '@/components/shell/page-grid'
import { Tile, TileEmpty } from '@/components/shell/tile'
import { DetailDrawer } from '@/components/shell/detail-drawer'
import { Sparkline } from '@/components/charts/sparkline'
import { RankedBar } from '@/components/charts/ranked-bar'
import { Mover } from '@/components/charts/mover'
import { ThemeMap, BucketLegend, EDGE, type ThemeBlock } from './theme-map'

// Voice of Customer — "what are they saying?", on one screen (one-screen
// redesign, 2026-08-22). The theme map is the hero: a squarified treemap of the
// top themes this update (block = conversations, tint = whose audience), with
// the category tabs and journey filter inside it; gaining-and-fading, how your
// customers talk, and audience mood on the right; five verbatim voices across
// the bottom. Everything deeper is one click away in a right-hand drawer
// (?detail=<themeId> | list | movers | language | legend).
//
// Rules kept from the old page: theme identity is theme_registry
// (registry_id) — cross-update joins never use labels; strength_score gates and
// orders but is never printed (what you read is conversations, a count);
// ?themes=slug,slug deep links from the Dashboard narrow the map and the list
// to the themes behind that insight; an in-flight update is never read.

interface ThemeRow {
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
const MAP_BLOCKS = 13
/** Themes the quote ribbon draws from, and member insights sampled per theme (URL-length cap). */
const RIBBON_THEMES = 8
const QUOTE_IDS_PER_THEME = 12
const QUOTES_PER_THEME = 4
const RIBBON_CARDS = 5
/** Phrases on the language tile / in its drawer. */
const PHRASES_SHOWN = 8
const PHRASES_DRAWER = 300
/** Quotes in a theme's drawer. */
const DETAIL_QUOTES = 6
/** Mover rows the tile has room for. */
const MOVER_ROWS = 6

const LEGEND_ITEMS: GlossaryKey[] = ['conversations', 'dominant', 'widespread', 'recurring', 'early_signal']

const chip = 'inline-flex h-[18px] items-center rounded-full px-[7px] text-[10.5px] font-medium whitespace-nowrap'

type SP = { entity?: string; themes?: string; type?: string; stage?: string; min?: string; detail?: string; seed?: string }

export default async function VoiceOfCustomerPage({ searchParams }: { searchParams?: Promise<SP> }) {
  // Auth + tenant via the RLS-enforced session client. See lib/auth.ts.
  const { supabase, clientId } = await getSessionContext()
  const sp = (await searchParams) ?? {}

  const detail = sp.detail
  const showLegend = detail === 'legend'
  const groundingSlugs = new Set((sp.themes ?? '').split(',').map((s) => s.trim()).filter(Boolean))
  const deepLinked = groundingSlugs.size > 0
  const entityFilter = sp.entity ?? 'all'
  const typeFilter = sp.type ?? 'all'
  const stageFilter = sp.stage ?? 'all'
  const minScore = Number(sp.min ?? '0') || 0
  // The ribbon rotates on every visit; ?seed= pins a draw so drawers and tabs
  // don't reshuffle it, and "Next five" advances it.
  const seed = sp.seed != null && sp.seed !== '' && Number.isFinite(Number(sp.seed)) ? Math.trunc(Number(sp.seed)) : Math.floor(Math.random() * 1_000_000)

  // Hrefs that preserve the active view; null drops a key.
  const hrefWith = (over: Partial<Record<'entity' | 'type' | 'themes' | 'stage' | 'min' | 'seed' | 'detail', string | null>>) => {
    const params = new URLSearchParams()
    const base: Record<string, string | undefined> = { entity: sp.entity, type: sp.type, themes: sp.themes, stage: sp.stage, min: sp.min, seed: String(seed) }
    for (const [k, v] of Object.entries({ ...base, ...over })) if (v) params.set(k, v)
    const qs = params.toString()
    return qs ? `/dashboard/voice?${qs}` : '/dashboard/voice'
  }
  const closeHref = hrefWith({ detail: null })

  // Latest COMPLETED update — an in-flight one has no themes yet, so the page
  // keeps serving the previous update's voices until the new one closes.
  const [{ data: latestRun }, runningRes, { data: client }] = await Promise.all([
    supabase.from('pipeline_runs').select('id, started_at')
      .eq('client_id', clientId).in('status', ['completed', 'partial'])
      .order('started_at', { ascending: false }).limit(1).maybeSingle(),
    supabase.from('pipeline_runs').select('id').eq('client_id', clientId).eq('status', 'running'),
    supabase.from('clients').select('company_name').eq('id', clientId).maybeSingle(),
  ])
  const runningIds = ((runningRes.data ?? []) as { id: string }[]).map((r) => r.id)
  const brand = client?.company_name ?? 'your brand'

  if (!latestRun) {
    return (
      <PageFrame>
        <PageBar title="Voice of Customer" context="What are they saying?">
          <HowToRead items={LEGEND_ITEMS} open={showLegend} basePath="/dashboard/voice" />
        </PageBar>
        <PageGrid>
          <Tile col={12} row={2} eyebrow="The conversation, by theme">
            <TileEmpty>Your customer voices land with your first update — check back then.</TileEmpty>
          </Tile>
        </PageGrid>
      </PageFrame>
    )
  }
  const runId = latestRun.id as string

  const [themesRes, historyRows, summaryRows, samplesRes, emotionRows] = await Promise.all([
    supabase.from('themes')
      .select('id, registry_id, bucket, category, label, description, member_themes, supporting_insight_ids, supporting_video_ids, evidence_count, strength_score, rank_score, dominant_emotion, dominant_sentiment_impact, single_source, first_seen')
      .eq('client_id', clientId).eq('run_id', runId)
      .order('evidence_count', { ascending: false })
      .order('rank_score', { ascending: false, nullsFirst: false }),
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
      .limit(detail === 'language' ? PHRASES_DRAWER : PHRASES_SHOWN),
    // Population read of the current analysis → the *_current view (AGENTS.md).
    selectAll<{ id: string; emotion: string | null }>(() =>
      supabase.from('audience_insights_current').select('id, emotion').eq('client_id', clientId).order('id', { ascending: true }),
    ),
  ])

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

  // ---- bucket vocabulary (raw bucket values are never client-facing) ----
  const competitorName = (bucket: string) => bucket.replace(/^competitor:/, '')
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

  // Journey stage + platform per insight, read by id from the base table (the
  // ids come from THIS update's themes; a newer in-flight update may already
  // have superseded some of those videos' rows in the current view).
  const insightMeta = new Map(
    (await fetchInsightsByIds<{ id: string; journey_stage: string | null; platform: string | null }>(
      supabase, themes.flatMap((t) => t.supporting_insight_ids ?? []), 'id, journey_stage, platform',
    )).map((i) => [i.id, i]),
  )
  const stagesPresent = new Set([...insightMeta.values()].map((i) => i.journey_stage).filter(Boolean))

  // ---- filters ----
  const inEntity = (t: ThemeRow) => entityFilter === 'all' || t.bucket === entityFilter
  const shown = themes.filter((t) =>
    inEntity(t) &&
    (!deepLinked || t.member_themes.some((slug) => groundingSlugs.has(slug))) &&
    (typeFilter === 'all' || t.category === typeFilter) &&
    (stageFilter === 'all' || t.supporting_insight_ids.some((id) => insightMeta.get(id)?.journey_stage === stageFilter)) &&
    Number(t.strength_score ?? 0) >= minScore,
  )
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

  // ---- the map: the widest-heard confirmed themes under the current filters.
  // A deep link shows exactly the themes behind that insight, singles included.
  const mapPool = (deepLinked ? shown : tiers.confirmed)
    .slice()
    .sort((a, b) => b.evidence_count - a.evidence_count || Number(b.rank_score ?? 0) - Number(a.rank_score ?? 0))
  const blocks: ThemeBlock[] = mapPool.slice(0, MAP_BLOCKS).map((t) => ({
    id: t.id,
    label: t.label,
    count: t.evidence_count,
    bucket: bucketKind(t.bucket),
    category: categoryLabel(t.category),
    categoryClass: categoryTint(t.category),
    isNew: showNew && t.first_seen,
    series: historyOf(t)?.evidence,
    href: hrefWith({ detail: t.id }),
  }))

  // ---- the ribbon: five verbatim voices from the top themes, scoped to the
  // current audience; redacted (demographic) evidence never reaches it.
  const ribbonThemes = mapPool.slice(0, RIBBON_THEMES)
  const citations = await fetchQuoteCitationsByAudience(
    supabase, ribbonThemes.flatMap((t) => t.supporting_insight_ids.slice(0, QUOTE_IDS_PER_THEME)),
  )
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
  const cards = ribbon.cards.map(({ quote: c }) => {
    const meta = c.citation.commentId ? commentMeta.get(c.citation.commentId) : undefined
    const platform = meta?.platform ?? insightMeta.get(c.insightId)?.platform ?? null
    const who = [
      platform ? platformLabel(platform) : null,
      meta?.likes && meta.likes > 0 ? `${fmtCompact(meta.likes)} likes` : null,
      c.theme.bucket === 'client' ? 'your audience' : c.theme.bucket.startsWith('competitor:') ? `${competitorName(c.theme.bucket)}’s audience` : null,
    ].filter(Boolean).join(' · ')
    return { theme: c.theme, quote: c.quote, who }
  })

  // ---- audience mood: the feeling Pass A read on each insight, counted —
  // scoped to the selected audience through its themes' member insights.
  const entityInsightIds = entityFilter === 'all' ? null : new Set(themes.filter(inEntity).flatMap((t) => t.supporting_insight_ids))
  const moods = topEmotions(emotionRows.filter((r) => !entityInsightIds || entityInsightIds.has(r.id)).map((r) => r.emotion), 3)
  const moodMax = moods[0]?.pct ?? 0
  const MOOD_COLOR = { positive: 'var(--positive)', negative: 'var(--accent-clay)', neutral: 'var(--input)' } as const

  // ---- theme drawer (?detail=<themeId>) ----
  const detailTheme = detail ? themes.find((t) => t.id === detail) ?? null : null
  const detailQuotes: string[] = []
  let detailWithheld = 0
  if (detailTheme) {
    // Counts-not-quotes: demographic evidence cites but never quotes — its rows
    // carry redacted = true and an empty quote; counted here, never rendered.
    const { data } = await supabase
      .from('insight_evidence').select('audience_insight_id, quote, relevance_rank, redacted')
      .in('audience_insight_id', detailTheme.supporting_insight_ids.slice(0, QUOTE_IDS_PER_THEME))
      .order('relevance_rank', { ascending: true })
    const seen = new Set<string>()
    for (const ev of (data ?? []) as { quote: string; redacted: boolean | null }[]) {
      if (ev.redacted || !ev.quote) { detailWithheld++; continue }
      const q = cleanQuote(ev.quote)
      if (seen.has(q.toLowerCase()) || detailQuotes.length >= DETAIL_QUOTES) continue
      seen.add(q.toLowerCase())
      detailQuotes.push(q)
    }
  }
  const detailHistory = detailTheme ? historyOf(detailTheme) : undefined

  const earlyInView = tiers.early.length
  const legendItems: GlossaryKey[] = showNew ? [...LEGEND_ITEMS, 'new'] : LEGEND_ITEMS
  const mapEmptyLine = themes.length === 0
    ? 'Your customer voices are being organised into themes — they land with your next update.'
    : deepLinked && shown.length === 0
      ? 'None of this update’s themes sit behind that insight any more — clear the filter to see the whole conversation.'
      : shown.length === 0 ? 'No themes match these filters.' : 'No confirmed theme matches these filters — the early signals and single mentions are in the list.'

  return (
    <PageFrame>
      <PageBar title="Voice of Customer" context={`What are they saying? · ${weekdayDate(runDate)}`}>
        {themes.length > 0 && entities.length > 1 && (
          <>
            <Link href={hrefWith({ entity: null, type: null, themes: null, detail: null })} scroll={false}>
              <BarPill active={entityFilter === 'all'}>All audiences</BarPill>
            </Link>
            {entities.map((e) => (
              <Link key={e.bucket} href={hrefWith({ entity: e.bucket, type: null, themes: null, detail: null })} scroll={false}>
                <BarPill active={entityFilter === e.bucket}>
                  {e.bucket === 'client' ? 'Yours' : e.bucket === 'industry-other' ? 'Category' : `${competitorName(e.bucket)}’s`}
                  <span className="font-mono text-[11px] font-medium tabular-nums text-muted-foreground">{e.confirmed}</span>
                </BarPill>
              </Link>
            ))}
          </>
        )}
        <HowToRead items={legendItems} open={showLegend} basePath="/dashboard/voice" />
      </PageBar>

      <PageGrid>
        {/* ── hero: the theme map ─────────────────────────────────────── */}
        <Tile col={8} row={4} eyebrow="The conversation, by theme"
          meta={themes.length > 0 ? `${tiersAll.confirmed.length} confirmed · ${tiersAll.early.length} early · ${tiersAll.heardOnce.length} heard once · block size = conversations this update` : undefined}
          bodyClassName="gap-1.5"
          footer={themes.length > 0 ? (
            <span className="flex items-center gap-2">
              <Link href={hrefWith({ detail: 'list' })} scroll={false}>All {fmtInt(shown.length)} themes as a list →</Link>
              {blocks.length > 0 && <span className="font-normal text-muted-foreground">top {blocks.length} shown · click a block to hear its voices</span>}
            </span>
          ) : undefined}
          footerNote={themes.length > 0 ? <BucketLegend competitor={leadCompetitor ? competitorName(leadCompetitor) : null} /> : undefined}
        >
          {themes.length > 0 && (
            <div className="-mx-3.5 flex items-end gap-2 border-b border-border/90 px-3.5">
              <div className="flex min-w-0 flex-1 gap-0.5 overflow-x-auto [scrollbar-width:none]">
                <TabLink label="All" count={tiersEntity.confirmed.length} active={typeFilter === 'all'} href={hrefWith({ type: null, detail: null })} />
                {tabs.map((t) => (
                  <TabLink key={t.category} label={t.label} count={t.count} active={typeFilter === t.category} href={hrefWith({ type: t.category, detail: null })} />
                ))}
              </div>
              <div className="pb-1">
                <VoiceFilters stage={stageFilter} min={String(minScore)} deepLinked={deepLinked} showStage={stagesPresent.size > 0} />
              </div>
            </div>
          )}
          {blocks.length > 0 ? (
            <ThemeMap blocks={blocks} className="mt-0.5 min-h-[260px]" />
          ) : (
            <TileEmpty>{mapEmptyLine}</TileEmpty>
          )}
        </Tile>

        {/* ── gaining and fading ─────────────────────────────────────── */}
        <Tile col={4} row={2} eyebrow="Gaining and fading" meta={updatesCount > 1 ? 'conversations · vs last update' : undefined}
          footer={movers.length > 0 ? <Link href={hrefWith({ detail: 'movers' })} scroll={false}>All movers →</Link> : undefined}
          footerNote={movers.length > 0 ? 'themes heard in ≥2 updates' : undefined}
        >
          {updatesCount < 2 ? (
            <TileEmpty>Movement lands with your second update.</TileEmpty>
          ) : movers.length === 0 ? (
            <TileEmpty>No theme has moved clearly yet — {steadyCount > 0 ? `${steadyCount} heard in more than one update, all steady so far` : 'the themes heard so far are all new this update'}.</TileEmpty>
          ) : (
            <div className="flex flex-col gap-[7px] pt-0.5">
              {movers.slice(0, MOVER_ROWS).map((t) => <MoverRow key={t.key} t={t} competitorName={competitorName} />)}
            </div>
          )}
        </Tile>

        {/* ── how your customers talk ────────────────────────────────── */}
        <Tile col={4} row={1} eyebrow="How your customers talk" meta={sampleTotal > 0 ? `${fmtInt(sampleTotal)} phrases` : undefined}
          footer={sampleTotal > 0 ? <Link href={hrefWith({ detail: 'language' })} scroll={false}>Borrow the language →</Link> : undefined}
        >
          {samples.length > 0 ? (
            <div className="flex flex-wrap content-start gap-1 overflow-hidden">
              {samples.slice(0, PHRASES_SHOWN).map((s, i) => (
                <span key={i} title={s.platform ? platformLabel(s.platform) : undefined} className={`${chip} max-w-full truncate bg-muted italic text-[#3F4B44]`}>
                  {s.phrase}
                </span>
              ))}
            </div>
          ) : <TileEmpty>The phrases your customers use land with your next update.</TileEmpty>}
        </Tile>

        {/* ── audience mood ──────────────────────────────────────────── */}
        <Tile col={4} row={1} eyebrow="Audience mood" meta={moods.length > 0 ? `top feelings · of ${fmtInt(moods[0].total)} read` : undefined}>
          {moods.length > 0 ? (
            <div className="flex flex-col gap-[4px]">
              {moods.map((m) => (
                <RankedBar key={m.emotion} label={cap(m.emotion)} pct={moodMax > 0 ? (m.pct / moodMax) * 100 : 0} color={MOOD_COLOR[emotionTone(m.emotion)]} count={fmtPct(m.pct, 0)} barWidth={120} />
              ))}
            </div>
          ) : <TileEmpty>Mood lands with your next update.</TileEmpty>}
        </Tile>

        {/* ── hear these voices ──────────────────────────────────────── */}
        <Tile col={12} row={2} eyebrow="Hear these voices"
          meta={cards.length > 0 ? `${cards.length} of ${fmtInt(ribbon.total)} · rotates on every visit · verbatim, unedited — a clay rule means a real person said this` : undefined}
          footer={cards.length > 0 && ribbon.total > cards.length ? <Link href={hrefWith({ seed: String(seed + 1), detail: null })} scroll={false}>Next five →</Link> : undefined}
          footerNote={themes.length > 0 ? (
            <span>
              <Link href={hrefWith({ detail: 'language' })} scroll={false} className="hover:text-primary">language samples</Link>
              {' and '}
              <Link href={hrefWith({ detail: 'list' })} scroll={false} className="hover:text-primary">early signals ({earlyInView})</Link>
              {' live in the drawer'}
            </span>
          ) : undefined}
        >
          {cards.length > 0 ? (
            <div className="-mx-3 flex min-h-0 flex-1 flex-col items-stretch divide-y divide-border/80 sm:flex-row sm:divide-x sm:divide-y-0">
              {cards.map((c, i) => (
                <Link key={i} href={hrefWith({ detail: c.theme.id })} scroll={false} className="flex min-w-0 flex-1 flex-col gap-1.5 px-3 hover:bg-muted/30">
                  <span className={`${chip} max-w-full self-start truncate ${categoryTint(c.theme.category)}`}>{c.theme.label}</span>
                  <blockquote className="min-h-0 border-l-2 border-clay pl-2 text-[12.5px] italic leading-[1.4] text-foreground/90">
                    <span className="line-clamp-4">“{c.quote}”</span>
                    {c.who && <span className="mt-0.5 block text-[10.5px] not-italic text-muted-foreground">{c.who}</span>}
                  </blockquote>
                </Link>
              ))}
            </div>
          ) : (
            <TileEmpty>{themes.length === 0 ? 'Verbatim voices land with your first analysed update.' : 'No quotable voices under these filters yet — the list has every theme.'}</TileEmpty>
          )}
        </Tile>
      </PageGrid>

      {/* ── drawers: one click deeper ────────────────────────────────── */}
      <DetailDrawer open={!!detailTheme} closeHref={closeHref} title={detailTheme?.label ?? 'Theme'}
        description={detailTheme ? `${bucketName(detailTheme.bucket)} · ${categoryLabel(detailTheme.category)}` : undefined}>
        {detailTheme && (() => {
          const denom = groupSize(detailTheme.bucket)
          const prevalence = prevalenceTier(detailTheme.evidence_count, denom)
          const kind = bucketKind(detailTheme.bucket)
          const pct = denom > 0 ? Math.min(100, Math.round((detailTheme.evidence_count / denom) * 100)) : 0
          return (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-1.5">
                <span title={glossaryRule(prevalence)} className={`${chip} ${PREVALENCE_BADGE[prevalence]}`}>{PREVALENCE_LABEL[prevalence]}</span>
                <span className={`${chip} ${categoryTint(detailTheme.category)}`}>{categoryLabel(detailTheme.category)}</span>
                {detailTheme.dominant_emotion && <span className={`${chip} capitalize bg-muted text-muted-foreground`}>{detailTheme.dominant_emotion}</span>}
                {showNew && detailTheme.first_seen && <span title={glossaryRule('new')} className={`${chip} bg-sidebar-accent text-primary`}>New</span>}
              </div>
              {detailTheme.description && <p className="text-[13px] leading-[1.5] text-foreground/90">{detailTheme.description}</p>}
              <div className="space-y-1.5 border-t border-border/70 pt-3">
                <div className="flex items-baseline gap-1.5">
                  <span className="font-mono text-[22px] font-semibold tabular-nums leading-none" style={{ color: EDGE[kind] }}>{fmtInt(detailTheme.evidence_count)}</span>
                  <span className="text-[11.5px] text-muted-foreground">of {fmtInt(denom)} {groupName(detailTheme.bucket)} conversations</span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted" aria-hidden>
                  <div className="h-full rounded-full" style={{ width: `${Math.max(3, pct)}%`, background: EDGE[kind] }} />
                </div>
              </div>
              {detailHistory && detailHistory.evidence.length >= 2 && (
                <div className="flex items-center gap-3 border-t border-border/70 pt-3">
                  <Sparkline values={detailHistory.evidence} color={EDGE[kind]} width={120} height={30} />
                  <p className="text-[11px] text-muted-foreground">
                    conversations per update, across the {detailHistory.evidence.length} updates this theme has appeared in ({shortDate(detailHistory.dates[0])} → {shortDate(detailHistory.dates[detailHistory.dates.length - 1])})
                  </p>
                </div>
              )}
              {detailQuotes.length > 0 && (
                <div className="space-y-2 border-t border-border/70 pt-3">
                  <p className="text-[10.5px] font-semibold uppercase tracking-[0.07em] text-muted-foreground">The voices behind it</p>
                  {detailQuotes.map((q, n) => (
                    <blockquote key={n} className="border-l-2 border-clay pl-2 text-[12.5px] italic leading-[1.4] text-foreground/90">“{q}”</blockquote>
                  ))}
                  <p className="text-[11px] text-muted-foreground">a sample of the conversations behind this theme</p>
                </div>
              )}
              {detailWithheld > 0 && (
                <p className="text-[11px] text-muted-foreground">
                  {detailWithheld} {detailWithheld === 1 ? 'comment describes' : 'comments describe'} who these commenters are. Counted, not quoted.
                </p>
              )}
            </div>
          )
        })()}
      </DetailDrawer>

      <DetailDrawer open={detail === 'list'} closeHref={closeHref} title={`All ${fmtInt(shown.length)} themes`}
        description={`${entityFilter === 'all' ? 'every audience' : bucketName(entityFilter).toLowerCase()}${typeFilter !== 'all' ? ` · ${categoryLabel(typeFilter).toLowerCase()}` : ''} · widest-heard first`}>
        <div className="space-y-5">
          <ThemeList title="Confirmed" hint="heard in more than one conversation" rows={[...tiers.confirmed].sort((a, b) => b.evidence_count - a.evidence_count)} hrefWith={hrefWith} showNew={showNew} />
          <ThemeList title="Early signals" hint="heard once so far, but clearly" rows={tiers.early} hrefWith={hrefWith} showNew={showNew} />
          <ThemeList title="Heard once" hint="single mentions, kept for the record" rows={tiers.heardOnce} hrefWith={hrefWith} showNew={showNew} compact />
          {shown.length === 0 && <p className="text-muted-foreground">No themes match these filters.</p>}
        </div>
      </DetailDrawer>

      <DetailDrawer open={detail === 'movers'} closeHref={closeHref} title="Gaining and fading" description={`themes heard in ≥2 of your ${updatesCount} updates · conversations per update, delta vs last`}>
        <div className="space-y-5">
          {(['gaining', 'fading', 'emerging'] as const).map((m) => {
            const rows = movers.filter((t) => t.movement === m)
            if (rows.length === 0) return null
            return (
              <section key={m} className="space-y-2">
                <h3 className="text-[10.5px] font-semibold uppercase tracking-[0.07em] text-muted-foreground">
                  {m === 'gaining' ? 'Gaining' : m === 'fading' ? 'Fading' : 'New since your first update'} <span className="font-mono normal-case tracking-normal">{rows.length}</span>
                </h3>
                <div className="flex flex-col gap-2">
                  {rows.map((t) => <MoverRow key={t.key} t={t} competitorName={competitorName} sparkWidth={88} />)}
                </div>
              </section>
            )
          })}
          {steadyCount > 0 && <p className="text-[11px] text-muted-foreground">{steadyCount} more {steadyCount === 1 ? 'theme has' : 'themes have'} held steady across the updates {steadyCount === 1 ? 'it was' : 'they were'} heard in.</p>}
          {movers.length === 0 && <p className="text-muted-foreground">Nothing has moved clearly yet.</p>}
        </div>
      </DetailDrawer>

      <DetailDrawer open={detail === 'language'} closeHref={closeHref} title="How your customers talk" description={`${fmtInt(sampleTotal)} phrases, verbatim — the words to borrow`}>
        <div className="flex flex-wrap gap-1.5">
          {samples.map((s, i) => (
            <span key={i} title={s.platform ? platformLabel(s.platform) : undefined} className="rounded-full bg-muted px-2.5 py-1 text-[12px] italic text-[#3F4B44]">{s.phrase}</span>
          ))}
        </div>
        {sampleTotal > samples.length && <p className="mt-3 text-[11px] text-muted-foreground">showing {fmtInt(samples.length)} of {fmtInt(sampleTotal)}</p>}
      </DetailDrawer>
    </PageFrame>
  )
}

/** One category tab — a Link so the server filters. */
function TabLink({ label, count, active, href }: { label: string; count: number; active: boolean; href: string }) {
  return (
    <Link
      href={href}
      scroll={false}
      className={`-mb-px flex shrink-0 items-baseline gap-1 whitespace-nowrap border-b-2 px-2 pb-1.5 pt-0.5 text-[11.5px] font-medium transition-colors ${
        active ? 'border-primary text-primary' : 'border-transparent text-[#6B756B] hover:text-foreground'
      }`}
    >
      {label}
      <span className="font-mono text-[10.5px] tabular-nums text-muted-foreground/80">{count}</span>
    </Link>
  )
}

/** One gaining/fading row: the Mover chart row for a theme trajectory. A
 *  gaining theme draws green, a fading one clay; an emerging theme is a
 *  "New" row with its count and no delta (nothing before it to compare). */
function MoverRow({ t, competitorName, sparkWidth }: { t: Trajectory; competitorName: (b: string) => string; sparkWidth?: number }) {
  const kind = bucketKind(t.bucket)
  const suffix = kind === 'competitor' ? ` · ${competitorName(t.bucket)}’s` : kind === 'client' ? ' · yours' : ''
  const label = (
    <span className="flex min-w-0 items-center gap-1.5">
      {t.movement === 'emerging' && <span className={`${chip} bg-sidebar-accent text-primary`}>New</span>}
      <span className="truncate">{t.label}{suffix ? <span className="text-muted-foreground">{suffix}</span> : null}</span>
    </span>
  )
  return (
    <Mover
      label={label}
      series={t.evidence}
      value={t.latestEvidence}
      delta={t.movement === 'emerging' ? null : t.evidenceDelta}
      good="up"
      color={t.movement === 'fading' ? 'var(--accent-clay)' : t.movement === 'emerging' ? 'var(--primary)' : 'var(--positive)'}
      sparkWidth={sparkWidth ?? 72}
    />
  )
}

/** A ranked section of the list drawer. */
function ThemeList({ title, hint, rows, hrefWith, showNew, compact }: {
  title: string
  hint: string
  rows: ThemeRow[]
  hrefWith: (o: { detail: string }) => string
  showNew: boolean
  compact?: boolean
}) {
  if (rows.length === 0) return null
  return (
    <section className="space-y-1.5">
      <h3 className="flex items-baseline gap-2 text-[10.5px] font-semibold uppercase tracking-[0.07em] text-muted-foreground">
        {title} <span className="font-mono normal-case tracking-normal">{rows.length}</span>
        <span className="font-normal normal-case tracking-normal opacity-80">{hint}</span>
      </h3>
      <div className="flex flex-col">
        {rows.map((t) => (
          <Link key={t.id} href={hrefWith({ detail: t.id })} scroll={false} className="flex items-center gap-2 rounded-sm py-[3px] hover:bg-muted/50">
            <span className="size-1.5 shrink-0 rounded-full" style={{ background: EDGE[bucketKind(t.bucket)] }} aria-hidden />
            <span className={`min-w-0 flex-1 truncate ${compact ? 'text-[12px] text-muted-foreground' : 'text-[12.5px]'}`}>{t.label}</span>
            {showNew && t.first_seen && <span className={`${chip} bg-sidebar-accent text-primary`}>New</span>}
            {!compact && <span className={`${chip} hidden sm:inline-flex ${categoryTint(t.category)}`}>{categoryLabel(t.category)}</span>}
            <span className="w-7 shrink-0 text-right font-mono text-[11.5px] font-semibold tabular-nums">{t.evidence_count}</span>
          </Link>
        ))}
      </div>
    </section>
  )
}
