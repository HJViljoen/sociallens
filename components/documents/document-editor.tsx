'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { restoreBlock, saveBlockEdit } from '@/app/dashboard/studio/actions'
import { FitWidth } from '@/components/reports/fit-width'
import { EditContext, type EditContextValue } from './edit-context'
import { WorkingsDrawer } from './workings-drawer'
import type { DocBlock, DocumentSnapshotData, DocumentWorkings } from '@/lib/reports/documents/types'

// The right pane of the document editor (S7, 2026-08-31): the built pages
// as printed, at readable size (never under 0.8, the pane scrolls sideways
// instead), every block editable where it sits. After each change the
// sheets are measured and a page that no longer fits says so. "Show the
// workings" puts a count in each block's margin and opens the evidence
// beside the page.

const PAGE_LABEL: Record<string, string> = { in_short: 'Overview', finding: 'Finding', competitor: 'Competitor', personas: 'Who is buying', language: 'Handle with care', method: 'About this brief' }
const FIELD_LABEL: Record<string, string> = { summary: 'Executive summary', headline: 'Headline', saw: 'What the conversation shows', means: 'What it means for a sale', practice: 'In practice', pitch: 'What they are pitching', praise: 'What their users praise', hurt: 'Where their users hurt', read: 'When they come up', persona: 'For a sale', care: 'Handle with care', not_sure: 'Not settled this update' }

export function DocumentEditor({ snapshotId, data, workings, editedIds, deck }: { snapshotId: string; data: DocumentSnapshotData; workings: DocumentWorkings | null; editedIds: string[]; deck: ReactNode }) {
  const router = useRouter()
  const [showWorkings, setShowWorkings] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [status, setStatus] = useState('')
  const [overflow, setOverflow] = useState<string[]>([])
  const root = useRef<HTMLDivElement>(null)

  const counts = useMemo(() => {
    if (!showWorkings || !workings) return null
    const m = new Map<string, number>()
    for (const b of workings.blocks) {
      const n = b.basedOn.reduce((s, id) => s + (workings.points.find((p) => p.id === id)?.conversationCount ?? 0), 0)
      if (b.basedOn.length) m.set(b.blockId, n)
    }
    return m
  }, [showWorkings, workings])

  const blockLabel = useCallback((id: string) => {
    for (const p of data.pages) {
      const b = p.blocks.find((x) => x.id === id)
      if (b) {
        const page = p.kind === 'finding' ? `Finding ${p.meta?.n ?? ''}` : p.kind === 'competitor' ? (p.meta?.name ?? 'Competitor') : PAGE_LABEL[p.kind] ?? p.title
        return `${page} · ${b.label ?? FIELD_LABEL[b.field] ?? b.field}`
      }
    }
    return id
  }, [data])

  const measure = useCallback(() => {
    const el = root.current
    if (!el) return
    const over: string[] = []
    el.querySelectorAll<HTMLElement>('.vb-slide').forEach((slide, i) => {
      const body = slide.querySelector<HTMLElement>('.vb-slide-body')
      const bad = Boolean(body && body.scrollHeight > body.clientHeight + 2)
      slide.toggleAttribute('data-overflow', bad)
      if (bad) over.push(`Page ${i + 1}`)
    })
    setOverflow(over)
  }, [])
  useEffect(() => { const t = setTimeout(measure, 50); return () => clearTimeout(t) }, [deck, measure])

  const ctx: EditContextValue = useMemo(() => ({
    snapshotId,
    figures: data.figures,
    edited: new Set(editedIds),
    counts,
    selectedId,
    select: (id) => { setSelectedId(id); setShowWorkings(true) },
    save: async (block: DocBlock, text: string) => {
      setStatus('Saving')
      const r = await saveBlockEdit({ snapshotId, blockId: block.id, text })
      setStatus(r.ok ? 'Saved. The PDF prints the new words on its next download.' : r.message)
      if (r.ok) router.refresh()
      return r.ok
    },
    restore: async (block: DocBlock) => {
      setStatus('Restoring')
      const r = await restoreBlock({ snapshotId, blockId: block.id })
      setStatus(r.ok ? 'Restored.' : r.message)
      if (r.ok) router.refresh()
      return r.ok
    },
  }), [snapshotId, data.figures, editedIds, counts, selectedId, router])

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-border px-4 py-2 text-[12px]">
        <p className="text-muted-foreground">Click any text to change it. It saves when you click away.</p>
        {workings && (
          <label className="ml-auto flex items-center gap-2">
            <input type="checkbox" checked={showWorkings} onChange={(e) => setShowWorkings(e.target.checked)} className="size-3.5 accent-primary" />
            <span>Show the workings</span>
          </label>
        )}
        <p className="basis-full font-mono text-[10.5px] text-muted-foreground" aria-live="polite">
          {overflow.length > 0 && <span className="mr-3 text-warning">{overflow.join(', ')} {overflow.length === 1 ? 'is' : 'are'} now too long for the sheet; shorten a block.</span>}
          {status}
        </p>
      </div>
      <div className="flex min-h-0 flex-1">
        <div ref={root} className="min-w-0 flex-1 overflow-auto bg-inner p-4">
          <EditContext.Provider value={ctx}>
            <FitWidth base={1123} min={0.8}>
              <div className="vb-print vb-preview vb-editing" data-print-variant="b">{deck}</div>
            </FitWidth>
          </EditContext.Provider>
        </div>
        {showWorkings && workings && <WorkingsDrawer workings={workings} selectedId={selectedId} blockLabel={blockLabel} />}
      </div>
    </div>
  )
}
