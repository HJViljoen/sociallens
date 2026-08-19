import { selectAll } from '../supabase-admin'
import { ASK_REEVALUATE_MAX_CHECKS } from '../config'
import { verdictPass } from './engine'
import { diffVerdicts, summarise } from './verdicts'
import type { ClaimResult, ExtractedClaim } from './types'

// Re-test stored plans against each new run.
//
// This is the point of storing a check at all. A plan checked once is a study;
// a plan re-tested every week against fresh conversation is a live document,
// and "assumption 4 moved from untested to contradicted" is the thing worth
// coming back for.
//
// The claims are REUSED, never re-extracted. Re-reading the document with a
// model would let the claim list and its refs shift between runs, and then
// "assumption 4 moved" would be comparing two different assumption 4s. The
// document is fixed; only the conversation moves.

export interface ReevaluationResult {
  planCheckId: string
  title: string | null
  moved: { ref: string; claim: string; from: string; to: string }[]
  summary: { supported: number; contradicted: number; untested: number }
  costUsd: number
}

interface CheckRow {
  id: string
  title: string | null
  claims: ClaimResult[]
}

/**
 * Re-evaluate every stored check for a client against a run.
 *
 * Bounded by ASK_REEVALUATE_MAX_CHECKS: each check costs a synthesis call, and
 * a tenant with fifty saved plans should not quietly add fifty calls to every
 * run. Oldest checks fall out of the sweep first — a plan nobody has revisited
 * in months is not the one they are steering by.
 */
export async function reevaluatePlanChecks(
  admin: ReturnType<typeof import('../supabase-admin').createAdminClient>,
  args: { clientId: string; runId: string; runDate: string; companyName: string },
): Promise<ReevaluationResult[]> {
  const { clientId, runId, runDate, companyName } = args

  const checks = await selectAll<CheckRow>(() =>
    admin
      .from('plan_checks')
      .select('id, title, claims')
      .eq('client_id', clientId)
      .order('created_at', { ascending: false }),
  )
  if (!checks.length) return []

  const out: ReevaluationResult[] = []
  for (const check of checks.slice(0, ASK_REEVALUATE_MAX_CHECKS)) {
    const stored = Array.isArray(check.claims) ? check.claims : []
    const claims: ExtractedClaim[] = stored
      .filter((c) => c && typeof c.ref === 'string' && typeof c.claim === 'string')
      .map((c) => ({ ref: c.ref, claim: c.claim }))
    if (!claims.length) continue

    // The baseline is the most recent EVALUATION if one exists, else the answer
    // stored with the check itself — so the first re-evaluation compares
    // against the original reading rather than against nothing.
    const { data: prevEval } = await admin
      .from('plan_check_evaluations')
      .select('claims')
      .eq('plan_check_id', check.id)
      .order('run_date', { ascending: false })
      .limit(1)
      .maybeSingle()
    const previous: ClaimResult[] = Array.isArray((prevEval as { claims?: ClaimResult[] } | null)?.claims)
      ? ((prevEval as { claims: ClaimResult[] }).claims)
      : stored

    let result
    try {
      result = await verdictPass(admin, { clientId, runId, companyName, claims })
    } catch (e) {
      // One bad check must not stop the rest, and must not fail the run.
      console.error(`[ask-reevaluate] check ${check.id} failed: ${e instanceof Error ? e.message : String(e)}`)
      continue
    }

    const summary = summarise(result.claims)
    const moved = diffVerdicts(previous, result.claims)

    const { error } = await admin.from('plan_check_evaluations').upsert(
      {
        plan_check_id: check.id,
        client_id: clientId,
        run_id: runId,
        run_date: runDate,
        claims: result.claims,
        summary,
        moved,
      },
      { onConflict: 'plan_check_id,run_id' },
    )
    if (error) {
      console.error(`[ask-reevaluate] write failed for ${check.id}: ${(error as { message?: string }).message ?? error}`)
      continue
    }

    out.push({ planCheckId: check.id, title: check.title, moved, summary, costUsd: result.costUsd })
  }

  return out
}
