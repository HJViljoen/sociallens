// Pure ranking logic for the Verbatim Agent's retrieval. No I/O, no model —
// everything here is testable, and the parts that decide what a client sees
// should be.

export interface Hit {
  id: string
  similarity: number
}

export interface FusedHit {
  id: string
  /** Fusion score. Comparable within one question, meaningless across questions. */
  score: number
  /** The best cosine any single query achieved on this insight. Kept because
   *  it is the only number here that means something on its own, and the
   *  operator lever prints it. */
  bestSimilarity: number
  /** How many of the question's expanded queries found this insight. An insight
   *  several angles agree on is a better answer than one a single phrasing
   *  happened to hit. */
  matchedQueries: number
}

/** Standard RRF constant. Large enough that rank 1 and rank 2 are close, so one
 *  query cannot dominate the fused list on a single confident hit. */
const RRF_K = 60

/**
 * Reciprocal-rank fusion across the queries one question expanded into.
 *
 * Why fusion and not "take the best score": a question like "should we run a
 * Black Friday promo" expands into several queries (price sensitivity, discount
 * expectation, waiting for a sale) precisely because no single phrasing matches
 * how the corpus talks. Ranking on max similarity would let whichever query
 * happened to phrase things most like the theme labels decide the whole answer.
 * RRF asks instead: which insights do the different angles AGREE on.
 *
 * Each query's hits must already be sorted best-first (the SQL orders by
 * distance, so they are).
 */
export function fuseHits(perQuery: Hit[][], opts?: { limit?: number }): FusedHit[] {
  const acc = new Map<string, { score: number; best: number; matched: number }>()
  for (const hits of perQuery) {
    hits.forEach((hit, rank) => {
      const cur = acc.get(hit.id) ?? { score: 0, best: 0, matched: 0 }
      cur.score += 1 / (RRF_K + rank + 1)
      cur.best = Math.max(cur.best, hit.similarity)
      cur.matched += 1
      acc.set(hit.id, cur)
    })
  }
  const fused = [...acc.entries()]
    .map(([id, v]) => ({ id, score: v.score, bestSimilarity: v.best, matchedQueries: v.matched }))
    // Ties broken by id so the same corpus and the same question produce the
    // same answer ordering twice running. A client re-asking and getting a
    // reshuffled answer reads as the product being unsure.
    .sort((a, b) => b.score - a.score || b.bestSimilarity - a.bestSimilarity || a.id.localeCompare(b.id))
  const limit = opts?.limit ?? 0
  return limit > 0 ? fused.slice(0, limit) : fused
}

/**
 * How many distinct conversations sit behind a set of insights.
 *
 * "Conversations" is a fixed word in this product (lib/calibration.ts GLOSSARY)
 * and it means distinct source videos, not evidence rows — counting rows would
 * report the same discussion several times because one video yields several
 * insights. The 2026-08-19 lesson stands: this is computed in code from the
 * cited rows, never taken from the model.
 */
export function countConversations(insights: { videoId: string | null }[]): number {
  const seen = new Set<string>()
  for (const i of insights) if (i.videoId) seen.add(i.videoId)
  return seen.size
}
