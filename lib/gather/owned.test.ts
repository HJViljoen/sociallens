import { describe, expect, it } from 'vitest'
import {
  acceptSnapshot,
  followerFloorPct,
  supportsOwnedProfile,
  emptyProfileIsGlitch,
  stampOwnedSource,
  ownedRawRows,
  igRawsByShortcode,
} from './owned'

describe('supportsOwnedProfile', () => {
  it('covers the three scraped platforms', () => {
    expect(supportsOwnedProfile('instagram')).toBe(true)
    expect(supportsOwnedProfile('tiktok')).toBe(true)
    expect(supportsOwnedProfile('youtube')).toBe(true)
  })

  it('excludes Reddit — a subreddit is not a brand-owned account', () => {
    // Wave 3: own_handles.reddit must be SKIPPED, not thrown. The daily
    // snapshot cron would otherwise fail for that tenant every morning.
    expect(supportsOwnedProfile('reddit')).toBe(false)
  })

  it('excludes unknown platforms', () => {
    expect(supportsOwnedProfile('facebook')).toBe(false)
  })
})

describe('acceptSnapshot', () => {
  it('rejects null/zero glitch reads', () => {
    expect(acceptSnapshot(61000, null).ok).toBe(false)
    expect(acceptSnapshot(61000, undefined).ok).toBe(false)
    expect(acceptSnapshot(61000, 0)).toEqual({ ok: false, reason: 'zero-count' })
  })

  it('rejects >20% single-step jumps, accepts normal movement', () => {
    expect(acceptSnapshot(61000, 40000).ok).toBe(false) // -34% — wrong-account/logged-out read
    expect(acceptSnapshot(61000, 80000).ok).toBe(false)
    expect(acceptSnapshot(61000, 62500)).toEqual({ ok: true }) // +2.5% — real growth
  })

  it('accepts any positive first reading (no prior)', () => {
    expect(acceptSnapshot(null, 12500)).toEqual({ ok: true })
  })
})

describe('followerFloorPct', () => {
  it('keeps the base floor for exact-count platforms', () => {
    expect(followerFloorPct('instagram', 61234, 1.5)).toBe(1.5)
    expect(followerFloorPct('tiktok', 23258, 1.5)).toBe(1.5)
  })

  it('raises the YouTube floor so 2 rounding steps cannot fake an event', () => {
    // 12,500 subs → 3-sig-fig rounding step = 100 → floor = 2*100/12500 = 1.6%
    expect(followerFloorPct('youtube', 12500, 1.5)).toBeCloseTo(1.6, 5)
    // 999 subs → 3 digits shown exactly (step 1) → base floor stands
    expect(followerFloorPct('youtube', 999, 1.5)).toBe(1.5)
    // 1M subs → step 10,000 → 2% — rounding dominates even at scale
    expect(followerFloorPct('youtube', 1_000_000, 1.5)).toBeCloseTo(2, 5)
  })
})

describe('emptyProfileIsGlitch', () => {
  it('flags the 2026-08-16 Instagram case: 1,494 posts reported, none returned', () => {
    expect(emptyProfileIsGlitch(1494, 0)).toBe(true)
  })

  it('accepts a genuinely empty account — an explicit zero is the only real emptiness', () => {
    expect(emptyProfileIsGlitch(0, 0)).toBe(false)
  })

  it('flags a null postsCount with no posts — the same glitch, second presentation', () => {
    // 2026-08-16, one hour after the 1,494-posts case: the same handle came
    // back followers-present, postsCount null, zero posts. Keying the guard on
    // postsCount > 0 would have stayed silent through exactly the failure it
    // exists to catch.
    expect(emptyProfileIsGlitch(null, 0)).toBe(true)
  })

  it('is irrelevant once any post came back', () => {
    expect(emptyProfileIsGlitch(1494, 12)).toBe(false)
    expect(emptyProfileIsGlitch(null, 12)).toBe(false)
    expect(emptyProfileIsGlitch(0, 12)).toBe(false)
  })
})

describe('stampOwnedSource', () => {
  const posts = [{ video_id: 'a' }, { video_id: 'b' }, { video_id: 'c' }]

  it('gives every row an explicit source — PostgREST sends NULL for a missing key', () => {
    // The 2026-08-16 YouTube failure: 2 of 12 posts already known, so those
    // rows carried no `source` key, PostgREST filled NULL, and the NOT NULL
    // constraint rejected the whole upsert (23502).
    const rows = stampOwnedSource(posts, [{ video_id: 'a', source: 'discovered' }])
    expect(rows.every((r) => typeof r.source === 'string' && r.source.length > 0)).toBe(true)
  })

  it('keeps an already-discovered client post on the discovered layer', () => {
    // Flipping it to 'owned' would drop it out of the SoV series and fake a
    // share decline — metric continuity beats layer purity.
    const rows = stampOwnedSource(posts, [{ video_id: 'a', source: 'discovered' }])
    expect(rows.find((r) => r.video_id === 'a')!.source).toBe('discovered')
  })

  it("keeps a post already stored as 'owned' on the owned layer", () => {
    const rows = stampOwnedSource(posts, [{ video_id: 'b', source: 'owned' }])
    expect(rows.find((r) => r.video_id === 'b')!.source).toBe('owned')
  })

  it("stamps posts new to us as 'owned'", () => {
    const rows = stampOwnedSource(posts, [{ video_id: 'a', source: 'discovered' }])
    expect(rows.find((r) => r.video_id === 'c')!.source).toBe('owned')
  })

  it("treats a stored NULL source as new rather than propagating the NULL", () => {
    const rows = stampOwnedSource(posts, [{ video_id: 'a', source: null }])
    expect(rows.find((r) => r.video_id === 'a')!.source).toBe('owned')
  })

  it('preserves every input field', () => {
    const rows = stampOwnedSource([{ video_id: 'a', views: 12 }], [])
    expect(rows[0]).toEqual({ video_id: 'a', views: 12, source: 'owned' })
  })
})

describe('ownedRawRows — own posts into the transcribe pool (Brand Voice)', () => {
  const ctx = { clientId: 'c', runId: 'r' }
  const post = (video_id: string, platform: 'youtube' | 'tiktok' | 'instagram' = 'youtube') =>
    ({ video_id, platform, video_url: `u/${video_id}` }) as unknown as Parameters<typeof ownedRawRows>[0][number]

  it('files one video_raw row per post that has a raw item, keyed by this run', () => {
    const rows = ownedRawRows([post('a'), post('b')], { a: { id: 'a' } }, ctx)
    expect(rows).toEqual([{ client_id: 'c', run_id: 'r', platform: 'youtube', video_id: 'a', raw: { id: 'a' } }])
  })
  it('returns nothing when the profile carried no raws (IG refetch failed)', () => {
    expect(ownedRawRows([post('a')], undefined, ctx)).toEqual([])
  })
})

describe('igRawsByShortcode', () => {
  it('keys posts-mode items by shortCode with a url fallback; first wins; skips junk', () => {
    const out = igRawsByShortcode([
      { shortCode: 'Db6AVCIiJPK', audioUrl: 'x' },
      { url: 'https://www.instagram.com/reel/Dbn476REwYZ/', videoUrl: 'y' },
      { shortCode: 'Db6AVCIiJPK', audioUrl: 'dup' },
      null as unknown as Record<string, unknown>,
      { nothing: true },
    ])
    expect(Object.keys(out)).toEqual(['Db6AVCIiJPK', 'Dbn476REwYZ'])
    expect(out.Db6AVCIiJPK.audioUrl).toBe('x')
  })
})
