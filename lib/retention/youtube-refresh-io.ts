import type { SupabaseClient } from '@supabase/supabase-js'
import { selectAll } from '../supabase-admin'
import { DEMO_CLIENT_ID } from '../config'
import { adapters } from '../gather/platforms'
import { loadHeroQuotes, matchHeroQuotes, nullHeroQuotes } from '../pipeline/hero-quotes'
import { markSnapshotsStale } from '../artifacts'
import {
  diffRefreshedComments, evidenceToDrop, phrasesToDrop, diffRefreshedVideos, videoTombstone,
  refreshCutoffs, distinctIds, assertPlausibleGoneRate, type StoredComment, type StoredVideoStats,
} from './youtube-refresh'

// The I/O half of the YouTube refresh (Tier 1.5, 2026-08-22). Called from
// inngest/functions/retention.ts (nightly) and scripts/retention-dry.ts
// (read-only preview, `dryRun: true`). Decisions live in ./youtube-refresh.ts.

const CHUNK = 200

export interface CommentRefreshSummary {
  due: number
  distinctIds: number
  refreshed: number
  textChanged: number
  evidenceDropped: number
  samplesDropped: number
  missing: number
  deleted: number
  insightsAffected: number
  heroQuotesNulled: number
  /** A few platform ids that were not returned, for the operator's eyes. */
  missingExamples: string[]
}

export interface VideoRefreshSummary {
  due: number
  refreshed: number
  missing: number
  tombstoned: number
  commentsDeleted: number
  insightsAffected: number
  heroQuotesNulled: number
}

/** Rows YouTube no longer serves have to go — the API data is gone and cannot
 *  be refreshed — but they can be cited. So: count what the delete will take
 *  with it (for the log), null any hero_quote copies of the text (no FK, they
 *  would otherwise survive), then delete and let the FKs cascade the evidence
 *  and language samples. Shared by the missing-comment and missing-video paths
 *  and by scripts/erase-commenter.ts. */
export async function deleteCommentsProperly(
  admin: SupabaseClient,
  rows: { id: string; client_id: string; text: string | null }[],
  opts: { dryRun?: boolean } = {},
): Promise<{ deleted: number; insightsAffected: number; heroQuotesNulled: number; artifactsStaled: number }> {
  if (!rows.length) return { deleted: 0, insightsAffected: 0, heroQuotesNulled: 0, artifactsStaled: 0 }
  const ids = rows.map((r) => r.id)
  const insights = new Set<string>()
  const evidenceIds: string[] = []
  for (let i = 0; i < ids.length; i += CHUNK) {
    const { data, error } = await admin.from('insight_evidence').select('id, audience_insight_id').in('comment_id', ids.slice(i, i + CHUNK))
    if (error) throw new Error(`count evidence: ${error.message}`)
    for (const r of (data ?? []) as { id: string; audience_insight_id: string }[]) { insights.add(r.audience_insight_id); evidenceIds.push(r.id) }
  }
  const clientIds = [...new Set(rows.map((r) => r.client_id))]
  const heroRows = await loadHeroQuotes(admin, clientIds)
  const heroHits = matchHeroQuotes(heroRows, rows.map((r) => r.text ?? ''))
  // Exports (Reports & Exports, plan D6): a stored PDF/PNG whose snapshot
  // cited any of these voices has the words baked into a file. Find those
  // snapshots by ref — c:<comment>, e:<evidence row>, h:<table>:<row> — delete
  // the files now and flag the artifacts; the next download re-renders from
  // the snapshot, where the erased voice no longer resolves.
  const refs = [
    ...ids.map((id) => `c:${id}`),
    ...evidenceIds.map((id) => `e:${id}`),
    ...heroHits.map((h) => `h:${h.table}:${h.id}`),
  ]
  const snapshotIds = new Set<string>()
  for (let i = 0; i < refs.length; i += 150) {
    const { data, error } = await admin.from('report_snapshots').select('id').overlaps('evidence_ids', refs.slice(i, i + 150))
    if (error) throw new Error(`find snapshots: ${error.message}`)
    for (const r of (data ?? []) as { id: string }[]) snapshotIds.add(r.id)
  }
  const staled = await markSnapshotsStale(admin, [...snapshotIds], { apply: !opts.dryRun })
  if (opts.dryRun) return { deleted: ids.length, insightsAffected: insights.size, heroQuotesNulled: heroHits.length, artifactsStaled: staled.artifacts }
  const heroQuotesNulled = await nullHeroQuotes(admin, heroHits)
  for (let i = 0; i < ids.length; i += CHUNK) {
    const { error } = await admin.from('comments').delete().in('id', ids.slice(i, i + CHUNK))
    if (error) throw new Error(`delete comments: ${error.message}`)
  }
  return { deleted: ids.length, insightsAffected: insights.size, heroQuotesNulled, artifactsStaled: staled.artifacts }
}

