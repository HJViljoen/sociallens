'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { LoaderCircle } from 'lucide-react'
import { deleteSchedule, saveSchedule } from '@/app/dashboard/studio/actions'
import { CADENCES, type ScheduleRow } from '@/lib/schedules/types'
import { splitRecipients } from '@/lib/schedules/validate'
import { SCHEDULE_RECIPIENTS_MAX } from '@/lib/config'

// A report's sending (Stage 3, reshaped 2026-08-30): who gets it, after which
// updates, with the PDF and a share link. One schedule per report; saved
// through a server action (owner/admin). "Send me a test" and "Send now" go
// through the send route, the same path the update takes on Sunday. No
// browser dialogs: a destructive click asks again inline.

interface Props {
  reportId: string
  reportTitle: string
  /** The report's schedule, or null when it is not sent to anyone yet. */
  schedule: ScheduleRow | null
  canManage: boolean
  userEmail: string | null
  /** Whether the workspace has a completed update to send. */
  sendable: boolean
  /** A build waiting for a person: any member may read it and send it. */
  /** A build waiting for a person. `stalled` = a delivery that died partway
   *  and whose claim has gone cold; the same Send press picks it up. */
  ready?: { id: string; subject: string | null; readyAt: string | null; error: string | null; stalled?: boolean } | null
  /** A written report is edited block by block before it goes; an arranged one is not. */
  isDocument?: boolean
}

const inputCls = 'h-8 w-full rounded-[4px] border border-input bg-tile px-2.5 text-[13px] outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-60'
const labelCls = 'text-[10.5px] font-semibold uppercase tracking-[0.07em] text-muted-foreground'
const btn = 'inline-flex h-8 items-center rounded-full px-3 text-[12px] font-medium disabled:opacity-50'
const btnPrimary = `${btn} bg-primary text-primary-foreground hover:bg-accent-foreground`
const btnQuiet = `${btn} bg-tile text-secondary-foreground ring-1 ring-border hover:bg-inner`

