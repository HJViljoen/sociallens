import { describe, it, expect } from 'vitest'
import { decideOpenRun, RUN_STALE_AFTER_HOURS } from './run-guard'

const NOW = new Date('2026-08-23T04:30:00Z')
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3600_000).toISOString()

describe('decideOpenRun — single-flight per client', () => {
  it('opens when nothing is running', () => {
    expect(decideOpenRun([], NOW)).toEqual({ action: 'open', staleRunIds: [] })
  })

  it('skips while a live run is in flight (the scheduler firing over a manual run)', () => {
    const d = decideOpenRun([{ id: 'live', started_at: hoursAgo(0.5) }], NOW)
    expect(d).toEqual({ action: 'skip', blockingRunId: 'live' })
  })

  it('a run just under the stale threshold still blocks', () => {
    const d = decideOpenRun([{ id: 'long', started_at: hoursAgo(RUN_STALE_AFTER_HOURS - 0.01) }], NOW)
    expect(d.action).toBe('skip')
  })

  it('an abandoned running row (past the threshold) never blocks — it is handed back to be closed', () => {
    const d = decideOpenRun([{ id: 'dead', started_at: hoursAgo(RUN_STALE_AFTER_HOURS + 1) }], NOW)
    expect(d).toEqual({ action: 'open', staleRunIds: ['dead'] })
  })

  it('one live row among stale ones still skips', () => {
    const d = decideOpenRun(
      [
        { id: 'dead1', started_at: hoursAgo(30) },
        { id: 'live', started_at: hoursAgo(1) },
        { id: 'dead2', started_at: hoursAgo(9) },
      ],
      NOW,
    )
    expect(d).toEqual({ action: 'skip', blockingRunId: 'live' })
  })
})
