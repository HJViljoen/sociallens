import { describe, it, expect } from 'vitest'
import {
  intentOf, ageLabel, contextLine, orderInbox, inboxRows, intentCounts, shapeInbox,
  medianEngagement, perfVsMedian, fmtMultiple, bestDuration,
  fieldSentence, topVoices, roleByAccount, initials,
  entityKey, entityScoreboard, durationPerf, entityPlaybooks, trendingSounds, durationLabel, pretty,
  type InboxRow, type InboxSource, type VoiceRole, type EntityVideo,
} from './content-tiles'
import type { EngageCandidate } from './engage'

const NOW = '2026-08-16T12:00:00Z'

describe('intentOf', () => {
  it('folds the engage categories into four intents', () => {
    expect(intentOf('purchase_intent')).toBe('buying')
    expect(intentOf('buying_trigger')).toBe('buying')
    expect(intentOf('switching_signal')).toBe('buying')
    expect(intentOf('question')).toBe('question')
    expect(intentOf('objection')).toBe('objection')
    expect(intentOf('misinformation')).toBe('misinformation')
  })
})

describe('ageLabel', () => {
  it('is coarse: today / days / weeks / months; null when undated', () => {
    expect(ageLabel('2026-08-16T03:00:00Z', NOW)).toBe('today')
    expect(ageLabel('2026-08-14T12:00:00Z', NOW)).toBe('2d')
    expect(ageLabel('2026-08-01T12:00:00Z', NOW)).toBe('2w')
    expect(ageLabel('2026-05-01T12:00:00Z', NOW)).toBe('3mo')
    expect(ageLabel(null, NOW)).toBeNull()
    expect(ageLabel('not a date', NOW)).toBeNull()
  })
})

describe('contextLine', () => {
  const roles = new Map<string, VoiceRole>([['ottobock', 'competitor'], ['amputee.coach', 'creator']])
  const own = new Set(['ossur'])
  it('says "your post" only for the client’s own handles', () => {
    expect(contextLine({ account: '@ossur', likes: 41, category: 'question' }, own, roles)).toBe('under your post · 41 likes')
    expect(contextLine({ account: 'ottobock', likes: 0, category: 'question' }, own, roles)).toBe('under @ottobock’s post · competitor')
    expect(contextLine({ account: 'amputee.coach', likes: 1, category: 'purchase_intent' }, own, roles)).toBe('under @amputee.coach’s post · 1 like')
    expect(contextLine({ account: null, likes: 0, category: 'question' }, own, roles)).toBe('under a category video')
  })
  it('marks misinformation as awareness only', () => {
    expect(contextLine({ account: 'ossur', likes: 9, category: 'misinformation' }, own, roles)).toBe('awareness only — never a reply prompt')
  })
})

describe('inbox ordering', () => {
  const src = (id: string, category: string, commentDate: string | null, likes = 0): InboxSource => ({ id, category, commentDate, likes, account: null })
  it('orders intent first, then newest; undated rows sink within their intent', () => {
    const rows = inboxRows(
      [
        src('q-old', 'question', '2026-08-10T00:00:00Z'),
        src('mis', 'misinformation', '2026-08-15T00:00:00Z'),
        src('buy-old', 'purchase_intent', '2026-08-11T00:00:00Z', 50),
        src('q-new', 'question', '2026-08-15T00:00:00Z'),
        src('buy-undated', 'buying_trigger', null),
        src('buy-new', 'switching_signal', '2026-08-14T00:00:00Z'),
        src('obj', 'objection', '2026-08-15T00:00:00Z'),
      ],
      { now: NOW, ownHandles: new Set(), roleByAccount: new Map() },
    )
    expect(rows.map((r) => r.src.id)).toEqual(['buy-new', 'buy-old', 'buy-undated', 'q-new', 'q-old', 'obj', 'mis'])
    expect(rows[0].age).toBe('2d')
    expect(rows[2].age).toBeNull()
    expect(intentCounts(rows)).toEqual([
      { intent: 'buying', count: 3 }, { intent: 'question', count: 2 }, { intent: 'objection', count: 1 }, { intent: 'misinformation', count: 1 },
    ])
  })
  it('orderInbox is stable for an already-ordered list', () => {
    const rows: InboxRow[] = [
      { src: src('a', 'question', '2026-08-15T00:00:00Z'), intent: 'question', age: '1d', context: '' },
      { src: src('b', 'question', '2026-08-14T00:00:00Z'), intent: 'question', age: '2d', context: '' },
    ]
    expect(orderInbox(rows).map((r) => r.src.id)).toEqual(['a', 'b'])
  })
})

