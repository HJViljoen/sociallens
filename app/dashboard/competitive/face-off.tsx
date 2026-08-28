import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import type { FaceOffRow } from '@/lib/competitive-tiles'

// The face-off — a butterfly comparison, you on the left, the faced competitor
// on the right, metrics down a fixed-width centre column. Each row's bars share
// one scale (the larger of the pair), grow outward from the centre line and
// take the entity's colour: you = green, the competitor = clay. Values sit in
// a fixed column on the outside so every row's bar starts from the same line
// and every value aligns. Server component, plain divs.

export const YOU_COLOR = 'var(--you)'
export const THEM_COLOR = 'var(--comp)'

// One grid for the header and every row: side · centre · side.
const GRID = 'grid grid-cols-[minmax(0,1fr)_150px_minmax(0,1fr)] gap-x-3'

/** The header row: two eyebrows with their "praised for" lines around a centre label. */
export function FaceOffHeader({
  you, youLine, centre, them, themLine,
}: { you: ReactNode; youLine?: ReactNode; centre: ReactNode; them: ReactNode; themLine?: ReactNode }) {
  return (
    <div className={cn(GRID, 'items-end')}>
      <div className="flex min-w-0 flex-col items-end text-right">
        <span className="block max-w-full truncate text-[10.5px] font-semibold uppercase tracking-[0.07em] text-you">{you}</span>
        {youLine && <span className="block max-w-full truncate text-[12.5px] font-medium text-foreground">{youLine}</span>}
      </div>
      <div className="truncate text-center text-[10.5px] font-semibold uppercase tracking-[0.07em] text-muted-foreground">{centre}</div>
      <div className="flex min-w-0 flex-col">
        <span className="block max-w-full truncate text-[10.5px] font-semibold uppercase tracking-[0.07em] text-comp">{them}</span>
        {themLine && <span className="block max-w-full truncate text-[12.5px] font-medium text-foreground">{themLine}</span>}
      </div>
    </div>
  )
}

/** One butterfly row: value · bar growing left ‖ label ‖ bar growing right · value. */
export function FaceOffRowView({ row, className }: { row: FaceOffRow; className?: string }) {
  return (
    <div className={cn(GRID, 'items-center', className)}>
      <div className="flex min-w-0 items-center justify-end gap-2">
        <span className="w-14 shrink-0 text-right font-mono text-[12.5px] font-semibold tabular-nums">{row.you.text}</span>
        <span className="flex h-2.5 min-w-0 flex-1 justify-end" aria-hidden>
          <span className="block h-full rounded-full" style={{ width: `${row.youPct}%`, background: YOU_COLOR }} />
        </span>
      </div>
      <div className="truncate text-center text-[11.5px] font-medium text-secondary-foreground">{row.label}</div>
      <div className="flex min-w-0 items-center gap-2">
        <span className="flex h-2.5 min-w-0 flex-1" aria-hidden>
          <span className="block h-full rounded-full" style={{ width: `${row.themPct}%`, background: THEM_COLOR }} />
        </span>
        <span className="w-14 shrink-0 text-left font-mono text-[12.5px] font-semibold tabular-nums">{row.them.text}</span>
      </div>
    </div>
  )
}

/** The rows, spread evenly through whatever height the tile gives them. */
export function FaceOff({ rows }: { rows: FaceOffRow[] }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col justify-between gap-1">
      {rows.map((r) => <FaceOffRowView key={r.key} row={r} />)}
    </div>
  )
}
