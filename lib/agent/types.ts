// The Verbatim Agent's output contract.
//
// THE ONE RULE, and the reason these are separate keys rather than a flag on a
// single list: access is not authority. The agent may read every layer of the
// corpus, but a GROUNDED point must be traceable to insights the pipeline
// already extracted and verified, while anything the agent worked out for
// itself belongs in JUDGEMENT. A flag can be dropped in a render; a key cannot.
//
// The failure this contract guards against in BOTH directions:
//   - a proposal wearing an evidence badge (bluffing), and
//   - a real finding suppressed because it did not perfectly resolve (FALSE
//     SILENCE). Enforcement therefore DEMOTES rather than drops.

export interface GroundedPoint {
  /** Stable within one answer, so judgement can cite it. */
  id: string
  /** The sentence the reader actually reads. */
  text: string
  /** REQUIRED, non-empty, and checked against rows that still exist. This is
   *  the whole difference between grounded and judgement. */
  insightIds: string[]
  themeRefs: { themeId: string; registryId: string | null; label: string }[]
  /** Real comments. A quote carries the id it came from — an uncitable quote
   *  never reaches this register. */
  quotes: { text: string; commentId: string | null; videoId: string | null }[]
  /** Distinct source videos behind `insightIds`. Computed in code from the
   *  cited rows, never taken from the model (the 2026-08-19 lesson). */
  conversationCount: number
}

export interface JudgementPoint {
  text: string
  /** GroundedPoint ids this reasons from. REQUIRED: a proposal that cites
   *  nothing is untethered, and untethered prose is what the register exists to
   *  keep out of the evidence column. */
  basedOn: string[]
}

/** Question mode only. The corpus had nothing on what was asked, but it does
 *  have something adjacent, and saying so is more useful than a blank. Always
 *  labelled as not-what-you-asked. NEVER produced in document mode: annotating
 *  every silent claim with a tangent turns a nine-claim brief into nine
 *  tangents and makes the summary line meaningless. */
export interface NearestThing {
  text: string
  insightIds: string[]
  conversationCount: number
}

export interface AgentAnswer {
  /** Answer first. Short, direct, in the executive-brief register — this is the
   *  thing the client came for, not a preamble to it. */
  answer: string
  grounded: GroundedPoint[]
  judgement: JudgementPoint[]
  /** True when nothing survived grounding. A first-class result: the corpus
   *  genuinely does not speak to this. */
  silent: boolean
  nearest: NearestThing[]
  runId: string
  costUsd: number
}

export type AgentOutcome = 'answered' | 'partial' | 'silent'

/** answered — grounded points carried the answer, quotes and all.
 *  partial  — the answer stands, but part of it is the agent's own reasoning
 *             (including the case where real analysis was found but could not
 *             be quoted).
 *  silent   — nothing resolved at all; the corpus does not speak to this.
 *
 *  Note the deliberate gap: `grounded.length === 0` is NOT silence on its own.
 *  A question that reached real insights with no quotable evidence behind them
 *  is a partial answer, and reporting it as silence would tell a client we have
 *  nothing when we have something we simply cannot quote. */
export function outcomeOf(answer: AgentAnswer): AgentOutcome {
  if (answer.silent) return 'silent'
  return answer.grounded.length === 0 || answer.judgement.length > 0 ? 'partial' : 'answered'
}

export type QuestionIntent =
  /** Answerable from the conversation corpus. */
  | 'about_customers'
  /** About the client's own numbers (ad spend, revenue, internal metrics).
   *  The corpus cannot see these, and pretending otherwise is the fastest way
   *  to lose a client's trust in everything else on the page. */
  | 'about_our_metrics'
  /** Neither — small talk, or a question about the product itself. */
  | 'out_of_scope'

export interface QuestionPlan {
  intent: QuestionIntent
  /** The question restated in the vocabulary the CORPUS uses. Clients ask
   *  "should we run a Black Friday promo"; no theme is labelled that, and
   *  matching on the question as typed is the measured under-recall problem. */
  retrievalQueries: string[]
  /** 'trend' pulls the cross-run layers that survive pruning. Never implies
   *  that historical insight TEXT can be retrieved — it cannot. */
  timeframe: 'current' | 'trend'
}
