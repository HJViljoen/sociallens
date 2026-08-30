import type { SupabaseClient } from '@supabase/supabase-js'
import { verdictPass } from '../../ask/engine'
import type { WriterOutput } from './write'

/**
 * The self-check (decision 13, built 2026-08-31): each written finding's
 * CLAIM, its headline, goes through the document-check engine's verdict pass
 * as if a client had asserted it. The conversation echoes it, is silent on
 * it, or contradicts it. A contradicted finding is dropped and the build is
 * flagged for review; silent is ignored, because the theme-level check is
 * coarser than the agent's retrieval that produced the finding.
 *
 * Why the headline and not the paragraphs: the first run on Össur dropped a
 * true finding because one side sentence in "what we saw" (about friction
 * being about access rather than failure) drew a contradiction while the
 * headline's own claims echoed. The paragraphs restate grounded points the
 * agent already cited; the headline is the claim the brief makes. One
 * verdict call for all findings (≈ 20 s, cents), no extraction, no judgement.
 */

export type CheckVerdict = 'echoes' | 'contradicts' | 'silent'

export interface FindingVerdict {
  headline: string
  verdict: CheckVerdict
  /** What the audience says where the check disagrees, in the engine's words. */
  theySay: string | null
}

export interface CheckResult {
  verdicts: FindingVerdict[]
  dropped: { headline: string; reason: string }[]
  flagged: boolean
  costUsd: number
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
  const findings = (args.written.findings ?? []).filter((f) => f.headline.trim())
  if (!findings.length) return { verdicts: [], dropped: [], flagged: false, costUsd: 0, written: args.written }
  const claims = findings.map((f, i) => ({ ref: `C${i + 1}`, claim: f.headline.replace(/\[\[[a-z0-9_]+\]\]/gi, 'many').trim(), source: null }))
  let verdicts: FindingVerdict[]
  let costUsd = 0
  try {
    const out = await verdictPass(admin, { clientId: args.clientId, runId: args.runId, companyName: args.companyName, claims, persist: true })
    costUsd = out.costUsd
    const byRef = new Map(out.claims.map((c) => [c.ref, c]))
    verdicts = findings.map((f, i) => {
      const c = byRef.get(`C${i + 1}`)
      return { headline: f.headline, verdict: (c?.verdict as CheckVerdict | undefined) ?? 'silent', theySay: c?.verdict === 'contradicts' ? (c.theySay ?? null) : null }
    })
  } catch (e) {
    console.error('[documents/check] the verdict pass failed; findings kept unchecked:', e)
    verdicts = findings.map((f) => ({ headline: f.headline, verdict: 'silent', theySay: null }))
  }
  const applied = applyCheck(args.written, verdicts)
  return { verdicts, dropped: applied.dropped, flagged: applied.flagged, costUsd, written: applied.written }
}
