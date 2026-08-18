import { normForMatch, quoteAppearsIn } from '../pipeline/quote-match'
import { engagementRate as gatherEngagementRate } from '../gather/util'

// YouTube refresh — the pure decision logic (Tier 1.5, 2026-08-22). No I/O:
// inngest/functions/retention.ts loads the due rows, calls the adapter, and
// hands both to these functions; scripts/retention-dry.ts reuses them for the
// read-only preview. Kept pure so the rules are unit-tested and the job stays
// glue, exactly like lib/gather/delta.ts and lib/pipeline/pass-a-plan.ts.
//
// THE RULE this serves (YouTube API Services Developer Policy III.E.4.d/e):
// Non-Authorized Data may be stored for at most 30 calendar days, after which it
// must be deleted OR refreshed, and stored data must be kept consistent with
// what the API serves. So every stored YouTube row is re-fetched on a rolling
// cadence; a row the API no longer returns is deleted; an edited comment is
// updated and any quote of it that no longer verifies is dropped.

/** How far a row may age before the refresh picks it up. Five days of slack
 *  under the 30-day hard limit, so one failed night cannot breach it. */
export const YOUTUBE_REFRESH_DUE_DAYS = 25
/** The hard limit: a row still unrefreshed at 30 days falls back to the
 *  delete/pseudonymise path (retention.ts step 5). */
export const YOUTUBE_RETENTION_BACKSTOP_DAYS = 30

export interface StoredComment {
  id: string
  client_id: string
  run_id: string
  video_id: string
  comment_id: string
  author: string | null
  text: string | null
  likes: number | null
  reply_count: number | null
}

/** What the adapter returns per platform comment id it could still see. */
export interface RefreshedComment {
  comment_id: string
  author: string | null
  text: string
  likes: number
  reply_count: number
}

/** One upsert row per stored row whose platform id was found. Keys are
 *  uniform on purpose — PostgREST bulk upsert requires it — and the natural
 *  key (client_id, platform, comment_id) is what the upsert conflicts on, so a
 *  comment id held by several tenants updates every tenant's copy. */
export interface CommentUpsertRow {
  client_id: string
  run_id: string
  platform: 'youtube'
  video_id: string
  comment_id: string
  author: string | null
  text: string
  likes: number
  reply_count: number
  refreshed_at: string
}

export interface CommentDiff {
  upserts: CommentUpsertRow[]
  /** Stored row ids (uuid) whose platform comment id the API no longer returns. */
  missingIds: string[]
  /** Stored row ids whose text changed (normalised) — their quotes need re-verifying. */
  textChangedIds: string[]
  /** New text by stored row id, for the quote re-check. */
  textById: Map<string, string>
}

export function diffRefreshedComments(
  stored: StoredComment[],
  fetched: Map<string, RefreshedComment>,
  nowIso: string,
): CommentDiff {
  const upserts: CommentUpsertRow[] = []
  const missingIds: string[] = []
  const textChangedIds: string[] = []
  const textById = new Map<string, string>()
  for (const s of stored) {
    const f = fetched.get(s.comment_id)
    if (!f) { missingIds.push(s.id); continue }
    upserts.push({
      client_id: s.client_id,
      run_id: s.run_id,
      platform: 'youtube',
      video_id: s.video_id,
      comment_id: s.comment_id,
      author: f.author,
      text: f.text,
      likes: f.likes,
      reply_count: f.reply_count,
      refreshed_at: nowIso,
    })
    if (normForMatch(s.text ?? '') !== normForMatch(f.text)) {
      textChangedIds.push(s.id)
      textById.set(s.id, f.text)
    }
  }
  return { upserts, missingIds, textChangedIds, textById }
}

/** Evidence rows whose quote no longer appears verbatim in the comment's new
 *  text — the same rule validateInsights enforces at persist time. Redacted
 *  rows (quote '') are never dropped for text drift: they cite, they don't quote. */
