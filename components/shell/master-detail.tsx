'use client'

import { useEffect, useRef, type ReactNode } from 'react'
import type { GroupImperativeHandle, Layout, LayoutChangedMeta } from 'react-resizable-panels'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable'
import { cn } from '@/lib/utils'

// "A page inside the page" (component-map §2): three resizable panes — a rail
// of groups with counts, a searchable list, and the detail of the selected
// item — all server-rendered by the page and passed through. Selection is
// URL-driven (?item=<id>), so every deep link still lands on an open item and
// the page itself stays a server component; this wrapper is the only client
// code, and it holds no state beyond the pane widths, which it restores from
// localStorage AFTER mount (never during render — the server has no storage
// and the first client paint must match the server HTML). Below `md` the
// panes stack in reading order.
//
// The three panes are the tile level of the nesting discipline (map §1,
// decision 2): white, ambient shadow. Rows inside them are the inner level.

const RAIL_ID = 'rail'
const LIST_ID = 'list'
const DETAIL_ID = 'detail'

export function MasterDetail({
  id, rail, list, detail, className,
}: {
  /** Unique per page — keys the persisted layout. */
  id: string
  rail: ReactNode
  list: ReactNode
  detail: ReactNode
  className?: string
}) {
  const group = useRef<GroupImperativeHandle | null>(null)
  const key = `verbatim:master-detail:${id}`

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(key)
      if (!raw) return
      const saved = JSON.parse(raw) as Layout
      if (saved && typeof saved === 'object' && group.current) group.current.setLayout(saved)
    } catch { /* no storage, or a stale value — the defaults are fine */ }
  }, [key])

  function remember(layout: Layout, meta: LayoutChangedMeta) {
    if (!meta.isUserInteraction) return
    try { window.localStorage.setItem(key, JSON.stringify(layout)) } catch { /* ignore */ }
  }

  return (
    // The three panes fill the shell's height and scroll inside themselves — the
    // page-inside-the-page keeps its frame still (component-map §2).
    <div className={cn('flex min-h-0 flex-col md:h-[calc(100dvh_-_6.75rem)] md:flex-none', className)}>
      {/* ≥ md: three panes side by side. The wrapper carries the breakpoint —
          the panel group sets display:flex inline, so `hidden` on it is ignored. */}
      <div className="hidden min-h-0 flex-1 md:flex">
      <ResizablePanelGroup
        orientation="horizontal"
        groupRef={group}
        onLayoutChanged={remember}
        className="min-h-0 flex-1 gap-3"
      >
        <ResizablePanel id={RAIL_ID} defaultSize="20" minSize={168} maxSize="32" className="min-h-0">
          <Pane>{rail}</Pane>
        </ResizablePanel>
        <ResizableHandle className="w-1 rounded-full bg-transparent after:w-1 hover:bg-border data-[resize-handle-state=drag]:bg-border" />
        <ResizablePanel id={LIST_ID} defaultSize="34" minSize={260} className="min-h-0">
          <Pane>{list}</Pane>
        </ResizablePanel>
        <ResizableHandle className="w-1 rounded-full bg-transparent after:w-1 hover:bg-border data-[resize-handle-state=drag]:bg-border" />
        <ResizablePanel id={DETAIL_ID} minSize={320} className="min-h-0">
          <Pane>{detail}</Pane>
        </ResizablePanel>
      </ResizablePanelGroup>
      </div>
      {/* < md: stacked, each pane its own tile */}
      <div className="flex flex-col gap-3 md:hidden">
        <Pane className="max-h-[40vh]">{rail}</Pane>
        <Pane className="max-h-[60vh]">{list}</Pane>
        <Pane>{detail}</Pane>
      </div>
    </div>
  )
}

function Pane({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <section className={cn('flex h-full min-h-0 flex-col overflow-hidden rounded-lg bg-tile shadow-tile', className)}>
      {children}
    </section>
  )
}
