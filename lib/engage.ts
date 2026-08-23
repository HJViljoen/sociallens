// Engagement digest ranking (2026-08-10). Picks the comments worth a reply
// from the insight evidence the pipeline already validated — evidence-only v1,
// no extra GPT. Pure logic; the Content page and the weekly report supply rows
// and render results. Tested in engage.test.ts.
//
// Ranking is lexicographic, in this order, so likes can never outrank intent:
//   1. hard freshness window (comment_date >= windowStart; undated dropped —
//      two-thirds of cited engagement comments predate the week, measured
//      2026-08-10, so this filter is load-bearing, not cosmetic)
//   2. category priority (ENGAGE_CATEGORIES order)
//   3. parent insight strength
//   4. likes (log-damped tiebreak)
// then dedupe: one slot per comment, max 2 per video, category + total caps.

import type { SupabaseClient } from '@supabase/supabase-js'
import { selectAll } from './supabase-admin'
import { cleanQuote, englishHits } from './quotes'

export const ENGAGE_CATEGORIES = [
  'purchase_intent',
  'question',
  'objection',
  'switching_signal',
  'buying_trigger',
] as const

export type EngageCategory = (typeof ENGAGE_CATEGORIES)[number]

export const ENGAGE_CATEGORY_LABEL: Record<string, string> = {
  purchase_intent: 'Ready to buy',
  question: 'Question',
  objection: 'Objection',
  switching_signal: 'Considering a switch',
  buying_trigger: 'Buying trigger',
}

export interface EngageComment {
  id: string
  author: string | null
  text: string
  likes: number
  commentDate: string | null
  platform: string
  videoUrl: string | null
  /** Account whose post the comment sits under (context line). */
  account: string | null
  /** Platform-native comment id (YouTube's is deep-linkable). */
  platformCommentId: string
}

export interface EngageCandidate {
  insightId: string
  category: string
  /** Parent insight strength_score, 1-10. */
  strength: number | null
  /** Parent insight theme — shown as context next to the quote. */
  theme: string
  /** Parent insight description — the detail-overlay body. */
  description?: string
  /** Pass A topics of the source video — the on-topic gate's evidence. */
  videoTopics?: string[] | null
  comment: EngageComment
}

/** Content words (≥4 chars, lowercased, diacritics folded — "össur" and
 *  "ossur" must meet) of a set of phrases. */
const contentWords = (phrases: (string | null | undefined)[]): Set<string> => {
  const out = new Set<string>()
  for (const p of phrases) {
    const folded = (p ?? '').toLowerCase().normalize('NFD').replace(/\p{M}/gu, '')
    for (const w of folded.match(/[a-z]{4,}/g) ?? []) out.add(w)
  }
  return out
}

/**
 * Does this candidate live in the client's space? Its video topics + insight
 * theme must share a content word with the tracked-keyword vocabulary.
 * Guards against corpus pollution reaching the digest: a hashtag-riding gaming
 * video generates strength-9 "purchase intent" for game items, and without
 * this it outranks every genuine buyer (observed on Össur run ef1e28a3 —
 * #runningblade pollution). Precision over recall by design: the digest picks
 * ~12 from hundreds, so dropping an oblique genuine candidate is cheap while
 * one junk item costs the feature its credibility.
 */
export function isOnTopic(candidate: EngageCandidate, vocab: Set<string>): boolean {
  if (vocab.size === 0) return true
  const words = contentWords([candidate.theme, ...(candidate.videoTopics ?? [])])
  for (const w of words) if (vocab.has(w)) return true
  return false
}

/** Tracked-keyword vocabulary for the on-topic gate. */
export function engageVocab(keywordLists: (string[] | null | undefined)[]): Set<string> {
  return contentWords(keywordLists.flatMap((l) => l ?? []))
}

const priority = (category: string) => {
  const i = (ENGAGE_CATEGORIES as readonly string[]).indexOf(category)
  return i === -1 ? ENGAGE_CATEGORIES.length : i
}

export function rankEngageCandidates(
  candidates: EngageCandidate[],
  opts: { windowStart: string; perCategoryCap?: number; totalCap?: number; vocab?: Set<string> },
): EngageCandidate[] {
  const perCategoryCap = opts.perCategoryCap ?? 3
  const totalCap = opts.totalCap ?? 12
  const windowStart = Date.parse(opts.windowStart)

  const fresh = candidates.filter((c) => {
    if (!c.comment.commentDate) return false
    const t = Date.parse(c.comment.commentDate)
    if (!Number.isFinite(t) || t < windowStart) return false
    if (opts.vocab && !isOnTopic(c, opts.vocab)) return false
    // A reply digest is only actionable in the client's language: hard-gate on
    // reading as English (the hero-quote rule, lib/quotes.ts), min-length so
    // "yes!!" can't take a slot. Unlike hero quotes there's no max — display
    // truncates instead of dropping a long genuine question.
    const text = cleanQuote(c.comment.text)
    return text.length >= 12 && englishHits(text) >= 2
  })

  fresh.sort(
    (a, b) =>
      priority(a.category) - priority(b.category) ||
      (b.strength ?? 0) - (a.strength ?? 0) ||
      Math.log1p(b.comment.likes) - Math.log1p(a.comment.likes),
  )

  const picked: EngageCandidate[] = []
  const seenComments = new Set<string>()
  const perVideo = new Map<string, number>()
  const perCategory = new Map<string, number>()
  for (const c of fresh) {
    if (picked.length >= totalCap) break
    if (seenComments.has(c.comment.id)) continue
    if ((perCategory.get(c.category) ?? 0) >= perCategoryCap) continue
    const videoKey = c.comment.videoUrl
    if (videoKey && (perVideo.get(videoKey) ?? 0) >= 2) continue
    picked.push(c)
    seenComments.add(c.comment.id)
    perCategory.set(c.category, (perCategory.get(c.category) ?? 0) + 1)
    if (videoKey) perVideo.set(videoKey, (perVideo.get(videoKey) ?? 0) + 1)
  }
  return picked
}

