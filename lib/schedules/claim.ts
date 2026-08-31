import { SCHEDULE_CLAIM_STALE_MS } from '../config'
import type { EmailAttachment } from '../email'

/** The pure rules of the runner (lib/schedules/run.ts), kept apart from it
 *  so they can be tested without the render and email modules. */

export interface ExistingSend { id: string; status: string; claimed_at: string }
export type ClaimDecision = 'already_sent' | 'waiting' | 'skipped' | 'takeover'

/** What to do with the row that already exists for (schedule, run): sent →
 *  never again; ready → it is built and waiting for a person, which is not
 *  abandoned work (taking it over would throw away a reviewed brief, and its
 *  edits with it, and pay to write another); a claim younger than the stale
 *  window → someone is on it; failed / skipped / a stale claim → take over. */
export function claimDecision(row: ExistingSend, now = Date.now()): ClaimDecision {
  if (row.status === 'sent') return 'already_sent'
  if (row.status === 'ready') return 'waiting'
  if (row.status === 'claimed' && now - new Date(row.claimed_at).getTime() < SCHEDULE_CLAIM_STALE_MS) return 'skipped'
  return 'takeover'
}

/** Inline images the email did not reference (a tile that rendered its
 *  honest empty line has no picture to show) must not travel as stray
 *  attachments. */
export function pruneInlineImages(html: string, attachments: EmailAttachment[]): EmailAttachment[] {
  return attachments.filter((a) => !a.contentId || html.includes(`cid:${a.contentId}`))
}
