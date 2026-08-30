import type { ScheduleCadence } from './types'

/** Calendar month of an instant in a timezone, as "YYYY-MM". */
export function monthKey(iso: string, tz: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit' }).format(new Date(iso))
}

/**
 * Whether a schedule fires for the update dated `runDate`. A schedule never has
 * its own clock — it rides the scheduled update (pipeline/run.requested with
 * sendReport), so "every update" is simply "active", and "monthly" is "active
 * and nothing sent yet in this calendar month" (SAST, like the scheduler).
 */
export function scheduleDue(
  s: { cadence: ScheduleCadence; active: boolean },
  lastSentAt: string | null,
  runDate: string,
  tz = 'Africa/Johannesburg',
): boolean {
  if (!s.active) return false
  if (s.cadence === 'every_update') return true
  if (!lastSentAt) return true
  return monthKey(lastSentAt, tz) !== monthKey(runDate, tz)
}
