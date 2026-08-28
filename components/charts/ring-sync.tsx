'use client'

import { useRef, type ReactNode } from 'react'

// Segment ↔ row hover sync for a server-rendered <Ring interactive>. Wrap the
// ring AND its legend rows (each row carries data-seg={i}) in this. Hovering a
// segment or a row marks every element with that data-seg as data-active —
// CSS in globals.css expands the segment and tints the row — and the ring's
// centre swaps to the hovered share and label; leaving restores it. Event
// delegation only; no state, no re-render.

export function RingSync({ children, className }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const original = useRef<{ center: string; sub: string } | null>(null)

  function segOf(target: EventTarget | null): string | null {
    const el = (target as Element | null)?.closest?.('[data-seg]') as HTMLElement | null
    return el?.dataset.seg ?? null
  }

  function activate(seg: string | null) {
    const root = ref.current
    if (!root) return
    const center = root.querySelector<SVGTextElement>('[data-ring-center]')
    const sub = root.querySelector<SVGTextElement>('[data-ring-sub]')
    if (center && !original.current) original.current = { center: center.textContent ?? '', sub: sub?.textContent ?? '' }
    root.querySelectorAll<HTMLElement>('[data-seg][data-active]').forEach((el) => el.removeAttribute('data-active'))
    if (seg == null) {
      if (center && original.current) center.textContent = original.current.center
      if (sub && original.current) sub.textContent = original.current.sub
      return
    }
    const matches = root.querySelectorAll<HTMLElement>(`[data-seg="${seg}"]`)
    matches.forEach((el) => el.setAttribute('data-active', ''))
    const arc = root.querySelector<SVGCircleElement>(`circle[data-seg="${seg}"]`)
    if (arc && center) center.textContent = arc.dataset.pct ?? original.current?.center ?? ''
    if (arc && sub) sub.textContent = arc.dataset.label ?? original.current?.sub ?? ''
  }

  return (
    <div
      ref={ref}
      data-ring-sync=""
      className={className}
      onMouseOver={(e) => { const s = segOf(e.target); if (s != null) activate(s) }}
      onMouseOut={(e) => { if (segOf(e.relatedTarget) == null) activate(null) }}
      onFocusCapture={(e) => { const s = segOf(e.target); if (s != null) activate(s) }}
      onBlurCapture={(e) => { if (segOf(e.relatedTarget) == null) activate(null) }}
    >
      {children}
    </div>
  )
}
