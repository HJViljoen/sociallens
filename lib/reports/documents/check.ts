import type { SupabaseClient } from '@supabase/supabase-js'
import { runAsk } from '../../ask/engine'
import type { WriterOutput } from './write'

/**
 * The self-check (decision 13, built 2026-08-31): each written finding goes
 * back through the document-check engine (`runAsk`, kind 'plan') as if it
 * were a claim a client had made. The conversation either echoes it, is
 * silent on it, or contradicts it. A contradicted finding is dropped and the
 * build is flagged for review; silent is ignored, because the theme-level
 * check is coarser than the agent's retrieval that produced the finding.
 * ≈ one extract + one verdict + one judgement call per finding, in parallel.
 */

export type CheckVerdict = 'echoes' | 'contradicts' | 'silent'

export interface FindingVerdict {
  headline: string
  verdict: CheckVerdict
  /** What the audience says where the check disagrees, in the engine's words. */
  theySay: string | null
  claims: number
}

export interface CheckResult {
  verdicts: FindingVerdict[]
  dropped: { headline: string; reason: string }[]
  flagged: boolean
  costUsd: number
}

/** A finding's verdict from its claims': one contradiction is a contradiction;
 *  else one echo is an echo; else silent. */
export function foldVerdicts(claims: { verdict: CheckVerdict; theySay?: string | null }[]): { verdict: CheckVerdict; theySay: string | null } {
  const contra = claims.find((c) => c.verdict === 'contradicts')
  if (contra) return { verdict: 'contradicts', theySay: contra.theySay ?? null }
  if (claims.some((c) => c.verdict === 'echoes')) return { verdict: 'echoes', theySay: null }
  return { verdict: 'silent', theySay: null }
}

/** Apply verdicts to the writer's output: contradicted findings leave, with
 *  the reason on record. Pure. */
export function applyCheck(written: WriterOutput, verdicts: FindingVerdict[]): { written: WriterOutput; dropped: CheckResult['dropped']; flagged: boolean } {
  const byHeadline = new Map(verdicts.map((v) => [v.headline, v]))
  const dropped: CheckResult['dropped'] = []
  const findings = (written.findings ?? []).filter((f) => {
    const v = byHeadline.get(f.headline)
    if (v?.verdict !== 'contradicts') return true
    dropped.push({ headline: f.headline, reason: v.theySay ? `the conversation contradicts it: ${v.theySay}` : 'the conversation contradicts it' })
    return false
  })
  return { written: { ...written, findings }, dropped, flagged: dropped.length > 0 }
}

export async function checkDocument(
  admin: SupabaseClient,
  args: { clientId: string; runId: string; companyName: string; written: WriterOutput },
): Promise<CheckResult & { written: WriterOutput }> {
  const findings = args.written.findings ?? []
  const verdicts = await Promise.all(findings.map(async (f): Promise<FindingVerdict> => {
    const text = `${f.headline}\n\n${f.saw}`.replace(/\[\[[a-z0-9_]+\]\]/gi, 'a number of')
    try {
      const res = await runAsk(admin, { clientId: args.clientId, runId: args.runId, kind: 'plan', text, companyName: args.companyName, persist: true })
      const folded = foldVerdicts(res.claims.map((c) => ({ verdict: c.verdict as CheckVerdict, theySay: (c as { theySay?: string | null }).theySay ?? null })))
      return { headline: f.headline, ...folded, claims: res.claims.length, costUsd: res.costUsd } as FindingVerdict & { costUsd: number }
    } catch (e) {
      console.error('[documents/check] a finding could not be checked:', e)
      return { headline: f.headline, verdict: 'silent', theySay: null, claims: 0 }
    }
  }))
  const costUsd = verdicts.reduce((s, v) => s + ((v as { costUsd?: number }).costUsd ?? 0), 0)
  const clean = verdicts.map(({ headline, verdict, theySay, claims }) => ({ headline, verdict, theySay, claims }))
  const applied = applyCheck(args.written, clean)
  return { verdicts: clean, dropped: applied.dropped, flagged: applied.flagged, costUsd, written: applied.written }
}
