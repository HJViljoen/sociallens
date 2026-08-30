'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { LoaderCircle } from 'lucide-react'
import { deleteSchedule, saveSchedule } from '@/app/dashboard/studio/actions'
import { CADENCES, type ScheduleRow } from '@/lib/schedules/types'
import { splitRecipients } from '@/lib/schedules/validate'
import { SCHEDULE_RECIPIENTS_MAX } from '@/lib/config'

// One schedule's form (Stage 3): what to send, when, to whom, with the PDF
// and a share link. Saves through a server action (owner/admin); "Send me a
// test" and "Send now" go through the send route, which is the same path
// the update takes on Sunday. No browser dialogs — a destructive click asks
// again inline.

export interface TemplateChoice { value: string; label: string; group: 'Starters' | 'Your templates' }

interface Props {
  schedule: ScheduleRow | null
  templates: TemplateChoice[]
  /** Preselected template for a new schedule ("Send on a schedule" from a template). */
  initialSource?: string | null
  canManage: boolean
  userEmail: string | null
  /** Whether the workspace has a completed update to send. */
  sendable: boolean
}

const inputCls = 'h-8 w-full rounded-[4px] border border-input bg-tile px-2.5 text-[13px] outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-60'
const labelCls = 'text-[10.5px] font-semibold uppercase tracking-[0.07em] text-muted-foreground'
const btn = 'inline-flex h-8 items-center rounded-full px-3 text-[12px] font-medium disabled:opacity-50'
const btnPrimary = `${btn} bg-primary text-primary-foreground hover:bg-accent-foreground`
const btnQuiet = `${btn} bg-tile text-secondary-foreground ring-1 ring-border hover:bg-inner`

