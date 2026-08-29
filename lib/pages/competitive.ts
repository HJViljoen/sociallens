import type { SupabaseClient } from '@supabase/supabase-js'
import { selectAll } from '../supabase-admin'
import { rankByTheme, fetchQuotesByAudience, fetchInsightsByIds, createCitedQuotePicker, bucketByAudienceId, scopeToCompetitor, cleanQuote, type ThemeBucketRow } from '../quotes'
import { quoteRef } from '../renderables/quotes-freeze'
import type { Quote, Scope } from '../renderables/types'
import type { GlossaryKey } from '../calibration'
import { fmtInt, fmtPct, weekdayDate, cap } from '../format'
import { shareBreakdown, pointDelta, type Sov } from '../dashboard-tiles'
import {
  leadCompetitor, competitorShares, competitorBucket, bucketStats, themeCounts, faceOffRows, praisedFor, shareSeries,
  orderInsights, groupByKind, coverageOf, coverageText, SENTIMENT_MIN_JUDGED, type VideoStatRow, type FaceOffRow, type ShareSeries,
} from '../competitive-tiles'
import type { MethodNoteData } from '../../components/print/method-note'
import { EXPORT_FULL_MAX_ITEMS } from '../config'

// Competitive Intelligence loader — the data half of the old
// app/dashboard/competitive/page.tsx (split 2026-08-29, Reports & Exports
// T5). "Where do we stand vs <competitor>?": standings, the face-off vs the
// selected competitor, the share line and the full comparison up top; the
// findings — a page inside the page (rail: all · by kind · about a
// competitor; list; the finding with its voices) — beneath. `?vs=` picks the
// competitor; `?kind=`/`?about=`/`?item=` drive the findings block.
//
// Rules kept: every figure is a stored count or share (run_summary
// share_of_voice, videos, themes); model judgments only gate, order and
// word; a finding about a competitor quotes THAT competitor's audience,
// never the client's own customers (scopeToCompetitor). Round trips, not
// rows, are the cost — the waves below are kept exactly as the page had
// them.

interface SummaryRow {
  run_id: string
  run_date: string
  total_videos: number | null
  share_of_voice: Sov | null
  period_share_of_voice: Sov | null
}

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

interface ThemeRow extends ThemeBucketRow {
  run_id: string
  category: string
  label: string
  evidence_count: number | null
  strength_score: number | null
  rank_score: number | null
}

const BASE = '/dashboard/competitive'
export const LEGEND_ITEMS: GlossaryKey[] = ['conversations', 'sentiment']

export type CompetitiveParams = { detail?: string; vs?: string; group?: string; item?: string; kind?: string; about?: string }

/** Hrefs the page uses to keep the overview's competitor and the findings'
 *  state in sync — the same shape the old page's inline `href()` built. Pure. */
export interface CompetitiveHrefParams { vs?: string | null; kind?: string | null; about?: string | null; item?: string | null }
export function competitiveFindingHref(p: CompetitiveHrefParams, hash?: string): string {
  const q = new URLSearchParams()
  for (const k of ['vs', 'kind', 'about', 'item'] as const) if (p[k]) q.set(k, p[k]!)
  const qs = q.toString()
  return `${BASE}${qs ? `?${qs}` : ''}${hash ? `#${hash}` : ''}`
}

const impactWord = (l: string | null) => (l === 'high' ? 'high impact' : l === 'medium' ? 'medium impact' : l === 'low' ? 'low impact' : null)

export interface StandingRow { name: string; pct: number; videos: number; delta: number | null }

export interface FieldRow {
  key: string
  label: string
  color: string
  videos: number
  pct: number
  comments: number | null
  engagement: number | null
  positive: number | null
  judged: number
  themes: number | null
}

export interface FindingListRow {
  id: string
  category: string
  competitorName: string | null
  coverage: { text: string; thin: boolean } | null
  title: string
  finding: string
  search: string
}

export interface FindingDetail {
  id: string
  category: string
  title: string
  competitorName: string | null
  coverage: { text: string; thin: boolean } | null
  impact: string | null
  finding: string
  quotes: Quote[]
  voices: number
  platforms: { label: string; count: number }[]
  support: string[]
  /** The competitor to face off against instead — app-only navigation, null
   *  when there is nothing to switch to (no name, untracked, or already lead). */
  faceOffTarget: string | null
}

