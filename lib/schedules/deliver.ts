import type { SupabaseClient } from '@supabase/supabase-js'
import { artifactFilename, logExport, replaceArtifactFile, storeArtifact, type ArtifactRow } from '../artifacts'
import { sendReportEmail, sendReviewEmail, type EmailAttachment } from '../email'
import { EMAIL_IMAGE_TILES, renderDigestEmail } from '../email/digest'
import { documentSubject, renderDocumentEmail } from '../email/document-brief'
import { applyEdits, loadEdits } from '../reports/documents/edits'
import { memberEmails } from './members'
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

/**
 * The build stands, and a person is asked to look at it: the send row becomes
 * `ready` with the subject it will carry, and every member of the workspace
 * gets the review email with the Studio link. Nothing reaches the schedule's
 * recipients until someone presses Send.
 *
 * The row must already name its snapshot (both doors set it before calling).
 */
export async function readyForReview(
  admin: SupabaseClient,
  a: { sendId: string; baseUrl: string },
): Promise<{ status: 'ready' | 'failed'; subject?: string; error?: string; notified?: boolean }> {
  const { data: sendRow } = await admin.from('report_sends').select('*').eq('id', a.sendId).maybeSingle()
  const row = sendRow as SendRow | null
  if (!row?.snapshot_id) return { status: 'failed', error: 'This send did not build, so there is nothing to review.' }
  // Already waiting: a retried step (a lost response, a redeploy) must not
  // email the whole workspace a second time.
  if (row.status === 'ready' && row.ready_at) return { status: 'ready', subject: row.subject ?? undefined, notified: false }
  const snapRow = await loadSnapshot(admin, row.snapshot_id)
  if (!snapRow) return { status: 'failed', error: 'The built report is gone.' }

  const { data: scheduleRow } = row.schedule_id ? await admin.from('report_schedules').select('*').eq('id', row.schedule_id).maybeSingle() : { data: null }
  const schedule = scheduleRow as ScheduleRow | null

  const data = await hydrateSnapshot<ReportSnapshotData>(admin, snapRow)
  const subject = isDocumentData(data)
    ? documentSubject(applyEdits(data, await loadEdits(admin, snapRow.id)))
    : renderDigestEmail({ data, shareUrl: null, appUrl: a.baseUrl, attached: schedule?.attach_pdf ?? false, cadenceWord: schedule?.cadence === 'monthly' ? 'monthly' : 'weekly' }).subject

  await admin
    .from('report_sends')
    .update({ status: 'ready', ready_at: new Date().toISOString(), error: null, subject })
    .eq('id', a.sendId)

  const { data: client } = await admin.from('clients').select('company_name').eq('id', row.client_id).maybeSingle()
  const members = await memberEmails(admin, row.client_id)
  const reportId = schedule?.report_id ?? null
  // The report's own name, not the snapshot's: a snapshot title carries the
  // company, and the subject already leads with it.
  const { data: report } = reportId ? await admin.from('reports').select('title').eq('id', reportId).maybeSingle() : { data: null }
  const { sent } = await sendReviewEmail({
    to: members,
    companyName: (client?.company_name as string | undefined) ?? '',
    reportTitle: (report?.title as string | undefined) ?? snapRow.title,
    builtOn: new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }),
    studioUrl: `${a.baseUrl}/dashboard/studio${reportId ? `?item=${reportId}` : ''}`,
  })
  // The build stands either way; the copy must not claim an email that the
  // provider refused or that no provider was configured to send.
  if (!sent) console.warn(`[deliver ${a.sendId}] the review email was not sent (${members.length} member(s))`)
  return { status: 'ready', subject, notified: sent }
}

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

  // Nothing is delivered without a build behind it, whichever door this is:
  // a stale `claimed` row from a build that died has no snapshot, and must
  // never be promoted to a Send button by the failure path below.
  if (!row.snapshot_id) return { status: 'failed', ms: ms(), error: 'This send did not build, so there is nothing to deliver.' }

  // Take the row before rendering anything, so two Sends deliver once. Both
  // doors compare-and-set: the review door on `ready` (or on the claimed_at of
  // a stale claim), the automatic one on the claim the runner made — an
  // Inngest step retry that overlaps the first attempt must not send twice.
  // Which door this came through, not which status the row happened to hold:
  // a delivery that died mid-render leaves a `claimed` row a person can still
  // pick up (the Studio offers it once the claim goes cold), and a second
  // failure on it must leave it pickable rather than strand a paid build.
  // Both the door AND the state: `mode === 'review'` is a person pressing
  // Send, and a row that is already `ready` is a reviewed build waiting for
  // one. Either way a failure must leave it pickable. (Keying off the door
  // alone stranded a reviewed build whose schedule had its review flag turned
  // off between an Inngest retry: the auto door would then mark it failed,
  // and nothing surfaces a failed row. Found in review, 2026-09-02.)
  const byHand = a.mode === 'review' || row.status === 'ready'
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
    // A young claim on the review door belongs to whoever is on it. On the
    // automatic door the claim IS ours (the runner made it), so we take it by
    // its timestamp and a second attempt finds the timestamp moved.
    if (a.mode === 'review' && claimDecision(row as ExistingSend, Date.now()) === 'skipped') {
      return { status: 'skipped', ms: ms(), error: 'Someone else is sending it right now.' }
    }
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

  // A failure on a build that was waiting for a person puts it back to
  // `ready` — the build stands and Send can be pressed again. A failure on a
  // scheduled send that was never reviewed is a failed send, plainly.
  const failAs = async (error: string): Promise<DeliverResult> => {
    // `ready` means "built, waiting for a person", and ready_at is when that
    // became true. Promoting a row without it left the Studio calling a
    // non-review schedule "Ready for review" with no built date, and left
    // readyForReview's idempotence guard (which requires both) able to email
    // the whole workspace a second time.
    const patch = byHand
      ? { status: 'ready' as const, ready_at: row.ready_at ?? new Date().toISOString(), error: error.slice(0, 500) }
      : { status: 'failed' as const, error: error.slice(0, 500) }
    await admin.from('report_sends').update(patch).eq('id', sendId)
    return { status: 'failed', ms: ms(), error }
  }

  try {
    const to = schedule.recipients
    if (!to.length) return await failAs('no recipients')

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
      // A link a member revoked between the build and the Send is not a link:
      // mint a fresh one rather than email a dead one.
      const { data: link } = await admin.from('share_links').select('token, revoked_at, expires_at').eq('id', shareLinkId).maybeSingle()
      const l = link as { token: string; revoked_at: string | null; expires_at: string | null } | null
      const dead = !l || l.revoked_at != null || (l.expires_at != null && new Date(l.expires_at).getTime() <= Date.now())
      if (dead) shareLinkId = null
      else shareUrl = `${a.baseUrl}/r/${l!.token}`
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
    // Recorded before the email, not after it: a send that the provider
    // refuses is retried, and a retry must reuse this link and this file
    // rather than leave a public link behind on every attempt.
    await admin.from('report_sends').update({ artifact_id: artifact.id, share_link_id: shareLinkId }).eq('id', sendId)

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
