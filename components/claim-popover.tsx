'use client'

import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import Link from 'next/link'

// A claim with voices behind it (MASTER rule 5 — the Agent page's document-
// review pattern, brought to the Dashboard). The trigger is the claim text with
// a quiet dotted underline; clicking opens the evidence: how many voices, on
// which platforms, two of them verbatim, and where the rest live. Nothing gets
// this treatment unless it can open — a claim without evidence is plain text.
//
// The panel is position:fixed and measured from the trigger, so a tile's
// overflow-hidden cannot clip it. Closes on outside click and Escape.

export interface ClaimEvidence {
  voices: number
  platforms: { label: string; count: number }[]
  quotes: string[]
  href: string
  hrefLabel: string
}

export function ClaimPopover({ evidence, children, className }: { evidence: ClaimEvidence; children: ReactNode; className?: string }) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)
  const btn = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const id = useId()

  function place() {
    const r = btn.current?.getBoundingClientRect()
    if (!r) return
    const width = 340
    const left = Math.min(Math.max(8, r.left), window.innerWidth - width - 8)
    const top = r.bottom + 6
    setPos({ left, top })
  }

  useEffect(() => {
    if (!open) return
    function onDown(e: MouseEvent) {
      const t = e.target as Node
      if (panel.current?.contains(t) || btn.current?.contains(t)) return
      setOpen(false)
    }
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') { setOpen(false); btn.current?.focus() } }
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
  }, [open])

  return (
    <>
      <button
        ref={btn}
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => { if (!open) place(); setOpen((o) => !o) }}
        className={[
          'cursor-pointer rounded-[2px] text-left underline decoration-dotted decoration-1 underline-offset-[3px]',
          'decoration-[var(--muted-foreground)] hover:decoration-[var(--foreground)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          open ? 'decoration-[var(--foreground)]' : '',
          className ?? '',
        ].join(' ')}
      >
        {children}
      </button>
      {open && pos && (
        <div
          ref={panel}
          id={id}
          role="dialog"
          aria-label="The voices behind this"
          className="fixed z-50 flex w-[340px] max-w-[calc(100vw-16px)] flex-col gap-2.5 rounded-md bg-tile p-3.5 text-[12px] leading-[1.4] text-foreground shadow-tile-hover ring-1 ring-border"
          style={{ left: pos.left, top: pos.top }}
        >
          <div className="flex items-baseline gap-2">
            <span className="font-mono text-[13px] font-semibold tabular-nums">{evidence.voices.toLocaleString('en-US')} voices</span>
            <span className="min-w-0 truncate text-muted-foreground">behind this</span>
          </div>
          {evidence.platforms.length > 0 && (
            <div className="flex flex-wrap gap-x-3 gap-y-1 font-mono text-[10.5px] tabular-nums text-secondary-foreground">
              {evidence.platforms.map((p) => (
                <span key={p.label} className="inline-flex items-center gap-1">
                  <span className="size-[7px] rounded-[2px] bg-you" aria-hidden />
                  {p.label} {p.count.toLocaleString('en-US')}
                </span>
              ))}
            </div>
          )}
          {evidence.quotes.slice(0, 2).map((q, i) => (
            <blockquote key={i} className="font-serif text-[13px] leading-[1.4] text-foreground">“{q}”</blockquote>
          ))}
          <Link href={evidence.href} className="border-t border-border/70 pt-2 font-medium hover:underline" onClick={() => setOpen(false)}>
            {evidence.hrefLabel}
          </Link>
        </div>
      )}
    </>
  )
}
