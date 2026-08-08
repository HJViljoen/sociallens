import { describe, it, expect } from 'vitest'
import { parseWebVtt, pickTrack, speechLen } from './transcript'
import { tiktok } from './platforms/tiktok'
import { instagram } from './platforms/instagram'
import type { SubtitleTrack } from './types'

// Transcript-capture invariants worth locking (Step 1, 2026-07-23):
//  - WebVTT parsing drops the scaffolding (WEBVTT header, cue numbers,
//    timestamps, inline tags, leading [Music]) and collapses the rolling-repeat
//    lines auto-captions emit, so the stored text reads like prose
//  - the adapters expose exactly the media/caption shape verified on real data:
//    TikTok = mp4 at video.url + WebVTT tracks in subtitleInformation (when the
//    video has them); Instagram = mp4 at videoUrl, never a caption track
//  - a caption track is preferred by language (English first)

describe('parseWebVtt', () => {
  it('strips scaffolding and collapses rolling repeats', () => {
    const vtt = [
      'WEBVTT',
      '',
      '1',
      '00:00:00.000 --> 00:00:02.000',
      'Hello and welcome',
      '',
      '2',
      '00:00:02.000 --> 00:00:04.000',
      'Hello and welcome', // rolling repeat of the same line
      '',
      '3',
      '00:00:04.000 --> 00:00:06.000',
      'to the <00:00:05.000>channel',
      '',
    ].join('\n')
    expect(parseWebVtt(vtt)).toBe('Hello and welcome to the channel')
  })

  it('drops leading sound cues and returns empty for a music-only track', () => {
    expect(parseWebVtt('WEBVTT\n\n1\n00:00:00.000 --> 00:00:03.000\n[Music]')).toBe('')
  })
})

describe('speechLen (the gate measure)', () => {
  it('counts letters, not music symbols or punctuation', () => {
    expect(speechLen('♪♪ ♪♪ ♪♪ ♪♪ ♪♪ ♪♪')).toBe(0) // the live smoke case
    expect(speechLen('[Music]')).toBe(5)
    expect(speechLen('Hello and welcome to the channel')).toBeGreaterThan(15)
    expect(speechLen('日本語のテキスト')).toBeGreaterThan(0) // non-Latin scripts still count
  })
})

describe('pickTrack', () => {
  const t = (lang: string): SubtitleTrack => ({ url: `u/${lang}`, lang, isAuto: true })
  it('prefers an English track, else the first', () => {
    expect(pickTrack([t('fr'), t('en-US')])?.lang).toBe('en-US')
    expect(pickTrack([t('fr'), t('de')])?.lang).toBe('fr')
    expect(pickTrack([])).toBeNull()
  })
})

describe('tiktok.extractMedia', () => {
  it('pulls the mp4 and the WebVTT caption tracks when present', () => {
    const media = tiktok.extractMedia!({
      video: { url: 'https://cdn/tt.mp4', duration: 30 },
      subtitleInformation: [
        { url: 'https://cdn/en.vtt', language_code: 'en', is_auto_generated: true, caption_format: 'webvtt' },
      ],
    })
    expect(media.mediaUrl).toBe('https://cdn/tt.mp4')
    expect(media.subtitleTracks).toEqual([{ url: 'https://cdn/en.vtt', lang: 'en', isAuto: true }])
  })

  it('returns null tracks when the video has no captions', () => {
    const media = tiktok.extractMedia!({ video: { url: 'https://cdn/tt.mp4' }, subtitleInformation: null })
    expect(media.mediaUrl).toBe('https://cdn/tt.mp4')
    expect(media.subtitleTracks).toBeNull()
  })
})

describe('instagram.extractMedia', () => {
  it('pulls the mp4 and never a caption track', () => {
    const media = instagram.extractMedia!({ videoUrl: 'https://cdn/ig.mp4', audioUrl: 'https://cdn/ig.m4a' })
    expect(media.mediaUrl).toBe('https://cdn/ig.mp4')
    expect(media.subtitleTracks).toBeNull()
  })
})
