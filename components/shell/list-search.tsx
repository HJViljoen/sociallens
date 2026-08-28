'use client'

import { useId, useRef, useState } from 'react'
import { Search } from 'lucide-react'

// Search inside a pane without a server round trip: the rows are already in
// the payload (ListRow writes its text to data-search), so typing only toggles
// their visibility. `scope` is the id of the element that contains the rows.

export function ListSearch({ scope, placeholder = 'Search…' }: { scope: string; placeholder?: string }) {
  const [q, setQ] = useState('')
  const [hidden, setHidden] = useState(0)
  const id = useId()
  const total = useRef<number | null>(null)

  function apply(value: string) {
    setQ(value)
    const root = document.getElementById(scope)
    if (!root) return
    const rows = root.querySelectorAll<HTMLElement>('[data-search]')
    if (total.current == null) total.current = rows.length
    const needle = value.trim().toLowerCase()
    let off = 0
    rows.forEach((row) => {
      const hit = needle === '' || (row.dataset.search ?? '').includes(needle)
      row.hidden = !hit
      if (!hit) off++
    })
    setHidden(off)
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
        aria-controls={scope}
        className="h-8 w-full rounded-[4px] bg-inner pl-8 pr-2 text-[12.5px] text-foreground placeholder:text-muted-foreground focus:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      />
      {q && (
        <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 font-mono text-[10.5px] tabular-nums text-muted-foreground" role="status">
          {total.current != null ? `${total.current - hidden} of ${total.current}` : ''}
        </span>
      )}
    </div>
  )
}
