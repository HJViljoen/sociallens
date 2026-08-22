// The Ask engine's contract.
//
// THREE REGISTERS, and the separation is structural rather than a flag:
//
//   ClaimResult   GROUNDED. A verdict, a count, the themes and insight ids
//                 behind it. Nothing in here is the model's opinion.
//   Judgement     THE MODEL'S OWN PROPOSAL, marked as such and citing the claim
//                 refs it reasons from. It may propose, infer and recommend
//                 freely — it may not pose as evidence.
//   'silent'      A FIRST-CLASS VERDICT. "The conversation does not speak to
//                 this" is an answer, not a gap to fill.
//
// A flag on one list would let a careless render merge them; separate types
// mean the grounded panel cannot accidentally print a proposal.

export type Verdict = 'echoes' | 'contradicts' | 'silent'

export const VERDICTS: readonly Verdict[] = ['echoes', 'contradicts', 'silent'] as const

/** A theme the verdict rests on. `registryId` is the cross-run key — the one a
 *  later re-evaluation can still resolve after labels churn. */
export interface ThemeRef {
  themeId: string
  registryId: string | null
  label: string
}

export interface ClaimResult {
  /** C1, C2 … — stable within one check, and how judgement cites back. */
  ref: string
  /** The claim as extracted from the submission, in the author's own terms. */
  claim: string
  verdict: Verdict
  /** What the conversation actually says on this subject. Null when silent —
   *  enforced in code, never trusted to the model. */
  theySay: string | null
  /** Distinct source videos behind the verdict. A conversation is one video and
   *  the comments it sparked (lib/calibration.ts), so this is the honest unit. */
  conversationCount: number
  themeRefs: ThemeRef[]
  /** Grounding for live quote resolution. No quote text is stored. */
  insightIds: string[]
  /** The document sentence this claim came from, verbatim. Null when the claim
   *  is implied rather than written — which the annotated view says out loud,
   *  because "your plan rests on this and never states it" is worth knowing. */
  source?: string | null
}

export interface Judgement {
  text: string
  /** Which claims this proposal reasons from. A judgement citing nothing is
   *  still allowed — it is visibly the model's own view either way — but the
   *  refs are what let a reader check the reasoning against the evidence. */
  basedOnRefs: string[]
}

export interface AskSummary {
  supported: number
  contradicted: number
  untested: number
}

export interface AskResult {
  claims: ClaimResult[]
  summary: AskSummary
  judgement: Judgement[]
  costUsd: number
}

/** One claim as extracted from the submission, before any verdict. */
export interface ExtractedClaim {
  ref: string
  claim: string
  /** The sentence in the document this was drawn from, verbatim — or null when
   *  the claim is implied rather than stated. Never trusted: it is checked
   *  against the document text before it is used to highlight anything. */
  source?: string | null
}
