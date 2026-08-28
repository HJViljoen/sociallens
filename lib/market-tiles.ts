// Pure shaping for the one-screen Market Intelligence page (the decision
// ledger). Everything here takes rows the page fetched and returns display-
// ready structure — no I/O, no React — so it is tested in
// lib/market-tiles.test.ts. Scores gate and order but are never shown as
// numbers: the page renders the evidence words ("Strong evidence" / "Early
// signal") that lib/curation assigns.

import { CURATION_GATE, gateTier, type GateTier } from './curation'

// ── recommendations: the agenda ───────────────────────────────────────────

export interface RecLike {
  id: string
  priority: string | null
  based_on: { insight_ids?: string[] } | null
}

export interface InsightLike {
  id: string
  evidence: { supporting_theme_ids?: string[]; supporting_competitive_insight_ids?: string[] } | null
  confidence_score: number | null
}

export interface CompetitiveLike {
  id: string
  evidence: { supporting_theme_ids?: string[] } | null
  impact_level: string | null
}

const PRIORITY_RANK: Record<string, number> = { high: 0, medium: 1, low: 2 }

/** Distinct references (themes + competitive insights) behind a market insight. */
export const insightSourceCount = (mi: InsightLike): number =>
  (mi.evidence?.supporting_theme_ids?.length ?? 0) + (mi.evidence?.supporting_competitive_insight_ids?.length ?? 0)

/** Curation tier per market insight id (lib/curation, never the model's word). */
export function insightTiers(insights: InsightLike[]): Map<string, GateTier> {
  return new Map(insights.map((mi) => [mi.id, gateTier(mi.confidence_score, insightSourceCount(mi))]))
}

/** Competitive insights carry no confidence score: a high-impact one clearing
 *  the confirmed source floor counts as confirmed ground for a recommendation. */
export function confirmedCompetitiveIds(competitive: CompetitiveLike[]): Set<string> {
  return new Set(
    competitive
      .filter((c) => c.impact_level === 'high' && (c.evidence?.supporting_theme_ids?.length ?? 0) >= CURATION_GATE.confirmedMinSources)
      .map((c) => c.id),
  )
}

/** The evidence word a recommendation earns from the insights behind it:
 *  confirmed when any ground insight is confirmed (or a confirmed competitive
 *  insight), early signal when the best ground is an early signal, archive
 *  otherwise. */
export function recEvidenceTier(rec: RecLike, tierById: Map<string, GateTier>, confirmedCompetitive: Set<string>): GateTier {
  let best: GateTier = 'archive'
  for (const id of rec.based_on?.insight_ids ?? []) {
    if (confirmedCompetitive.has(id) || tierById.get(id) === 'confirmed') return 'confirmed'
    if (tierById.get(id) === 'early_signal') best = 'early_signal'
  }
  return best
}

export interface AgendaItem<T extends RecLike> {
  rec: T
  tier: GateTier
}

/** The agenda order: gate-passed recommendations first (by stored priority,
 *  then by how many insights ground them), then the rest in the same order —
 *  so "ordered by evidence" is literally true and #1 is the best-grounded
 *  action, never merely the model's favourite. */
export function orderAgenda<T extends RecLike>(recs: T[], tierById: Map<string, GateTier>, confirmedCompetitive: Set<string>): AgendaItem<T>[] {
  const TIER_RANK: Record<GateTier, number> = { confirmed: 0, early_signal: 1, archive: 2 }
  return recs
    .map((rec) => ({ rec, tier: recEvidenceTier(rec, tierById, confirmedCompetitive) }))
    .sort(
      (a, b) =>
        TIER_RANK[a.tier] - TIER_RANK[b.tier] ||
        (PRIORITY_RANK[a.rec.priority ?? 'low'] ?? 3) - (PRIORITY_RANK[b.rec.priority ?? 'low'] ?? 3) ||
        (b.rec.based_on?.insight_ids?.length ?? 0) - (a.rec.based_on?.insight_ids?.length ?? 0),
    )
}

/** The agenda row that is open (?rec=<id>): the requested one when it is
 *  among the shown rows, else the top row. Exactly one row is ever open. */
export function openAgendaId<T extends RecLike>(shown: AgendaItem<T>[], requested: string | undefined): string | null {
  if (requested && shown.some((a) => a.rec.id === requested)) return requested
  return shown[0]?.rec.id ?? null
}