/** Refresh the YouTube comments that are due. */
export async function refreshYoutubeComments(
  admin: SupabaseClient,
  opts: { now?: Date; cap: number; dryRun?: boolean; sample?: number },
): Promise<CommentRefreshSummary> {
  const now = opts.now ?? new Date()
  const nowIso = now.toISOString()
  const { due } = refreshCutoffs(now)
  const adapter = adapters.youtube
  if (!adapter.refreshComments) throw new Error('youtube adapter has no refreshComments')

  const stored = await selectAll<StoredComment>(() =>
    admin.from('comments')
      .select('id, client_id, run_id, video_id, comment_id, author, text, likes, reply_count')
      .eq('platform', 'youtube')
      .or(`and(refreshed_at.is.null,created_at.lt.${due}),refreshed_at.lt.${due}`)
      .order('created_at', { ascending: true }).order('id', { ascending: true }),
  )
  const ids = distinctIds(stored, 'comment_id', opts.sample ?? opts.cap)
  const idSet = new Set(ids)
  const batch = stored.filter((s) => idSet.has(s.comment_id))
  const summary: CommentRefreshSummary = {
    due: stored.length, distinctIds: ids.length, refreshed: 0, textChanged: 0, evidenceDropped: 0,
    samplesDropped: 0, missing: 0, deleted: 0, insightsAffected: 0, heroQuotesNulled: 0, missingExamples: [],
  }
  if (!ids.length) return summary

  const { found } = await adapter.refreshComments(ids)
  assertPlausibleGoneRate('comments', ids.length, found.length)
  const diff = diffRefreshedComments(batch, new Map(found.map((f) => [f.comment_id, f])), nowIso, { keepAuthorForClients: new Set([DEMO_CLIENT_ID]) })
  summary.refreshed = diff.upserts.length
  summary.textChanged = diff.textChangedIds.length
  summary.missing = diff.missingIds.length
  summary.missingExamples = [...new Set(diff.missingIds.map((id) => batch.find((b) => b.id === id)?.comment_id ?? id))].slice(0, 5)

  if (!opts.dryRun) {
    for (let i = 0; i < diff.upserts.length; i += CHUNK) {
      const { error } = await admin.from('comments').upsert(diff.upserts.slice(i, i + CHUNK), { onConflict: 'client_id,platform,comment_id' })
      if (error) throw new Error(`refresh upsert: ${error.message}`)
    }
  }

  // Edited upstream: any quote that no longer appears verbatim goes, same rule
  // as validateInsights at persist time.
  if (diff.textChangedIds.length) {
    const changed = diff.textChangedIds
    const evidence: { id: string; comment_id: string | null; quote: string; redacted?: boolean }[] = []
    const samples: { id: string; comment_id: string | null; phrase: string }[] = []
    for (let i = 0; i < changed.length; i += CHUNK) {
      const chunk = changed.slice(i, i + CHUNK)
      const [ev, ls] = await Promise.all([
        admin.from('insight_evidence').select('id, comment_id, quote, redacted').in('comment_id', chunk),
        admin.from('language_samples').select('id, comment_id, phrase').in('comment_id', chunk),
      ])
      if (ev.error) throw new Error(`load evidence: ${ev.error.message}`)
      if (ls.error) throw new Error(`load samples: ${ls.error.message}`)
      evidence.push(...((ev.data ?? []) as typeof evidence))
      samples.push(...((ls.data ?? []) as typeof samples))
    }
    const dropEv = evidenceToDrop(evidence, diff.textById)
    const dropLs = phrasesToDrop(samples, diff.textById)
    summary.evidenceDropped = dropEv.length
    summary.samplesDropped = dropLs.length
    if (!opts.dryRun) {
      for (let i = 0; i < dropEv.length; i += CHUNK) {
        const { error } = await admin.from('insight_evidence').delete().in('id', dropEv.slice(i, i + CHUNK))
        if (error) throw new Error(`drop evidence: ${error.message}`)
      }
      for (let i = 0; i < dropLs.length; i += CHUNK) {
        const { error } = await admin.from('language_samples').delete().in('id', dropLs.slice(i, i + CHUNK))
        if (error) throw new Error(`drop samples: ${error.message}`)
      }
    }
  }

  if (diff.missingIds.length) {
    const missingSet = new Set(diff.missingIds)
    const gone = batch.filter((s) => missingSet.has(s.id))
    const r = await deleteCommentsProperly(admin, gone, { dryRun: opts.dryRun })
    summary.deleted = r.deleted
    summary.insightsAffected = r.insightsAffected
    summary.heroQuotesNulled = r.heroQuotesNulled
  }
  return summary
}

