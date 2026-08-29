import { describe, expect, it } from 'vitest'
import { citationLink } from './evidence-cite'

describe('citationLink', () => {
  it('deep-links a YouTube comment with &lc=', () => {
    expect(citationLink('youtube', 'https://www.youtube.com/watch?v=abc', 'Ugx123')).toEqual({ href: 'https://www.youtube.com/watch?v=abc&lc=Ugx123', commentLevel: true })
    expect(citationLink('youtube', 'https://youtu.be/abc', 'Ugx123')).toEqual({ href: 'https://youtu.be/abc?lc=Ugx123', commentLevel: true })
  })
  it('falls back to the post on TikTok / Instagram, and says so', () => {
    expect(citationLink('tiktok', 'https://www.tiktok.com/@a/video/1', '7001')).toEqual({ href: 'https://www.tiktok.com/@a/video/1', commentLevel: false })
    expect(citationLink('instagram', 'https://www.instagram.com/p/x/', '9')).toEqual({ href: 'https://www.instagram.com/p/x/', commentLevel: false })
  })
  it('has no link without a video URL', () => {
    expect(citationLink('youtube', null, 'Ugx')).toEqual({ href: null, commentLevel: false })
  })
})
