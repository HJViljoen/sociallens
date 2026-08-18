import { describe, it, expect } from 'vitest'
import {
  diffRefreshedComments, evidenceToDrop, phrasesToDrop, diffRefreshedVideos, videoTombstone,
  refreshCutoffs, distinctIds, assertPlausibleGoneRate, type StoredComment, type RefreshedComment,
} from './youtube-refresh'

const NOW = '2026-08-22T02:00:00.000Z'

const stored = (over: Partial<StoredComment> = {}): StoredComment => ({
  id: 'row-1', client_id: 'c1', run_id: 'r1', video_id: 'v1', comment_id: 'yt-1',
  author: '@alice', text: 'The socket rubs after two hours', likes: 3, reply_count: 0, ...over,
})
const fetched = (over: Partial<RefreshedComment> = {}): RefreshedComment => ({
  comment_id: 'yt-1', author: '@alice', text: 'The socket rubs after two hours', likes: 5, reply_count: 1, ...over,
})

describe('diffRefreshedComments', () => {
  it('found → one upsert per stored row, refreshed_at stamped, counts refreshed', () => {
    const d = diffRefreshedComments([stored()], new Map([['yt-1', fetched()]]), NOW)
    expect(d.missingIds).toEqual([])
    expect(d.textChangedIds).toEqual([])
    expect(d.upserts).toHaveLength(1)
    expect(d.upserts[0]).toMatchObject({ client_id: 'c1', run_id: 'r1', platform: 'youtube', video_id: 'v1', comment_id: 'yt-1', likes: 5, reply_count: 1, refreshed_at: NOW })
  })

  it('a comment id held by two tenants fans out to both rows', () => {
    const rows = [stored({ id: 'row-1', client_id: 'c1' }), stored({ id: 'row-2', client_id: 'c2', run_id: 'r9' })]
    const d = diffRefreshedComments(rows, new Map([['yt-1', fetched()]]), NOW)
    expect(d.upserts.map((u) => u.client_id)).toEqual(['c1', 'c2'])
    expect(d.upserts[1].run_id).toBe('r9')
  })

  it('keeps the stored (pseudonymised) author for protected tenants, still refreshes text/counts', () => {
    const rows = [stored({ id: 'demo', client_id: 'demo-tenant', author: 'user_49d29304' }), stored({ id: 'real', client_id: 'c1' })]
    const d = diffRefreshedComments(rows, new Map([['yt-1', fetched({ author: '@Alice Real', likes: 9 })]]), NOW, { keepAuthorForClients: new Set(['demo-tenant']) })
    expect(d.upserts.find((u) => u.client_id === 'demo-tenant')).toMatchObject({ author: 'user_49d29304', likes: 9 })
    expect(d.upserts.find((u) => u.client_id === 'c1')).toMatchObject({ author: '@Alice Real', likes: 9 })
  })

  it('missing on YouTube → missingIds, no upsert', () => {
    const d = diffRefreshedComments([stored(), stored({ id: 'row-2', comment_id: 'yt-2' })], new Map([['yt-1', fetched()]]), NOW)
    expect(d.missingIds).toEqual(['row-2'])
    expect(d.upserts).toHaveLength(1)
  })

  it('edited text → textChangedIds + new text; whitespace/case-only edits do not count', () => {
    const edited = fetched({ text: 'The socket rubs after two hours — fixed by my prosthetist' })
    const cosmetic = fetched({ comment_id: 'yt-2', text: '  the SOCKET rubs after   two hours ' })
    const rows = [stored(), stored({ id: 'row-2', comment_id: 'yt-2' })]
    const d = diffRefreshedComments(rows, new Map([['yt-1', edited], ['yt-2', cosmetic]]), NOW)
    expect(d.textChangedIds).toEqual(['row-1'])
    expect(d.textById.get('row-1')).toBe(edited.text)
    // the cosmetic edit still gets upserted (fresh text, fresh stamp), just not flagged
    expect(d.upserts).toHaveLength(2)
  })
})