describe('shapeInbox', () => {
  const candidate = (over: { commentId?: string; category?: string; commentDate?: string | null; likes?: number }): EngageCandidate => ({
    insightId: 'i1',
    evidenceId: 'e1',
    category: over.category ?? 'question',
    strength: 5,
    theme: 'battery_life',
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
  it('shapes candidates into ordered inbox rows, the candidate riding along as src', () => {
    const rows = shapeInbox(
      [candidate({ commentId: 'c-old', category: 'objection', commentDate: '2026-08-10T00:00:00Z' }), candidate({ commentId: 'c-new' })],
      { now: NOW, ownHandles: new Set(), roleByAccount: new Map() },
    )
    expect(rows.map((r) => r.src.id)).toEqual(['c-new', 'c-old'])
    expect(rows[0].src.comment.text).toBe('how long does the battery actually last')
    expect(rows[0].intent).toBe('question')
  })
})

describe('perfVsMedian', () => {
  const vids = [
    { engagement_rate: 2, hook_style: 'before_after' },
    { engagement_rate: 6, hook_style: 'before_after' },
    { engagement_rate: 1, hook_style: 'direct_question' },
    { engagement_rate: 3, hook_style: 'direct_question' },
    { engagement_rate: '4', hook_style: 'shock_stat' },        // singleton — dropped at minCount 2
    { engagement_rate: 0, hook_style: 'face_to_camera' },       // no engagement — doesn't count
    { engagement_rate: null, hook_style: 'face_to_camera' },
    { engagement_rate: 2, hook_style: null },                   // unclassified — ignored for groups, counted for the median
  ]
  it('reads each group against the update’s median video, best first', () => {
    // engagement rates > 0: 2,6,1,3,4,2 → median 2.5
    expect(medianEngagement(vids)).toBe(2.5)
    const out = perfVsMedian(vids, 'hook_style', { minCount: 2 })
    expect(out.map((r) => r.k)).toEqual(['before_after', 'direct_question'])
    expect(out[0].multiple).toBeCloseTo(4 / 2.5)
    expect(out[0].count).toBe(2)
    expect(out[1].multiple).toBeCloseTo(2 / 2.5)
  })
  it('keeps singletons when asked, and returns nothing without a median', () => {
    expect(perfVsMedian(vids, 'hook_style', { minCount: 1 }).map((r) => r.k)).toEqual(['before_after', 'shock_stat', 'direct_question']) // 4 vs 4 — the bigger group first
    expect(perfVsMedian([{ engagement_rate: 0, hook_style: 'x' }], 'hook_style')).toEqual([])
  })
  it('formats multiples without false precision', () => {
    expect(fmtMultiple(2.44)).toBe('2.4×')
    expect(fmtMultiple(1)).toBe('1×')
    expect(fmtMultiple(12.6)).toBe('13×')
    expect(fmtMultiple(0.7)).toBe('0.7×')
  })
})

describe('bestDuration', () => {
  it('picks the best band with enough videos and reads it against the median video', () => {
    const v = bestDuration([
      { label: 'Under 15s', count: 3, avgEng: 3, engN: 3 },
      { label: '15–30s', count: 212, avgEng: 4.2, engN: 200 },
      { label: 'Over 1 min', count: 40, avgEng: 2, engN: 30 },
      { label: '30–60s', count: 1, avgEng: 9, engN: 1 }, // too thin
    ], 2)
    expect(v?.best.label).toBe('15–30s')
    expect(v?.multiple).toBeCloseTo(2.1)
  })
  it('handles a missing median and no bands', () => {
    const one = bestDuration([{ label: '15–30s', count: 5, avgEng: 4, engN: 5 }], null)
    expect(one?.best.label).toBe('15–30s')
    expect(one?.multiple).toBeNull()
    expect(bestDuration([], 2)).toBeNull()
    expect(bestDuration([{ label: 'x', count: 2, avgEng: null, engN: 0 }], 2)).toBeNull()
  })
})

describe('fieldSentence', () => {
  it('grounds every clause in the numbers', () => {
    expect(fieldSentence([
      { label: 'You', kind: 'you', videos: 27, views: 129_000, avgEng: 4.1 },
      { label: 'Ottobock', kind: 'competitor', videos: 75, views: 73_000, avgEng: 3.2 },
      { label: 'Category creators', kind: 'category', videos: 366, views: 18_200_000, avgEng: 6.6 },
    ])).toBe('You out-engage Ottobock per video but posted 27 videos to their 75; category creators own reach.')
  })
  it('flips the joiner when engagement and volume agree', () => {
    expect(fieldSentence([
      { label: 'You', kind: 'you', videos: 80, views: 900_000, avgEng: 4.1 },
      { label: 'Ottobock', kind: 'competitor', videos: 20, views: 73_000, avgEng: 3.2 },
    ])).toBe('You out-engage Ottobock per video and posted 80 videos to their 20; you own reach.')
    expect(fieldSentence([
      { label: 'You', kind: 'you', videos: 10, views: 1_000, avgEng: 2 },
      { label: 'Ottobock', kind: 'competitor', videos: 20, views: 5_000, avgEng: 3.2 },
    ])).toBe('Ottobock out-engages you per video and posted 10 videos to their 20; Ottobock owns reach.')
  })
  it('stays quiet without numbers to compare', () => {
    expect(fieldSentence([{ label: 'You', kind: 'you', videos: 3, views: 0, avgEng: null }])).toBeNull()
    expect(fieldSentence([
      { label: 'Ottobock', kind: 'competitor', videos: 5, views: 100, avgEng: null },
      { label: 'Category creators', kind: 'category', videos: 50, views: 9_000, avgEng: null },
    ])).toBe('Ottobock posted 5 videos this update; category creators own reach.')
    expect(fieldSentence([
      { label: 'You', kind: 'you', videos: 4, views: 0, avgEng: null },
      { label: 'Ottobock', kind: 'competitor', videos: 4, views: 0, avgEng: null },
    ])).toBe('You posted as often (4 each).')
  })
})

describe('topVoices', () => {
  const vid = (account_name: string, views: number, role: 'you' | 'comp' | 'creator' = 'creator', classified_type: string | null = null) => ({
    account_name, views, is_client: role === 'you', is_competitor: role === 'comp', competitor_name: role === 'comp' ? 'Ottobock' : null, classified_type,
  })
  it('ranks accounts by views, carries role and the most common format', () => {
    const out = topVoices([
      vid('amputee.coach', 700_000, 'creator', 'day_in_the_life'),
      vid('amputee.coach', 500_000, 'creator', 'day_in_the_life'),
      vid('amputee.coach', 10, 'creator', 'explainer'),
      vid('@ottobock', 410_000, 'comp'),
      vid('ossur', 129_000, 'you', 'brand_ad'),
      vid('tiny', 5),
    ], 3)
    expect(out.map((v) => [v.name, v.role, v.videos, v.views, v.topFormat])).toEqual([
      ['amputee.coach', 'creator', 3, 1_200_010, 'day_in_the_life'],
      ['ottobock', 'competitor', 1, 410_000, null],
      ['ossur', 'you', 1, 129_000, 'brand_ad'],
    ])
    expect(out[1].competitorName).toBe('Ottobock')
  })
  it('maps account → role with you winning over competitor over creator', () => {
    const m = roleByAccount([vid('a', 1), vid('a', 1, 'comp'), vid('b', 1, 'you'), vid('b', 1)])
    expect(m.get('a')).toBe('competitor')
    expect(m.get('b')).toBe('you')
  })
  it('makes two-letter initials from a handle', () => {
    expect(initials('amputee.coach')).toBe('AC')
    expect(initials('@ossur')).toBe('OS')
    expect(initials('runningblade_life')).toBe('RL')
    expect(initials('x')).toBe('X')
  })
})

describe('entityKey and the scoreboard', () => {
  const vid = (over: Partial<EntityVideo> = {}): EntityVideo => ({
    is_client: false, is_competitor: false, competitor_name: null,
    duration_seconds: 20, engagement_rate: 3, views: 1000,
    classified_type: null, hook_style: null, audio_name: null,
    ...over,
  })
  it('reads a video’s entity: you, a named competitor, or category creators', () => {
    expect(entityKey(vid({ is_client: true }))).toEqual({ label: 'You', kind: 'you' })
    expect(entityKey(vid({ is_competitor: true, competitor_name: 'Ottobock' }))).toEqual({ label: 'Ottobock', kind: 'competitor' })
    expect(entityKey(vid({ is_competitor: true, competitor_name: null }))).toEqual({ label: 'Competitor', kind: 'competitor' })
    expect(entityKey(vid())).toEqual({ label: 'Category creators', kind: 'category' })
  })

  it('groups the scoreboard by entity, You first, then competitors by volume, category last', () => {
    const rows = entityScoreboard([
      vid({ is_client: true, duration_seconds: 10, engagement_rate: 4, views: 100 }),
      vid({ is_client: true, duration_seconds: 30, engagement_rate: 2, views: 200 }),
      vid({ is_competitor: true, competitor_name: 'Ottobock', engagement_rate: 0, views: 50 }),
      vid(), vid(), vid(),
    ])
    expect(rows.map((r) => r.label)).toEqual(['You', 'Ottobock', 'Category creators'])
    const you = rows[0]
    expect(you).toMatchObject({ videos: 2, views: 300, medianDuration: 20, avgEng: 3, engN: 2 })
    expect(rows.find((r) => r.label === 'Ottobock')).toMatchObject({ avgEng: null, engN: 0 })
  })

  it('buckets videos into non-empty duration bands, engagement averaged per band', () => {
    const out = durationPerf([
      vid({ duration_seconds: 10, engagement_rate: 2 }),
      vid({ duration_seconds: 12, engagement_rate: 4 }),
      vid({ duration_seconds: 45, engagement_rate: 0 }),
      vid({ duration_seconds: 0 }), // uncounted — no duration
    ])
    expect(out).toEqual([
      { label: 'Under 15 s', count: 2, avgEng: 3, engN: 2 },
      { label: '30–60 s', count: 1, avgEng: null, engN: 0 },
    ])
  })

  it('builds per-entity playbooks: top formats and hook, coverage stated', () => {
    const out = entityPlaybooks([
      vid({ is_client: true, classified_type: 'review', hook_style: 'direct_question' }),
      vid({ is_client: true, classified_type: 'review' }),
      vid({ is_client: true }),
    ])
    expect(out[0]).toMatchObject({ label: 'You', total: 3, classified: 2, topFormats: [{ k: 'review', count: 2 }], topHook: { k: 'direct_question', count: 1 } })
  })

  it('picks sounds shared by 2+ videos, most-used and highest-viewed first', () => {
    const out = trendingSounds([
      vid({ audio_name: 'trend-a', views: 10 }),
      vid({ audio_name: 'trend-a', views: 20 }),
      vid({ audio_name: 'solo-track', views: 999 }),
    ])
    expect(out).toEqual([{ name: 'trend-a', count: 2, views: 30 }])
  })

  it('formats a duration and humanizes a slug', () => {
    expect(durationLabel(9)).toBe('9s')
    expect(durationLabel(92)).toBe('1:32 min')
    expect(pretty('before_after')).toBe('before after')
  })
})
