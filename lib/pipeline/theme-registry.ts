import { REGISTRY_MATCH_STRONG, REGISTRY_MATCH_WEAK, THEME_MATCH_THRESHOLD, REGISTRY_DORMANT_RUNS } from '../config'

// Theme identity — the pure matching logic (shape B-lite, 2026-08-17). No I/O:
// persistThemes loads the registry, calls matchThemes, and writes the result.
//
// WHY MEMBERSHIP, NOT LABELS. Measured on two Sealand runs whose Pass A output
// was byte-identical (shape A froze it): 507 of 537 themes had an EXACTLY
// identical supporting_insight_ids set, while 48 of the 58 themes the
// label-embedding rule flagged "new" were the same theme with a new label.
// Clustering is now fully reproducible; the only nondeterminism left is the two
// gpt-5.4 calls (theme-merge picks which clusters fuse, pass-b picks the words),
// and neither accepts a temperature. So the words are the volatile part and the
// membership is the stable part — match on the stable part.

export type MatchKind = 'exact' | 'strong' | 'weak' | 'new' | 'revived'

/** A registry entry as loaded from the DB (last observation's state). */
export interface RegistryEntry {
  id: string
  bucket: string
  member_insight_ids: string[]
  embedding: number[] | null
  status: string
  canonical_label: string
}

/** A theme produced by THIS run, awaiting an identity. `key` is any caller-side
 *  handle (the themes-array index) used to map results back. */
export interface IncomingTheme {
  key: string
  bucket: string
  memberInsightIds: string[]
  label: string
  embedding: number[] | null
}

export interface MatchResult {
  key: string
  /** null = no registry entry claimed; the caller creates one. */
  themeId: string | null
  kind: MatchKind
  score: number
  /** Diagnostics only (no genealogy UI in v1): other entries that overlapped. */
  mergedFrom?: string[]
  splitFrom?: string
}

export interface MatchOptions {
  strong?: number
  weak?: number
  cosineFloor?: number
  /** Injected so this module stays free of the embedding/OpenAI import chain. */
  cosine?: (a: number[], b: number[]) => number
}

/** |A ∩ B| / |A ∪ B| over id sets. 1.0 = the same insights exactly. */
export function jaccard(a: string[], b: string[]): number {
  if (a.length === 0 && b.length === 0) return 0
  const A = new Set(a)
  let inter = 0
  for (const id of new Set(b)) if (A.has(id)) inter++
  const union = A.size + new Set(b).size - inter
  return union === 0 ? 0 : inter / union
}

interface Candidate {
  key: string
  entryId: string
  score: number
  kind: MatchKind
  overlapped: string[]
}

/**
 * Assign each incoming theme a registry identity.
 *
 * Rules, in order (per bucket — matching never crosses entity buckets):
 *   1. Jaccard >= strong  → same theme (the exact-set case scores 1.0)
 *   2. Jaccard >= weak AND label cosine >= cosineFloor → same theme (the
 *      split/merge band, where both signals must agree)
 *   3. otherwise → new entry
 *
 * Assignment is GREEDY by descending score and each registry entry can be
 * claimed at most once per run: when a cluster splits in two, the larger half
 * continues the time series and the smaller opens a fresh entry (reported with
 * `splitFrom`), rather than both claiming the same identity.
 */
export function matchThemes(
  incoming: IncomingTheme[],
  registry: RegistryEntry[],
  opts: MatchOptions = {},
): MatchResult[] {
  const strong = opts.strong ?? REGISTRY_MATCH_STRONG
  const weak = opts.weak ?? REGISTRY_MATCH_WEAK
  const cosineFloor = opts.cosineFloor ?? THEME_MATCH_THRESHOLD
  const cosine = opts.cosine

  const byBucket = new Map<string, RegistryEntry[]>()
  for (const e of registry) {
    const arr = byBucket.get(e.bucket)
    if (arr) arr.push(e)
    else byBucket.set(e.bucket, [e])
  }

  // 1. Score every (theme, entry) pair that shares at least one insight.
  const candidates: Candidate[] = []
  const overlapByKey = new Map<string, string[]>()
  for (const t of incoming) {
    const entries = byBucket.get(t.bucket) ?? []
    const overlapped: string[] = []
    for (const e of entries) {
      const j = jaccard(t.memberInsightIds, e.member_insight_ids)
      if (j <= 0) continue
      overlapped.push(e.id)
      if (j >= strong) {
        candidates.push({ key: t.key, entryId: e.id, score: j, kind: j >= 1 ? 'exact' : 'strong', overlapped: [] })
      } else if (j >= weak && cosine && t.embedding && e.embedding) {
        // The ambiguous band: membership alone is not enough, so the words have
        // to agree too before we continue someone's time series.
        if (cosine(t.embedding, e.embedding) >= cosineFloor) {
          candidates.push({ key: t.key, entryId: e.id, score: j, kind: 'weak', overlapped: [] })
        }
      }
    }
    overlapByKey.set(t.key, overlapped)
  }

  // 2. Greedy assignment: best score first, one entry per theme, one theme per
  //    entry. Ties break on entry id so a rerun is deterministic.
  candidates.sort((a, b) => b.score - a.score || a.entryId.localeCompare(b.entryId) || a.key.localeCompare(b.key))
  const takenEntry = new Set<string>()
  const assigned = new Map<string, Candidate>()
  for (const c of candidates) {
    if (assigned.has(c.key) || takenEntry.has(c.entryId)) continue
    assigned.set(c.key, c)
    takenEntry.add(c.entryId)
  }

  const dormantById = new Map(registry.map((e) => [e.id, e.status === 'dormant']))
  return incoming.map((t) => {
    const c = assigned.get(t.key)
    const overlapped = overlapByKey.get(t.key) ?? []
    if (!c) {
      // No identity claimed. If it overlapped entries that someone else took,
      // it is the smaller half of a split — recorded, but still a new theme.
      const splitFrom = overlapped.find((id) => takenEntry.has(id))
      return { key: t.key, themeId: null, kind: 'new' as MatchKind, score: 0, ...(splitFrom ? { splitFrom } : {}) }
    }
    const others = overlapped.filter((id) => id !== c.entryId)
    return {
      key: t.key,
      themeId: c.entryId,
      kind: dormantById.get(c.entryId) ? ('revived' as MatchKind) : c.kind,
      score: c.score,
      ...(others.length ? { mergedFrom: others } : {}),
    }
  })
}

/** Registry entries to mark dormant: active, and not seen in the last
 *  `dormantAfter` themed runs. `recentRunIds` is newest-first. */
export function dormantIds(
  registry: { id: string; last_seen_run_id: string | null; status: string }[],
  recentRunIds: string[],
  dormantAfter: number = REGISTRY_DORMANT_RUNS,
): string[] {
  const window = new Set(recentRunIds.slice(0, dormantAfter))
  return registry
    .filter((e) => e.status === 'active' && (!e.last_seen_run_id || !window.has(e.last_seen_run_id)))
    .map((e) => e.id)
}

/** Run-level tally for the persist step's result and the operator script. */
export function matchTally(results: MatchResult[]): Record<MatchKind, number> {
  const t: Record<MatchKind, number> = { exact: 0, strong: 0, weak: 0, new: 0, revived: 0 }
  for (const r of results) t[r.kind]++
  return t
}