export interface CompetitiveData {
  brand: string
  brandShort: string
  runDate: string
  updatesCount: number
  context: string
  layerWord: string
  selection: { vs: string | null; kind: string | null; about: string | null; itemId: string | null }
  standings: { competitors: StandingRow[]; client: StandingRow | null; maxPct: number } | null
  faceoff: {
    lead: string | null
    youPraise: string | null
    themPraise: string | null
    rows: FaceOffRow[]
    leadFindings: number
    youDelta: number | null
    themDelta: number | null
  } | null
  shareLine: { series: ShareSeries | null }
  table: { rows: FieldRow[] }
  rail: {
    insightsCount: number
    kinds: { category: string; label: string; count: number }[]
    competitors: { name: string; count: number }[]
  }
  list: { title: string; meta: string | null; blurb: string | null; searchable: boolean; rows: FindingListRow[]; emptyMessage: string }
  detail: FindingDetail | null
  /** `full` variant only: every finding in the current filter, in full — one
   *  slide each, capped at EXPORT_FULL_MAX_ITEMS. */
  allFindings?: FindingDetail[]
  legendItems: GlossaryKey[]
  method: MethodNoteData
}

export type CompetitiveEmpty = { empty: true; brand: string; nextUpdate: string }

export const isCompetitiveEmpty = (d: CompetitiveData | CompetitiveEmpty): d is CompetitiveEmpty => 'empty' in d

