import type { SupabaseClient } from '@supabase/supabase-js'
import { selectAll } from '../supabase-admin'
import { cleanQuote } from '../quotes'
import { quoteRef } from '../renderables/quotes-freeze'
import type { Quote, Scope } from '../renderables/types'
import { fmtInt, weekdayDate } from '../format'
import { accountSeries, type AccountSeries, type SnapshotRow } from '../dashboard-tiles'
import {
  engageDeepLink, engageVocab, loadEngageCandidates, rankEngageCandidates,
  type EngageCandidate,
} from '../engage'
import { periodWindowDays } from '../config'
import {
  perfVsMedian, medianEngagement, bestDuration, fieldSentence, topVoices, roleByAccount, handleKey,
  entityScoreboard, durationPerf, entityPlaybooks, trendingSounds, entityKey, shapeInbox, intentCounts, isIntent,
  type PerfMultiple, type DurationVerdict, type Voice,
  type EntityRow, type EntityPlaybook, type EntityKind,
  type Intent, type InboxRow, type InboxSource,
} from '../content-tiles'
import type { MethodNoteData } from '../../components/print/method-note'

// Content loader — the data half of the old app/dashboard/videos/page.tsx +
// engage-section.tsx (split 2026-08-29, Reports & Exports T7). "What content
// works, and who to answer?": the playbook (hooks + formats as multiples of
// the median video, best length, top sound) leads, the reply inbox sits beside
// it, then the field this update, top voices and the client's own accounts.
//
// TWO run anchors, kept separate (do not unify them): the video tiles anchor
// on the newest update WITH videos (`latestVid`, excluding in-flight runs);
// the reply inbox anchors inside loadEngageDigest, on the latest
// completed/partial run — an analysis-only update re-reads old videos and
// gathers none, so the two can point at different updates while a new one is
// mid-flight. Numbers rule: counts, views and measured engagement are the
// only figures; hook styles, formats and insight categories only group and
// order. A third party's words travel only inside a Quote.text — never a
// hero_quote, theySay or comment text sitting bare in this data.

interface VideoRow {
  id: string
  platform: string
  account_name: string
  account_followers: number | null
  video_url: string
  views: number | null
  likes: number | null
  engagement_rate: number | null
  upload_date: string | null
  duration_seconds: number | null
  audio_name: string | null
  transcript_status: string | null
  is_client: boolean
  is_competitor: boolean
  competitor_name: string | null
  sentiment: string | null
  classified_type: string | null
  hook_style: string | null
  hook_text: string | null
  topics: string[] | null
}

/** Max catalog rows rendered in the "All videos" drawer/slide (the query
 *  stays uncapped — the tiles need the full update). */
const CATALOG_CAP = 100
/** Accounts in the "All voices" drawer, and in the tile. */
const VOICES_ALL = 12
const VOICES_SHOWN = 5
/** Hook styles / formats listed per column in "What works right now". */
const PERF_SHOWN = 6

export type ContentParams = { detail?: string; intent?: string }

export interface ContentSelection {
  intent: Intent | null
  detail: string | undefined
}

// ── the reply inbox ─────────────────────────────────────────────────────────

export interface ContentInboxRow extends Quote {
  id: string
  intent: Intent
  age: string | null
  /** "under your post · 41 likes" / "under @handle’s post" / "under a category video". */
  context: string
  /** The row IS the quote (ref `m:<comments.id>`, the comment as posted): the
   *  freeze/resolve walk drops an erased comment's whole row, link and all. */
  ref: string
  text: string
  platform: string
  /** Where "reply" lands — a URL, never a stored quote (fine to keep as-is). */
  href: string | null
  commentLevel: boolean
  insightId: string
  category: string
  /** audience_insights.theme — a machine slug; the renderer humanizes it. */
  theme: string
}

export interface EngageInsightDetail {
  insightId: string
  theme: string
  category: string
  description: string | null
  /** Each entry is a Quote (ref `e:<evidence id>`) plus its platform. */
  quotes: (Quote & { platform: string })[]
}

/** insight_evidence.id → EngageCandidate.evidenceId (lib/engage.ts), so an
 *  evidence quote freezes through its own row rather than the comment's. */
export function toContentInboxRows(rows: InboxRow<EngageCandidate & InboxSource>[]): ContentInboxRow[] {
  return rows.map((row) => {
    const c = row.src
    const link = c.category === 'misinformation' ? { href: null, commentLevel: false } : engageDeepLink(c.comment)
    return {
      id: c.id,
      intent: row.intent,
      age: row.age,
      context: row.context,
      ref: quoteRef.message(c.id),
      text: cleanQuote(c.comment.text),
      platform: c.comment.platform,
      href: link.href,
      commentLevel: link.commentLevel,
      insightId: c.insightId,
      category: c.category,
      theme: c.theme,
    }
  })
}

