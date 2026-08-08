import { toFile } from 'openai'
import { openai } from '../openai'
import { TRANSCRIBE_MODEL, MIN_TRANSCRIPT_CHARS, TRANSCRIBE_MAX_BYTES } from '../config'
import type { MediaRef, SubtitleTrack, TranscriptResult } from './types'

// Transcript resolution (Step 1 — capture only). One transcript per video,
// however sourced: a platform caption track when the actor returns one (free),
// else Whisper on the downloaded media. The analysis passes DO NOT read this yet.
//
// Every media/caption URL is a signed, expiring CDN link, so this runs during
// gather (right after the item is fetched) — never lazily later.

/**
 * Parse a WebVTT caption file to plain, de-duplicated text. Auto-captions roll
 * the same line forward across overlapping cues, so consecutive repeats are
 * collapsed. Timestamp lines, cue numbers, inline timing tags, and leading
 * bracketed sound cues ([Music]) are stripped.
 */
export function parseWebVtt(vtt: string): string {
  const out: string[] = []
  for (let line of vtt.split(/\r?\n/)) {
    line = line.trim()
    if (!line || line === 'WEBVTT' || line.includes('-->') || /^\d+$/.test(line)) continue
    line = line.replace(/<[^>]+>/g, '') // inline timing tags <00:00:01.000>
    line = line.replace(/^\[[^\]]+\]\s*/, '') // leading [Music] / [Applause]
    if (!line) continue
    if (out.length && out[out.length - 1] === line) continue // rolling repeat
    out.push(line)
  }
  return out.join(' ').replace(/\s+/g, ' ').trim()
}

/** Pick the best caption track: prefer an English track, else the first. */
export function pickTrack(tracks: SubtitleTrack[]): SubtitleTrack | null {
  if (!tracks.length) return null
  return tracks.find((t) => (t.lang ?? '').toLowerCase().startsWith('en')) ?? tracks[0]
}

/** Count LETTERS only — the speech-gate measure. Whisper renders a music-only
 *  clip as "♪♪ ♪♪" and captions can be "[Music]"; those have real length but no
 *  words, so gating on raw length lets them through. Letters don't lie. */
export function speechLen(text: string): number {
  return (text.match(/\p{L}/gu) ?? []).length
}

async function fetchCaption(url: string): Promise<string> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`caption fetch ${res.status}`)
  return res.text()
}

async function whisperMedia(url: string): Promise<string> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`media fetch ${res.status}`)
  const declared = Number(res.headers.get('content-length') ?? 0)
  if (declared && declared > TRANSCRIBE_MAX_BYTES) throw new Error(`media ${Math.round(declared / 1e6)}MB over cap`)
  const buf = Buffer.from(await res.arrayBuffer())
  if (buf.byteLength > TRANSCRIBE_MAX_BYTES) throw new Error(`media ${Math.round(buf.byteLength / 1e6)}MB over cap`)
  const file = await toFile(buf, 'audio.mp4')
  const out = await openai.audio.transcriptions.create({ file, model: TRANSCRIBE_MODEL, response_format: 'json' })
  return ((out as { text?: string }).text ?? '').trim()
}

/**
 * Resolve one transcript from a platform's media reference. Never throws — a
 * failure returns a status so one bad video can't sink the batch. Order: free
 * caption track first (TikTok when present), then Whisper on the media
 * (Instagram always; TikTok without a usable caption). Applies the speech-gate:
 * a near-empty result is `no_speech`, not `ok`.
 */
export async function resolveTranscript(media: MediaRef): Promise<TranscriptResult> {
  try {
    const track = media.subtitleTracks ? pickTrack(media.subtitleTracks) : null
    if (track?.url) {
      const text = parseWebVtt(await fetchCaption(track.url))
      if (speechLen(text) >= MIN_TRANSCRIPT_CHARS) {
        return { text, lang: track.lang, source: 'tiktok_caption', status: 'ok' }
      }
      // caption present but empty/music-only → fall through to Whisper if we have media
    }
    if (media.mediaUrl) {
      const text = await whisperMedia(media.mediaUrl)
      return speechLen(text) >= MIN_TRANSCRIPT_CHARS
        ? { text, lang: null, source: 'whisper', status: 'ok' }
        : { text, lang: null, source: 'whisper', status: 'no_speech' }
    }
    return { text: '', lang: null, source: null, status: 'no_media' }
  } catch (e) {
    console.warn(`[transcript] ${(e as Error).message}`)
    return { text: '', lang: null, source: null, status: 'failed' }
  }
}
