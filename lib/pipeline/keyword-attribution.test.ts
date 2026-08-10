import { describe, expect, it } from 'vitest'
import { computeKeywordAttribution, type AttributionVideo } from './keyword-attribution'

const vid = (id: string, platform: string, keywords: string[] | null): AttributionVideo => ({
  id,
  platform,
  source_keywords: keywords,
})

describe('computeKeywordAttribution', () => {
  it('credits every keyword on the source video, full credit each', () => {
    const counts = computeKeywordAttribution(
      [{ source_video_id: 'v1' }, { source_video_id: 'v1' }],
      [vid('v1', 'instagram', ['ossur', '#runningblade'])],
    )
    expect(counts.get('instagram::ossur')).toBe(2)
    expect(counts.get('instagram::#runningblade')).toBe(2)
    expect(counts.size).toBe(2)
  })

  it('keys by the video platform, aggregating across videos', () => {
    const counts = computeKeywordAttribution(
      [{ source_video_id: 'v1' }, { source_video_id: 'v2' }],
      [vid('v1', 'tiktok', ['ossur']), vid('v2', 'youtube', ['ossur'])],
    )
    expect(counts.get('tiktok::ossur')).toBe(1)
    expect(counts.get('youtube::ossur')).toBe(1)
  })

  it('skips insights with no source video or an unknown one', () => {
    const counts = computeKeywordAttribution(
      [{ source_video_id: null }, { source_video_id: 'missing' }, { source_video_id: 'v1' }],
      [vid('v1', 'tiktok', ['ossur'])],
    )
    expect(counts.get('tiktok::ossur')).toBe(1)
    expect(counts.size).toBe(1)
  })

  it('handles null keyword arrays and credits a duplicated keyword once per insight', () => {
    const counts = computeKeywordAttribution(
      [{ source_video_id: 'v0' }, { source_video_id: 'v1' }],
      [vid('v0', 'tiktok', null), vid('v1', 'tiktok', ['ossur', 'ossur'])],
    )
    expect(counts.get('tiktok::ossur')).toBe(1)
    expect(counts.size).toBe(1)
  })

  it('returns an empty map for empty inputs', () => {
    expect(computeKeywordAttribution([], []).size).toBe(0)
  })
})
