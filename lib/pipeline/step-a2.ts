import { createAdminClient, selectAll } from '../supabase-admin'
import { EVIDENCE_FLOOR, CLUSTER_SIMILARITY_THRESHOLD, MEGA_CLUSTER_MIN, MEGA_CLUSTER_SHARE } from '../config'
import { clusterInsights, type ClusterMethod } from './cluster'
import { mergeClusterLabels } from './theme-merge'
import type { InsightRow, AggregatedTheme } from './types'

// Step A2 — theme aggregation (Architecture/Analysis-Passes §Step A2). No new
// GPT call (one cheap embeddings call inside the clustering seam). Buckets Pass A
// insights by entity, clusters within the bucket, and rolls each cluster up into
// an AggregatedTheme. Two Redesign-Spec §8 fixes (2026-07-03):
//   (a) clustering is bucket-level, not (bucket, category) — one concern that
//       Pass A split across categories (e.g. a cost pain_point and a cost
//       question) re-stitches into one theme; the theme's category is the mode
//       of its members'.
//   (b) themes below the evidence floor are KEPT and flagged singleSource
//       ("Early signals" on the pages) instead of silently dropped. Pass C/D
//       still consume only floor-passing themes.
// Themes are persisted per run via lib/pipeline/themes.ts (labels from Pass B,
// first_seen from mini theme-matching); the in-memory result stays the working
// currency for Pass C/D.

export interface RunStepA2Options {
  clientId: string
  runId: string
  method?: ClusterMethod
  threshold?: number
  /** Min distinct supporting videos for a theme to survive. Default EVIDENCE_FLOOR. */
  evidenceFloor?: number
  /** LLM label-merge pass after clustering (theme-merge.ts). Default ON;
   *  scripts disable it for A/B against raw clustering. */
  merge?: boolean
  /** Model override for the merge pass (offline A/B). */
  mergeModel?: string
  /** Write merge calls to ai_call_log — the pipeline path sets this. */
  logCalls?: boolean
}

export interface StepA2Result {
  runId: string
  totalInsights: number
  totalClusters: number
  /** Floor-passing themes — the Pass C/D input. */
  themes: AggregatedTheme[]
  /** Below-floor themes, kept + flagged singleSource ("Early signals"). */
  earlySignals: AggregatedTheme[]
  /** Label-merge pass outcome (empty/zero when the pass is off). */
  mergesApplied: { bucket: string; members: string[]; reason: string }[]
  mergeCostUsd: number
}

/** A homogeneous (one bucket) group of insights — the unit clustering operates
 *  on. Exported so the debug inspector can reuse the exact same grouping the
 *  pipeline uses. */
export interface InsightGroup {
  bucket: string
  insights: InsightRow[]
}

function bucketOf(v: { is_client: boolean; is_competitor: boolean; competitor_name: string | null }): string {
  if (v.is_client) return 'client'
  if (v.is_competitor) return `competitor:${v.competitor_name ?? 'unknown'}`
  return 'industry-other'
}

/** Most frequent value, ties broken by first-seen order. */
function mode(values: string[]): string {
  const counts = new Map<string, number>()
  let best = values[0] ?? ''
  let bestN = 0
  for (const v of values) {
    const n = (counts.get(v) ?? 0) + 1
    counts.set(v, n)
    if (n > bestN) {
      bestN = n
      best = v
    }
  }
  return best
}

function aggregate(cluster: InsightRow[], bucket: string): AggregatedTheme {
  // Working slug = highest-strength member's; the client-facing label comes
  // from Pass B. Category = mode of the members' (bucket-level clustering can
  // legitimately merge across categories).
  const canonical = cluster.reduce((a, b) => (b.strength_score > a.strength_score ? b : a))
  const supportingVideoIds = [...new Set(cluster.map((i) => i.source_video_id))]
  const byStrength = [...cluster].sort((a, b) => b.strength_score - a.strength_score)
  return {
    bucket,
    category: mode(cluster.map((i) => i.category)),
    theme: canonical.theme,
    memberThemes: [...new Set(cluster.map((i) => i.theme))],
    supportingVideoIds,
    supportingInsightIds: cluster.map((i) => i.id),
    evidenceCount: supportingVideoIds.length,
    strengthScore: canonical.strength_score,
    dominantEmotion: mode(cluster.map((i) => i.emotion)),
    dominantSentimentImpact: mode(cluster.map((i) => i.sentiment_impact)),
    singleSource: false,
    sampleDescriptions: byStrength.slice(0, 2).map((i) => i.description),
  }
}

/** A run's insight corpus: bucket groups plus the distinct-video count — the
 *  corpus-scale denominator A2 consumers (mega-cluster tripwire) need. */
export interface InsightCorpus {
  groups: InsightGroup[]
  distinctVideoCount: number
}

/**
 * Load a run's Pass A insights, attach each one's entity bucket (derived from
 * its source video), and group by (bucket, category). Shared by runStepA2, the
 * per-bucket pipeline step and the debug inspector so all see identical grouping.
 */