export async function loadCompetitive(scope: Scope): Promise<CompetitiveData | CompetitiveEmpty> {
  const supabase = scope.supabase as SupabaseClient
  const clientId = scope.clientId
  const sp = scope.params as CompetitiveParams
  const full = scope.variant === 'full'

  // Anchor on the newest update WITH analysis; an in-flight one has no
  // findings yet and would blank the page for the duration of every update.
  const [{ data: client }, { data: tc }, { data: latestRun }, runningRes, historyRaw] = await Promise.all([
    supabase.from('clients').select('company_name').eq('id', clientId).maybeSingle(),
    supabase.from('tracking_configs').select('report_day, report_period').eq('client_id', clientId).maybeSingle(),
    supabase.from('pipeline_runs').select('id, started_at')
      .eq('client_id', clientId).in('status', ['completed', 'partial'])
      .order('started_at', { ascending: false }).limit(1).maybeSingle(),
    supabase.from('pipeline_runs').select('id').eq('client_id', clientId).eq('status', 'running'),
    selectAll<SummaryRow>(() =>
      supabase.from('run_summary').select('run_id, run_date, total_videos, share_of_voice, period_share_of_voice')
        .eq('client_id', clientId).order('run_date', { ascending: true }),
    ),
  ])
  const runningIds = ((runningRes.data ?? []) as { id: string }[]).map((r) => r.id)
  const notRunning = runningIds.length ? `(${runningIds.join(',')})` : null
  const brand = client?.company_name ?? 'Your brand'
  const brandShort = brand.split(/\s[—–-]\s/)[0].trim() || brand
  const runId = latestRun?.id as string | undefined
  const nextUpdate = tc?.report_period === 'weekly' && tc?.report_day ? `${cap(tc.report_day)}’s update` : 'the next update'

  if (!runId) return { empty: true, brand, nextUpdate }

  // ── the update's state + its history + this update's videos ───────────
  let themedQ = supabase.from('themes').select('run_id').eq('client_id', clientId)
  if (notRunning) themedQ = themedQ.not('run_id', 'in', notRunning)
  let latestVidQ = supabase.from('videos').select('run_id').eq('client_id', clientId)
  if (notRunning) latestVidQ = latestVidQ.not('run_id', 'in', notRunning)
  const [ciRes, latestThemedRes, latestVidRes] = await Promise.all([
    supabase.from('competitive_insights').select('id, category, competitor_name, title, finding, evidence, impact_level, hero_quote')
      .eq('client_id', clientId).eq('run_id', runId),
    themedQ.order('created_at', { ascending: false }).limit(1).maybeSingle(),
    latestVidQ.order('scraped_at', { ascending: false }).limit(1).maybeSingle(),
  ])
  const themedRunId = (latestThemedRes.data?.run_id as string | undefined) ?? null
  const videoRunId = (latestVidRes.data?.run_id as string | undefined) ?? null
  const [themeRows, videoRows] = await Promise.all([
    themedRunId
      ? selectAll<ThemeRow>(() =>
          supabase.from('themes').select('run_id, bucket, category, label, evidence_count, strength_score, rank_score, supporting_insight_ids')
            .eq('client_id', clientId).eq('run_id', themedRunId).order('id'),
        )
      : Promise.resolve([] as ThemeRow[]),
    videoRunId
      ? selectAll<VideoStatRow>(() =>
          supabase.from('videos').select('is_client, is_competitor, competitor_name, comments_count, engagement_rate, sentiment, sentiment_source, analyzed_lane')
            .eq('client_id', clientId).eq('run_id', videoRunId).eq('source', 'discovered').order('id'),
        )
      : Promise.resolve([] as VideoStatRow[]),
  ])

  const history = historyRaw.filter((s) => s.run_id && !runningIds.includes(s.run_id))
  const summary = history.find((s) => s.run_id === runId) ?? history[history.length - 1] ?? null
  const summaryIdx = summary ? history.indexOf(summary) : -1
  const prev = summaryIdx > 0 ? history[summaryIdx - 1] : null
  const runDate = summary?.run_date ?? (latestRun?.started_at as string)
  const updatesCount = history.length

  // ── the competitors, on which layer ────────────────────────────────────
  const hasKeys = (o: Sov | null | undefined) => !!o && Object.keys(o).length > 0
  let faceLayer: 'period' | 'cumulative' = hasKeys(summary?.period_share_of_voice) ? 'period' : 'cumulative'
  let faceSov = faceLayer === 'period' ? summary?.period_share_of_voice : summary?.share_of_voice
  if (!leadCompetitor(faceSov, null) && faceLayer === 'period' && leadCompetitor(summary?.share_of_voice, null)) {
    faceLayer = 'cumulative'
    faceSov = summary?.share_of_voice
  }
  const prevSov = faceLayer === 'period' ? prev?.period_share_of_voice : prev?.share_of_voice
  const competitors = competitorShares(faceSov)
  const share = shareBreakdown(faceSov)
  const sharePrev = shareBreakdown(prevSov)
  const stats = videoRows.length > 0 && videoRunId === runId ? bucketStats(videoRows) : null
  const themesByBucket = themeRows.length > 0 ? themeCounts(themeRows) : null

  // ── findings ───────────────────────────────────────────────────────────
  const insights = orderInsights((ciRes.data ?? []) as CompetitiveInsight[])
  const kinds = groupByKind(insights)
  const findingsByCompetitor = new Map<string, number>()
  for (const ci of insights) if (ci.competitor_name) findingsByCompetitor.set(ci.competitor_name, (findingsByCompetitor.get(ci.competitor_name) ?? 0) + 1)

  // ── selection ──────────────────────────────────────────────────────────
  const byName = (want: string | undefined | null, names: string[]) => (want ? names.find((n) => n.toLowerCase() === want.toLowerCase()) ?? null : null)
  // Old links: ?group=faceoff&item=<competitor> meant "vs that competitor".
  const legacyVs = sp.group === 'faceoff' && sp.item ? sp.item : null
  const lead = byName(sp.vs ?? legacyVs, competitors.map((c) => c.name)) ?? competitors[0]?.name ?? null
  const kind = sp.kind && kinds.some((g) => g.category === sp.kind) ? sp.kind : null
  const about = byName(sp.about, [...findingsByCompetitor.keys()])
  const findingsShown = insights.filter((ci) => (!kind || ci.category === kind) && (!about || ci.competitor_name === about))
  const itemId = sp.item && findingsShown.some((ci) => ci.id === sp.item) ? sp.item : (findingsShown[0]?.id ?? null)
  const selected = itemId ? insights.find((ci) => ci.id === itemId) ?? null : null

  // ── the face-off vs the selected competitor ────────────────────────────
  const rows = lead ? faceOffRows({ sov: faceSov, layer: faceLayer, competitor: lead, stats, themes: themesByBucket, fmtInt, fmtPct }) : []
  const youPraise = praisedFor(themeRows, 'client')
  const themPraise = lead ? praisedFor(themeRows, competitorBucket(lead)) : null
  const youDelta = pointDelta(share?.client?.pct, sharePrev?.client?.pct)
  const themDelta = lead ? pointDelta(share?.competitors.find((c) => c.name === lead)?.pct, sharePrev?.competitors.find((c) => c.name === lead)?.pct) : null
  const series = lead ? shareSeries(history, lead) : null
  const YOU_COLOR = 'var(--you)'
  const THEM_COLOR = 'var(--comp)'
  const COMP_DIM = 'color-mix(in srgb, var(--comp) 55%, var(--tile))'
  const fieldRows: FieldRow[] = share
    ? [
        ...(share.client ? [{ key: 'client', label: `${brandShort} · you`, color: YOU_COLOR, videos: share.client.videos, pct: share.client.pct }] : []),
        ...share.competitors.map((c) => ({ key: competitorBucket(c.name), label: c.name, color: c.name === lead ? THEM_COLOR : COMP_DIM, videos: c.videos, pct: c.pct })),
        ...(share.rest ? [{ key: 'industry-other', label: 'Wider category', color: 'var(--cat)', videos: share.rest.videos, pct: share.rest.pct }] : []),
      ].map((r) => {
        const s = stats?.get(r.key)
        return {
          ...r,
          comments: s ? s.comments : null,
          engagement: s?.avgEngagement ?? null,
          positive: s && s.judged >= SENTIMENT_MIN_JUDGED ? (s.positive / s.judged) * 100 : null,
          judged: s?.judged ?? 0,
          themes: themesByBucket?.get(r.key) ?? null,
        }
      })
    : []
  const maxPct = Math.max(share?.client?.pct ?? 0, ...competitors.map((c) => c.pct), 1)

  // ── the selected finding(s) + their voices (shared lib/quotes) ─────────
  const citedIds = new Set<string>()
  for (const ci of insights) for (const id of ci.evidence?.supporting_theme_ids ?? []) citedIds.add(id)
  for (const t of themeRows) for (const id of t.supporting_insight_ids ?? []) citedIds.add(id)
  const audienceInsights = insights.length > 0
    ? await fetchInsightsByIds<{ id: string; theme: string; platform: string | null }>(supabase, [...citedIds], 'id, theme, platform')
    : []
  const themeSlugById = new Map(audienceInsights.map((a) => [a.id, a.theme]))
  const platformById = new Map(audienceInsights.map((a) => [a.id, a.platform]))
  // A finding about a competitor quotes THAT competitor's audience, never your
  // own customers — presenting one brand's voices as another's is the defect.
  const bucketById = bucketByAudienceId(themeRows)
  const audienceIdsFor = (ci: CompetitiveInsight) => scopeToCompetitor(ci.evidence?.supporting_theme_ids ?? [], bucketById, ci.competitor_name)
  const claimOf = (ci: CompetitiveInsight) => `${ci.title} ${ci.finding}`
  const supportFor = (ci: CompetitiveInsight) => [...new Set((ci.evidence?.supporting_theme_ids ?? []).map((id) => themeSlugById.get(id)).filter((s): s is string => !!s))].slice(0, 4)
  const coverageFor = (ci: CompetitiveInsight) => coverageText(coverageOf(summary?.share_of_voice, ci.competitor_name))
  const trackedNames = new Set(competitors.map((c) => c.name))

  // The finding's own quotes + hero-quote lead, cited so a snapshot can freeze
  // the words and resolve them live (dashboard.ts's heroCited pattern).
  const shapeFinding = (ci: CompetitiveInsight, ids: string[], pick: ReturnType<typeof createCitedQuotePicker>): FindingDetail => {
    const byPlatform = new Map<string, number>()
    for (const id of ids) { const pl = platformById.get(id) ?? 'other'; byPlatform.set(pl, (byPlatform.get(pl) ?? 0) + 1) }
    const platforms = [...byPlatform.entries()].sort((a, b) => b[1] - a[1]).map(([pl, count]) => ({ label: pl === 'other' ? 'Other' : cap(pl), count }))
    const claim = claimOf(ci)
    const cited = pick(ids, 3, claim, ci.hero_quote)
    const hero = ci.hero_quote ? cleanQuote(ci.hero_quote) : ''
    const heroCited = hero !== '' && cited.some((q) => q.text.toLowerCase() === hero.toLowerCase())
    const quotes: Quote[] = hero && !heroCited ? [{ ref: quoteRef.hero('competitive_insights', ci.id), text: hero }, ...cited].slice(0, 3) : cited
    return {
      id: ci.id, category: ci.category, title: ci.title, competitorName: ci.competitor_name,
      coverage: coverageFor(ci), impact: impactWord(ci.impact_level), finding: ci.finding,
      quotes, voices: ids.length, platforms, support: supportFor(ci),
      faceOffTarget: ci.competitor_name && trackedNames.has(ci.competitor_name) && ci.competitor_name !== lead ? ci.competitor_name : null,
    }
  }

  let detail: FindingDetail | null = null
  if (selected) {
    const ids = audienceIdsFor(selected)
    const pool = rankByTheme(ids, claimOf(selected), themeSlugById).slice(0, 120)
    const quotesByAudience = await fetchQuotesByAudience(supabase, pool)
    const pick = createCitedQuotePicker(quotesByAudience, themeSlugById)
    detail = shapeFinding(selected, ids, pick)
  }

  // `full` (print): every finding under the current filter, in full — one
  // quote read for all of them (chunked), a single shared picker so no voice
  // repeats across the deck. Capped: a deck with sixty finding slides is one
  // nobody presents.
  let allFindings: FindingDetail[] | undefined
  if (full) {
    const wanted = findingsShown.slice(0, EXPORT_FULL_MAX_ITEMS)
    const idsByFinding = wanted.map((ci) => audienceIdsFor(ci))
    const allIds = [...new Set(idsByFinding.flat())]
    const quotesByAudience = await fetchQuotesByAudience(supabase, allIds)
    const pick = createCitedQuotePicker(quotesByAudience, themeSlugById)
    allFindings = wanted.map((ci, i) => shapeFinding(ci, idsByFinding[i], pick))
  }

  const emptyFindingsReason = competitors.length === 0
    ? 'No competitor videos drew enough comments this update — the consumer voice about them mostly lives in creator and category content not yet tied to a competitor.'
    : 'Competitor videos were tracked, but not enough of them drew comments to form a comparable theme — so there was only one brand to read, and the cross-brand analysis waited.'

  const layerWord = faceLayer === 'period' ? 'this update' : 'all updates'
  const context = `${lead ? `Where do we stand vs ${lead}?` : 'Where do we stand?'} · ${weekdayDate(runDate)}`
  const leadFindings = lead ? findingsByCompetitor.get(lead) ?? 0 : 0

  const standingRow = (name: string, pct: number, videos: number, delta: number | null): StandingRow => ({ name, pct, videos, delta })
  const standings = competitors.length > 0 ? {
    competitors: competitors.map((c) => standingRow(c.name, c.pct, c.videos, pointDelta(c.pct, sharePrev?.competitors.find((p) => p.name === c.name)?.pct))),
    client: share?.client ? standingRow(`${brandShort} · you`, share.client.pct, share.client.videos, youDelta) : null,
    maxPct,
  } : null

  const kindOfCategory = new Map(kinds.map((g) => [g.category, g.kind]))
  const listTitle = kind ? kindOfCategory.get(kind)?.label ?? 'Findings' : about ? `About ${about}` : 'All findings'
  const listBlurb = kind ? kindOfCategory.get(kind)?.blurb ?? null : null

  const legendItems: GlossaryKey[] = LEGEND_ITEMS

  return {
    brand, brandShort, runDate, updatesCount, context, layerWord,
    selection: { vs: lead, kind, about, itemId },
    standings,
    faceoff: lead ? { lead, youPraise, themPraise, rows, leadFindings, youDelta, themDelta } : null,
    shareLine: { series },
    table: { rows: fieldRows },
    rail: {
      insightsCount: insights.length,
      kinds: kinds.map((g) => ({ category: g.category, label: g.kind.label, count: g.items.length })),
      competitors: [...findingsByCompetitor.entries()].sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, count })),
    },
    list: {
      title: listTitle,
      meta: findingsShown.length > 0 ? `${findingsShown.length} finding${findingsShown.length === 1 ? '' : 's'}` : null,
      blurb: listBlurb,
      searchable: findingsShown.length > 3,
      rows: findingsShown.map((ci) => ({
        id: ci.id, category: ci.category, competitorName: ci.competitor_name, coverage: coverageFor(ci),
        title: ci.title, finding: ci.finding,
        search: `${ci.title} ${ci.finding} ${ci.competitor_name ?? ''} ${kindOfCategory.get(ci.category)?.label ?? ''}`,
      })),
      emptyMessage: insights.length === 0 ? `No cross-brand findings this update. ${emptyFindingsReason}` : 'No findings of this kind this update.',
    },
    detail,
    allFindings,
    legendItems,
    method: {
      company: brand,
      period: `Update of ${weekdayDate(runDate)}`,
      platforms: [],
      videos: summary?.total_videos != null ? Number(summary.total_videos) : null,
      comments: null,
      note: `${insights.length} cross-brand finding${insights.length === 1 ? '' : 's'} this update · share and videos are stored counts, comments as platforms report them.`,
    },
  }
}
