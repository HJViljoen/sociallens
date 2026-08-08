import { clipText } from '../gather/transcript'
import { TRANSCRIPT_PROMPT_CHARS } from '../config'
import type { VideoRow } from './types'

// The single door transcript text enters analysis through: only content-gated
// speech (transcript_status 'ok') is ever readable — no_speech / lyrics /
// garbled / no_media / failed / not-attempted all read as "no transcript"
// (the 2026-08-08 backfill measured 33% of letter-gate survivors as lyrics or
// noise; feeding those to Pass A is worse than no transcript). Clipped
// code-point-safe to the prompt budget; validation checks quotes against the
// same clipped text the model saw.
export function usableTranscript(v: Pick<VideoRow, 'transcript' | 'transcript_status'>): string | null {
  if (v.transcript_status !== 'ok' || !v.transcript) return null
  return clipText(v.transcript, TRANSCRIPT_PROMPT_CHARS) || null
}
