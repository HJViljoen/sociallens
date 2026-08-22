'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'

// Earlier questions, as a sheet that lives off the bottom of the page.
//
// The page itself does not scroll — the composer and the figure hold the centre
// of the frame, which is the whole composition. So the history cannot sit below
// them: there is no "below". It parks at the bottom edge, rises almost to the
// top when you reach for it, and drops back when you look away.
//
// NO HEADING. The peek is tall enough to show the most recent question itself,
// which says what the sheet is far better than a label would — a list of
// questions is self-evidently a list of questions. All that is left above it is
// a grab bar: the universal "this pulls up" mark, and no words to read twice.
//
// Deliberately NOT a modal: it is a drawer over its own page, so it takes no
// focus trap and no scroll lock. Escape and a click outside both close it,
// because a thing that covers the page must always have an obvious way back.

export interface ThreadRow {
  id: string
  title: string | null
  created_at: string
}

/** Height left on screen when the sheet is down: the grab bar plus one row, so
 *  the newest question is readable without opening anything. */
const PEEK_REM = 5.5

export function AgentHistory({ threads }: { threads: ThreadRow[] }) {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  if (threads.length === 0) return null

  return (
    <>
      {/* Catches the click-away. Only mounted while open, so it can never
          swallow a click at the composer. No dimming: the page behind is the
          subject and this is a drawer, not a modal. */}
      {open && <div className="absolute inset-0 z-20" onClick={() => setOpen(false)} aria-hidden />}

      <div
        // Centred and sized to the composer rather than the pane — a touch
        // wider, so it reads as belonging to the box above it instead of being
        // a separate full-width tray. -mb-6 cancels the dashboard's own padding
        // so it reaches the real bottom edge and looks like it leaves the
        // screen; the page root is deliberately not overflow-hidden, or that
        // negative margin would be clipped away.
        className="absolute inset-x-0 bottom-0 z-30 mx-auto -mb-6 flex w-full max-w-3xl flex-col rounded-t-[1.15rem] border border-b-0 border-border bg-card shadow-[0_-8px_30px_-12px_rgba(13,33,23,0.18)] transition-transform duration-500 ease-[cubic-bezier(0.22,1,0.36,1)]"
        style={{
          height: 'calc(100% + 1.5rem - 3rem)',
          transform: open ? 'translateY(0)' : `translateY(calc(100% - ${PEEK_REM}rem))`,
        }}
        // A closed sheet opens the moment the reader tries to scroll it — that
        // gesture IS the reach for it, and making them find the handle first
        // would be a rule they had to learn.
        onWheel={() => {
          if (!open) setOpen(true)
        }}
      >
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-label={open ? 'Hide earlier questions' : 'Show earlier questions'}
          className="group flex h-6 shrink-0 items-center justify-center pt-2"
        >
          <span className="h-1 w-10 rounded-full bg-border transition-colors group-hover:bg-muted-foreground/40" />
        </button>

        <div className={`min-h-0 flex-1 px-4 pb-8 pt-3 ${open ? 'overflow-y-auto' : 'overflow-hidden'}`}>
          <div className="space-y-2">
            {threads.map((t, i) => (
              <Link
                key={t.id}
                href={`/dashboard/agent/${t.id}`}
                // The first row is visible while the sheet is down, so it stays
                // reachable; the rest would otherwise take focus off-screen.
                tabIndex={open || i === 0 ? undefined : -1}
                className="flex items-baseline justify-between gap-3 rounded-2xl border border-border/60 px-4 py-3 transition-colors hover:bg-muted/40"
              >
                <span className="text-sm text-foreground">{t.title ?? 'Untitled'}</span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {new Date(t.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                </span>
              </Link>
            ))}
          </div>
        </div>
      </div>
    </>
  )
}
