import type { SupabaseClient } from '@supabase/supabase-js'
import { SCHEDULE_CLAIM_STALE_MS } from '../config'
import { artifactFilename, logExport, storeArtifact } from '../artifacts'
import { sendReportEmail, type EmailAttachment } from '../email'
import { EMAIL_IMAGE_TILES, renderDigestEmail } from '../email/digest'
import { renderMany } from '../render/render'
import { BuildEmptyError, snapshotReport } from '../reports/build'
import { expiryFromDays, mintShareToken } from '../reports/share'
import { resolveScheduleReport } from './resolve'
import type { ScheduleRow } from './types'

/**
 * Firing one schedule for one update (Stage 3). No session anywhere: the
 * admin client loads, freezes, renders, links, sends and records — the same
 * spine a Studio build rides, plus the email.
 *
 *   1  claim report_sends (schedule_id, run_id) — BEFORE anything renders, so
 *      an Inngest retry after a lost response cannot send twice (T0-6)
 *   2  resolve the template → snapshotReport (loaders, figures, cover, delta)
 *   3  the PDF and the email's inline PNGs in ONE browser session → Storage
 *   4  a share link (open with the link, the schedule's expiry, no password)
 *   5  the email from the same snapshot data → Resend, PDF attached if asked
 *   6  record: the send row, last_sent_at, a Studio template's build state
 *
 * A failure after the snapshot exists but before an artifact is stored
 * deletes the snapshot (the Stage-1 orphan rule); a failure later keeps what
 * was made and marks the send failed, with the reason.
 */

export type RunMode = 'send' | 'test' | 'preview'

export interface RunScheduleArgs {
  admin: SupabaseClient
  schedule: ScheduleRow
  runId: string
  /** The app's origin — where the email's links land. */
  baseUrl: string
  /** Where the browser fetches /render; the same origin on Vercel. A local
   *  rehearsal renders here (the dev server) while links point at production. */
  renderBaseUrl?: string
  mode: RunMode
  /** 'test': the only addresses the email goes to; nothing is recorded. */
  to?: string[]
}

export interface RunScheduleResult {
  status: 'sent' | 'already_sent' | 'skipped' | 'failed' | 'preview'
  sendId?: string
  snapshotId?: string
  artifactId?: string
  shareUrl?: string
  subject?: string
  html?: string
  text?: string
  ms: number
  error?: string
}

type Claim = { status: 'claimed'; id: string } | { status: 'already_sent' | 'skipped'; id: string }

/** The row for (schedule, run): new → claimed; sent → already_sent; a young
 *  claim → skipped (someone else is on it); failed / skipped / stale → taken over. */
export async function claimSend(admin: SupabaseClient, schedule: Pick<ScheduleRow, 'id' | 'client_id' | 'recipients'>, runId: string, now = Date.now()): Promise<Claim> {
  const { data: existing } = await admin.from('report_sends').select('id, status, claimed_at').eq('schedule_id', schedule.id).eq('run_id', runId).maybeSingle()
  const row = existing as { id: string; status: string; claimed_at: string } | null
  if (row) {
    if (row.status === 'sent') return { status: 'already_sent', id: row.id }
    if (row.status === 'claimed' && now - new Date(row.claimed_at).getTime() < SCHEDULE_CLAIM_STALE_MS) return { status: 'skipped', id: row.id }
    const { error } = await admin.from('report_sends').update({ status: 'claimed', claimed_at: new Date(now).toISOString(), error: null, recipients: schedule.recipients }).eq('id', row.id)
    if (error) throw new Error(`send: reclaim failed: ${error.message}`)
    return { status: 'claimed', id: row.id }
  }
  const { data, error } = await admin
    .from('report_sends')
    .insert({ client_id: schedule.client_id, schedule_id: schedule.id, run_id: runId, status: 'claimed', recipients: schedule.recipients })
    .select('id')
    .maybeSingle()
  if (error || !data) {
    // The unique constraint fired: another worker claimed it between our read and our insert.
    if (error?.code === '23505') {
      const { data: theirs } = await admin.from('report_sends').select('id').eq('schedule_id', schedule.id).eq('run_id', runId).maybeSingle()
      return { status: 'skipped', id: (theirs as { id: string } | null)?.id ?? '' }
    }
    throw new Error(`send: claim failed: ${error?.message ?? 'no row'}`)
  }
  return { status: 'claimed', id: (data as { id: string }).id }
}

