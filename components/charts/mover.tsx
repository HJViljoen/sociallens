import type { ReactNode } from 'react'
import { Sparkline } from './sparkline'
import { Delta, type Good } from './stat'

// One row of a movement list: label · sparkline over updates · current value ·
// delta vs the previous update, coloured by favourability. The dashboard's
// "since your first update" tile and Voice's gaining/fading list are rows of
// these.

export function Mover({
  label, series, value, delta, unit = '', good = 'neutral', color = 'var(--primary)', sparkWidth = 104,
}: {
  label: ReactNode
  series: number[]
  value: ReactNode
  delta: number | null
  unit?: string
  good?: Good
  color?: string
  sparkWidth?: number
}) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="min-w-0 flex-[1.3] truncate text-[12px]">{label}</span>
      <Sparkline values={series} color={color} width={sparkWidth} height={22} />
      <span className="w-10 shrink-0 text-right font-mono text-[11.5px] font-semibold tabular-nums">{value}</span>
      <span className="w-14 shrink-0 text-right">
        <Delta value={delta} unit={unit} good={good} />
      </span>
    </div>
  )
}
