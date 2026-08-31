/**
 * Schedules (Reports & Exports Stage 3, 2026-08-30).
 *
 * A schedule names WHAT to send — a starter template by key, or one of the
 * workspace's own templates (a `reports` row) — WHEN (after every scheduled
 * update, or the first update of each month) and TO WHOM (its own list).
 * Firing one produces an ordinary report snapshot, a PDF artifact and a share
 * link, and a `report_sends` row that records ids and timestamps — never the
 * email body (words stay live in the snapshot, as everywhere on the spine).
 */

export type ScheduleCadence = 'every_update' | 'monthly'

export const CADENCES: { key: ScheduleCadence; label: string; help: string }[] = [
  { key: 'every_update', label: 'Every update', help: 'Goes out after each scheduled update.' },
  { key: 'monthly', label: 'Monthly', help: 'Goes out after the first update of each month.' },
]

export interface ScheduleRow {
  id: string
  client_id: string
  name: string
  /** A starter template (lib/reports/templates.ts) … */
  starter_key: string | null
  /** … or one of the workspace's own templates (reports.id). Exactly one is set. */
  report_id: string | null
  cadence: ScheduleCadence
  recipients: string[]
  attach_pdf: boolean
  /** 7 | 30 | 90 | null (never expires) */
  share_days: number | null
  active: boolean
  /** Review before sending: the build waits as a `ready` send until a member delivers it. */
  review: boolean
  /** The workspace's digest: the schedule an accepted invite joins. */
  is_default: boolean
  last_sent_at: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

export type SendStatus = 'claimed' | 'ready' | 'sent' | 'failed' | 'skipped'

export interface SendRow {
  id: string
  client_id: string
  /** Null once the schedule is deleted; schedule_name keeps the archive readable. */
  schedule_id: string | null
  schedule_name: string | null
  run_id: string | null
  snapshot_id: string | null
  artifact_id: string | null
  share_link_id: string | null
  subject: string | null
  recipients: string[]
  status: SendStatus
  error: string | null
  claimed_at: string
  sent_at: string | null
  /** Who pressed Send on a review send (any member may). */
  approved_by: string | null
  ready_at: string | null
}
