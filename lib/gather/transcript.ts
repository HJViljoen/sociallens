import { toFile } from 'openai'
import { openai } from '../openai'
import {
  TRANSCRIBE_MODEL,
  MIN_TRANSCRIPT_CHARS,
  TRANSCRIBE_MAX_BYTES,
  CONTENT_GATE_MODEL,
} from '../config'
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

// Whisper's verbose_json reports a language NAME ('english'), while a platform
// caption track reports an ISO code ('en') — same column, two vocabularies, so
// anything keyed on language would silently miss half the rows. Normalise to
// ISO-639-1. Unknown languages fall through as-is rather than being dropped.
const LANG_CODES: Record<string, string> = {
  english: 'en', spanish: 'es', portuguese: 'pt', french: 'fr', german: 'de',
  italian: 'it', dutch: 'nl', afrikaans: 'af', arabic: 'ar', hindi: 'hi',
  telugu: 'te', tamil: 'ta', urdu: 'ur', indonesian: 'id', malay: 'ms',
  chinese: 'zh', japanese: 'ja', korean: 'ko', russian: 'ru', turkish: 'tr',
  thai: 'th', vietnamese: 'vi', polish: 'pl', swedish: 'sv', danish: 'da',
  norwegian: 'no', filipino: 'tl', tagalog: 'tl',
}

export function normaliseLang(lang: string | null | undefined): string | null {
  if (!lang) return null
  const l = lang.trim().toLowerCase()
  if (!l) return null
  return LANG_CODES[l] ?? l
}

/** Count LETTERS only — the speech-gate measure. Whisper renders a music-only
 *  clip as "♪♪ ♪♪" and captions can be "[Music]"; those have real length but no
 *  words, so gating on raw length lets them through. Letters don't lie. */
export function speechLen(text: string): number {
  return (text.match(/\p{L}/gu) ?? []).length
}

/**
 * Truncate by CODE POINT, not UTF-16 unit. A plain `.slice()` can cut an emoji
 * in half and leave a lone surrogate, which is unencodable — the OpenAI request
 * body then 400s with "failed to parse JSON value". Social text is full of
 * emoji, so this is the common case, not an edge one.
 */
export function clipText(s: string, max: number): string {
  const collapsed = s.replace(/\s+/g, ' ').trim()
  const points = [...collapsed]
  return points.length <= max ? collapsed : points.slice(0, max).join('')
}

// The failure modes below are the ones actually observed on the 2026-08-08
// Sealand backfill, not hypotheticals — a bare three-way definition missed half
// of them, so each junk class carries a real example.
const CONTENT_GATE_PROMPT = [
  'You are auditing an auto-generated transcript of a short social video.',
  'Decide whether it contains SUBSTANTIVE SPOKEN CONTENT about the video subject.',
  'Reply ONLY with JSON: {"verdict":"speech"}',
  '',
  '- speech:  a person genuinely talking — narrating, explaining, reviewing,',
  '           demonstrating, telling a story, or selling something. Any language.',
  '- lyrics:  song lyrics. The audio is music with vocals and nobody is talking.',
  '           e.g. "And I\'m feelin\' good" / "Have a holly jolly Christmas".',
  '- garbled: no usable content. This covers ALL of:',
  '           · transcription noise — "50ression 3t 2.1t 0.9t period 2.6t"',
  '           · watermarks — "Transcribed by https://otter.ai"',
  '           · bare filler with no subject — "Thanks for watching!", "Let\'s go!"',
  '           · one short line repeated over and over (a looping caption artefact)',
  '           · disconnected word salad that never states a subject',
  '',
  'Judge CONTENT, not length: a short line that actually says something about a',
  'product or a subject is speech; a long string of noise or repetition is garbled.',
  'When speech and background music are mixed but a person is genuinely talking,',
  'answer "speech".',
].join('\n')

export type TranscriptContent = 'speech' | 'lyrics' | 'garbled'

/**
 * The content gate. The letter-count gate can only see whether SOMETHING was
 * said; it can't tell a product review from a pop chorus, and Whisper transcribes
 * background music as happily as narration. Measured on the 2026-08-08 backfill:
 * a third of transcripts that passed the letter gate had no usable speech.
 *
 * Fails OPEN (returns 'speech'): a transient classifier error should not throw
 * away a good transcript, and Pass A's own prompt is the second line of defence.
 */
