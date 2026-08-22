'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { ChevronUp } from 'lucide-react'

// Earlier questions, as a sheet that lives off the bottom of the page.
//
// The page itself does not scroll — the composer and the figure hold the centre
// of the frame, which is the whole composition. So the history cannot simply sit
// below them: there is no "below". It parks off the bottom edge showing only its
// handle, rises almost to the top when you reach for it, and drops back when you
// look away.
//
// Deliberately NOT a modal: it is a drawer over its own page, so it takes no
// focus trap and no scroll lock. Escape and a click outside both close it,
// because a thing that covers the page must always have an obvious way back.

export interface ThreadRow {
  id: string
  title: string | null
  created_at: string
}

/** How much of the sheet stays on screen when it is down. */
const PEEK_REM = 3.5

export function AgentHistory({ threads }: { threads: ThreadRow[] }) {
  const [open, setOpen] = useState(false)
  const sheet = useRef<HTMLDivElement>(null)

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
      {open && (
        <div
          className="absolute inset-0 z-20"
          onClick={() => setOpen(false)}
          aria-hidden
        />
      )}

      <div
        ref={sheet}
        // Negative margins cancel the dashboard's own p-6 so the sheet reaches
        // the real bottom edge and reads as leaving the screen, rather than
        // stopping short inside the padding.
        className="absolute inset-x-0 bottom-0 z-30 -mx-6 -mb-6 flex flex-col rounded-t-[1.15rem] border border-b-0 border-border bg-card shadow-[0_-8px_30px_-12px_rgba(13,33,23,0.18)] transition-transform duration-500 ease-[cubic-bezier(0.22,1,0.36,1)]"
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
          className="flex h-14 shrink-0 items-center justify-between px-6 text-left"
        >
          <span className="text-sm font-medium text-foreground">
            Earlier questions
            <span className="ml-2 text-xs font-normal text-muted-foreground tabular-nums">{threads.length}</span>
          </span>
          <ChevronUp
            className={`size-4 text-muted-foreground transition-transform duration-500 ${open ? 'rotate-180' : ''}`}
            aria-hidden
          />
        </button>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-8">
          <div className="mx-auto w-full max-w-2xl space-y-2">
            {threads.map((t) => (
              <Link
                key={t.id}
                href={`/dashboard/agent/${t.id}`}
                // Unreachable by keyboard while the sheet is down, so it cannot
                // be tabbed into from behind the page edge.
                tabIndex={open ? undefined : -1}
                className="flex items-baseline justify-between gap-3 rounded-lg border border-border/60 px-4 py-3 transition-colors hover:bg-muted/40"
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
