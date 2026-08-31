import type { SupabaseClient } from '@supabase/supabase-js'
import { artifactFilename, logExport, replaceArtifactFile, storeArtifact, type ArtifactRow } from '../artifacts'
import { sendReportEmail, type EmailAttachment } from '../email'
import { EMAIL_IMAGE_TILES, renderDigestEmail } from '../email/digest'
import { renderDocumentEmail } from '../email/document-brief'
import { loadEdits } from '../reports/documents/edits'
import { renderMany } from '../render/render'
import { expiryFromDays, mintShareToken } from '../reports/share'
import { isDocumentData } from '../reports/documents/types'
import type { ReportSnapshotData } from '../reports/types'
import { hydrateSnapshot, loadSnapshot } from '../snapshots'
import { claimDecision, pruneInlineImages, type ExistingSend } from './claim'
import type { ScheduleRow, SendRow } from './types'

/**
 * Delivering one send row (T9, 2026-08-31): the email, from a snapshot that
 * already exists. Two doors in:
 *
 *   'review' — a member pressed Send on a `ready` row. The claim is a CAS on
 *   status, so two people pressing at once deliver once; a failure puts the
 *   row back to `ready` with the reason, so Send can be tried again.
 *
 *   'auto' — the document build's deliver step, on the row the schedule
 *   runner claimed when it enqueued the build. A failure marks the send
 *   failed, as a failed scheduled send always has.
 *
 * The email re-renders from the stored snapshot — words resolve live, edits
 * apply on the way, and a stale PDF is re-rendered in place before it is
 * attached. Nothing about the email body is stored (the repo rule).
 */

export interface DeliverArgs {
  admin: SupabaseClient
  sendId: string
  baseUrl: string
  renderBaseUrl?: string
  mode: 'review' | 'auto'
  /** review: the member who pressed Send. */
  approvedBy?: string | null
}

export interface DeliverResult {
  status: 'sent' | 'already_sent' | 'skipped' | 'failed'
  subject?: string
  ms: number
  error?: string
}

const EMAIL_FAILED = 'email not sent, provider not configured or the send failed'