export async function loadGroupedInsights(clientId: string, runId: string): Promise<InsightCorpus> {
  const admin = createAdminClient()

  // 1. Pull the corpus's CURRENT insights (paginated past the 1000-row cap).
  //    Incremental Pass A (2026-08-17): insights outlive runs — a video's
  //    current rows are the ones its videos.analyzed_run_id names, which is
  //    exactly what the audience_insights_current view returns. This run's
  //    Pass A already moved the pointer for every video it re-read, so the
  //    view is "this run's analysis of the whole corpus" (runId is kept for
  //    the callers' labels/logging only).
  const insightsBase = await selectAll<{
    id: string; category: string; theme: string; description: string
    strength_score: number; emotion: string | null; sentiment_impact: string | null
    source_video_id: string; platform: string
  }>(() =>
    admin
      .from('audience_insights_current')
      .select('id, category, theme, description, strength_score, emotion, sentiment_impact, source_video_id, platform')
      .eq('client_id', clientId)
      .order('id', { ascending: true }),
  )
  void runId

  // 2. Fetch the referenced videos for entity flags; join in code (avoids
  //    PostgREST FK-name ambiguity on source_video_id).
  const videoIds = [...new Set(insightsBase.map((i) => i.source_video_id).filter(Boolean))]
  const videoEntity = new Map<string, { is_client: boolean; is_competitor: boolean; competitor_name: string | null }>()
  if (videoIds.length) {
    const videos = await selectAll<{ id: string; is_client: boolean; is_competitor: boolean; competitor_name: string | null }>(() =>
      admin
        .from('videos')
        .select('id, is_client, is_competitor, competitor_name')
        .in('id', videoIds)
        .order('id', { ascending: true }),
    )
    for (const v of videos) {
      videoEntity.set(v.id, { is_client: v.is_client, is_competitor: v.is_competitor, competitor_name: v.competitor_name })
    }
  }

  const insights: InsightRow[] = insightsBase.map((i) => {
    const ent = videoEntity.get(i.source_video_id) ?? { is_client: false, is_competitor: false, competitor_name: null }
    return { ...i, ...ent } as InsightRow
  })

  // 3. Group by bucket (Spec §8: bucket-level clustering, categories merge).
  const groups = new Map<string, InsightGroup>()
  for (const ins of insights) {
    const bucket = bucketOf(ins)
    const g = groups.get(bucket)
    if (g) g.insights.push(ins)
    else groups.set(bucket, { bucket, insights: [ins] })
  }
  return { groups: [...groups.values()], distinctVideoCount: videoIds.length }
}

interface ProcessGroupOptions {
  clientId: string
  runId: string
  method?: ClusterMethod
  threshold?: number
  evidenceFloor: number
  merge: boolean
  mergeModel?: string
  logCalls?: boolean
}

interface ProcessGroupResult {
  /** Both tiers, singleSource flagged; unsorted — callers sort across buckets. */
  themes: AggregatedTheme[]
  mergesApplied: StepA2Result['mergesApplied']
  mergeCostUsd: number
}

// One bucket's slice of Step A2: cluster, label-merge same-concern clusters
// (teardown defect 3 — embeddings alone leave the same finding fragmented),
// roll up to aggregated themes, flag the evidence-floor tier. Shared by
// runStepA2 and runStepA2Bucket so the whole-run and per-bucket-step paths
// cannot drift.
/** Scale-aware mega-cluster threshold: the warn line for one theme's distinct
 *  supporting videos, given the run's distinct insight-bearing videos. */
export function megaClusterThreshold(distinctVideoCount: number): number {
  return Math.max(MEGA_CLUSTER_MIN, MEGA_CLUSTER_SHARE * distinctVideoCount)
}

/** True when a theme's evidence span reads as clustering chaining, not a real
 *  consumer concern. Replaces the bare `> 40` literal (recalibrated 2026-08-09:
 *  a fixed 40 false-alarms at run-2 scale — the 64-video "admiration for
 *  resilience" theme was coherent and legitimate at a 385-video denominator). */
export function isMegaCluster(evidenceCount: number, distinctVideoCount: number): boolean {
  return evidenceCount > megaClusterThreshold(distinctVideoCount)
}