export async function runSchedule(a: RunScheduleArgs): Promise<RunScheduleResult> {
  const t0 = Date.now()
  const ms = () => Date.now() - t0
  const { admin, schedule, runId } = a
  const recording = a.mode === 'send'
  let sendId: string | undefined

  if (recording) {
    const claim = await claimSend(admin, schedule, runId)
    if (claim.status !== 'claimed') return { status: claim.status, sendId: claim.id, ms: ms() }
    sendId = claim.id
  }

  const mark = async (status: 'failed' | 'skipped', error: string) => {
    if (sendId) await admin.from('report_sends').update({ status, error: error.slice(0, 500) }).eq('id', sendId)
  }

  let snapshotId: string | undefined
  let artifactStored = false
  try {
    const resolved = await resolveScheduleReport(admin, schedule)
    if (!resolved) {
      await mark('failed', 'The template this schedule sends no longer exists.')
      return { status: 'failed', sendId, ms: ms(), error: 'The template this schedule sends no longer exists.' }
    }
    const to = a.mode === 'test' ? (a.to ?? []).filter(Boolean) : schedule.recipients
    if (a.mode !== 'preview' && !to.length) {
      await mark('skipped', 'no recipients')
      return { status: 'skipped', sendId, ms: ms(), error: 'no recipients' }
    }

    let snap
    try {
      snap = await snapshotReport({ admin, supabase: admin, clientId: schedule.client_id, userId: null, report: resolved.report, company: resolved.company })
    } catch (e) {
      if (e instanceof BuildEmptyError) {
        await mark('skipped', e.message)
        return { status: 'skipped', sendId, ms: ms(), error: e.message }
      }
      throw e
    }
    snapshotId = snap.snapshotId
    const cadenceWord = schedule.cadence === 'monthly' ? 'monthly' : 'weekly'

    if (a.mode === 'preview') {
      const email = renderDigestEmail({ data: snap.data, shareUrl: null, appUrl: a.baseUrl, attached: schedule.attach_pdf, cadenceWord })
      await admin.from('report_snapshots').delete().eq('id', snapshotId)
      return { status: 'preview', subject: email.subject, html: email.html, text: email.text, ms: ms() }
    }

    // 3. The PDF, then the PNGs the email carries inline, one browser session.
    const imageTiles = EMAIL_IMAGE_TILES.filter((k) => {
      const page = k.split('.')[0]
      return snap.data.sections.some((s) => s.section.page === page && (s.section.keys ? s.section.keys.includes(k) : true))
    })
    const rendered = await renderMany({
      baseUrl: a.renderBaseUrl ?? a.baseUrl,
      snapshotId,
      jobs: [{ format: 'pdf' }, ...imageTiles.map((k) => ({ format: 'png' as const, tileKey: k }))],
    })
    const artifact = await storeArtifact(admin, { clientId: schedule.client_id, snapshotId, format: 'pdf', tileKey: null, buffer: rendered[0].buffer, renderMs: rendered[0].ms })
    artifactStored = true
    await logExport(admin, { clientId: schedule.client_id, userId: null, snapshotId, artifactId: artifact.id, action: 'export', kind: 'report', format: 'pdf' })

    // 4. The link the email carries. Open with the link; the schedule's life; no password.
    const token = mintShareToken()
    const { data: link, error: linkError } = await admin
      .from('share_links')
      .insert({ client_id: schedule.client_id, snapshot_id: snapshotId, token, title: snap.title, expires_at: expiryFromDays(schedule.share_days), password_hash: null, created_by: null })
      .select('id')
      .single()
    if (linkError || !link) throw new Error(`send: share link failed: ${linkError?.message ?? 'no row'}`)
    const shareLinkId = (link as { id: string }).id
    const shareUrl = `${a.baseUrl}/r/${token}`

    // 5. The email, from the same data the paper was printed from.
    const images: Record<string, string> = {}
    const attachments: EmailAttachment[] = []
    imageTiles.forEach((k, i) => {
      const cid = `${k.replace(/\./g, '-')}@verbatim`
      images[k] = `cid:${cid}`
      attachments.push({ filename: `${k}.png`, content: rendered[i + 1].buffer, contentType: 'image/png', contentId: cid })
    })
    if (schedule.attach_pdf) attachments.push({ filename: artifactFilename(snap.title, artifact), content: rendered[0].buffer, contentType: 'application/pdf' })
    const email = renderDigestEmail({ data: snap.data, shareUrl, appUrl: a.baseUrl, attached: schedule.attach_pdf, images, cadenceWord })
    const { sent } = await sendReportEmail({ to, subject: email.subject, html: email.html, text: email.text, attachments })

    // 6. Record.
    const now = new Date().toISOString()
    if (recording && sendId) {
      await admin
        .from('report_sends')
        .update({
          status: sent ? 'sent' : 'failed',
          error: sent ? null : 'email not sent — provider not configured or the send failed',
          sent_at: sent ? now : null,
          subject: email.subject,
          recipients: to,
          snapshot_id: snapshotId,
          artifact_id: artifact.id,
          share_link_id: shareLinkId,
        })
        .eq('id', sendId)
      if (sent) await admin.from('report_schedules').update({ last_sent_at: now }).eq('id', schedule.id)
      if (schedule.report_id) await admin.from('reports').update({ status: 'built', latest_snapshot_id: snapshotId, updated_at: now }).eq('id', schedule.report_id)
    }
    return { status: sent ? 'sent' : 'failed', sendId, snapshotId, artifactId: artifact.id, shareUrl, subject: email.subject, ms: ms(), ...(sent ? {} : { error: 'email not sent — provider not configured or the send failed' }) }
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e)
    console.error(`[schedule ${schedule.id}] ${error}`)
    if (snapshotId && !artifactStored) await admin.from('report_snapshots').delete().eq('id', snapshotId)
    await mark('failed', error)
    return { status: 'failed', sendId, snapshotId: artifactStored ? snapshotId : undefined, ms: ms(), error }
  }
}
