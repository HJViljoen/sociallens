/**
 * Delta honesty (Tier 0 T0-8, 2026-08-18): a proportion that moved between two
 * updates is only "moved" when the difference clears a band, and only when
 * both sides have enough judged items to mean anything.
 *
 * Why: the sent subject "sentiment up 6.2 pts" compared n=129 vs n=414 judged
 * videos (z ≈ 1.7, not significant); LLM re-judgment alone moves an identical
 * corpus ±1.7 pts; and the 08-16 classify-meta reorder changed the population
 * being judged. Arrows on that are noise sold as news.
 *
 * Pure: shared by the email, the dashboard and tests.
 */

export type DeltaState = 'moved' | 'no_clear_change' | 'too_little_data'

export interface DeltaVerdict {
  state: DeltaState
  /** now − prev, in percentage points (1 dp). */
  change: number
  /** Half-width of the no-change band, in points (1 dp). */
  band: number
}

export interface ProportionSides {
  /** Percentages, 0–100. */
  nowPct: number
  prevPct: number
  /** Denominators (items judged / total tracked). */
  nowN: number
  prevN: number
  /** Optional numerator counts (e.g. the client's own videos in a share) with
   *  their own floor — a 3-of-40 share is not a share. */
  nowK?: number
  prevK?: number
}

export interface BandOptions {
  /** Minimum denominator on EACH side. */
  minN: number
  /** Minimum numerator on each side when nowK/prevK are given. */
  minK?: number
  /** Floor for the band half-width, in points. */
  minBandPts: number
}

/** Sentiment shares: ≥ 100 judged videos per side, band = max(2×SE, 2 pts). */
export const SENTIMENT_BAND: BandOptions = { minN: 100, minBandPts: 2 }
/** Share of tracked videos: ≥ 100 tracked per side and ≥ 10 of the entity's own. */
export const SHARE_BAND: BandOptions = { minN: 100, minK: 10, minBandPts: 2 }

const round1 = (n: number) => Math.round(n * 10) / 10

/**
 * Two-proportion difference with a 2×SE band (≈ 95%), floored at minBandPts.
 * SE = sqrt(p1(1−p1)/n1 + p2(1−p2)/n2).
 */
export function proportionDelta(sides: ProportionSides, opts: BandOptions): DeltaVerdict {
  const change = round1(sides.nowPct - sides.prevPct)
  const thin =
    sides.nowN < opts.minN ||
    sides.prevN < opts.minN ||
    (opts.minK != null && ((sides.nowK ?? Infinity) < opts.minK || (sides.prevK ?? Infinity) < opts.minK))
  const p1 = Math.min(1, Math.max(0, sides.nowPct / 100))
  const p2 = Math.min(1, Math.max(0, sides.prevPct / 100))
  const se =
    sides.nowN > 0 && sides.prevN > 0
      ? Math.sqrt((p1 * (1 - p1)) / sides.nowN + (p2 * (1 - p2)) / sides.prevN) * 100
      : Infinity
  const band = round1(Math.max(2 * se, opts.minBandPts))
  if (thin) return { state: 'too_little_data', change, band: Number.isFinite(band) ? band : opts.minBandPts }
  return { state: Math.abs(change) > band ? 'moved' : 'no_clear_change', change, band }
}
