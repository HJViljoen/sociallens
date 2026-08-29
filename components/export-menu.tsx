'use client'

import { createContext, useContext, useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { Download, LoaderCircle } from 'lucide-react'
import type { PageKey } from '@/lib/renderables/types'

// Export-in-place (Reports & Exports T10, 2026-08-29). Every tile can leave as
// a PNG or a PDF; every page as a PDF of the view the reader is looking at, or
// of everything on it. The page provides the scope (which page, which URL
// params) through a context; a tile only names its renderable key. On paper
// there is no provider, so the buttons render nothing.
//
// Quiet chrome (rule 1, "hover that answers a question"): the tile button is
// zero-width until the tile is hovered or the button is focused, so the tile
// header does not move; the page-level control is a plain pill.

interface ExportScopeValue {
  page: PageKey
  params: Record<string, string | undefined>
  /** Every renderable on the page, for the page-level "a tile as PNG" list. */
  tiles: { key: string; title: string }[]
}

const ExportScopeContext = createContext<ExportScopeValue | null>(null)

export function ExportScope({ page, params, tiles, children }: ExportScopeValue & { children: ReactNode }) {
  return <ExportScopeContext.Provider value={{ page, params, tiles }}>{children}</ExportScopeContext.Provider>
}

type Format = 'pdf' | 'png'
interface Job { kind: 'page' | 'tile'; tileKey?: string; format: Format; variant?: 'default' | 'full'; label: string }
const NOUN: Record<Format, string> = { pdf: 'PDF', png: 'image' }
type State = { phase: 'idle' } | { phase: 'busy'; noun: string; started: number } | { phase: 'done'; url: string; noun: string } | { phase: 'error'; message: string }

function useExport(scope: ExportScopeValue | null) {
  const [state, setState] = useState<State>({ phase: 'idle' })
  // A ticking clock while busy; elapsed is derived, never set in the effect.
  const [now, setNow] = useState(0)
  useEffect(() => {
    if (state.phase !== 'busy') return
    const id = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(id)
  }, [state])
  const elapsed = state.phase === 'busy' ? Math.max(0, Math.floor((now - state.started) / 1000)) : 0

  async function run(job: Job) {
    if (!scope) return
    setState({ phase: 'busy', noun: NOUN[job.format], started: Date.now() })
    try {
      const r = await fetch('/api/export', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ kind: job.kind, page: scope.page, tileKey: job.tileKey, params: scope.params, variant: job.variant ?? 'default', format: job.format }),
      })
      const j = (await r.json().catch(() => ({}))) as { url?: string; error?: string }
      if (!r.ok || !j.url) {
        setState({ phase: 'error', message: j.error ?? 'Couldn’t render this — try again.' })
        return
      }
      setState({ phase: 'done', url: j.url, noun: NOUN[job.format] })
      // The signed URL carries Content-Disposition: attachment — the browser
      // downloads it and the page stays put.
      window.location.assign(j.url)
    } catch {
      setState({ phase: 'error', message: 'Couldn’t render this — try again.' })
    }
  }
  return { state, elapsed, run, reset: () => setState({ phase: 'idle' }) }
}

