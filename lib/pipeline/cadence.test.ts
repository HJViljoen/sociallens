import { describe, it, expect } from 'vitest'
import { cadenceReliability, formatCadence } from './cadence'

const run = (id: string, status: string, sendReport?: boolean) =>
  ({ id, status, options: sendReport === undefined ? null : { sendReport }, completedAt: '2026-08-16T09:00:00Z' })

describe('cadenceReliability (Tier 2)', () => {
  it('counts a scheduled run that finished and emailed nobody as a miss', () => {
    const s = cadenceReliability(
      [run('r1', 'completed', true), run('r2', 'completed', true)],
      [{ runId: 'r1', sentAt: '2026-08-16T09:05:00Z' }],
    )
    expect(s).toMatchObject({ owed: 2, delivered: 1, missed: 1, missedRunIds: ['r2'], rate: 0.5 })
  })

  it('does not blame a run that was never asked to report', () => {
    // Sealand is the internal iteration tenant: it finishes runs and emails
    // nobody on purpose. An alert that cannot tell that from a real miss is an
    // alert nobody reads.
    const s = cadenceReliability([run('r1', 'completed', false), run('r2', 'completed')], [])
    expect(s.owed).toBe(0)
    expect(s.rate).toBeNull()
  })

  it('counts a partial run as owing a report, because it still delivers one', () => {
    const s = cadenceReliability([run('r1', 'partial', true)], [{ runId: 'r1', sentAt: 'x' }])
    expect(s).toMatchObject({ owed: 1, delivered: 1 })
  })

  it('ignores failed and running runs', () => {
    const s = cadenceReliability([run('r1', 'failed', true), run('r2', 'running', true)], [])
    expect(s.owed).toBe(0)
  })

  it('a stored but never-sent report does not count as delivered', () => {
    // The demo tenant has six stored reports and zero sends.
    const s = cadenceReliability([run('r1', 'completed', true)], [{ runId: 'r1', sentAt: null }])
    expect(s).toMatchObject({ delivered: 0, missed: 1 })
  })

  it('separates "nothing owed" from "we cannot tell what was owed"', () => {
    // Every run before the options snapshot shipped carries no options at all.
    // Reporting that as "nothing owed" would claim perfect cadence on no data.
    const s = cadenceReliability([run('r1', 'completed'), run('r2', 'partial')], [])
    expect(s.noHistory).toBe(true)
    expect(formatCadence('Ossur', s)).toContain('measures forward')
    // A run that explicitly said sendReport:false is a real answer, not a gap.
    expect(cadenceReliability([run('r1', 'completed', false)], []).noHistory).toBe(false)
  })

  it('reads as a sentence an operator can act on', () => {
    const s = cadenceReliability([run('r1', 'completed', true)], [])
    expect(formatCadence('Ossur', s)).toBe('Ossur: delivered on schedule 0/1 — 1 run finished and emailed nobody')
    expect(formatCadence('Sealand', cadenceReliability([], []))).toContain('no scheduled updates owed yet')
  })
})
