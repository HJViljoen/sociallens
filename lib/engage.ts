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

export const ENGAGE_CATEGORIES = [
  'purchase_intent',
  'question',
  'objection',
  'switching_signal',
  'buying_trigger',
] as const

export type EngageCategory = (typeof ENGAGE_CATEGORIES)[number]

export interface EngageComment {
  id: string
  author: string | null
  text: string
  likes: number
  commentDate: string | null
  platform: string
  videoUrl: string | null
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
  comment: EngageComment
}

const priority = (category: string) => {
  const i = (ENGAGE_CATEGORIES as readonly string[]).indexOf(category)
  return i === -1 ? ENGAGE_CATEGORIES.length : i
}

export function rankEngageCandidates(
  candidates: EngageCandidate[],
  opts: { windowStart: string; perCategoryCap?: number; totalCap?: number },
): EngageCandidate[] {
  const perCategoryCap = opts.perCategoryCap ?? 3
  const totalCap = opts.totalCap ?? 12
  const windowStart = Date.parse(opts.windowStart)

  const fresh = candidates.filter((c) => {
    if (!c.comment.commentDate) return false
    const t = Date.parse(c.comment.commentDate)
    return Number.isFinite(t) && t >= windowStart
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