/** Priority dot colour by stored priority: high amber, medium grey, low hairline. */
export function priorityDot(priority: string | null | undefined): string {
  if (priority === 'high') return 'var(--warning)'
  if (priority === 'medium') return 'var(--cat)'
  return 'var(--input)'
}

/** Measured grounding: distinct conversations (videos) behind a set of
 *  audience-insight ids. */
export function distinctVideos(audienceIds: Iterable<string>, videoByInsight: Map<string, string | null>): number {
  const vids = new Set<string>()
  for (const id of audienceIds) {
    const v = videoByInsight.get(id)
    if (v) vids.add(v)
  }
  return vids.size
}

// ── say vs hear: the claims ledger ────────────────────────────────────────

export type ClaimAudience = 'echoes' | 'contradicts' | 'silent'
export type ClaimTone = 'positive' | 'clay' | 'sand'

export interface ClaimVerdict { label: string; tone: ClaimTone }

/** The verdict chip word per audience reading. Silence is a real verdict. */
export function claimVerdict(audience: ClaimAudience | string): ClaimVerdict {
  if (audience === 'echoes') return { label: 'Echoed', tone: 'positive' }
  if (audience === 'contradicts') return { label: 'Pushed back', tone: 'clay' }
  return { label: 'Not talked about', tone: 'sand' }
}

export interface ClaimCounts { total: number; echoed: number; pushedBack: number; silent: number }

export function claimCounts(entries: { audience: string }[]): ClaimCounts {
  const c: ClaimCounts = { total: entries.length, echoed: 0, pushedBack: 0, silent: 0 }
  for (const e of entries) {
    if (e.audience === 'echoes') c.echoed++
    else if (e.audience === 'contradicts') c.pushedBack++
    else c.silent++
  }
  return c
}

/** "13 claims · 3 echoed · 2 pushed back · 8 silent" */
export function claimCountsLine(c: ClaimCounts): string {
  return `${c.total} claim${c.total === 1 ? '' : 's'} · ${c.echoed} echoed · ${c.pushedBack} pushed back · ${c.silent} silent`
}

/** The rows the ledger tile shows: voiced verdicts first (pushed back, then
 *  echoed — the ones with a "they hear" side), silence last; stable within. */
export function ledgerRows<T extends { audience: string }>(entries: T[], n = 4): T[] {
  const weight = (a: string) => (a === 'contradicts' ? 0 : a === 'echoes' ? 1 : 2)
  return entries
    .map((e, i) => ({ e, i }))
    .sort((a, b) => weight(a.e.audience) - weight(b.e.audience) || a.i - b.i)
    .slice(0, n)
    .map((x) => x.e)
}

// ── the short read: 2×2 quadrants ─────────────────────────────────────────

/** Honest truncation at a word boundary with an ellipsis — the reader can
 *  always tell something was cut. */
export function truncateWords(s: string, max: number): string {
  const t = s.replace(/\s+/g, ' ').trim()
  if (t.length <= max) return t
  const cut = t.slice(0, max)
  const at = cut.lastIndexOf(' ')
  return `${(at > max * 0.5 ? cut.slice(0, at) : cut).replace(/[,;:.\-–—]+$/, '')}…`
}

/** The first n bullets of a summary list, each truncated to fit its quadrant. */
export function quadrantBullets(items: string[] | null | undefined, n = 2, max = 120): string[] {
  return (items ?? []).filter((s) => !!s && s.trim().length > 0).slice(0, n).map((s) => truncateWords(s, max))
}

// ── key insights ──────────────────────────────────────────────────────────

/** Counts per tier for the chips in the tile header. */
export function tierCounts(tierById: Map<string, GateTier>): { confirmed: number; early: number; archive: number } {
  const out = { confirmed: 0, early: 0, archive: 0 }
  for (const t of tierById.values()) {
    if (t === 'confirmed') out.confirmed++
    else if (t === 'early_signal') out.early++
    else out.archive++
  }
  return out
}

// ── news ──────────────────────────────────────────────────────────────────

export interface NewsRingChip { label: string; tone: ClaimTone }

/** Ring → the entity chip beside a headline (0 your brand, 1 competitors, 2 category). */
export function newsRingChip(ring: number): NewsRingChip {
  if (ring === 0) return { label: 'Your brand', tone: 'positive' }
  if (ring === 1) return { label: 'Competitor', tone: 'clay' }
  return { label: 'Category', tone: 'sand' }
}