/** Refresh the YouTube video statistics that are due; tombstone what is gone. */
export async function refreshYoutubeVideos(
  admin: SupabaseClient,
  opts: { now?: Date; cap: number; dryRun?: boolean },
): Promise<VideoRefreshSummary> {
  const now = opts.now ?? new Date()
  const nowIso = now.toISOString()
  const { due } = refreshCutoffs(now)
  const adapter = adapters.youtube
  if (!adapter.refreshVideoStats) throw new Error('youtube adapter has no refreshVideoStats')

  const stored = await selectAll<StoredVideoStats & { client_id: string }>(() =>
    admin.from('videos')
      .select('id, client_id, video_id, views, likes, comments_count, comments_count_at_scrape')
      .eq('platform', 'youtube')
      .is('unavailable_at', null)
      .or(`and(refreshed_at.is.null,scraped_at.lt.${due}),refreshed_at.lt.${due}`)
      .order('scraped_at', { ascending: true }).order('id', { ascending: true }),
  )
  const ids = distinctIds(stored, 'video_id', opts.cap)
  const idSet = new Set(ids)
  const batch = stored.filter((s) => idSet.has(s.video_id))
  const summary: VideoRefreshSummary = { due: stored.length, refreshed: 0, missing: 0, tombstoned: 0, commentsDeleted: 0, insightsAffected: 0, heroQuotesNulled: 0 }
  if (!ids.length) return summary

  const { found } = await adapter.refreshVideoStats(ids)
  assertPlausibleGoneRate('videos', ids.length, found.size)
  const diff = diffRefreshedVideos(batch, found, nowIso)
  summary.refreshed = diff.updates.length
  summary.missing = diff.missingIds.length

  if (!opts.dryRun) {
    // Per-row updates: the payload differs per row (frozen baseline) and the
    // table's natural key includes columns we did not select, so no upsert.
    for (const u of diff.updates) {
      const { id, ...patch } = u
      const { error } = await admin.from('videos').update(patch).eq('id', id)
      if (error) throw new Error(`refresh video ${id}: ${error.message}`)
    }
  }

  if (diff.missingIds.length) {
    const missingSet = new Set(diff.missingIds)
    const gone = batch.filter((s) => missingSet.has(s.id))
    // Their YouTube comments are no longer served either.
    const comments: { id: string; client_id: string; text: string | null }[] = []
    for (const v of gone) {
      const rows = await selectAll<{ id: string; client_id: string; text: string | null }>(() =>
        admin.from('comments').select('id, client_id, text').eq('platform', 'youtube').eq('client_id', v.client_id).eq('video_id', v.video_id).order('id', { ascending: true }),
      )
      comments.push(...rows)
    }
    const r = await deleteCommentsProperly(admin, comments, { dryRun: opts.dryRun })
    summary.commentsDeleted = r.deleted
    summary.insightsAffected = r.insightsAffected
    summary.heroQuotesNulled = r.heroQuotesNulled
    if (!opts.dryRun) {
      const tomb = videoTombstone(nowIso)
      for (let i = 0; i < gone.length; i += CHUNK) {
        const { error } = await admin.from('videos').update(tomb).in('id', gone.slice(i, i + CHUNK).map((g) => g.id))
        if (error) throw new Error(`tombstone videos: ${error.message}`)
      }
    }
    summary.tombstoned = gone.length
  }
  return summary
}
