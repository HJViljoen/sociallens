'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { Search } from 'lucide-react'

// Search inside a pane without a server round trip: the rows are already in
// the payload (ListRow writes its text to data-search), so typing only toggles
// their visibility. `scope` is the id of the element that contains the rows.
// The component keeps its tree position across rail/filter navigations, so
// the query and the count reset whenever the URL changes — new rows, new list.

export function ListSearch({ scope, placeholder = 'Search…', label }: { scope: string; placeholder?: string; label?: string }) {
  const [q, setQ] = useState('')
  const [shown, setShown] = useState<{ visible: number; total: number } | null>(null)
  const id = useId()
  const params = useSearchParams()
  const nav = params.toString()
  const lastNav = useRef(nav)

  useEffect(() => {
    if (lastNav.current === nav) return
    lastNav.current = nav
    setQ('')
    setShown(null)
  }, [nav])

  function apply(value: string) {
    setQ(value)
    const root = document.getElementById(scope)
    if (!root) return
    const rows = root.querySelectorAll<HTMLElement>('[data-search]')
    const needle = value.trim().toLowerCase()
    let visible = 0
    rows.forEach((row) => {
      const hit = needle === '' || (row.dataset.search ?? '').includes(needle)
      row.hidden = !hit
      if (hit) visible++
    })
    setShown(needle === '' ? null : { visible, total: rows.length })
  }

  return (
    <div className="relative">
      <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
      <input
        id={id}
        type="search"
        value={q}
        onChange={(e) => apply(e.target.value)}
        placeholder={placeholder}
        aria-label={label ?? placeholder.replace(/…$/, '')}
        aria-controls={scope}
        className="h-8 w-full rounded-[4px] bg-inner pl-8 pr-14 text-[12.5px] text-foreground placeholder:text-muted-foreground focus:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      />
      {shown && (
        <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 font-mono text-[10.5px] tabular-nums text-muted-foreground" role="status">
          {shown.visible} of {shown.total}
        </span>
      )}
    </div>
  )
}