/** The "Why it surfaced" evidence behind one insight — every candidate
 *  (not just the ranked/capped ones the inbox shows) that cites it, so a
 *  reader sees the full weight behind the theme, not just what made the cut. */
export function buildEngageDetail(candidates: EngageCandidate[], detail: string | undefined): EngageInsightDetail | null {
  if (!detail?.startsWith('engage-')) return null
  const insightId = detail.slice('engage-'.length)
  const matches = candidates.filter((c) => c.insightId === insightId)
  const first = matches[0]
  if (!first) return null
  return {
    insightId,
    theme: first.theme,
    category: first.category,
    description: first.description ?? null,
    quotes: matches.map((c) => ({ platform: c.comment.platform, ref: quoteRef.evidence(c.evidenceId), text: cleanQuote(c.comment.text) })),
  }
}

interface EngageDigest {
  windowDays: number
  /** Reply-worthy candidates, ranked (lib/engage.ts caps apply). */
  engage: EngageCandidate[]
  /** Misinformation, awareness only. */
  flagged: EngageCandidate[]
  /** Every candidate this update — the "why it surfaced" detail reads from here. */
  candidates: EngageCandidate[]
}

/** The digest's data, ready to shape — null before the first completed update.
 *  Its own anchor (latest completed/partial run), separate from the video
 *  tiles' `latestVid` — see the file header. */
async function loadEngageDigest(supabase: SupabaseClient, clientId: string): Promise<EngageDigest | null> {
  const { data: run } = await supabase
    .from('pipeline_runs')
    .select('id, started_at')
    .eq('client_id', clientId)
    .in('status', ['completed', 'partial'])
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (!run) return null

  const { data: config } = await supabase
    .from('tracking_configs')
    .select('report_period, brand_keywords, competitor_keywords, industry_keywords')
    .eq('client_id', clientId)
    .maybeSingle()
  const windowDays = periodWindowDays((config?.report_period as string) ?? 'weekly')
  const windowStart = new Date(Date.parse(run.started_at as string) - windowDays * 86_400_000).toISOString()
  const vocab = engageVocab([config?.brand_keywords, config?.competitor_keywords, config?.industry_keywords])

  const candidates = await loadEngageCandidates(supabase, clientId, run.id as string)
  const engage = rankEngageCandidates(
    candidates.filter((c) => c.category !== 'misinformation'),
    { windowStart, vocab },
  )
  const flagged = rankEngageCandidates(
    candidates.filter((c) => c.category === 'misinformation'),
    { windowStart, perCategoryCap: 3, totalCap: 3, vocab },
  )
  return { windowDays, engage, flagged, candidates }
}

// ── what works right now ────────────────────────────────────────────────────

export interface ContentWorksData {
  hooks: PerfMultiple[]
  formats: PerfMultiple[]
  perfMax: number
  duration: DurationVerdict | null
  topSound: { name: string; count: number } | null
}

// ── the field this update ───────────────────────────────────────────────────

export interface ContentFieldRow extends EntityRow {
  color: string
}

export interface ContentFieldData {
  rows: ContentFieldRow[]
  sentence: string | null
  engMax: number
  /** Entities in the scoreboard but not shown (past the top-2 competitors). */
  hiddenCount: number
  totalVideos: number
  analysedVideos: number
}

const KIND_COLOR: Record<EntityKind, string> = { you: 'var(--you)', competitor: 'var(--comp)', category: 'var(--cat)' }
const COMPETITOR_COLORS = ['var(--comp)', 'color-mix(in srgb, var(--comp) 70%, var(--tile))', 'color-mix(in srgb, var(--comp) 48%, var(--tile))', 'var(--mixed)']

// ── your accounts ───────────────────────────────────────────────────────────

export interface ContentAccountsData {
  series: AccountSeries[]
  topEvent: { platform: string; magnitude_label: string; explained: boolean; explanation: string | null } | null
  explainedPlatforms: string[]
}

interface EventRow {
  platform: string
  metric: string
  event_date: string
  severity: number
  explained: boolean
  magnitude_label: string
  explanation: string | null
}

// ── the catalog ──────────────────────────────────────────────────────────────

export interface ContentCatalogRow {
  id: string
  platform: string
  account: string
  videoUrl: string
  hasTranscript: boolean
  entityLabel: string
  entityKind: EntityKind
  uploadDate: string | null
  durationSeconds: number
  views: number
  likes: number | null
  engagementRate: number | null
  sentiment: string | null
  format: string | null
  hook: string | null
  topics: string[]
}

