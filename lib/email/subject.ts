import type { RunDelta } from '../report-delta'

/** Carried from the weekly email: the subject names the movement when there
 *  is any, else it is simply the update. Pure — the renderer lives in
 *  digest.tsx, which pulls the page registry in and is not for unit tests. */
export function digestSubject(company: string, delta: RunDelta | null | undefined, cadenceWord = 'weekly'): string {
  if (!delta) return `${company}: your consumer intelligence baseline`
  const bits: string[] = []
  if (delta.newThemes && delta.newThemes.count > 0) {
    const n = delta.newThemes.count
    bits.push(`${n} new theme${n === 1 ? '' : 's'}`)
  }
  if (delta.sentiment && delta.sentiment.verdict.state === 'moved') {
    const s = delta.sentiment.verdict.change
    bits.push(`sentiment ${s > 0 ? 'up' : 'down'} ${Math.abs(Math.round(s * 10) / 10)} pts`)
  }
  return bits.length ? `${company}: what changed. ${bits.join(', ')}` : `${company}: your ${cadenceWord} update`
}
