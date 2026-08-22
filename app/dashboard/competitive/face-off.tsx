import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import type { FaceOffRow } from '@/lib/competitive-tiles'

// The face-off — a butterfly comparison, you on the left, the faced competitor
// on the right, metrics down the centre. Each row's bars share one scale (the
// larger of the pair), grow outward from the centre and take the entity's
// colour: you = green, the competitor = clay. Server component, plain divs.

export const YOU_COLOR = 'var(--positive)'
export const THEM_COLOR = 'var(--accent-clay)'

/** The header row: two eyebrows with their "praised for" lines around a centre label. */
export function FaceOffHeader({
  you, youLine, centre, them, themLine,
}: { you: ReactNode; youLine?: ReactNode; centre: ReactNode; them: ReactNode; themLine?: ReactNode }) {
  return (
    <div className="grid grid-cols-[1fr_150px_1fr] items-end gap-2.5">
      <div className="flex min-w-0 flex-col items-end gap-px text-right">
        <span className="truncate text-[10.5px] font-semibold uppercase tracking-[0.07em] text-positive">{you}</span>
        {youLine && <span className="line-clamp-1 text-[12.5px] font-medium text-[#2B3A31]">{youLine}</span>}
      </div>
      <div className="text-center text-[10.5px] font-semibold uppercase tracking-[0.07em] text-[#6B756B]">{centre}</div>
      <div className="flex min-w-0 flex-col gap-px">
        <span className="truncate text-[10.5px] font-semibold uppercase tracking-[0.07em] text-clay">{them}</span>
        {themLine && <span className="line-clamp-1 text-[12.5px] font-medium text-[#2B3A31]">{themLine}</span>}
      </div>
    </div>
  )
}

/** One butterfly row: value · bar growing left ‖ label ‖ bar growing right · value. */
export function FaceOffRowView({ row, className }: { row: FaceOffRow; className?: string }) {
  return (
    <div className={cn('grid grid-cols-[1fr_150px_1fr] items-center gap-2.5 py-[3px]', className)}>
      <div className="flex items-center justify-end gap-2">
        <span className="font-mono text-[12.5px] font-semibold tabular-nums">{row.you.text}</span>
        <span className="flex h-2.5 w-full max-w-[340px] justify-end" aria-hidden>
          <span className="block h-full rounded-full" style={{ width: `${row.youPct}%`, background: YOU_COLOR }} />
        </span>
      </div>
      <div className="truncate text-center text-[11.5px] font-medium text-[#3F4B44]">{row.label}</div>
      <div className="flex items-center gap-2">
        <span className="flex h-2.5 w-full max-w-[340px]" aria-hidden>
          <span className="block h-full rounded-full" style={{ width: `${row.themPct}%`, background: THEM_COLOR }} />
        </span>
        <span className="font-mono text-[12.5px] font-semibold tabular-nums">{row.them.text}</span>
      </div>
    </div>
  )
}

export function FaceOff({ rows }: { rows: FaceOffRow[] }) {
  return (
    <div className="flex flex-col">
      {rows.map((r) => <FaceOffRowView key={r.key} row={r} />)}
    </div>
  )
}
