import { SCHEDULE_CLAIM_STALE_MS } from '../config'

/**
 * What a send row says to the workspace (Stage 3 review). The row's `error`
 * is the runner's raw reason — a Supabase or Chromium message is pipeline
 * jargon in a client-facing surface — so the page shows one calibrated
 * sentence and the ops view keeps the raw text.
 */
export function sendFailureSentence(error: string | null | undefined): string {
  const e = (error ?? '').toLowerCase()
  if (e.includes('no recipients')) return 'Nobody was on the list, so nothing was sent.'
  if (e.includes('provider not configured') || e.includes('send failed')) return 'The email service did not accept it.'
  if (e.includes('nothing to build') || e.includes('first update')) return 'There was nothing to build yet.'
  if (e.includes('no longer exists')) return 'The template this schedule sends no longer exists.'
  return 'The build or the send failed on our side.'
}

/** A claim older than the stale window that never finished. */
export function sendDidNotFinish(status: string, claimedAt: string, now = Date.now()): boolean {
  return status === 'claimed' && now - new Date(claimedAt).getTime() > SCHEDULE_CLAIM_STALE_MS
}
