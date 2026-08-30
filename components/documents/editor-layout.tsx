'use client'

import { useEffect, useState, type ReactNode } from 'react'

// The document editor's two columns (S7): settings left, the page right.
// The settings fold to a rail so the page can sit at full size on a laptop;
// the choice is remembered in this browser.

const KEY = 'vb-studio-settings-open'

export function EditorLayout({ settings, page }: { settings: ReactNode; page: ReactNode }) {
  const [open, setOpen] = useState(true)
  // The server always renders open; the remembered choice lands after
  // hydration (a stored value in the initialiser would mismatch the HTML).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- read-after-hydrate on purpose
    try { if (localStorage.getItem(KEY) === '0') setOpen(false) } catch { /* no storage */ }
  }, [])
  const toggle = () => { setOpen((o) => { try { localStorage.setItem(KEY, o ? '0' : '1') } catch {}; return !o }) }
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 md:h-[calc(100dvh_-_6.75rem)] md:flex-row">
      <section className={`flex min-h-0 flex-col overflow-hidden rounded-lg bg-tile shadow-tile ${open ? 'md:w-[300px]' : 'md:w-[44px]'} md:shrink-0`}>
        <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
          {open && <p className="text-[13px] font-semibold">Settings</p>}
          <button type="button" onClick={toggle} aria-label={open ? 'Hide the settings' : 'Show the settings'} aria-expanded={open}
            className="inline-flex size-6 items-center justify-center rounded-full bg-inner text-[13px] leading-none text-secondary-foreground ring-1 ring-border hover:bg-tile">
            {open ? '‹' : '›'}
          </button>
        </div>
        {open ? <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">{settings}</div> : <p className="px-3 py-3 font-mono text-[10.5px] uppercase tracking-[0.08em] text-muted-foreground [writing-mode:vertical-rl]">Settings</p>}
      </section>
      <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg bg-tile shadow-tile">{page}</section>
    </div>
  )
}
