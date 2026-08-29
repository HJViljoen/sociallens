import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Citations for an evidence appendix (Reports & Exports T11, 2026-08-29):
 * platform · date · link for a quote the agent grounded an answer on. The
 * agent stores `{ commentId, videoId }` per quote and never fetches where it
 * was said; this joins comments → videos the way lib/engage.ts does for the
 * reply digest (`${platform}::${video_id}` is the key gather used).
 *
 * The link is honest about where it lands: YouTube deep-links to the comment
 * (&lc=); TikTok and Instagram have no public per-comment URL, so the post is
 * the closest stop and `commentLevel` says so.
 */

export interface CitationRef {
  commentId: string | null
  videoId: string | null
}

export interface CitationMeta {
  platform: string | null
  /** ISO date (day precision is enough for a footnote). */
  date: string | null
  href: string | null
  commentLevel: boolean
}

/** Pure: the link for a comment on a video. */
export function citationLink(platform: string | null, videoUrl: string | null, platformCommentId: string | null): { href: string | null; commentLevel: boolean } {
  if (!videoUrl) return { href: null, commentLevel: false }
  if (platform === 'youtube' && platformCommentId) {
    const sep = videoUrl.includes('?') ? '&' : '?'
    return { href: `${videoUrl}${sep}lc=${platformCommentId}`, commentLevel: true }
  }
  return { href: videoUrl, commentLevel: false }
}

/** Resolve where each ref was said. Keyed by `c:<commentId>` / `v:<videoId>`;
 *  a ref that resolves to nothing is absent (the appendix prints it without
 *  platform, date or link rather than guessing). */
export async function resolveCitations(admin: SupabaseClient, refs: CitationRef[]): Promise<Map<string, CitationMeta>> {
  const out = new Map<string, CitationMeta>()
  const commentIds = [...new Set(refs.map((r) => r.commentId).filter((id): id is string => !!id))]
  const videoRowIds = [...new Set(refs.filter((r) => !r.commentId && r.videoId).map((r) => r.videoId as string))]

  const chunk = <T,>(ids: string[], read: (ids: string[]) => PromiseLike<{ data: T[] | null }>) =>
    Promise.all(Array.from({ length: Math.ceil(ids.length / 120) }, (_, i) => read(ids.slice(i * 120, i * 120 + 120)))).then((rs) => rs.flatMap((r) => r.data ?? []))

  type CommentRow = { id: string; platform: string | null; comment_date: string | null; video_id: string | null; comment_id: string | null; client_id: string }
  const comments = commentIds.length
    ? await chunk<CommentRow>(commentIds, (ids) => admin.from('comments').select('id, platform, comment_date, video_id, comment_id, client_id').in('id', ids))
    : []

  // Videos for the comments (by platform-native id) and for transcript refs (by row id).
  const nativeKeys = [...new Set(comments.filter((c) => c.platform && c.video_id).map((c) => `${c.platform}::${c.video_id}`))]
  const nativeIds = [...new Set(comments.map((c) => c.video_id).filter((v): v is string => !!v))]
  type VideoRow = { id: string; platform: string | null; video_id: string | null; video_url: string | null; upload_date: string | null }
  const [byNative, byRow] = await Promise.all([
    nativeIds.length ? chunk<VideoRow>(nativeIds, (ids) => admin.from('videos').select('id, platform, video_id, video_url, upload_date').in('video_id', ids)) : Promise.resolve([] as VideoRow[]),
    videoRowIds.length ? chunk<VideoRow>(videoRowIds, (ids) => admin.from('videos').select('id, platform, video_id, video_url, upload_date').in('id', ids)) : Promise.resolve([] as VideoRow[]),
  ])
  const videoByKey = new Map<string, VideoRow>()
  for (const v of byNative) if (v.platform && v.video_id && nativeKeys.includes(`${v.platform}::${v.video_id}`)) videoByKey.set(`${v.platform}::${v.video_id}`, v)

  for (const c of comments) {
    const v = c.platform && c.video_id ? videoByKey.get(`${c.platform}::${c.video_id}`) : undefined
    const link = citationLink(c.platform, v?.video_url ?? null, c.comment_id)
    out.set(`c:${c.id}`, { platform: c.platform, date: c.comment_date ? c.comment_date.slice(0, 10) : null, ...link })
  }
  for (const v of byRow) {
    out.set(`v:${v.id}`, { platform: v.platform, date: v.upload_date, href: v.video_url, commentLevel: false })
  }
  return out
}
