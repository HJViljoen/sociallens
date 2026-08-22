import { openai } from '../openai'
import { EMBEDDING_MODEL, CLUSTER_SIMILARITY_THRESHOLD } from '../config'
import type { InsightRow } from './types'

// Step A2 clustering seam (Architecture/Analysis-Passes §Step A2). The pipeline
// only calls `clusterInsights`; the implementation behind it can swap without
// touching Step A2. v4.1 specced case-insensitive string match on the theme
// slug; the first real Ossur run showed near-zero exact collisions (free-text
// labels rarely match), so the pre-approved embedding-similarity merge is the
// default. `'string'` is retained for A/B and as a no-cost fallback.
//
// Input to clusterInsights is assumed homogeneous (one bucket + one category) —
// the caller in step-a2.ts guarantees that, so themes are only ever merged
// within a category.

export type ClusterMethod = 'embedding' | 'string'

export interface ClusterOptions {
  method?: ClusterMethod
  /** Cosine threshold for the embedding method. */
  threshold?: number
}

/** Embed texts, preserving input order. Returns [] for empty input. */
export async function embedTexts(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return []
  const res = await openai.embeddings.create({ model: EMBEDDING_MODEL, input: texts })
  // The API returns items with an `index`; sort to be order-safe.
  return [...res.data].sort((a, b) => a.index - b.index).map((d) => d.embedding)
}

export function cosine(a: number[], b: number[]): number {
  let dot = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    na += a[i] * a[i]
    nb += b[i] * b[i]
  }
  if (na === 0 || nb === 0) return 0
  return dot / (Math.sqrt(na) * Math.sqrt(nb))
}

/** Text fed to the embedder for one insight: the slug as words + its
 *  description, which carries far more semantic signal than the 2–4 word slug
 *  alone.
 *
 *  Exported because the Verbatim Agent's insight embeddings
 *  (scripts/embed-insights.ts) MUST be produced by this exact formula. Two
 *  copies of it would drift, and vectors built from different text are not
 *  comparable — a silent, invisible retrieval failure. */
export function embedInput(ins: Pick<InsightRow, 'theme' | 'description'>): string {
  return `${ins.theme.replace(/_/g, ' ')}. ${ins.description}`
}

/** Average-linkage agglomerative clustering: two clusters merge only while the
 *  AVERAGE similarity across all their cross-pairs clears the threshold.
 *
 *  Replaces the original union-find single-linkage (2026-07-11): single-linkage
 *  merges transitively on any ONE qualifying pair, and in a large bucket the
 *  generic bridge insights ("love this bag", "so beautiful") chain unrelated
 *  themes into one grab-bag — the Sealand run-1 corpus produced a 119-video
 *  "theme" that led the dashboard and inflated grounding counts. Average
 *  linkage is the standard chaining fix: one bridge pair can no longer fuse
 *  two unrelated groups. Cluster-cluster similarities update exactly via the
 *  size-weighted mean, so no pair is ever recomputed. O(n³) worst case —
 *  fine at Step A2's per-bucket sizes (≤ a few hundred insights).
 */
export function averageLinkageClusters(vecs: number[][], threshold: number): number[][] {
  const n = vecs.length
  const active: number[][] = vecs.map((_, i) => [i]) // member indices per cluster
  // sim[a][b] = average cross-pair similarity between clusters a and b.
  const sim: number[][] = vecs.map((vi) => vecs.map((vj) => cosine(vi, vj)))

  for (;;) {
    let bestA = -1
    let bestB = -1
    let bestSim = threshold
    for (let a = 0; a < active.length; a++) {
      for (let b = a + 1; b < active.length; b++) {
        if (sim[a][b] >= bestSim) {
          bestA = a
          bestB = b
          bestSim = sim[a][b]
        }
      }
    }
    if (bestA < 0) return active

    // Merge B into A; update average similarity by size-weighted mean.
    const sizeA = active[bestA].length
    const sizeB = active[bestB].length
    for (let c = 0; c < active.length; c++) {
      if (c === bestA || c === bestB) continue
      sim[bestA][c] = sim[c][bestA] = (sizeA * sim[bestA][c] + sizeB * sim[bestB][c]) / (sizeA + sizeB)
    }
    active[bestA] = active[bestA].concat(active[bestB])
    active.splice(bestB, 1)
    sim.splice(bestB, 1)
    for (const row of sim) row.splice(bestB, 1)
  }
}

/** Pairwise similarity matrix for a homogeneous group (debug/threshold tuning). */
export async function similarityMatrix(insights: InsightRow[]): Promise<number[][]> {
  const vecs = await embedTexts(insights.map(embedInput))
  return vecs.map((vi) => vecs.map((vj) => cosine(vi, vj)))
}

/**
 * Cluster a homogeneous list of insights (same bucket + category) into groups.
 * Returns arrays of the original InsightRows. A singleton stays its own group.
 */
export async function clusterInsights(
  insights: InsightRow[],
  opts: ClusterOptions = {},
): Promise<InsightRow[][]> {
  const method = opts.method ?? 'embedding'
  if (insights.length <= 1) return insights.map((i) => [i])

  if (method === 'string') {
    const byTheme = new Map<string, InsightRow[]>()
    for (const ins of insights) {
      const key = ins.theme.toLowerCase().trim()
      const g = byTheme.get(key)
      if (g) g.push(ins)
      else byTheme.set(key, [ins])
    }
    return [...byTheme.values()]
  }

  // embedding
  const threshold = opts.threshold ?? CLUSTER_SIMILARITY_THRESHOLD
  const vecs = await embedTexts(insights.map(embedInput))
  const groups = averageLinkageClusters(vecs, threshold)
  return groups.map((idxs) => idxs.map((i) => insights[i]))
}