export function ScheduleForm({ reportId, reportTitle, schedule, canManage, userEmail, sendable, ready, isDocument }: Props) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [cadence, setCadence] = useState<ScheduleRow['cadence']>(schedule?.cadence ?? 'every_update')
  const [recipients, setRecipients] = useState(schedule?.recipients.join(', ') ?? '')
  const [attachPdf, setAttachPdf] = useState(schedule?.attach_pdf ?? true)
  const [shareDays, setShareDays] = useState(schedule ? (schedule.share_days == null ? 'never' : String(schedule.share_days)) : '30')
  const [active, setActive] = useState(schedule?.active ?? true)
  const [review, setReview] = useState(schedule?.review ?? false)
  const [status, setStatus] = useState<{ ok: boolean; message: string } | null>(null)
  const [confirm, setConfirm] = useState<'send' | 'delete' | 'deliver' | null>(null)
  const [preview, setPreview] = useState(false)
  const [busy, setBusy] = useState<'test' | 'now' | 'deliver' | null>(null)

  const parsedRecipients = splitRecipients(recipients)
  const tooMany = parsedRecipients.length > SCHEDULE_RECIPIENTS_MAX
  const readOnly = !canManage

  const save = () => start(async () => {
    const r = await saveSchedule({
      id: schedule?.id ?? null,
      input: {
        name: reportTitle,
        starterKey: null,
        reportId,
        cadence,
        recipients: parsedRecipients,
        attachPdf,
        shareDays: shareDays === 'never' ? null : (Number(shareDays) as 7 | 30 | 90),
        active,
        review,
      },
    })
    setStatus(r)
    if (r.ok) router.refresh()
  })

  const send = async (mode: 'test' | 'now' | 'deliver') => {
    if (!schedule) return
    setBusy(mode); setConfirm(null); setStatus(null)
    try {
      const body = mode === 'deliver' ? { mode, sendId: ready?.id } : { mode }
      const r = await fetch(`/api/schedules/${schedule.id}/send`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
      const j = (await r.json().catch(() => ({}))) as { status?: string; error?: string; to?: string | string[]; subject?: string; notified?: boolean }
      if (!r.ok) setStatus({ ok: false, message: j.error ?? 'Could not send. Try again.' })
      else if (j.status === 'sent') setStatus({ ok: true, message: mode === 'test' ? `Sent to ${j.to}: "${j.subject}".` : `Sent to ${Array.isArray(j.to) ? j.to.length : 0} people: "${j.subject}".` })
      else if (j.status === 'enqueued') setStatus({ ok: true, message: 'Writing it now. It goes out when it is done, or comes back here for review.' })
      else if (j.status === 'ready') setStatus({ ok: true, message: `Built and waiting for review${j.notified ? '; everyone in this workspace was emailed' : ''}. Use Send it above when you have read it.` })
      else if (j.status === 'already_sent') setStatus({ ok: true, message: 'This update already went out to this list.' })
      else if (j.status === 'skipped') setStatus({ ok: false, message: j.error ?? 'Nothing was sent.' })
      else setStatus({ ok: false, message: j.error ?? 'Could not send.' })
      router.refresh()
    } catch {
      setStatus({ ok: false, message: 'Could not send. Try again.' })
    } finally {
      setBusy(null)
    }
  }

  const readyOn = ready?.readyAt ? new Date(ready.readyAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'long' }) : null

  return (
    <div className="flex flex-col gap-4">
      {ready && schedule && (
        <div className="flex flex-col gap-2 rounded-[6px] bg-inner px-4 py-3">
          <p className="text-[13px] font-medium text-foreground">
            {ready.stalled ? 'Stopped partway through sending' : `Ready for review${readyOn ? ` · built ${readyOn}` : ''}`}
          </p>
          <p className="text-[12px] leading-[1.45] text-muted-foreground">
            {ready.stalled
              ? `The report is built, and nothing was recorded as sent. It stopped partway, so it is possible some of the ${schedule.recipients.length} ${schedule.recipients.length === 1 ? 'person' : 'people'} already have it; sending it again goes to all of them. Anyone here can send it.`
              : `${isDocument ? 'Read it, change anything that needs changing, then send it' : 'Read it, then send it'} to ${schedule.recipients.length} ${schedule.recipients.length === 1 ? 'person' : 'people'}. Anyone here can send it.`}
          </p>
          {ready.error && <p className="text-[12px] text-negative">The last attempt did not go: {ready.error}</p>}
          <div className="mt-1 flex flex-wrap items-center gap-2">
            {confirm === 'deliver' ? (
              <span className="inline-flex items-center gap-2 text-[12px]">
                Send it to {schedule.recipients.length} {schedule.recipients.length === 1 ? 'person' : 'people'} now?
                <button type="button" onClick={() => send('deliver')} className={btnPrimary}>Yes, send</button>
                <button type="button" onClick={() => setConfirm(null)} className="text-muted-foreground hover:text-foreground">Cancel</button>
              </span>
            ) : (
              <button type="button" onClick={() => setConfirm('deliver')} disabled={busy != null || schedule.recipients.length === 0} className={btnPrimary}>
                {busy === 'deliver' ? <><LoaderCircle className="mr-1.5 size-3 animate-spin" aria-hidden /> Sending…</> : 'Send it'}
              </button>
            )}
            {isDocument
              ? <Link href={`/dashboard/studio/edit/${reportId}`} className={btnQuiet}>Read and edit it</Link>
              : <button type="button" onClick={() => setPreview((v) => !v)} className={btnQuiet}>{preview ? 'Hide the email' : 'Read the email'}</button>}
          </div>
        </div>
      )}
      <label className="flex flex-col gap-1">
        <span className={labelCls}>To</span>
        <textarea value={recipients} disabled={readOnly} rows={2} onChange={(e) => setRecipients(e.target.value)} className={`${inputCls} h-auto py-1.5 leading-relaxed`} placeholder="one@company.com, two@company.com" />
        <span className={`text-[11px] ${tooMany ? 'text-negative' : 'text-muted-foreground'}`}>
          {parsedRecipients.length} address{parsedRecipients.length === 1 ? '' : 'es'} · commas, spaces or new lines between them · at most {SCHEDULE_RECIPIENTS_MAX}
        </span>
      </label>
      <div className="grid gap-4 md:grid-cols-2">
        <label className="flex flex-col gap-1">
          <span className={labelCls}>When</span>
          <select value={cadence} disabled={readOnly} onChange={(e) => setCadence(e.target.value as ScheduleRow['cadence'])} className={inputCls}>
            {CADENCES.map((c) => <option key={c.key} value={c.key}>{c.label}: {c.help}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className={labelCls}>Share link in the email</span>
          <select value={shareDays} disabled={readOnly} onChange={(e) => setShareDays(e.target.value)} className={inputCls}>
            <option value="7">Opens for 7 days</option>
            <option value="30">Opens for 30 days</option>
            <option value="90">Opens for 90 days</option>
            <option value="never">Never expires</option>
          </select>
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-5 text-[13px]">
        <label className="flex items-center gap-2"><input type="checkbox" checked={attachPdf} disabled={readOnly} onChange={(e) => setAttachPdf(e.target.checked)} className="size-3.5 accent-primary" /> Attach the PDF</label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={active} disabled={readOnly} onChange={(e) => setActive(e.target.checked)} className="size-3.5 accent-primary" /> Sending is on</label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={review} disabled={readOnly} onChange={(e) => setReview(e.target.checked)} className="size-3.5 accent-primary" /> Review before sending</label>
      </div>
      {review && <p className="-mt-2 text-[11px] text-muted-foreground">Everyone in this workspace gets an email when it is ready; any of them can read, edit and send it. Nothing goes to the list above until then.</p>}

      {canManage && (
        <div className="flex flex-wrap items-center gap-2 border-t border-border/60 pt-4">
          <button type="button" onClick={save} disabled={pending || tooMany} className={btnPrimary}>
            {pending ? <><LoaderCircle className="mr-1.5 size-3 animate-spin" aria-hidden /> Saving…</> : schedule ? 'Save' : 'Start sending'}
          </button>
          {schedule && (
            <>
              <button type="button" onClick={() => send('test')} disabled={busy != null || !sendable || !userEmail} title={userEmail ? `Sends to ${userEmail} only` : undefined} className={btnQuiet}>
                {busy === 'test' ? <><LoaderCircle className="mr-1.5 size-3 animate-spin" aria-hidden /> Sending…</> : 'Send me a test'}
              </button>
              {confirm === 'send' ? (
                <span className="inline-flex items-center gap-2 text-[12px]">
                  Send the latest update to {schedule.recipients.length} {schedule.recipients.length === 1 ? 'person' : 'people'} now?
                  <button type="button" onClick={() => send('now')} className={btnPrimary}>Yes, send</button>
                  <button type="button" onClick={() => setConfirm(null)} className="text-muted-foreground hover:text-foreground">Cancel</button>
                </span>
              ) : (
                <button type="button" onClick={() => setConfirm('send')} disabled={busy != null || !sendable || schedule.recipients.length === 0} className={btnQuiet}>
                  {busy === 'now' ? <><LoaderCircle className="mr-1.5 size-3 animate-spin" aria-hidden /> Sending…</> : 'Send now'}
                </button>
              )}
              <button type="button" onClick={() => setPreview((v) => !v)} className={btnQuiet}>{preview ? 'Hide the email' : 'Preview the email'}</button>
              {schedule.is_default ? (
                <span className="ml-auto text-[11px] text-muted-foreground">The workspace digest can be switched off, not removed.</span>
              ) : confirm === 'delete' ? (
                <form action={deleteSchedule} className="ml-auto inline-flex items-center gap-2 text-[12px]">
                  <input type="hidden" name="id" value={schedule.id} />
                  Stop sending this report and forget its list?
                  <button type="submit" className={`${btn} bg-negative text-white hover:opacity-90`}>Yes</button>
                  <button type="button" onClick={() => setConfirm(null)} className="text-muted-foreground hover:text-foreground">Cancel</button>
                </form>
              ) : (
                <button type="button" onClick={() => setConfirm('delete')} className="ml-auto text-[12px] text-muted-foreground hover:text-negative">Remove the sending</button>
              )}
            </>
          )}
        </div>
      )}
      {!canManage && schedule && (
        <div className="flex flex-wrap items-center gap-2 border-t border-border/60 pt-4">
          <button type="button" onClick={() => setPreview((v) => !v)} className={btnQuiet}>{preview ? 'Hide the email' : 'Preview the email'}</button>
          <span className="text-[12px] text-muted-foreground">An owner or admin changes who gets this.</span>
        </div>
      )}
      {status && <p className={`font-mono text-[11px] ${status.ok ? 'text-positive' : 'text-negative'}`} aria-live="polite">{status.message}</p>}
      {!sendable && canManage && <p className="text-[11px] text-muted-foreground">Sending and previewing start with your first completed update.</p>}

      {preview && schedule && (
        <div className="flex flex-col gap-1">
          <span className={labelCls}>The email, at today’s data</span>
          <iframe src={`/api/schedules/${schedule.id}/preview`} sandbox="allow-popups allow-popups-to-escape-sandbox" title="Email preview" className="h-[720px] w-full rounded-[4px] bg-tile ring-1 ring-border" />
          <span className="text-[11px] text-muted-foreground">Builds the report at today’s data (a few seconds); the sparkline pictures are added when it is sent.</span>
        </div>
      )}
    </div>
  )
}
