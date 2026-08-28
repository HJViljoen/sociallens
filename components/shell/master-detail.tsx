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
// and the first client paint must match the server HTML).
//
// The panes are rendered exactly once. Below `md` the same group stacks in
// reading order by CSS (the library sizes panels with inline styles, so the
// overrides are `!important`) and the drag handles hide. One DOM, one set of
// ids — the pane search always filters the list the reader is looking at.
//
// The three panes are the tile level of the nesting discipline (map §1,
// decision 2): white, ambient shadow. Rows inside them are the inner level.


// Panel drops `className`, so the stacking lives on the wrapper as descendant
// rules. Tailwind 4: the important marker is a suffix (`flex-none!`) — it has
// to beat the library's inline sizes.
const STACK = [
  'max-md:[&_[data-slot=resizable-panel-group]]:h-auto! max-md:[&_[data-slot=resizable-panel-group]]:flex-col! max-md:[&_[data-slot=resizable-panel-group]]:overflow-visible!',
  'max-md:[&_[data-panel]]:h-auto! max-md:[&_[data-panel]]:max-h-none! max-md:[&_[data-panel]]:w-full! max-md:[&_[data-panel]]:basis-auto! max-md:[&_[data-panel]]:flex-none! max-md:[&_[data-panel]]:overflow-visible!',
].join(' ')
const HANDLE = 'w-1 rounded-full bg-transparent after:w-1 hover:bg-border data-[resize-handle-state=drag]:bg-border max-md:hidden'

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
    // Desktop: the panes fill the shell's height and scroll inside themselves —
    // the page-inside-the-page keeps its frame still. Phones: they stack.
    <div className={cn('flex min-h-0 flex-col md:h-[calc(100dvh_-_6.75rem)] md:flex-none', STACK, className)}>
      <ResizablePanelGroup
        orientation="horizontal"
        groupRef={group}
        onLayoutChanged={remember}
        className="min-h-0 flex-1 gap-3"
      >
        <ResizablePanel id={`${id}-rail`} defaultSize="20" minSize={168} maxSize="32" className="min-h-0">
          <Pane className="max-md:max-h-[40vh]">{rail}</Pane>
        </ResizablePanel>
        <ResizableHandle className={HANDLE} />
        <ResizablePanel id={`${id}-list`} defaultSize="34" minSize={260} className="min-h-0">
          <Pane className="max-md:max-h-[60vh]">{list}</Pane>
        </ResizablePanel>
        <ResizableHandle className={HANDLE} />
        <ResizablePanel id={`${id}-detail`} minSize={320} className="min-h-0">
          <Pane>{detail}</Pane>
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  )
}

function Pane({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <section className={cn('flex h-full min-h-0 flex-col overflow-hidden rounded-lg bg-tile shadow-tile max-md:h-auto max-md:w-full', className)}>
      {children}
    </section>
  )
}