describe('evidenceToDrop / phrasesToDrop', () => {
  const textById = new Map([['row-1', 'The socket rubs after two hours, then it is fine']])
  it('keeps quotes that still appear, drops ones that do not', () => {
    const ev = [
      { id: 'e1', comment_id: 'row-1', quote: 'socket rubs after two hours' },
      { id: 'e2', comment_id: 'row-1', quote: 'my liner tore' },
    ]
    expect(evidenceToDrop(ev, textById)).toEqual(['e2'])
  })
  it('never drops redacted or empty-quote rows, ignores rows for unchanged comments', () => {
    const ev = [
      { id: 'e1', comment_id: 'row-1', quote: '', redacted: true },
      { id: 'e2', comment_id: 'row-1', quote: '' },
      { id: 'e3', comment_id: 'row-other', quote: 'anything' },
      { id: 'e4', comment_id: null, quote: 'transcript line' },
    ]
    expect(evidenceToDrop(ev, textById)).toEqual([])
  })
  it('phrases follow the same rule', () => {
    const s = [{ id: 's1', comment_id: 'row-1', phrase: 'rubs after two hours' }, { id: 's2', comment_id: 'row-1', phrase: 'liner tore' }]
    expect(phrasesToDrop(s, textById)).toEqual(['s2'])
  })
})

describe('diffRefreshedVideos', () => {
  const v = { id: 'vid-row', video_id: 'abc', views: 1000, likes: 50, comments_count: 10, comments_count_at_scrape: null as number | null }
  it('updates stats, recomputes engagement with the gather formula, freezes the delta baseline from the OLD count', () => {
    const { updates, missingIds } = diffRefreshedVideos([v], new Map([['abc', { views: 2000, likes: 80, comments_count: 30 }]]), NOW)
    expect(missingIds).toEqual([])
    expect(updates[0]).toMatchObject({ id: 'vid-row', views: 2000, likes: 80, comments_count: 30, comments_count_at_scrape: 10, refreshed_at: NOW })
    expect(updates[0].engagement_rate).toBe(5.5) // (80+30)/2000*100
  })
  it('does not overwrite an existing baseline', () => {
    const { updates } = diffRefreshedVideos([{ ...v, comments_count_at_scrape: 7 }], new Map([['abc', { views: 1, likes: 0, comments_count: 0 }]]), NOW)
    expect(updates[0].comments_count_at_scrape).toBe(7)
    expect(updates[0].engagement_rate).toBe(0)
  })
  it('zero views → null engagement; missing → missingIds', () => {
    const { updates, missingIds } = diffRefreshedVideos(
      [v, { ...v, id: 'gone', video_id: 'zzz' }],
      new Map([['abc', { views: 0, likes: 0, comments_count: 0 }]]), NOW)
    expect(updates[0].engagement_rate).toBeNull()
    expect(missingIds).toEqual(['gone'])
  })
  it('tombstone clears the API-sourced fields and stamps both dates', () => {
    expect(videoTombstone(NOW)).toEqual({ unavailable_at: NOW, refreshed_at: NOW, caption: null, hashtags: [], views: 0, likes: 0, comments_count: 0, engagement_rate: null })
  })
})

describe('cutoffs + distinctIds', () => {
  it('due at 25 days, backstop at 30', () => {
    const c = refreshCutoffs(new Date('2026-08-31T00:00:00.000Z'))
    expect(c.due).toBe('2026-08-06T00:00:00.000Z')
    expect(c.backstop).toBe('2026-08-01T00:00:00.000Z')
  })
  it('distinct, order-preserving, capped', () => {
    const rows = [{ comment_id: 'a' }, { comment_id: 'b' }, { comment_id: 'a' }, { comment_id: 'c' }]
    expect(distinctIds(rows, 'comment_id', 10)).toEqual(['a', 'b', 'c'])
    expect(distinctIds(rows, 'comment_id', 2)).toEqual(['a', 'b'])
  })
})

describe('assertPlausibleGoneRate — the circuit breaker', () => {
  it('lets the measured world through: 4% gone, and even the oldest cohort at 30%', () => {
    expect(() => assertPlausibleGoneRate('comments', 196, 188)).not.toThrow()
    expect(() => assertPlausibleGoneRate('comments', 50, 35)).not.toThrow()
    expect(() => assertPlausibleGoneRate('videos', 50, 45)).not.toThrow()
    expect(() => assertPlausibleGoneRate('comments', 5, 0)).not.toThrow() // too few to judge
  })
  it('refuses a systemic failure that reads as absence', () => {
    expect(() => assertPlausibleGoneRate('comments', 50, 0)).toThrow(/0 of 50/)
    expect(() => assertPlausibleGoneRate('comments', 200, 60)).toThrow(/70% gone/)
    expect(() => assertPlausibleGoneRate('videos', 10, 0)).toThrow()
  })
})
