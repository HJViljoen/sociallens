// Cadence reliability (Tier 2, 2026-08-18).
//
// The product is sold as a weekly update, and nothing measured whether the
// weekly update actually arrived. Measured on the live corpus when this was
// written: Össur had 10 completed-or-partial runs and 2 emailed reports. A run
// that finishes and emails nobody looks identical, in every dashboard and every
// log, to one that finishes and delivers.
//
// The distinction that makes this usable: a run only OWES a report if it was
// dispatched with sendReport. Sealand is the internal iteration tenant and the
// demo is seeded — both finish runs and email nobody entirely on purpose, and
// an alert that cannot tell those from a real miss is an alert nobody reads.
// pipeline_runs.options records sendReport as of the T1 flag snapshot.

export interface CadenceRun {
  id: string
  status: string
  /** The trigger options the run was dispatched with. */
  options: { sendReport?: boolean } | null
  completedAt: string | null
}

export interface CadenceReport {
  runId: string | null
  sentAt: string | null
}

export interface CadenceStats {
  /** Runs that finished in a reportable state AND were asked to report. */
  owed: number
  /** Of those, how many actually emailed someone. */
  delivered: number
  /** owed - delivered. Each of these is an update a client did not get. */
  missed: number
  missedRunIds: string[]
  /** 0..1, or null when nothing was owed (nothing to be reliable about). */
  rate: number | null
  /** True when NO reportable run carries trigger options at all. Every run
   *  before 2026-08-18 predates the options snapshot, so "nothing owed" and
   *  "we cannot tell what was owed" are different answers and must not read
   *  the same. */
  noHistory: boolean
}

const REPORTABLE = new Set(['completed', 'partial'])

export function cadenceReliability(runs: CadenceRun[], reports: CadenceReport[]): CadenceStats {
  const emailed = new Set(
    reports.filter((r) => r.sentAt && r.runId).map((r) => r.runId as string),
  )
  const reportable = runs.filter((r) => REPORTABLE.has(r.status))
  const owedRuns = reportable.filter((r) => r.options?.sendReport === true)
  const missedRunIds = owedRuns.filter((r) => !emailed.has(r.id)).map((r) => r.id)
  return {
    owed: owedRuns.length,
    delivered: owedRuns.length - missedRunIds.length,
    missed: missedRunIds.length,
    missedRunIds,
    rate: owedRuns.length === 0 ? null : Math.round(((owedRuns.length - missedRunIds.length) / owedRuns.length) * 1000) / 1000,
    noHistory: reportable.length > 0 && reportable.every((r) => r.options == null),
  }
}

/** One line for an operator: "delivered on schedule: 9/10". */
export function formatCadence(clientName: string, s: CadenceStats): string {
  if (s.noHistory) return `${clientName}: no run yet records what it was asked to do (measures forward from 2026-08-18)`
  if (s.rate === null) return `${clientName}: no scheduled updates owed yet`
  return `${clientName}: delivered on schedule ${s.delivered}/${s.owed}` +
    (s.missed ? ` — ${s.missed} run${s.missed === 1 ? '' : 's'} finished and emailed nobody` : '')
}
