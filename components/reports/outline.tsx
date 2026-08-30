'use client'

import { useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, LoaderCircle, X } from 'lucide-react'
import { updateReport, type ActionState } from '@/app/dashboard/studio/actions'
import { newSectionId } from '@/lib/reports/templates'
import { AUDIENCES, REPORT_FRAMING_MAX, type Audience, type ReportSection } from '@/lib/reports/types'
import type { CataloguePage } from '@/lib/reports/catalogue'
import { REPORT_MAX_SECTIONS } from '@/lib/config'

// The Studio's outline (spec §4): ordered sections, each a page with its
// selection, the tiles to include, whether to append every item, and one
// line of the operator's framing. Ordering is page-level (arrows, not
// drag); layouts are the pages' own. Every change saves through a server
// action and the preview re-renders from the saved definition.

interface Props {
  reportId: string
  title: string
  audience: Audience
  sections: ReportSection[]
  catalogue: CataloguePage[]
  skipped: { sectionId: string; reason: string }[]
  slideCount: number
  slidesWarn: number
}

const FULL_PAGES = new Set(['voice', 'market', 'competitive', 'content', 'profile'])

export function Outline(p: Props) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [title, setTitle] = useState(p.title)
  const [audience, setAudience] = useState<Audience>(p.audience)
  const [sections, setSections] = useState<ReportSection[]>(p.sections)
  const [open, setOpen] = useState<string | null>(p.sections[0]?.id ?? null)
  const [status, setStatus] = useState<ActionState | null>(null)
  const [addPage, setAddPage] = useState(p.catalogue[0]?.page ?? 'dashboard')
  const byPage = new Map(p.catalogue.map((c) => [c.page, c]))
  const skippedFor = new Map(p.skipped.map((s) => [s.sectionId, s.reason]))

  // Saves run one after another (a second click cannot overtake the first),
  // and the outline re-mounts on the server row's updated_at after each
  // refresh, so a section added from another tab is adopted, never overwritten.
  const chain = useRef<Promise<unknown>>(Promise.resolve())
  function save(patch: Parameters<typeof updateReport>[0]['patch']) {
    start(async () => {
      const run = chain.current.then(() => updateReport({ id: p.reportId, patch }))
      chain.current = run.catch(() => undefined)
      const r = await run
      setStatus(r)
      if (r.ok) router.refresh()
    })
  }
  function commit(next: ReportSection[]) {
    setSections(next)
    save({ sections: next })
  }
  const patchSection = (id: string, fn: (s: ReportSection) => ReportSection) => commit(sections.map((s) => (s.id === id ? fn(s) : s)))
  const move = (i: number, d: -1 | 1) => {
    const j = i + d
    if (j < 0 || j >= sections.length) return
    const next = [...sections]
    ;[next[i], next[j]] = [next[j], next[i]]
    commit(next)
  }
  const remove = (id: string) => commit(sections.filter((s) => s.id !== id))
  const add = () => {
    if (sections.length >= REPORT_MAX_SECTIONS) return
    const s: ReportSection = { id: newSectionId(), page: addPage as ReportSection['page'], params: {} }
    setOpen(s.id)
    commit([...sections, s])
  }

  return (
    <div className="flex flex-col gap-4 text-[13px]">
      <div className="flex flex-col gap-2">
        <label className="block">
          <span className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-muted-foreground">Title</span>
          <input value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} onBlur={() => title.trim() && title !== p.title && save({ title: title.trim() })}
            className="mt-1 h-8 w-full rounded-[4px] border border-input bg-tile px-2.5 text-[13px] font-medium outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50" />
        </label>
        <label className="block">
          <span className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-muted-foreground">Written for</span>
          <select value={audience} onChange={(e) => { const a = e.target.value as Audience; setAudience(a); save({ audience: a }) }}
            className="mt-1 h-8 w-full rounded-[4px] border border-input bg-tile px-2 text-[13px] outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50">
            {AUDIENCES.map((a) => <option key={a.key} value={a.key}>{a.label} — {a.reader}</option>)}
          </select>
          <span className="mt-1 block text-[11px] text-muted-foreground/80">The cover is written in this register when the report is built; the preview shows the plain cover.</span>
        </label>
      </div>

      <ol className="flex flex-col gap-1.5">
        {sections.map((s, i) => {
          const cat = byPage.get(s.page)
          const isOpen = open === s.id
          const selection = Object.entries(s.params).filter(([, v]) => v).map(([k, v]) => `${k} ${v}`).join(' · ')
          const reason = skippedFor.get(s.id)
          const allKeys = cat?.tiles.map((t) => t.key) ?? []
          const checked = (k: string) => !s.keys || s.keys.includes(k)
          return (
            <li key={s.id} className="rounded-[4px] bg-inner">
              <div className="flex items-center gap-1 px-2 py-1.5">
                <button type="button" onClick={() => setOpen(isOpen ? null : s.id)} aria-expanded={isOpen}
                  className="flex min-w-0 flex-1 items-center gap-1.5 text-left">
                  {isOpen ? <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" aria-hidden /> : <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />}
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{i + 1}. {cat?.title ?? s.page}</span>
                    <span className="block truncate font-mono text-[10.5px] text-muted-foreground">
                      {selection || 'page default'}{s.keys ? ` · ${s.keys.length} of ${allKeys.length || '?'} tiles` : ' · every tile'}{s.variant === 'full' ? ' · every item' : ''}
                    </span>
                  </span>
                </button>
                <button type="button" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Move up" className="grid size-6 place-items-center rounded-[4px] text-muted-foreground hover:bg-tile hover:text-foreground disabled:opacity-30"><ArrowUp className="size-3.5" aria-hidden /></button>
                <button type="button" onClick={() => move(i, 1)} disabled={i === sections.length - 1} aria-label="Move down" className="grid size-6 place-items-center rounded-[4px] text-muted-foreground hover:bg-tile hover:text-foreground disabled:opacity-30"><ArrowDown className="size-3.5" aria-hidden /></button>
                <button type="button" onClick={() => remove(s.id)} aria-label="Remove section" className="grid size-6 place-items-center rounded-[4px] text-muted-foreground hover:bg-tile hover:text-negative"><X className="size-3.5" aria-hidden /></button>
              </div>
              {reason && <p className="px-3 pb-2 text-[11.5px] text-warning">{reason}</p>}
              {isOpen && (
                <div className="flex flex-col gap-3 border-t border-border/60 px-3 py-2.5">
                  {allKeys.length > 0 && (
                    <fieldset className="flex flex-col gap-1">
                      <legend className="mb-1 font-mono text-[10.5px] uppercase tracking-[0.08em] text-muted-foreground">Tiles</legend>
                      {cat!.tiles.map((t) => (
                        <label key={t.key} className="flex items-center gap-2">
                          <input type="checkbox" checked={checked(t.key)} onChange={(e) => {
                            const next = new Set(s.keys ?? allKeys)
                            if (e.target.checked) next.add(t.key); else next.delete(t.key)
                            const keys = allKeys.filter((k) => next.has(k))
                            if (!keys.length) return // a section keeps at least one tile; remove the section instead
                            patchSection(s.id, (x) => (keys.length === allKeys.length ? { ...x, keys: undefined } : { ...x, keys }))
                          }} className="size-3.5 accent-primary" />
                          <span>{t.title}</span>
                        </label>
                      ))}
                    </fieldset>
                  )}
                  {FULL_PAGES.has(s.page) && (
                    <label className="flex items-center gap-2">
                      <input type="checkbox" checked={s.variant === 'full'} onChange={(e) => patchSection(s.id, (x) => ({ ...x, variant: e.target.checked ? 'full' : undefined }))} className="size-3.5 accent-primary" />
                      <span>Every item, one slide each</span>
                    </label>
                  )}
                  <label className="block">
                    <span className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-muted-foreground">Framing — one line, in your words</span>
                    <input defaultValue={s.framing ?? ''} maxLength={REPORT_FRAMING_MAX} placeholder="Why this section is here (optional)"
                      onBlur={(e) => { const v = e.target.value.trim(); if (v !== (s.framing ?? '')) patchSection(s.id, (x) => ({ ...x, framing: v || undefined })) }}
                      className="mt-1 h-8 w-full rounded-[4px] border border-input bg-tile px-2.5 font-serif text-[13px] italic outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50" />
                  </label>
                  {selection && <p className="text-[11px] text-muted-foreground/80">The selection came from the page you added it from; change it there and add again.</p>}
                </div>
              )}
            </li>
          )
        })}
      </ol>

      <div className="flex items-center gap-2">
        <select value={addPage} onChange={(e) => setAddPage(e.target.value as CataloguePage['page'])} aria-label="Page to add"
          className="h-8 min-w-0 flex-1 rounded-[4px] border border-input bg-tile px-2 text-[13px] outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50">
          {p.catalogue.filter((c) => c.page !== 'agent').map((c) => <option key={c.page} value={c.page}>{c.title}</option>)}
        </select>
        <button type="button" onClick={add} disabled={sections.length >= REPORT_MAX_SECTIONS}
          className="inline-flex h-8 items-center rounded-full bg-tile px-3 text-[12px] font-medium text-secondary-foreground ring-1 ring-border hover:bg-inner disabled:opacity-50">
          Add page
        </button>
      </div>
      <p className="text-[11px] text-muted-foreground/80">Each section shows its page’s default view; a selection it was given (one competitor, one theme) stays with it.</p>


      <p className="flex items-center gap-2 font-mono text-[10.5px] text-muted-foreground" aria-live="polite">
        {pending ? <><LoaderCircle className="size-3 animate-spin" aria-hidden /> Saving…</> : status ? <span className={status.ok ? '' : 'text-negative'}>{status.message}</span> : <span>{p.slideCount} slide{p.slideCount === 1 ? '' : 's'}</span>}
        {!pending && p.slideCount > p.slidesWarn && <span className="text-warning">· long deck — readers read less</span>}
      </p>
    </div>
  )
}