export async function deliverSend(a: DeliverArgs): Promise<DeliverResult> {
  const t0 = Date.now()
  const ms = () => Date.now() - t0
  const { admin, sendId } = a

  const { data: sendRow, error: sendErr } = await admin.from('report_sends').select('*').eq('id', sendId).maybeSingle()
  if (sendErr || !sendRow) return { status: 'failed', ms: ms(), error: 'That send no longer exists.' }
  const row = sendRow as SendRow

  if (row.status === 'sent') return { status: 'already_sent', ms: ms() }

  if (!row.schedule_id) return { status: 'failed', ms: ms(), error: 'The schedule this send belonged to was removed.' }
  const { data: scheduleRow } = await admin.from('report_schedules').select('*').eq('id', row.schedule_id).maybeSingle()
  if (!scheduleRow) return { status: 'failed', ms: ms(), error: 'The schedule this send belonged to was removed.' }
  const schedule = scheduleRow as ScheduleRow

  // Take the row before rendering anything, so two Sends deliver once.
  if (a.mode === 'review') {
    if (row.status === 'ready') {
      const { data: taken } = await admin
        .from('report_sends')
        .update({ status: 'claimed', claimed_at: new Date().toISOString(), error: null })
        .eq('id', sendId)
        .eq('status', 'ready')
        .select('id')
        .maybeSingle()
      if (!taken) return { status: 'skipped', ms: ms(), error: 'Someone else is sending it right now.' }
    } else if (row.status === 'claimed') {
      const decision = claimDecision(row as ExistingSend, Date.now())
      if (decision === 'skipped') return { status: 'skipped', ms: ms(), error: 'Someone else is sending it right now.' }
      const { data: taken } = await admin
        .from('report_sends')
        .update({ status: 'claimed', claimed_at: new Date().toISOString(), error: null })
        .eq('id', sendId)
        .eq('claimed_at', row.claimed_at)
        .select('id')
        .maybeSingle()
      if (!taken) return { status: 'skipped', ms: ms(), error: 'Someone else is sending it right now.' }
    } else {
      return { status: 'failed', ms: ms(), error: 'This send did not build, so there is nothing to deliver.' }
    }
  } else if (row.status !== 'claimed' && row.status !== 'ready') {
    return { status: 'failed', ms: ms(), error: 'This send did not build, so there is nothing to deliver.' }
  }

  // A failure on the review door puts the row back to ready — the build
  // stands, and Send can be pressed again. On the auto door it is a failed
  // scheduled send, plainly.
  const failAs = async (error: string): Promise<DeliverResult> => {
    if (a.mode === 'review') {
      await admin.from('report_sends').update({ status: 'ready', error: error.slice(0, 500) }).eq('id', sendId)
    } else {
      await admin.from('report_sends').update({ status: 'failed', error: error.slice(0, 500) }).eq('id', sendId)
    }
    return { status: 'failed', ms: ms(), error }
  }

  try {
    const to = schedule.recipients
    if (!to.length) return await failAs('no recipients')
    if (!row.snapshot_id) return await failAs('This send did not build, so there is nothing to deliver.')

    const snapRow = await loadSnapshot(admin, row.snapshot_id)
    if (!snapRow || snapRow.client_id !== schedule.client_id) return await failAs('The built report is gone.')
    const data = await hydrateSnapshot<ReportSnapshotData>(admin, snapRow)

    // A written report carries no inline tile pictures: its pages are the
    // report, and the email is the way in.
    const document = isDocumentData(data) ? data : null
    const cadenceWord = schedule.cadence === 'monthly' ? 'monthly' : 'weekly'
    const imageTiles = document ? [] : EMAIL_IMAGE_TILES.filter((k) => {
      const page = k.split('.')[0]
      return data.sections.some((s) => s.section.page === page && (s.section.keys ? s.section.keys.includes(k) : true))
    })
    const rendered = await renderMany({
      baseUrl: a.renderBaseUrl ?? a.baseUrl,
      snapshotId: snapRow.id,
      jobs: [{ format: 'pdf' }, ...imageTiles.map((k) => ({ format: 'png' as const, tileKey: k }))],
    })

    // The stored PDF: replace a stale file with what we just rendered (edits
    // and erasures both stale it); store one if the row never had one.
    let artifact: ArtifactRow | null = null
    if (row.artifact_id) {
      const { data: art } = await admin.from('artifacts').select('*').eq('id', row.artifact_id).maybeSingle()
      artifact = (art as ArtifactRow | null) ?? null
    }
    if (artifact?.stale) {
      artifact = await replaceArtifactFile(admin, artifact, { buffer: rendered[0].buffer, renderMs: rendered[0].ms })
      await logExport(admin, { clientId: schedule.client_id, userId: a.approvedBy ?? null, snapshotId: snapRow.id, artifactId: artifact.id, action: 'rerender', kind: 'report', format: 'pdf' })
    } else if (!artifact) {
      artifact = await storeArtifact(admin, { clientId: schedule.client_id, snapshotId: snapRow.id, format: 'pdf', tileKey: null, buffer: rendered[0].buffer, renderMs: rendered[0].ms })
      await logExport(admin, { clientId: schedule.client_id, userId: a.approvedBy ?? null, snapshotId: snapRow.id, artifactId: artifact.id, action: 'export', kind: 'report', format: 'pdf' })
    }
    const pdfFilename = artifactFilename(snapRow.title, artifact)

    // The link the email carries: the one minted at build time, or a fresh one.
    let shareUrl: string | null = null
    let shareLinkId = row.share_link_id
    if (shareLinkId) {
      const { data: link } = await admin.from('share_links').select('token').eq('id', shareLinkId).maybeSingle()
      if (link) shareUrl = `${a.baseUrl}/r/${(link as { token: string }).token}`
    }
    if (!shareUrl) {
      const token = mintShareToken()
      const { data: link, error: linkError } = await admin
        .from('share_links')
        .insert({ client_id: schedule.client_id, snapshot_id: snapRow.id, token, title: snapRow.title, expires_at: expiryFromDays(schedule.share_days), password_hash: null, created_by: null })
        .select('id')
        .single()
      if (linkError || !link) throw new Error(`send: share link failed: ${linkError?.message ?? 'no row'}`)
      shareLinkId = (link as { id: string }).id
      shareUrl = `${a.baseUrl}/r/${token}`
    }

    const images: Record<string, string> = {}
    const inline: EmailAttachment[] = []
    imageTiles.forEach((k, i) => {
      const cid = `${k.replace(/\./g, '-')}@verbatim`
      images[k] = `cid:${cid}`
      inline.push({ filename: `${k}.png`, content: rendered[i + 1].buffer, contentType: 'image/png', contentId: cid })
    })
    const email = document
      ? renderDocumentEmail({ data: document, edits: await loadEdits(admin, snapRow.id), shareUrl, appUrl: a.baseUrl, attached: schedule.attach_pdf })
      : renderDigestEmail({ data, shareUrl, appUrl: a.baseUrl, attached: schedule.attach_pdf, images, cadenceWord })
    const attachments = pruneInlineImages(email.html, inline)
    if (schedule.attach_pdf) attachments.push({ filename: pdfFilename, content: rendered[0].buffer, contentType: 'application/pdf' })
    const { sent } = await sendReportEmail({ to, subject: email.subject, html: email.html, text: email.text, attachments })
    if (!sent) return await failAs(EMAIL_FAILED)

    const now = new Date().toISOString()
    await admin
      .from('report_sends')
      .update({
        status: 'sent',
        error: null,
        sent_at: now,
        subject: email.subject,
        recipients: to,
        artifact_id: artifact.id,
        share_link_id: shareLinkId,
        approved_by: a.approvedBy ?? null,
      })
      .eq('id', sendId)
    await admin.from('report_schedules').update({ last_sent_at: now }).eq('id', schedule.id)
    return { status: 'sent', subject: email.subject, ms: ms() }
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e)
    console.error(`[deliver ${sendId}] ${error}`)
    return await failAs(error)
  }
}
