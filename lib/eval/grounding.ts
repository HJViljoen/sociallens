import { normForMatch } from '../pipeline/pass-a'

// Quote grounding: the one piece of ground truth Verbatim already has (Tier 1).
//
// Pass A's validateInsights requires an insight's quote to appear verbatim in
// the comment it cites, and refuses the evidence otherwise. That is a real,
// deterministic, human-independent correctness check — the product's central
// promise ("every insight traces to something someone actually said") expressed
// as an assertion. It fires often: prod ai_call_log holds 792 calls at
// validation_status 'quote_not_found' against 3,758 clean.
//
// What the pipeline does NOT do is keep what it rejected, or ever re-check what
// it accepted. This re-checks the STORED corpus: every evidence row should
// still verify against its comment. A row that does not is either drift (the
// comment was re-scraped and changed) or a hole in the check.

export interface EvidenceRow {
  id: string
  quote: string
  /** Text of the comment this evidence cites. Null when the comment is gone
   *  (retention deletes uncited stale YouTube comments; a cited one keeps its
   *  text and loses only its author). */
  commentText: string | null
}

export type GroundingVerdict = 'grounded' | 'not_found' | 'orphaned' | 'empty'

export function checkGrounding(row: EvidenceRow): GroundingVerdict {
  const needle = normForMatch(row.quote ?? '')
  if (!needle) return 'empty'
  if (row.commentText === null) return 'orphaned'
  return normForMatch(row.commentText).includes(needle) ? 'grounded' : 'not_found'
}

export interface GroundingReport {
  total: number
  grounded: number
  notFound: number
  orphaned: number
  empty: number
  /** Of the rows we could actually check, the share that verify. */
  rate: number
  /** A few failing examples, for a human to look at. */
  failures: { id: string; quote: string }[]
}

const FAILURE_EXAMPLES = 10

export function reportGrounding(rows: EvidenceRow[]): GroundingReport {
  const counts = { grounded: 0, not_found: 0, orphaned: 0, empty: 0 }
  const failures: { id: string; quote: string }[] = []
  for (const r of rows) {
    const v = checkGrounding(r)
    counts[v]++
    if (v === 'not_found' && failures.length < FAILURE_EXAMPLES) {
      failures.push({ id: r.id, quote: r.quote.slice(0, 120) })
    }
  }
  const checkable = counts.grounded + counts.not_found
  return {
    total: rows.length,
    grounded: counts.grounded,
    notFound: counts.not_found,
    orphaned: counts.orphaned,
    empty: counts.empty,
    rate: checkable === 0 ? 0 : Math.round((counts.grounded / checkable) * 1000) / 1000,
    failures,
  }
}