export function evidenceToDrop(
  evidence: { id: string; comment_id: string | null; quote: string; redacted?: boolean }[],
  textById: Map<string, string>,
): string[] {
  const out: string[] = []
  for (const e of evidence) {
    if (!e.comment_id || e.redacted || e.quote === '') continue
    const text = textById.get(e.comment_id)
    if (text == null) continue
    if (!quoteAppearsIn(e.quote, text)) out.push(e.id)
  }
  return out
}

/** Same rule for language_samples.phrase. */
export function phrasesToDrop(
  samples: { id: string; comment_id: string | null; phrase: string }[],
  textById: Map<string, string>,
): string[] {
  const out: string[] = []
  for (const s of samples) {
    if (!s.comment_id) continue
    const text = textById.get(s.comment_id)
    if (text == null) continue
    if (!quoteAppearsIn(s.phrase, text)) out.push(s.id)
  }
  return out
}

export interface StoredVideoStats {
  id: string
  video_id: string
  views: number
  likes: number
  comments_count: number
  comments_count_at_scrape: number | null
}

export interface RefreshedVideoStats {
  views: number
  likes: number
  comments_count: number
}

export interface VideoStatsUpdate {
  id: string
  views: number
  likes: number
  comments_count: number
  /** Frozen from the OLD comments_count when it was null, so a refreshed count
   *  can never mask real comment growth from the delta re-scrape rule
   *  (lib/gather/delta.ts scrapeBaseline). Otherwise unchanged. */
  comments_count_at_scrape: number | null
  engagement_rate: number | null
  refreshed_at: string
}

/** The SAME helper normaliseVideo uses at gather time (YouTube passes shares=0). */
export function engagementRate(views: number, likes: number, comments: number): number | null {
  return gatherEngagementRate(views, likes, 0, comments)
}

export function diffRefreshedVideos(
  stored: StoredVideoStats[],
  fetched: Map<string, RefreshedVideoStats>,
  nowIso: string,
): { updates: VideoStatsUpdate[]; missingIds: string[] } {
  const updates: VideoStatsUpdate[] = []
  const missingIds: string[] = []
  for (const s of stored) {
    const f = fetched.get(s.video_id)
    if (!f) { missingIds.push(s.id); continue }
    updates.push({
      id: s.id,
      views: f.views,
      likes: f.likes,
      comments_count: f.comments_count,
      comments_count_at_scrape: s.comments_count_at_scrape ?? s.comments_count,
      engagement_rate: engagementRate(f.views, f.likes, f.comments_count),
      refreshed_at: nowIso,
    })
  }
  return { updates, missingIds }
}

/** The tombstone applied to a video the API no longer returns: API-sourced
 *  fields cleared, the row kept so nothing cascades. */
export function videoTombstone(nowIso: string) {
  return {
    unavailable_at: nowIso,
    refreshed_at: nowIso,
    caption: null as string | null,
    hashtags: [] as string[],
    views: 0,
    likes: 0,
    comments_count: 0,
    engagement_rate: null as number | null,
  }
}

/** ISO cutoffs for the two selections. */
export function refreshCutoffs(now: Date, dueDays = YOUTUBE_REFRESH_DUE_DAYS, backstopDays = YOUTUBE_RETENTION_BACKSTOP_DAYS) {
  const day = 86_400_000
  return {
    due: new Date(now.getTime() - dueDays * day).toISOString(),
    backstop: new Date(now.getTime() - backstopDays * day).toISOString(),
  }
}

/** Distinct platform ids, oldest-first order preserved, capped. */
export function distinctIds<T extends { comment_id?: string; video_id?: string }>(rows: T[], key: 'comment_id' | 'video_id', cap: number): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const r of rows) {
    const k = r[key]
    if (!k || seen.has(k)) continue
    seen.add(k)
    out.push(k)
    if (out.length >= cap) break
  }
  return out
}
