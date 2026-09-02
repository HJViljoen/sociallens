'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { updateDocumentSettings } from '@/app/dashboard/studio/actions'
import { SELLS_TO, type DocumentSettings } from '@/lib/reports/documents/types'
import { REPORT_TITLE_MAX } from '@/lib/reports/types'
import type { DocumentSettingsPatch } from '@/lib/reports/validate'

// A written report's settings (S8, 2026-08-31): the few choices it has.
// Blur-save through the server action, one at a time, in order; the built
// document stands, the next build reads these. Language is the fixed word
// while English is the only one.

const inputCls = 'h-8 w-full rounded-[4px] border border-input bg-tile px-2.5 text-[13px] outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50'
const labelCls = 'font-mono text-[10.5px] uppercase tracking-[0.08em] text-muted-foreground'

export function SettingsPane({ reportId, title, reader, settings, tracked, readerHint, competitorsUsed, findingsMax }: {
  reportId: string
  title: string
  reader: string
  settings: DocumentSettings
  tracked: string[]
  /** The placeholder in "Written for": this template's own reader. */
  readerHint: string
  /** False when the template neither prints a competitor page nor asks a
   *  question per competitor, so the picker would change nothing. */
  competitorsUsed: boolean
  /** The template's own ceiling: offering four on a brief that prints three
   *  is a control that does not do what it says. */
  findingsMax: 3 | 4
}) {
  const router = useRouter()
  const [status, setStatus] = useState('')
  const chain = useRef<Promise<unknown>>(Promise.resolve())
  const save = (patch: DocumentSettingsPatch) => {
    setStatus('Saving')
    chain.current = chain.current.then(async () => {
      const r = await updateDocumentSettings({ id: reportId, patch })
      setStatus(r.message)
      if (r.ok) router.refresh()
    })
  }
  // Held in state so two quick ticks both count (props lag the refresh).
  const [chosen, setChosen] = useState<Set<string>>(() => (settings.competitors === null ? new Set(tracked) : new Set(settings.competitors)))
  const toggle = (name: string, on: boolean) => {
    const next = new Set(chosen)
    if (on) next.add(name); else next.delete(name)
    setChosen(next)
    const all = tracked.every((t) => next.has(t))
    save({ competitors: all ? null : tracked.filter((t) => next.has(t)) })
  }
  return (
    <div className="flex flex-col gap-4 text-[13px]">
      <label className="flex flex-col gap-1">
        <span className={labelCls}>Title</span>
        <input defaultValue={title} className={inputCls} maxLength={REPORT_TITLE_MAX} onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== title) save({ title: v }) }} />
      </label>
      <label className="flex flex-col gap-1">
        <span className={labelCls}>Written for</span>
        <input defaultValue={reader} placeholder={readerHint} className={inputCls} maxLength={80} onBlur={(e) => { const v = e.target.value.trim(); if (v !== reader) save({ reader: v }) }} />
      </label>
      <label className="flex flex-col gap-1">
        <span className={labelCls}>Who you sell to</span>
        <select defaultValue={settings.sellsTo} className={inputCls} onChange={(e) => save({ sellsTo: e.target.value as DocumentSettings['sellsTo'] })}>
          {SELLS_TO.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
        </select>
        <span className="text-[11.5px] text-muted-foreground">{SELLS_TO.find((s) => s.key === settings.sellsTo)?.hint}</span>
      </label>
      {competitorsUsed && (
        <fieldset className="flex flex-col gap-1.5">
          <legend className={labelCls}>Competitors to include</legend>
          {tracked.length ? tracked.map((name) => (
            <label key={name} className="flex items-center gap-2">
              <input type="checkbox" checked={chosen.has(name)} onChange={(e) => toggle(name, e.target.checked)} className="size-3.5 accent-primary" />
              <span>{name}</span>
            </label>
          )) : <span className="text-[11.5px] text-muted-foreground">No competitors tracked yet. Add them under Settings.</span>}
        </fieldset>
      )}
      {findingsMax > 3 ? (
        <label className="flex flex-col gap-1">
          <span className={labelCls}>Findings</span>
          <select defaultValue={String(Math.min(settings.findings, findingsMax))} className={inputCls} onChange={(e) => save({ findings: e.target.value === '3' ? 3 : 4 })}>
            <option value="4">Up to four</option>
            <option value="3">Up to three</option>
          </select>
        </label>
      ) : (
        <div className="flex flex-col gap-1">
          <span className={labelCls}>Findings</span>
          <span>Up to three</span>
          <span className="text-[11.5px] text-muted-foreground">This brief is short by design.</span>
        </div>
      )}
      <div className="flex flex-col gap-1">
        <span className={labelCls}>Language</span>
        <span>English</span>
      </div>
      <p className="min-h-[1em] font-mono text-[10.5px] text-muted-foreground" aria-live="polite">{status}</p>
    </div>
  )
}
