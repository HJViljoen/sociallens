'use client'

import { useEffect, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, Search } from 'lucide-react'

// Sorting, filtering and a sticky header for a server-rendered <table>, with
// no data serialisation and no table library: the page renders the rows it
// already has; this wrapper (component-map §1: "the field table on sorting,
// column filters, sticky header") reads `data-v` on each cell to sort, and
// `data-search` on each row to filter. Headers become buttons; the current
// sort is announced with aria-sort. Everything degrades to the plain table.
//
// Markup contract: <th data-sort="num|str"> for sortable columns; <td data-v="…">
// carries the raw value (numbers as plain digits); <tr data-search="…"> on
// body rows.

export function EnhancedTable({ children, filterPlaceholder = 'Filter rows…', className }: { children: React.ReactNode; filterPlaceholder?: string; className?: string }) {
  const root = useRef<HTMLDivElement>(null)
  const [sort, setSort] = useState<{ col: number; dir: 'asc' | 'desc' } | null>(null)
  const [q, setQ] = useState('')
  const [shown, setShown] = useState<{ visible: number; total: number } | null>(null)

  function table() { return root.current?.querySelector('table') ?? null }

  function applySort(col: number, dir: 'asc' | 'desc', kind: string) {
    const t = table(); if (!t) return
    const tbody = t.tBodies[0]; if (!tbody) return
    const rows = [...tbody.rows]
    const val = (r: HTMLTableRowElement) => {
      const cell = r.cells[col]
      const raw = cell?.dataset.v ?? cell?.textContent ?? ''
      return kind === 'num' ? (raw === '' || raw === '—' ? Number.NEGATIVE_INFINITY : Number(raw)) : raw.toLowerCase()
    }
    rows.sort((a, b) => {
      const va = val(a), vb = val(b)
      const c = typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb))
      return dir === 'asc' ? c : -c
    })
    for (const r of rows) tbody.appendChild(r)
    t.querySelectorAll('th').forEach((th, i) => th.setAttribute('aria-sort', i === col ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'))
  }

  function applyFilter(value: string) {
    const t = table(); if (!t) return
    const needle = value.trim().toLowerCase()
    let visible = 0, total = 0
    for (const r of t.tBodies[0]?.rows ?? []) {
      total++
      const hit = needle === '' || (r.dataset.search ?? r.textContent ?? '').toLowerCase().includes(needle)
      r.hidden = !hit
      if (hit) visible++
    }
    setShown({ visible, total })
  }

  useEffect(() => {
    const t = table(); if (!t) return
    const ths = [...t.querySelectorAll<HTMLTableCellElement>('thead th[data-sort]')]
    const handlers: [HTMLTableCellElement, () => void][] = []
    ths.forEach((th) => {
      th.tabIndex = 0
      th.setAttribute('role', 'button')
      const col = th.cellIndex
      const kind = th.dataset.sort ?? 'str'
      const onClick = () => {
        setSort((prev) => {
          const dir: 'asc' | 'desc' = prev?.col === col && prev.dir === 'desc' ? 'asc' : 'desc'
          applySort(col, dir, kind)
          return { col, dir }
        })
      }
      th.addEventListener('click', onClick)
      th.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick() } })
      handlers.push([th, onClick])
    })
    return () => { for (const [th, fn] of handlers) th.removeEventListener('click', fn) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div ref={root} className={className}>
      <div className="mb-2 flex items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <input
            type="search"
            value={q}
            onChange={(e) => { setQ(e.target.value); applyFilter(e.target.value) }}
            placeholder={filterPlaceholder}
            aria-label={filterPlaceholder}
            className="h-8 w-full rounded-[4px] bg-inner pl-8 pr-2 text-[12.5px] text-foreground placeholder:text-muted-foreground focus:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
        </div>
        <span className="shrink-0 font-mono text-[10.5px] tabular-nums text-muted-foreground" role="status">
          {shown && q ? `${shown.visible} of ${shown.total}` : sort ? <span className="inline-flex items-center gap-1">sorted {sort.dir === 'asc' ? <ArrowUp className="size-3" aria-hidden /> : <ArrowDown className="size-3" aria-hidden />}</span> : 'click a heading to sort'}
        </span>
      </div>
      <div className="overflow-auto [&_table]:w-full [&_thead_th]:sticky [&_thead_th]:top-0 [&_thead_th]:z-[1] [&_thead_th]:bg-tile [&_thead_th[data-sort]]:cursor-pointer [&_thead_th[data-sort]:hover]:text-foreground [&_thead_th[aria-sort=ascending]]:text-foreground [&_thead_th[aria-sort=descending]]:text-foreground">
        {children}
      </div>
    </div>
  )
}