/**
 * Where "reply" can actually land: YouTube deep-links to the comment itself
 * (&lc= takes a top-level thread id — exactly what gather stores); TikTok and
 * Instagram have no public per-comment URL, so the post is the closest stop.
 */
export function engageDeepLink(comment: EngageComment): { href: string | null; commentLevel: boolean } {
  if (!comment.videoUrl) return { href: null, commentLevel: false }
  if (comment.platform === 'youtube') {
    const sep = comment.videoUrl.includes('?') ? '&' : '?'
    return { href: `${comment.videoUrl}${sep}lc=${comment.platformCommentId}`, commentLevel: true }
  }
  return { href: comment.videoUrl, commentLevel: false }
}

// ---- Candidate loading (I/O) ------------------------------------------------
// Shared by the Content page section and the weekly report. Works with either
// the tenant session client (all three tables are tenant-SELECT under RLS) or
// the admin client. Includes 'misinformation' — callers split it off.

/** .in() in id-chunks of 100 (pass-d's retrieveQuotes precedent), each chunk
 *  paged via selectAll — evidence rows per insight are unbounded, so a bare
 *  select could silently cap at 1000 and hollow out the digest. Builders must
 *  end with a stable .order(). */
async function chunkedIn<T>(
  buildChunk: (ids: string[]) => () => { range: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }> },
  ids: string[],
): Promise<T[]> {
  // All chunks in flight at once (they were awaited one by one — the Content
  // page's long pole was this helper's four stages, each a serial walk).
  // Chunks are disjoint, and concatenating in chunk order keeps the output
  // order the serial loop produced.
  const chunks: string[][] = []
  for (let i = 0; i < ids.length; i += 100) chunks.push(ids.slice(i, i + 100))
  const pages = await Promise.all(chunks.map((chunk) => selectAll<T>(buildChunk(chunk))))
  return pages.flat()
}

export async function loadEngageCandidates(
  db: SupabaseClient,
  clientId: string,
  runId: string,
): Promise<EngageCandidate[]> {
  const insights = await selectAll<{
    id: string; category: string; theme: string; description: string; strength_score: number | null
  }>(() =>
    // Current insights of the corpus (audience_insights_current), not this
    // run's stamps — Pass A is incremental since 2026-08-17. The 7-day comment
    // window below still decides freshness; runId stays for the callers.
    db.from('audience_insights_current')
      .select('id, category, theme, description, strength_score')
      .eq('client_id', clientId)
      .in('category', [...ENGAGE_CATEGORIES, 'misinformation'])
      .order('id'),
  )
  void runId
  if (insights.length === 0) return []
  const byInsight = new Map(insights.map((i) => [i.id, i]))

  const evidence = await chunkedIn<{ audience_insight_id: string; comment_id: string | null }>(
    (ids) => () =>
      db.from('insight_evidence')
        .select('audience_insight_id, comment_id')
        .in('audience_insight_id', ids)
        .eq('source', 'comment')
        .order('id'),
    insights.map((i) => i.id),
  )

  const comments = await chunkedIn<{
    id: string; author: string | null; text: string; likes: number | null
    comment_date: string | null; platform: string; video_id: string; comment_id: string
  }>(
    (ids) => () =>
      db.from('comments')
        .select('id, author, text, likes, comment_date, platform, video_id, comment_id')
        .in('id', ids)
        .order('id'),
    // Retention nulls the author on cited comments and deletes uncited ones
    // past 30 days (T0-9), so an evidence row can outlive its comment; a null
    // id must never reach the `in.()` filter.
    [...new Set(evidence.map((e) => e.comment_id).filter((id): id is string => Boolean(id)))],
  )
  const byComment = new Map(comments.map((c) => [c.id, c]))

  const videos = await chunkedIn<{
    video_id: string; platform: string; video_url: string; account_name: string; topics: string[] | null
  }>(
    (ids) => () =>
      db.from('videos')
        .select('video_id, platform, video_url, account_name, topics')
        .eq('client_id', clientId)
        .in('video_id', ids)
        .order('id'),
    [...new Set(comments.map((c) => c.video_id))],
  )
  const videoByKey = new Map(videos.map((v) => [`${v.platform}::${v.video_id}`, v]))

  const candidates: EngageCandidate[] = []
  for (const e of evidence) {
    const insight = byInsight.get(e.audience_insight_id)
    const comment = e.comment_id ? byComment.get(e.comment_id) : undefined
    if (!insight || !comment) continue
    const video = videoByKey.get(`${comment.platform}::${comment.video_id}`)
    candidates.push({
      insightId: insight.id,
      category: insight.category,
      strength: insight.strength_score,
      theme: insight.theme,
      description: insight.description,
      videoTopics: video?.topics ?? null,
      comment: {
        id: comment.id,
        // YouTube handles arrive @-prefixed, TT/IG bare — normalize so display
        // can prepend @ without doubling it.
        author: comment.author?.replace(/^@+/, '') ?? null,
        text: comment.text,
        likes: Number(comment.likes ?? 0),
        commentDate: comment.comment_date,
        platform: comment.platform,
        videoUrl: video?.video_url ?? null,
        account: video?.account_name ?? null,
        platformCommentId: comment.comment_id,
      },
    })
  }
  return candidates
}
