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
  // A written report is built by the agent, so its reasons are its own.
  if (e.includes('already running')) return 'A build was already running for this report; the next update sends.'
  if (e.includes('nothing built to send')) return 'Nothing was built to send yet.'
  if (e.includes('searchable index')) return 'This workspace has nothing to write from yet.'
  if (e.includes('gave up') || e.includes('given up') || e.includes('took too long')) return 'Writing it took too long and was given up on.'
  if (e.includes('build failed') || e.includes('nothing to send')) return 'The report could not be written this time.'
  return 'The build or the send failed on our side.'
}

/** A claim older than the stale window that never finished. */
export function sendDidNotFinish(status: string, claimedAt: string, now = Date.now()): boolean {
  return status === 'claimed' && now - new Date(claimedAt).getTime() > SCHEDULE_CLAIM_STALE_MS
}