function toCatalogRow(v: VideoRow): ContentCatalogRow {
  const { label, kind } = entityKey(v)
  return {
    id: v.id, platform: v.platform, account: v.account_name, videoUrl: v.video_url,
    hasTranscript: v.transcript_status === 'ok',
    entityLabel: label, entityKind: kind,
    uploadDate: v.upload_date,
    durationSeconds: Number(v.duration_seconds) || 0,
    views: Number(v.views) || 0,
    likes: v.likes != null ? Number(v.likes) : null,
    engagementRate: v.engagement_rate != null ? Number(v.engagement_rate) : null,
    sentiment: v.sentiment, format: v.classified_type, hook: v.hook_style,
    topics: v.topics ?? [],
  }
}

export interface ContentData {
  updateDate: string | null
  context: string
  works: ContentWorksData
  inbox: { total: number; counts: { intent: Intent; count: number }[]; windowDays: number | null; rows: ContentInboxRow[] }
  field: ContentFieldData
  voices: { shown: Voice[]; all: Voice[]; max: number }
  accounts: ContentAccountsData
  playbooks: EntityPlaybook[]
  catalog: { rows: ContentCatalogRow[]; total: number }
  engageDetail: EngageInsightDetail | null
  selection: ContentSelection
  method: MethodNoteData
}

export type ContentEmpty = { empty: true }

export const isContentEmpty = (d: ContentData | ContentEmpty): d is ContentEmpty => 'empty' in d