export async function classifyTranscript(text: string): Promise<{ verdict: TranscriptContent; tokens: { prompt: number; completion: number } }> {
  try {
    const completion = await openai.chat.completions.create({
      model: CONTENT_GATE_MODEL,
      temperature: 0,
      messages: [
        { role: 'system', content: CONTENT_GATE_PROMPT },
        { role: 'user', content: clipText(text, 500) },
      ],
      response_format: { type: 'json_object' },
    })
    const raw = JSON.parse(completion.choices[0]?.message?.content ?? '{}') as { verdict?: string }
    const v = (raw.verdict ?? '').toLowerCase()
    const tokens = { prompt: completion.usage?.prompt_tokens ?? 0, completion: completion.usage?.completion_tokens ?? 0 }
    return { verdict: v === 'lyrics' || v === 'garbled' ? v : 'speech', tokens }
  } catch (e) {
    console.warn(`[transcript] content gate failed, keeping transcript: ${(e as Error).message}`)
    return { verdict: 'speech', tokens: { prompt: 0, completion: 0 } }
  }
}

async function fetchCaption(url: string): Promise<string> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`caption fetch ${res.status}`)
  return res.text()
}

async function whisperMedia(url: string): Promise<{ text: string; lang: string | null; minutes: number }> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`media fetch ${res.status}`)
  const declared = Number(res.headers.get('content-length') ?? 0)
  if (declared && declared > TRANSCRIBE_MAX_BYTES) throw new Error(`media ${Math.round(declared / 1e6)}MB over cap`)
  const buf = Buffer.from(await res.arrayBuffer())
  if (buf.byteLength > TRANSCRIBE_MAX_BYTES) throw new Error(`media ${Math.round(buf.byteLength / 1e6)}MB over cap`)
  const file = await toFile(buf, 'audio.mp4')
  // verbose_json, not json: it's the only response format that returns the
  // DETECTED language, and whether a transcript needs translating can't be
  // decided without knowing what language it's in.
  const out = await openai.audio.transcriptions.create({
    file,
    model: TRANSCRIBE_MODEL,
    response_format: 'verbose_json',
  })
  const o = out as { text?: string; language?: string; duration?: number }
  // verbose_json also returns the audio duration — the unit Whisper bills by.
  return { text: (o.text ?? '').trim(), lang: normaliseLang(o.language), minutes: (o.duration ?? 0) / 60 }
}

/** Apply both gates to a resolved text: the cheap letter count first (silent or
 *  music-only never reaches the classifier), then the content gate. Carries the
 *  cost facts (Whisper minutes, gate tokens) so the caller can log spend.
 *  Exported (Wave 4) so a platform whose text arrives already fetched — YouTube
 *  captions via `fetchTranscripts` — is judged by exactly the same gate as a
 *  Whisper result: an auto-caption of a music video is lyrics either way. */
export async function gateTranscript(
  text: string,
  lang: string | null,
  source: TranscriptResult['source'],
  whisperMinutes?: number,
): Promise<TranscriptResult> {
  if (speechLen(text) < MIN_TRANSCRIPT_CHARS) return { text, lang, source, status: 'no_speech', whisperMinutes }
  const { verdict, tokens } = await classifyTranscript(text)
  return { text, lang, source, status: verdict === 'speech' ? 'ok' : verdict, whisperMinutes, gateTokens: tokens }
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
      // The caption URL is signed and can 403 on its own. That must not sink the
      // video — the express lane failing just means we take the slow one, so this
      // attempt gets its own catch rather than falling into the outer one.
      // (Backfill 2026-08-08: one TikTok died this way with a live mp4 in hand.)
      try {
        const text = parseWebVtt(await fetchCaption(track.url))
        if (speechLen(text) >= MIN_TRANSCRIPT_CHARS) {
          // A caption track transcribes the SAME audio Whisper would, so a
          // lyrics/garbled verdict here wouldn't change on a second pass — settle it.
          return await gateTranscript(text, normaliseLang(track.lang), 'tiktok_caption')
        }
        // caption present but empty/music-only → fall through to Whisper if we have media
      } catch (e) {
        console.warn(`[transcript] caption failed, falling back to whisper: ${(e as Error).message}`)
      }
    }
    if (media.mediaUrl) {
      const { text, lang, minutes } = await whisperMedia(media.mediaUrl)
      return await gateTranscript(text, lang, 'whisper', minutes)
    }
    return { text: '', lang: null, source: null, status: 'no_media' }
  } catch (e) {
    console.warn(`[transcript] ${(e as Error).message}`)
    return { text: '', lang: null, source: null, status: 'failed' }
  }
}
