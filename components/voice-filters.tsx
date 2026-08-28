'use client'

import { useRouter, useSearchParams, usePathname } from 'next/navigation'

// Filter controls for Voice of Customer's theme map. URL-driven so the server
// component does the actual filtering (shareable links, no client data
// duplication); this only updates the query string and preserves any other
// params (?entity, ?type, ?themes, ?seed). Category filtering is the tab row
// on the page; strength options are worded, never numeric (Redesign Spec §1 —
// scores are not displayed). Rendered inline (a span) so it can sit in the
// tile's eyebrow row.
const STAGES = [
  { value: 'all', label: 'Journey: any' },
  { value: 'awareness', label: 'Awareness' },
  { value: 'consideration', label: 'Consideration' },
  { value: 'purchase', label: 'Purchase' },
  { value: 'ownership', label: 'Ownership' },
  { value: 'advocacy', label: 'Advocacy' },
]
const STRENGTH = [
  { value: '0', label: 'Any strength' },
  { value: '4', label: 'Clear or stronger' },
  { value: '7', label: 'Strong only' },
]

export function VoiceFilters({ stage, min, deepLinked, showStage }: {
  stage: string
  min: string
  deepLinked?: boolean
  /** Hide the journey filter on updates whose insights predate the journey tag. */
  showStage?: boolean
}) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()

  function push(mutate: (p: URLSearchParams) => void) {
    const p = new URLSearchParams(params.toString())
    mutate(p)
    const qs = p.toString()
    router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
  }

  const setParam = (key: string, value: string, clearValue: string) =>
    push((p) => (value === clearValue ? p.delete(key) : p.set(key, value)))

  // Quiet 22px controls: they sit on the map tile's eyebrow row (2026-08-22),
  // so they read as settings, not as a second toolbar.
  const selectCls =
    'h-[22px] cursor-pointer rounded-md border border-border/80 bg-tile px-1.5 text-[11px] text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40'

  return (
    <span className="inline-flex shrink-0 items-center gap-1.5">
      {deepLinked && (
        <button
          type="button"
          onClick={() => push((p) => p.delete('themes'))}
          className="inline-flex h-[22px] cursor-pointer items-center gap-1 rounded-md bg-sidebar-accent px-2 text-[11px] font-medium text-primary transition-colors hover:bg-sidebar-accent/80"
        >
          Behind a selected insight
          <span aria-hidden>✕</span>
        </button>
      )}
      {showStage && (
        <select id="voice-stage" name="stage" className={selectCls} value={stage} onChange={(e) => setParam('stage', e.target.value, 'all')} aria-label="Filter by journey stage">
          {STAGES.map((s) => (
            <option key={s.value} value={s.value}>{s.label}</option>
          ))}
        </select>
      )}
      <select id="voice-min" name="min" className={selectCls} value={min} onChange={(e) => setParam('min', e.target.value, '0')} aria-label="Filter by signal strength">
        {STRENGTH.map((s) => (
          <option key={s.value} value={s.value}>{s.label}</option>
        ))}
      </select>
    </span>
  )
}
