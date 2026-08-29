'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'

// The tiles are the app's own, and some carry links into /dashboard — the
// rest of a finding, the page a theme lives on. A reader of a share link has
// no account to land in, so those links go quiet here with one honest line;
// links out to the platforms (a comment, a video) still open.
export function LinkGuard({ children }: { children: ReactNode }) {
  const [note, setNote] = useState<{ x: number; y: number } | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])
  return (
    <div
      onClickCapture={(e) => {
        const a = (e.target as HTMLElement).closest('a')
        if (!a) return
        const href = a.getAttribute('href') ?? ''
        const internal = href.startsWith('/') && !href.startsWith('/r/')
        const sameOrigin = href.startsWith(window.location.origin) && !href.startsWith(`${window.location.origin}/r/`)
        if (!internal && !sameOrigin) return
        e.preventDefault()
        e.stopPropagation()
        setNote({ x: e.clientX, y: e.clientY })
        if (timer.current) clearTimeout(timer.current)
        timer.current = setTimeout(() => setNote(null), 2200)
      }}
    >
      {children}
      {note && (
        <p role="status" style={{ left: Math.min(note.x, window.innerWidth - 260), top: note.y + 12 }}
          className="pointer-events-none fixed z-50 rounded-md bg-foreground px-2.5 py-1.5 text-[12px] text-tile shadow-tile-hover">
          That lives in Verbatim — ask whoever sent this.
        </p>
      )}
    </div>
  )
}
