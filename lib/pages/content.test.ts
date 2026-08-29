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
      ref: 'm:c1', text: 'how long does the battery actually last',
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
        { platform: 'tiktok', ref: 'e:e1', text: 'how long does the battery actually last' },
        { platform: 'tiktok', ref: 'e:e2', text: 'how long does the battery actually last' },
      ],
    })
  })
})

describe('Content quotes freeze', () => {
  const row = (id: string, text: string): ContentInboxRow => ({
    id, intent: 'question', age: null, context: 'under a category video', ref: `m:${id}`, text,
    platform: 'tiktok', href: `https://t.example/${id}`, commentLevel: false, insightId: 'i1', category: 'question', theme: 't',
  })

  it('strips the inbox and evidence-detail quotes to refs and restores them', () => {
    const engageDetail: EngageInsightDetail = {
      insightId: 'i1', theme: 'battery_life', category: 'question', description: null,
      quotes: [{ platform: 'tiktok', ref: 'e:e1', text: 'how long does the battery last' }],
    }
    const data = { inbox: { rows: [row('c1', 'just ordered mine')] }, engageDetail }
    const { data: frozen, refs } = freezeQuotes(data)
    expect(refs.sort()).toEqual(['e:e1', 'm:c1'])
    expect(JSON.stringify(frozen)).not.toContain('ordered')
    expect(JSON.stringify(frozen)).not.toContain('battery last')
    const thawed = resolveQuotes(frozen, new Map([['m:c1', 'just ordered mine'], ['e:e1', 'how long does the battery last']]))
    expect(thawed).toEqual(data)
  })

  it('drops an erased comment’s whole inbox row — link, context and all', () => {
    const { data: frozen } = freezeQuotes({ inbox: { rows: [row('c1', 'kept'), row('c2', 'erased')] } })
    const thawed = resolveQuotes(frozen, new Map([['m:c1', 'kept']]))
    expect(thawed.inbox.rows.map((r) => r.id)).toEqual(['c1'])
    expect(JSON.stringify(thawed)).not.toContain('c2')
  })
})