/** The popover shared by both controls: a list of jobs, then the progress. */
function Menu({ anchor, open, onClose, jobs, ex, id }: {
  anchor: React.RefObject<HTMLElement | null>
  open: boolean
  onClose: () => void
  jobs: Job[]
  ex: ReturnType<typeof useExport>
  id: string
}) {
  const panel = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)
  function place() {
    const r = anchor.current?.getBoundingClientRect()
    if (!r) return
    const width = 260
    setPos({ left: Math.min(Math.max(8, r.right - width), window.innerWidth - width - 8), top: r.bottom + 6 })
  }
  useEffect(() => {
    if (!open) return
    place()
    function onDown(e: MouseEvent) {
      const t = e.target as Node
      if (panel.current?.contains(t) || anchor.current?.contains(t)) return
      onClose()
    }
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])
  if (!open || !pos) return null
  const { state, elapsed } = ex
  return (
    <div ref={panel} id={id} role="dialog" aria-label="Export" style={{ left: pos.left, top: pos.top, width: 260 }}
      className="fixed z-50 rounded-lg bg-tile p-1.5 text-[12.5px] shadow-tile-hover ring-1 ring-border">
      {state.phase === 'busy' ? (
        <p className="flex items-center gap-2 px-2 py-2 text-secondary-foreground">
          <LoaderCircle className="size-3.5 animate-spin" aria-hidden />
          Preparing your {state.noun} · {elapsed}s
        </p>
      ) : state.phase === 'done' ? (
        <div className="px-2 py-2">
          <p className="text-secondary-foreground">Your {state.noun} is downloading.</p>
          <a href={state.url} className="mt-1 inline-block font-medium underline underline-offset-2">Download again</a>
          <button type="button" onClick={ex.reset} className="ml-3 text-muted-foreground hover:text-foreground">Export another</button>
        </div>
      ) : state.phase === 'error' ? (
        <div className="px-2 py-2">
          <p className="text-negative">{state.message}</p>
          <button type="button" onClick={ex.reset} className="mt-1 text-muted-foreground hover:text-foreground">Back</button>
        </div>
      ) : (
        <ul className="flex flex-col">
          {jobs.map((j) => (
            <li key={`${j.kind}-${j.tileKey ?? ''}-${j.format}-${j.variant ?? ''}`}>
              <button type="button" onClick={() => ex.run(j)}
                className="flex w-full items-center justify-between gap-3 rounded-md px-2 py-1.5 text-left hover:bg-inner focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring">
                <span>{j.label}</span>
                <span className="font-mono text-[10.5px] uppercase text-muted-foreground">{j.format}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** The page-level control: this view · everything · any tile as a PNG. */
export function ExportMenu() {
  const scope = useContext(ExportScopeContext)
  const [open, setOpen] = useState(false)
  const btn = useRef<HTMLButtonElement>(null)
  const id = useId()
  const ex = useExport(scope)
  if (!scope) return null
  const jobs: Job[] = [
    { kind: 'page', format: 'pdf', variant: 'default', label: 'This page' },
    { kind: 'page', format: 'pdf', variant: 'full', label: 'This page, everything' },
    ...scope.tiles.map((t) => ({ kind: 'tile' as const, tileKey: t.key, format: 'png' as const, label: `${t.title}` })),
  ]
  return (
    <>
      <button ref={btn} type="button" aria-expanded={open} aria-controls={id} aria-haspopup="dialog" data-print-hide=""
        onClick={() => setOpen((o) => !o)}
        className="inline-flex h-[26px] items-center gap-1.5 rounded-full bg-tile px-2.5 text-[12px] font-medium text-secondary-foreground ring-1 ring-border transition-colors hover:bg-inner focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        {ex.state.phase === 'busy' ? <LoaderCircle className="size-3.5 animate-spin" aria-hidden /> : <Download className="size-3.5" aria-hidden />}
        Export
      </button>
      <Menu anchor={btn} open={open} onClose={() => setOpen(false)} jobs={jobs} ex={ex} id={id} />
    </>
  )
}

/** The tile-level control, rendered by Tile when it has an exportKey. */
export function TileExportButton({ tileKey }: { tileKey: string }) {
  const scope = useContext(ExportScopeContext)
  const [open, setOpen] = useState(false)
  const btn = useRef<HTMLButtonElement>(null)
  const id = useId()
  const ex = useExport(scope)
  if (!scope) return null
  const jobs: Job[] = [
    { kind: 'tile', tileKey, format: 'png', label: 'Image' },
    { kind: 'tile', tileKey, format: 'pdf', label: 'One-page PDF' },
  ]
  const busy = ex.state.phase === 'busy'
  return (
    // No transform here: a transformed ancestor would trap the position:fixed
    // menu inside the tile's overflow-hidden box.
    <span className={`absolute -right-1 -top-0.5 ${open || busy ? 'opacity-100' : 'opacity-0 group-hover/tile:opacity-100 focus-within:opacity-100'}`}>
      <button ref={btn} type="button" aria-label="Export this tile" aria-expanded={open} aria-controls={id} aria-haspopup="dialog" data-print-hide=""
        onClick={() => setOpen((o) => !o)}
        className="grid size-5 place-items-center rounded-[4px] text-muted-foreground hover:bg-inner hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring">
        {busy ? <LoaderCircle className="size-3 animate-spin" aria-hidden /> : <Download className="size-3" aria-hidden />}
      </button>
      <Menu anchor={btn} open={open} onClose={() => setOpen(false)} jobs={jobs} ex={ex} id={id} />
    </span>
  )
}
