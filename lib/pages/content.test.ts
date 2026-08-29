import { describe, expect, it } from 'vitest'
import { freezeQuotes, resolveQuotes } from '../renderables/quotes-freeze'
import { toContentInboxRows, buildEngageDetail, type ContentInboxRow, type EngageInsightDetail } from './content'
import { shapeInbox } from '../content-tiles'
import type { EngageCandidate } from '../engage'

const candidate = (over: {
  insightId?: string
  evidenceId?: string
  category?: string
  commentId?: string
  commentDate?: string | null
  likes?: number
}): EngageCandidate => ({
  insightId: over.insightId ?? 'i1',
  evidenceId: over.evidenceId ?? 'e1',
  category: over.category ?? 'question',
  strength: 5,
  theme: 'battery_life',
  description: 'Comments asking how long the battery lasts.',
  comment: {
    id: over.commentId ?? 'c1',
    author: 'a',
    text: 'how long does the battery actually last',
    likes: over.likes ?? 0,
    commentDate: over.commentDate === undefined ? '2026-08-15T00:00:00Z' : over.commentDate,
    platform: 'tiktok',
    videoUrl: 'https://t.example/1',
    account: 'ossur',
    platformCommentId: 'p1',
  },
})

describe('toContentInboxRows', () => {
  it('attaches a comment-ref quote and the reply link to each shaped row', () => {
    const shaped = shapeInbox([candidate({})], { now: '2026-08-16T00:00:00Z', ownHandles: new Set(), roleByAccount: new Map() })
    const rows = toContentInboxRows(shaped)
    expect(rows).toEqual<ContentInboxRow[]>([{
      id: 'c1', intent: 'question', age: '1d', context: 'under @ossur’s post',
      quote: { ref: 'c:c1', text: 'how long does the battery actually last' },
      platform: 'tiktok', href: 'https://t.example/1', commentLevel: false,
      insightId: 'i1', category: 'question', theme: 'battery_life',
    }])
  })

  it('never links a misinformation row to reply', () => {
    const shaped = shapeInbox([candidate({ category: 'misinformation' })], { now: '2026-08-16T00:00:00Z', ownHandles: new Set(), roleByAccount: new Map() })
    const rows = toContentInboxRows(shaped)
    expect(rows[0].href).toBeNull()
  })
})

describe('buildEngageDetail', () => {
  it('is null without an engage- detail param, or when no candidate matches', () => {
    expect(buildEngageDetail([candidate({})], undefined)).toBeNull()
    expect(buildEngageDetail([candidate({})], 'videos')).toBeNull()
    expect(buildEngageDetail([candidate({ insightId: 'i1' })], 'engage-i2')).toBeNull()
  })

  it('collects every candidate citing the insight, quoted through its own evidence row', () => {
    const detail = buildEngageDetail(
      [candidate({ insightId: 'i1', evidenceId: 'e1', commentId: 'c1' }), candidate({ insightId: 'i1', evidenceId: 'e2', commentId: 'c2' }), candidate({ insightId: 'i9', evidenceId: 'e9' })],
      'engage-i1',
    )
    expect(detail).toEqual<EngageInsightDetail>({
      insightId: 'i1', theme: 'battery_life', category: 'question', description: 'Comments asking how long the battery lasts.',
      quotes: [
        { platform: 'tiktok', quote: { ref: 'e:e1', text: 'how long does the battery actually last' } },
        { platform: 'tiktok', quote: { ref: 'e:e2', text: 'how long does the battery actually last' } },
      ],
    })
  })
})

describe('Content quotes freeze', () => {
  it('strips the inbox and evidence-detail quotes to refs and restores them', () => {
    const inbox: ContentInboxRow[] = [{
      id: 'c1', intent: 'buying', age: '2d', context: 'under a category video',
      quote: { ref: 'c:c1', text: 'just ordered mine' },
      platform: 'youtube', href: 'https://y.example/1', commentLevel: true,
      insightId: 'i1', category: 'purchase_intent', theme: 'purchase_intent',
    }]
    const engageDetail: EngageInsightDetail = {
      insightId: 'i1', theme: 'battery_life', category: 'question', description: null,
      quotes: [{ platform: 'tiktok', quote: { ref: 'e:e1', text: 'how long does the battery last' } }],
    }
    const data = { inbox: { rows: inbox }, engageDetail }
    const { data: frozen, refs } = freezeQuotes(data)
    expect(refs.sort()).toEqual(['c:c1', 'e:e1'])
    expect(JSON.stringify(frozen)).not.toContain('ordered')
    expect(JSON.stringify(frozen)).not.toContain('battery last')
    const texts = new Map([['c:c1', 'just ordered mine'], ['e:e1', 'how long does the battery last']])
    const thawed = resolveQuotes(frozen, texts)
    expect(thawed.inbox.rows[0].quote.text).toBe('just ordered mine')
    expect(thawed.engageDetail!.quotes[0].quote.text).toBe('how long does the battery last')
  })

  it('nulls an erased row’s quote rather than resolving stale text — the row itself is not a Quote, so it is not dropped', () => {
    const inbox: ContentInboxRow[] = [
      { id: 'c1', intent: 'question', age: null, context: 'under a category video', quote: { ref: 'c:c1', text: 'kept' }, platform: 'tiktok', href: null, commentLevel: false, insightId: 'i1', category: 'question', theme: 't' },
      { id: 'c2', intent: 'question', age: null, context: 'under a category video', quote: { ref: 'c:c2', text: 'erased' }, platform: 'tiktok', href: null, commentLevel: false, insightId: 'i1', category: 'question', theme: 't' },
    ]
    const { data: frozen } = freezeQuotes({ inbox: { rows: inbox } })
    const thawed = resolveQuotes(frozen, new Map([['c:c1', 'kept']]))
    expect(thawed.inbox.rows.map((r) => r.id)).toEqual(['c1', 'c2'])
    expect(thawed.inbox.rows[0].quote.text).toBe('kept')
    expect(thawed.inbox.rows[1].quote).toBeNull()
  })
})
