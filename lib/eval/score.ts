// Scoring primitives for the eval contract (Tier 1, 2026-08-18).
//
// Before this there was no ground truth anywhere in Verbatim: every calibration
// was embedding-vs-embedding, and the six existing "measurement" scripts all
// report counts or deltas, never a correctness rate. ab-pass-a can tell you
// that 18% of classifications changed between two arms; it cannot tell you
// which arm was right.
//
// Pure by design, so it unit-tests under the repo's no-network/no-DB test rule.

export interface ClassScore {
  label: string
  /** Of the items we predicted this label for, how many were right. */
  precision: number
  /** Of the items that truly are this label, how many we found. */
  recall: number
  f1: number
  /** True instances of this label in the labelled set. */
  support: number
}

export interface Scorecard {
  perClass: ClassScore[]
  /** Unweighted mean F1 across classes that have support. Unweighted on
   *  purpose: a rare-but-important class (misinformation, switching_signal)
   *  should not be drowned by a common one (praise). */
  macroF1: number
  /** Plain proportion correct. Reported because it is what people expect, and
   *  kept beside macroF1 because on a skewed label set it flatters. */
  accuracy: number
  n: number
}

export interface Prediction {
  id: string
  predicted: string
  actual: string
}

const div = (a: number, b: number) => (b === 0 ? 0 : a / b)
const r3 = (n: number) => Math.round(n * 1000) / 1000

/** Per-class precision/recall/F1 plus macro-F1 and accuracy. */
export function scorePredictions(items: Prediction[]): Scorecard {
  const labels = [...new Set(items.flatMap((i) => [i.predicted, i.actual]))].sort()
  const perClass: ClassScore[] = labels.map((label) => {
    const tp = items.filter((i) => i.predicted === label && i.actual === label).length
    const fp = items.filter((i) => i.predicted === label && i.actual !== label).length
    const fn = items.filter((i) => i.predicted !== label && i.actual === label).length
    const precision = div(tp, tp + fp)
    const recall = div(tp, tp + fn)
    return {
      label,
      precision: r3(precision),
      recall: r3(recall),
      f1: r3(div(2 * precision * recall, precision + recall)),
      support: tp + fn,
    }
  })
  const scored = perClass.filter((c) => c.support > 0)
  return {
    perClass,
    macroF1: r3(div(scored.reduce((s, c) => s + c.f1, 0), scored.length)),
    accuracy: r3(div(items.filter((i) => i.predicted === i.actual).length, items.length)),
    n: items.length,
  }
}

/**
 * Agreement between two runs over the same items — the stability half of the
 * contract. Distinct from accuracy: two runs can agree perfectly and both be
 * wrong, which is exactly why both numbers are reported.
 */
export function agreement(a: Map<string, string>, b: Map<string, string>): { agreed: number; compared: number; rate: number } {
  let agreed = 0
  let compared = 0
  for (const [id, av] of a) {
    const bv = b.get(id)
    if (bv === undefined) continue
    compared++
    if (av === bv) agreed++
  }
  return { agreed, compared, rate: r3(div(agreed, compared)) }
}

/** Render a scorecard for a terminal. */
export function formatScorecard(title: string, s: Scorecard): string {
  const rows = s.perClass
    .filter((c) => c.support > 0 || c.precision > 0)
    .map((c) => `  ${c.label.padEnd(22)} P ${c.precision.toFixed(3)}  R ${c.recall.toFixed(3)}  F1 ${c.f1.toFixed(3)}  n=${c.support}`)
  return [
    `${title}  (n=${s.n})`,
    ...rows,
    `  ${'MACRO F1'.padEnd(22)} ${s.macroF1.toFixed(3)}     accuracy ${s.accuracy.toFixed(3)}`,
  ].join('\n')
}