async function processGroup(
  grp: InsightGroup,
  distinctVideoCount: number,
  callIndex: number,
  opts: ProcessGroupOptions,
): Promise<ProcessGroupResult> {
  const { clientId, runId, method, threshold } = opts
  let clusters = await clusterInsights(grp.insights, { method, threshold })
  const mergesApplied: StepA2Result['mergesApplied'] = []
  let mergeCostUsd = 0
  if (opts.merge) {
    const m = await mergeClusterLabels({
      clientId, runId, bucket: grp.bucket, clusters,
      model: opts.mergeModel, logCall: opts.logCalls, callIndex,
    })
    clusters = m.clusters
    mergeCostUsd += m.costUsd
    for (const a of m.applied) mergesApplied.push({ bucket: grp.bucket, ...a })
  }
  const themes: AggregatedTheme[] = []
  for (const cluster of clusters) {
    const theme = aggregate(cluster, grp.bucket)
    // Grab-bag tripwire: no genuine single consumer concern spans this share
    // of the corpus. A hit means the clustering is chaining again (the
    // 119-video run-1 blob) — investigate, don't ship quietly.
    if (isMegaCluster(theme.evidenceCount, distinctVideoCount)) {
      console.warn(`[a2] suspicious mega-cluster: [${grp.bucket}] "${theme.theme}" spans ${theme.evidenceCount} videos / ${theme.memberThemes.length} member slugs (threshold ${megaClusterThreshold(distinctVideoCount).toFixed(0)} at ${distinctVideoCount} distinct insight videos)`)
    }
    // Evidence floor as a TIER, not a cut (Spec §8): below-floor themes are
    // flagged singleSource and surface as "Early signals".
    theme.singleSource = theme.evidenceCount < opts.evidenceFloor
    themes.push(theme)
  }
  return { themes, mergesApplied, mergeCostUsd }
}

export async function runStepA2(opts: RunStepA2Options): Promise<StepA2Result> {
  const { clientId, runId, method, threshold } = opts
  const floor = opts.evidenceFloor ?? EVIDENCE_FLOOR
  const merge = opts.merge ?? true

  const { groups, distinctVideoCount } = await loadGroupedInsights(clientId, runId)
  const totalInsights = groups.reduce((s, g) => s + g.insights.length, 0)

  // Per-bucket processing (processGroup); merged singles clearing the evidence
  // floor is the point: the finding was heard once per video, many times
  // across the corpus.
  const all: AggregatedTheme[] = []
  const mergesApplied: StepA2Result['mergesApplied'] = []
  let mergeCostUsd = 0
  let callIndex = 0
  for (const grp of groups) {
    if (merge) callIndex++
    const r = await processGroup(grp, distinctVideoCount, callIndex, {
      clientId, runId, method, threshold,
      evidenceFloor: floor, merge, mergeModel: opts.mergeModel, logCalls: opts.logCalls,
    })
    all.push(...r.themes)
    mergesApplied.push(...r.mergesApplied)
    mergeCostUsd += r.mergeCostUsd
  }

  // Only floor-passing themes feed Pass C/D. Sort by strength desc.
  all.sort((a, b) => b.strengthScore - a.strengthScore)
  const themes = all.filter((t) => !t.singleSource)
  const earlySignals = all.filter((t) => t.singleSource)

  return {
    runId,
    totalInsights,
    totalClusters: all.length,
    themes,
    earlySignals,
    mergesApplied,
    mergeCostUsd,
  }
}

export interface RunStepA2BucketOptions {
  clientId: string
  runId: string
  /** Entity bucket this call owns (from the plan-themes step's bucket list). */
  bucket: string
  /** 1-based position in the run's bucket list — keeps ai_call_log's
   *  theme_merge callIndex stable across the per-bucket fan-out. */
  callIndex: number
  method?: ClusterMethod
  threshold?: number
  evidenceFloor?: number
  merge?: boolean
  mergeModel?: string
  logCalls?: boolean
}

export interface StepA2BucketResult {
  bucket: string
  insightCount: number
  /** Both tiers, singleSource flagged; the cross-bucket strength sort happens
   *  where the buckets recombine (the pass-b step). */
  themes: AggregatedTheme[]
  mergesApplied: StepA2Result['mergesApplied']
  mergeCostUsd: number
}

/** One bucket's Step A2 — the per-bucket Inngest step body. Reloads the corpus
 *  itself (cheap DB reads, no cross-step payload) so the step stays
 *  self-contained and replayable. A bucket missing on reload throws — the run
 *  fails loudly rather than synthesizing over a silently smaller theme set
 *  (unreachable with per-client concurrency 1; Inngest retries cover a
 *  transient read first). */
export async function runStepA2Bucket(opts: RunStepA2BucketOptions): Promise<StepA2BucketResult> {
  const { groups, distinctVideoCount } = await loadGroupedInsights(opts.clientId, opts.runId)
  const grp = groups.find((g) => g.bucket === opts.bucket)
  if (!grp) throw new Error(`[a2] bucket "${opts.bucket}" missing on reload for run ${opts.runId}`)
  const r = await processGroup(grp, distinctVideoCount, opts.callIndex, {
    clientId: opts.clientId, runId: opts.runId, method: opts.method, threshold: opts.threshold,
    evidenceFloor: opts.evidenceFloor ?? EVIDENCE_FLOOR, merge: opts.merge ?? true,
    mergeModel: opts.mergeModel, logCalls: opts.logCalls,
  })
  return { bucket: grp.bucket, insightCount: grp.insights.length, themes: r.themes, mergesApplied: r.mergesApplied, mergeCostUsd: r.mergeCostUsd }
}

export { CLUSTER_SIMILARITY_THRESHOLD }