export async function loadContent(scope: Scope): Promise<ContentData | ContentEmpty> {
  const supabase = scope.supabase as SupabaseClient
  const clientId = scope.clientId
  const sp = scope.params as ContentParams
  const intentFilter = isIntent(sp.intent) ? sp.intent : null

  // Only the anchor query below needs the in-flight run ids; everything else
  // is keyed on the client alone, so it goes out in the same wave as the
  // running-runs lookup — round trips, not rows, are the cost (the DB pays a
  // ~0.5s wake-up on the first requests after idle, and every sequential wave
  // pays it again). `client` (company name) is the one addition this split
  // makes: every page's method note needs a company, and nothing on this page
  // read it before.
  const [{ data: runningRuns }, { data: tc }, { data: client }, digest, snapRows, { data: eventData }] = await Promise.all([
    supabase.from('pipeline_runs').select('id').eq('client_id', clientId).eq('status', 'running'),
    supabase.from('tracking_configs').select('own_handles').eq('client_id', clientId).maybeSingle(),
    supabase.from('clients').select('company_name').eq('id', clientId).maybeSingle(),
    loadEngageDigest(supabase, clientId),
    // Daily follower snapshots (three platforms cross the 1000-row cap in ~11 months).
    selectAll<SnapshotRow>(() =>
      supabase.from('account_snapshots').select('platform, snapshot_date, followers').eq('client_id', clientId).order('snapshot_date', { ascending: true }),
    ),
    // Measured movements on the client's own accounts, newest first (Trends' logic).
    supabase.from('account_events')
      .select('platform, metric, event_date, severity, magnitude_label, explained, explanation')
      .eq('client_id', clientId).order('event_date', { ascending: false }),
  ])
  const brand = client?.company_name ?? 'Your brand'

  // Anchor on the newest update WITH videos, excluding in-flight ones (the
  // dashboard's videoRunId pattern) — the page keeps serving the previous
  // update while a new one is collecting.
  const runningIds = ((runningRuns ?? []) as { id: string }[]).map((r) => r.id)
  let vidQ = supabase.from('videos').select('run_id, scraped_at').eq('client_id', clientId)
  if (runningIds.length) vidQ = vidQ.not('run_id', 'in', `(${runningIds.join(',')})`)
  const { data: latestVid } = await vidQ.order('scraped_at', { ascending: false }).limit(1).maybeSingle()

  const ownHandles = new Set(
    Object.values(((tc as { own_handles?: Record<string, string> } | null)?.own_handles ?? {}) as Record<string, string>)
      .filter((h): h is string => typeof h === 'string' && h.length > 0)
      .map(handleKey),
  )

  if (!latestVid) return { empty: true }

  const videoRunId = latestVid.run_id as string
  const updateDate = (latestVid.scraped_at as string | null) ?? null

  // Discovered videos only — the client's own posts are a different segment
  // (Owned-Data-Plan: "segment, never blend") and never mix into market content
  // intelligence.
  const all = await selectAll<VideoRow>(() => supabase.from('videos')
    .select('id, platform, account_name, account_followers, video_url, views, likes, engagement_rate, upload_date, duration_seconds, audio_name, transcript_status, is_client, is_competitor, competitor_name, sentiment, classified_type, hook_style, hook_text, topics')
    .eq('client_id', clientId).eq('run_id', videoRunId).eq('source', 'discovered')
    .order('views', { ascending: false }).order('id', { ascending: true }))

  // ── the inbox ──────────────────────────────────────────────────────────
  const roles = roleByAccount(all)
  const shapedInbox = digest ? shapeInbox([...digest.engage, ...digest.flagged], { now: new Date().toISOString(), ownHandles, roleByAccount: roles }) : []
  const inboxRows = toContentInboxRows(shapedInbox)
  const engageDetail = digest ? buildEngageDetail(digest.candidates, sp.detail) : null

  // ── what works right now ───────────────────────────────────────────────
  const analysed = all.filter((v) => v.classified_type != null)
  const hooks = perfVsMedian(analysed, 'hook_style', { top: PERF_SHOWN })
  const formats = perfVsMedian(analysed, 'classified_type', { top: PERF_SHOWN })
  // One scale for both columns: the same multiple draws the same bar.
  const perfMax = Math.max(hooks[0]?.multiple ?? 0, formats[0]?.multiple ?? 0)
  const duration = bestDuration(durationPerf(all), medianEngagement(analysed))
  const sounds = trendingSounds(all)
  const topSound = sounds[0] ? { name: sounds[0].name, count: sounds[0].count } : null
  const playbooks = entityPlaybooks(all).filter((p) => p.classified > 0)

  // ── the field ──────────────────────────────────────────────────────────
  const scoreboard = entityScoreboard(all)
  const fieldRows = [
    ...scoreboard.filter((r) => r.kind === 'you'),
    ...scoreboard.filter((r) => r.kind === 'competitor').slice(0, 2),
    ...scoreboard.filter((r) => r.kind === 'category'),
  ]
  const fieldEngMax = Math.max(...fieldRows.map((r) => r.avgEng ?? 0), 0)
  const sentence = fieldSentence(scoreboard)
  let compIdx = 0
  const rowColor = (r: EntityRow) => (r.kind === 'competitor' ? COMPETITOR_COLORS[Math.min(compIdx++, COMPETITOR_COLORS.length - 1)] : KIND_COLOR[r.kind])
  const fieldColored: ContentFieldRow[] = fieldRows.map((r) => ({ ...r, color: rowColor(r) }))

  // ── top voices ─────────────────────────────────────────────────────────
  const voices = topVoices(all, VOICES_SHOWN)
  const voicesAll = topVoices(all, VOICES_ALL)
  const voiceMax = voices[0]?.views ?? 0

  // ── your accounts (Trends' logic: snapshots → series; events newest first,
  // the first explained one speaks) ──────────────────────────────────────
  const accounts = accountSeries(snapRows, 30)
  const events = (eventData ?? []) as EventRow[]
  const sortedEvents = [...events].sort((a, b) => b.event_date.localeCompare(a.event_date) || b.severity - a.severity)
  const topEvent = sortedEvents.find((e) => e.explained && e.explanation) ?? sortedEvents[0] ?? null
  const explainedPlatforms = [...new Set(sortedEvents.filter((e) => e.explained && e.metric === 'followers').map((e) => e.platform))]

  // ── the catalog ────────────────────────────────────────────────────────
  const catalogRows = all.slice(0, CATALOG_CAP).map(toCatalogRow)

  const platformsSeen = [...new Set(all.map((v) => v.platform).filter(Boolean))]
  const context = `What content works, and who to answer?${updateDate ? ` · ${weekdayDate(updateDate)}` : ''}`

  return {
    updateDate, context,
    works: { hooks, formats, perfMax, duration, topSound },
    inbox: {
      total: inboxRows.length,
      counts: intentCounts(inboxRows),
      windowDays: digest?.windowDays ?? null,
      rows: inboxRows,
    },
    field: {
      rows: fieldColored, sentence, engMax: fieldEngMax,
      hiddenCount: scoreboard.length - fieldRows.length,
      totalVideos: all.length, analysedVideos: analysed.length,
    },
    voices: { shown: voices, all: voicesAll, max: voiceMax },
    accounts: { series: accounts, topEvent, explainedPlatforms },
    playbooks,
    catalog: { rows: catalogRows, total: all.length },
    engageDetail,
    selection: { intent: intentFilter, detail: sp.detail },
    method: {
      company: brand,
      period: updateDate ? `Update of ${weekdayDate(updateDate)}` : 'This update',
      platforms: platformsSeen,
      videos: all.length,
      comments: null,
      note: `Hooks and formats are read against the update's median video; the reply inbox surfaces ${fmtInt(inboxRows.length)} comments the analysis already cited, capped to the update's window.`,
    },
  }
}