export function ScheduleForm({ schedule, templates, initialSource, canManage, userEmail, sendable }: Props) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [name, setName] = useState(schedule?.name ?? '')
  const [source, setSource] = useState(schedule ? (schedule.starter_key ? `starter:${schedule.starter_key}` : `report:${schedule.report_id}`) : (initialSource ?? templates[0]?.value ?? ''))
  const [cadence, setCadence] = useState<ScheduleRow['cadence']>(schedule?.cadence ?? 'every_update')
  const [recipients, setRecipients] = useState(schedule?.recipients.join(', ') ?? '')
  const [attachPdf, setAttachPdf] = useState(schedule?.attach_pdf ?? true)
  const [shareDays, setShareDays] = useState(schedule ? (schedule.share_days == null ? 'never' : String(schedule.share_days)) : '30')
  const [active, setActive] = useState(schedule?.active ?? true)
  const [status, setStatus] = useState<{ ok: boolean; message: string } | null>(null)
  const [confirm, setConfirm] = useState<'send' | 'delete' | null>(null)
  const [preview, setPreview] = useState(false)
  const [busy, setBusy] = useState<'test' | 'now' | null>(null)

  const parsedRecipients = splitRecipients(recipients)
  const tooMany = parsedRecipients.length > SCHEDULE_RECIPIENTS_MAX
  const readOnly = !canManage

  const save = () => start(async () => {
    const [kind, key] = source.split(':')
    const r = await saveSchedule({
      id: schedule?.id ?? null,
      input: {
        name,
        starterKey: kind === 'starter' ? key : null,
        reportId: kind === 'report' ? key : null,
        cadence,
        recipients: parsedRecipients,
        attachPdf,
        shareDays: shareDays === 'never' ? null : (Number(shareDays) as 7 | 30 | 90),
        active,
      },
    })
    setStatus(r)
    if (r.ok && r.id && r.id !== schedule?.id) router.push(`/dashboard/studio?group=schedules&item=${r.id}`)
    else if (r.ok) router.refresh()
  })

  const send = async (mode: 'test' | 'now') => {
    if (!schedule) return
    setBusy(mode); setConfirm(null); setStatus(null)
    try {
      const r = await fetch(`/api/schedules/${schedule.id}/send`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode }) })
      const j = (await r.json().catch(() => ({}))) as { status?: string; error?: string; to?: string | string[]; subject?: string }
      if (!r.ok) setStatus({ ok: false, message: j.error ?? 'Could not send — try again.' })
      else if (j.status === 'sent') setStatus({ ok: true, message: mode === 'test' ? `Sent to ${j.to} — "${j.subject}".` : `Sent to ${Array.isArray(j.to) ? j.to.length : 0} people — "${j.subject}".` })
      else if (j.status === 'already_sent') setStatus({ ok: true, message: 'This update already went out to this list.' })
      else if (j.status === 'skipped') setStatus({ ok: false, message: j.error ?? 'Nothing was sent.' })
      else setStatus({ ok: false, message: j.error ?? 'Could not send.' })
      router.refresh()
    } catch {
      setStatus({ ok: false, message: 'Could not send — try again.' })
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 md:grid-cols-2">
        <label className="flex flex-col gap-1">
          <span className={labelCls}>Name</span>
          <input value={name} maxLength={80} disabled={readOnly} onChange={(e) => setName(e.target.value)} className={inputCls} placeholder="Weekly digest" />
        </label>
        <label className="flex flex-col gap-1">
          <span className={labelCls}>What to send</span>
          <select value={source} disabled={readOnly} onChange={(e) => setSource(e.target.value)} className={inputCls}>
            {(['Starters', 'Your templates'] as const).map((g) => {
              const items = templates.filter((t) => t.group === g)
              return items.length ? <optgroup key={g} label={g}>{items.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}</optgroup> : null
            })}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className={labelCls}>When</span>
          <select value={cadence} disabled={readOnly} onChange={(e) => setCadence(e.target.value as ScheduleRow['cadence'])} className={inputCls}>
            {CADENCES.map((c) => <option key={c.key} value={c.key}>{c.label} — {c.help}</option>)}
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
      <label className="flex flex-col gap-1">
        <span className={labelCls}>To</span>
        <textarea value={recipients} disabled={readOnly} rows={3} onChange={(e) => setRecipients(e.target.value)} className={`${inputCls} h-auto py-1.5 leading-relaxed`} placeholder="one@company.com, two@company.com" />
        <span className={`text-[11px] ${tooMany ? 'text-negative' : 'text-muted-foreground'}`}>
          {parsedRecipients.length} address{parsedRecipients.length === 1 ? '' : 'es'} · commas, spaces or new lines between them · at most {SCHEDULE_RECIPIENTS_MAX}
        </span>
      </label>
      <div className="flex flex-wrap items-center gap-5 text-[13px]">
        <label className="flex items-center gap-2"><input type="checkbox" checked={attachPdf} disabled={readOnly} onChange={(e) => setAttachPdf(e.target.checked)} className="size-3.5 accent-primary" /> Attach the PDF</label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={active} disabled={readOnly} onChange={(e) => setActive(e.target.checked)} className="size-3.5 accent-primary" /> Active</label>
      </div>

      {canManage && (
        <div className="flex flex-wrap items-center gap-2 border-t border-border/60 pt-4">
          <button type="button" onClick={save} disabled={pending || !name.trim() || tooMany || !source} className={btnPrimary}>
            {pending ? <><LoaderCircle className="mr-1.5 size-3 animate-spin" aria-hidden /> Saving…</> : schedule ? 'Save' : 'Create schedule'}
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
              {confirm === 'delete' ? (
                <form action={deleteSchedule} className="ml-auto inline-flex items-center gap-2 text-[12px]">
                  <input type="hidden" name="id" value={schedule.id} />
                  Delete this schedule?
                  <button type="submit" className={`${btn} bg-negative text-white hover:opacity-90`}>Yes, delete</button>
                  <button type="button" onClick={() => setConfirm(null)} className="text-muted-foreground hover:text-foreground">Cancel</button>
                </form>
              ) : (
                <button type="button" onClick={() => setConfirm('delete')} className="ml-auto text-[12px] text-muted-foreground hover:text-negative">Delete</button>
              )}
            </>
          )}
        </div>
      )}
      {!canManage && schedule && (
        <div className="flex flex-wrap items-center gap-2 border-t border-border/60 pt-4">
          <button type="button" onClick={() => setPreview((v) => !v)} className={btnQuiet}>{preview ? 'Hide the email' : 'Preview the email'}</button>
          <span className="text-[12px] text-muted-foreground">An owner or admin changes schedules.</span>
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
