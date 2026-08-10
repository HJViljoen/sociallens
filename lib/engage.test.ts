import { describe, expect, it } from 'vitest'
import { engageDeepLink, engageVocab, rankEngageCandidates, type EngageCandidate } from './engage'

const WINDOW = '2026-08-02T00:00:00Z'

let n = 0
function cand(over: {
  category?: string
  strength?: number | null
  likes?: number
  commentDate?: string | null
  videoUrl?: string | null
  commentId?: string
  text?: string
}): EngageCandidate {
  n++
  return {
    insightId: `i${n}`,
    category: over.category ?? 'question',
    strength: over.strength === undefined ? 5 : over.strength,
    theme: 'theme',
    comment: {
      id: over.commentId ?? `c${n}`,
      author: 'a',
      text: over.text ?? 'where can i actually buy one of these',
      likes: over.likes ?? 0,
      commentDate: over.commentDate === undefined ? '2026-08-05T10:00:00Z' : over.commentDate,
      platform: 'tiktok',
      videoUrl: over.videoUrl === undefined ? `https://t.example/${n}` : over.videoUrl,
      account: null,
      platformCommentId: `p${n}`,
    },
  }
}

describe('rankEngageCandidates', () => {
  it('hard-drops comments outside the window and undated ones', () => {
    const out = rankEngageCandidates(
      [
        cand({ commentDate: '2026-07-20T00:00:00Z', likes: 500 }),
        cand({ commentDate: null, likes: 500 }),
        cand({ commentDate: '2026-08-05T00:00:00Z' }),
      ],
      { windowStart: WINDOW },
    )
    expect(out).toHaveLength(1)
    expect(out[0].comment.commentDate).toBe('2026-08-05T00:00:00Z')
  })

  it('category priority beats strength and likes — a viral question cannot outrank purchase intent', () => {
    const viral = cand({ category: 'question', strength: 9, likes: 6128 })
    const intent = cand({ category: 'purchase_intent', strength: 4, likes: 1 })
    const out = rankEngageCandidates([viral, intent], { windowStart: WINDOW })
    expect(out[0]).toBe(intent)
  })

  it('within a category, strength beats likes; likes only tiebreak', () => {
    const liked = cand({ strength: 5, likes: 6128 })
    const strong = cand({ strength: 9, likes: 0 })
    const tiebreak = cand({ strength: 5, likes: 3 })
    const out = rankEngageCandidates([liked, tiebreak, strong], { windowStart: WINDOW })
    expect(out.map((c) => c.insightId)).toEqual([strong.insightId, liked.insightId, tiebreak.insightId])
  })

  it('dedupes per comment and caps two per video', () => {
    const url = 'https://t.example/same'
    const a = cand({ videoUrl: url, commentId: 'same-comment' })
    const b = cand({ videoUrl: url, commentId: 'same-comment' })
    const c = cand({ videoUrl: url })
    const d = cand({ videoUrl: url })
    const out = rankEngageCandidates([a, b, c, d], { windowStart: WINDOW })
    expect(out).toHaveLength(2)
  })

  it('hard-drops non-English and too-short comments — the digest must be actionable', () => {
    const chinese = cand({ text: '好好看👍❤期待第八季🎉🎉🎉', likes: 900 })
    const short = cand({ text: 'yes!!' })
    const real = cand({ text: 'does this work for above-knee amputees too?' })
    const out = rankEngageCandidates([chinese, short, real], { windowStart: WINDOW })
    expect(out).toHaveLength(1)
    expect(out[0]).toBe(real)
  })

  it('on-topic gate: pollution-video candidates drop, oblique-but-on-market ones stay', () => {
    const vocab = engageVocab([['ossur'], ['ottobock'], ['prosthetic leg', 'amputee', '#runningblade']])
    const junk = cand({ category: 'purchase_intent', strength: 9 })
    junk.theme = 'Game item giveaway requests'
    junk.videoTopics = ['gaming', 'Blox Fruits PvP', 'rage quit']
    const genuine = cand({ category: 'question', strength: 5 })
    genuine.theme = 'Fit and comfort questions'
    genuine.videoTopics = ['amputee', 'dancing', 'balance']
    const out = rankEngageCandidates([junk, genuine], { windowStart: WINDOW, vocab })
    expect(out).toHaveLength(1)
    expect(out[0]).toBe(genuine)
    // No vocab configured → gate off, both survive.
    expect(rankEngageCandidates([junk, genuine], { windowStart: WINDOW })).toHaveLength(2)
  })

  it('applies per-category and total caps', () => {
    const qs = Array.from({ length: 5 }, () => cand({ category: 'question' }))
    const pis = Array.from({ length: 5 }, () => cand({ category: 'purchase_intent' }))
    const out = rankEngageCandidates([...qs, ...pis], { windowStart: WINDOW, perCategoryCap: 3, totalCap: 4 })
    expect(out).toHaveLength(4)
    expect(out.filter((c) => c.category === 'purchase_intent')).toHaveLength(3)
    expect(out.filter((c) => c.category === 'question')).toHaveLength(1)
  })
})

describe('engageDeepLink', () => {
  it('deep-links to the comment on YouTube, the post elsewhere, nothing without a URL', () => {
    const yt = cand({ videoUrl: 'https://www.youtube.com/watch?v=x' })
    yt.comment.platform = 'youtube'
    expect(engageDeepLink(yt.comment)).toEqual({
      href: `https://www.youtube.com/watch?v=x&lc=${yt.comment.platformCommentId}`,
      commentLevel: true,
    })
    const tt = cand({ videoUrl: 'https://t.example/v' })
    expect(engageDeepLink(tt.comment)).toEqual({ href: 'https://t.example/v', commentLevel: false })
    const none = cand({ videoUrl: null })
    expect(engageDeepLink(none.comment)).toEqual({ href: null, commentLevel: false })
  })
})
