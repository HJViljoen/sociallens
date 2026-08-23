// Pure shaping for the one-screen Voice of Customer page. Everything here takes
// rows the page fetched and returns display-ready structure — no I/O, no React
// — so it is tested in lib/voice-tiles.test.ts. The rules that matter:
//   · theme identity is theme_registry (themes.registry_id); themes.id is a
//     per-update row id and labels churn ~88% update to update, so cross-update
//     joins key on registry_id with a label bridge ONLY for rows written before
//     the registry existed (ported from the Trends page, 2026-08-22);
//   · strength_score gates and orders (the gaining/fading rule is calibrated to
//     its 0–10 scale) but is never shown — what the page prints is conversations
//     (evidence_count), a real count.

import { CURATION_GATE } from './curation'
import { bucketKind, type Bucket } from './dashboard-tiles'

// ── squarified treemap ────────────────────────────────────────────────────

export interface Rect { x: number; y: number; w: number; h: number }

/** Squarified treemap (Bruls, Huizing & van Wijk). `values` are relative
 *  sizes in the order you want them laid out (largest first gives the
 *  classic layout); they are scaled so the rectangles tile x,y,w,h exactly.
 *  Returns one rect per value, in input order. */
export function squarify(values: number[], x: number, y: number, w: number, h: number): Rect[] {
  const total = values.reduce((a, v) => a + Math.max(0, v), 0)
  if (values.length === 0 || total <= 0 || w <= 0 || h <= 0) return values.map(() => ({ x, y, w: 0, h: 0 }))
  if (values.length === 1) return [{ x, y, w, h }]
  const scale = (w * h) / total
  const areas = values.map((v) => Math.max(0, v) * scale)
  const rects: Rect[] = new Array(values.length)

  const worst = (row: number[], length: number) => {
    const s = row.reduce((a, v) => a + v, 0)
    if (s <= 0) return Infinity
    const mx = Math.max(...row), mn = Math.min(...row)
    return Math.max((length * length * mx) / (s * s), (s * s) / (length * length * mn))
  }
  // Lay one row along the shorter side; return the remaining free rectangle.
  const layout = (row: { area: number; i: number }[], fx: number, fy: number, fw: number, fh: number) => {
    const s = row.reduce((a, r) => a + r.area, 0)
    if (fw >= fh) {
      const rw = fh > 0 ? s / fh : 0
      let yy = fy
      for (const r of row) {
        const rh = rw > 0 ? r.area / rw : 0
        rects[r.i] = { x: fx, y: yy, w: rw, h: rh }
        yy += rh
      }
      return { fx: fx + rw, fy, fw: fw - rw, fh }
    }
    const rh = fw > 0 ? s / fw : 0
    let xx = fx
    for (const r of row) {
      const rw = rh > 0 ? r.area / rh : 0
      rects[r.i] = { x: xx, y: fy, w: rw, h: rh }
      xx += rw
    }
    return { fx, fy: fy + rh, fw, fh: fh - rh }
  }

  let free = { fx: x, fy: y, fw: w, fh: h }
  let row: { area: number; i: number }[] = []
  let i = 0
  while (i < areas.length) {
    const length = Math.min(free.fw, free.fh) || 1
    const next = { area: areas[i], i }
    const rowAreas = row.map((r) => r.area)
    if (row.length === 0 || worst([...rowAreas, next.area], length) <= worst(rowAreas, length)) {
      row.push(next)
      i++
    } else {
      free = layout(row, free.fx, free.fy, free.fw, free.fh)
      row = []
    }
  }
  if (row.length) layout(row, free.fx, free.fy, free.fw, free.fh)
  return rects
}

// ── theme trajectories across updates (the Trends join, kept to its rules) ──

export interface ThemeHistoryRow {
  run_id: string
  registry_id: string | null
  label: string
  category: string
  bucket: string
  strength_score: number | null
  evidence_count: number | null
  first_seen: boolean | null
}

export type Movement = 'emerging' | 'gaining' | 'fading' | 'steady'

export interface Trajectory {
  /** registry_id, or the bridged / label key for pre-registry rows */
  key: string
  /** the LATEST label — the identity is the key, the wording is this update's */
  label: string
  category: string
  bucket: string
  /** oldest → newest, one point per update the theme appeared in */
  dates: string[]
  strength: number[]
  evidence: number[]
  latestEvidence: number
  movement: Movement
  /** strength last − first: the movement rule's input (0–10 scale), never shown */
  strengthDelta: number
  /** conversations vs the previous update the theme appeared in — what is shown */
  evidenceDelta: number | null
}

/** Gaining/fading thresholds (±1 on strength's 0–10 scale) — calibrated on
 *  Trends; a theme that appeared after the first update AND was flagged new
 *  on arrival is "emerging". */
export const MOVEMENT_STEP = 1

export function movementOf(strength: number[], emerged: boolean): Movement {
  if (emerged) return 'emerging'
  const d = strength[strength.length - 1] - strength[0]
  return d >= MOVEMENT_STEP ? 'gaining' : d <= -MOVEMENT_STEP ? 'fading' : 'steady'
}

/** Join every update's themes into per-identity series. `runDates` maps
 *  run_id → run_date (ISO) for every update that should count; rows whose run
 *  is not in the map are ignored (an in-flight update, say). Returns the
 *  trajectories (including single-point ones, so a block can look up its own
 *  history) and `keyOf`, which maps one of THIS update's theme rows onto its
 *  trajectory key. */
export function themeTrajectories(rows: ThemeHistoryRow[], runDates: Map<string, string>) {
  // Rows written before the registry existed carry no id, so bridge them onto
  // the identity by label where the label is unchanged — otherwise the same
  // theme would split into two disjoint series at the changeover. A label that
  // two registry identities share is ambiguous and is not bridged (that would
  // be a label join, which the registry exists to prevent).
  const bridge = new Map<string, string | null>()
  for (const t of rows) {
    if (!t.registry_id) continue
    const seen = bridge.get(t.label)
    bridge.set(t.label, seen === undefined || seen === t.registry_id ? t.registry_id : null)
  }
  const keyOf = (t: { registry_id: string | null; label: string }) => t.registry_id ?? bridge.get(t.label) ?? `label:${t.label}`

  const dates = [...runDates.values()].sort()
  const earliestDate = dates[0]
  const byKey = new Map<string, { date: string; strength: number; evidence: number; category: string; bucket: string; label: string; firstSeen: boolean }[]>()
  for (const t of rows) {
    const d = runDates.get(t.run_id)
    if (!d) continue
    const key = keyOf(t)
    const arr = byKey.get(key) ?? []
    arr.push({ date: d, strength: Number(t.strength_score ?? 0), evidence: Number(t.evidence_count ?? 0), category: t.category, bucket: t.bucket, label: t.label, firstSeen: !!t.first_seen })
    byKey.set(key, arr)
  }
  const trajectories: Trajectory[] = [...byKey.entries()].map(([key, ptsRaw]) => {
    const pts = ptsRaw.sort((a, b) => a.date.localeCompare(b.date))
    const last = pts[pts.length - 1]
    const strength = pts.map((p) => p.strength)
    const evidence = pts.map((p) => p.evidence)
    const emerged = earliestDate != null && pts[0].date > earliestDate && pts[0].firstSeen
    return {
      key,
      label: last.label,
      category: last.category,
      bucket: last.bucket,
      dates: pts.map((p) => p.date),
      strength,
      evidence,
      latestEvidence: last.evidence,
      movement: movementOf(strength, emerged),
      strengthDelta: strength[strength.length - 1] - strength[0],
      evidenceDelta: evidence.length >= 2 ? evidence[evidence.length - 1] - evidence[evidence.length - 2] : null,
    }
  })
  return { trajectories, keyOf }
}

/** The gaining-and-fading list: themes heard in ≥2 updates, movers first by
 *  the size of the move (strength rule orders; conversations break ties),
 *  then emerging, then steady. */
export function themeMovers(trajectories: Trajectory[]): Trajectory[] {
  const rank = (t: Trajectory) => (t.movement === 'gaining' || t.movement === 'fading' ? 0 : t.movement === 'emerging' ? 1 : 2)
  return trajectories
    .filter((t) => t.strength.length >= 2)
    .sort((a, b) =>
      rank(a) - rank(b) ||
      Math.abs(b.strengthDelta) - Math.abs(a.strengthDelta) ||
      Math.abs(b.evidenceDelta ?? 0) - Math.abs(a.evidenceDelta ?? 0) ||
      b.latestEvidence - a.latestEvidence,
    )
}

// ── tiers ─────────────────────────────────────────────────────────────────

export interface VoiceTierRow { single_source: boolean | null; strength_score: number | null }

/** Voice's three tiers as lists: confirmed = heard in more than one
 *  conversation; early = one source but clearing the early-signal bar; the
 *  rest was heard once. Input order is preserved within each tier. */
export function voiceTiers<T extends VoiceTierRow>(rows: T[]): { confirmed: T[]; early: T[]; heardOnce: T[] } {
  const confirmed: T[] = [], early: T[] = [], heardOnce: T[] = []
  for (const t of rows) {
    if (!t.single_source) confirmed.push(t)
    else if (Number(t.strength_score ?? 0) >= CURATION_GATE.earlySignalMinScore) early.push(t)
    else heardOnce.push(t)
  }
  return { confirmed, early, heardOnce }
}

// ── the quote ribbon ──────────────────────────────────────────────────────

export interface VoiceCard<Q> { themeIndex: number; quote: Q }

/** Order the ribbon's candidates round-robin across themes (every theme's
 *  best quote before any theme's second), then rotate by `seed` so each visit
 *  shows the next five. Returns the `n` cards for this seed plus the pool size
 *  ("5 of N"). Themes with no usable quote are skipped. */
export function pickVoiceCards<Q>(candidatesByTheme: Q[][], seed: number, n = 5): { cards: VoiceCard<Q>[]; total: number } {
  const pool: VoiceCard<Q>[] = []
  const depth = Math.max(0, ...candidatesByTheme.map((c) => c.length))
  for (let d = 0; d < depth; d++) {
    candidatesByTheme.forEach((c, themeIndex) => { if (c[d] != null) pool.push({ themeIndex, quote: c[d] }) })
  }
  const total = pool.length
  if (total === 0) return { cards: [], total }
  const s = Number.isFinite(seed) ? Math.abs(Math.trunc(seed)) : 0
  const start = (s * n) % total
  const cards: VoiceCard<Q>[] = []
  for (let i = 0; i < Math.min(n, total); i++) cards.push(pool[(start + i) % total])
  return { cards, total }
}

// ── labels ────────────────────────────────────────────────────────────────

/** Tab wording for audience-insight categories (plural where it reads). */
export const CATEGORY_LABEL: Record<string, string> = {
  pain_point: 'Pain points',
  question: 'Questions',
  praise: 'Praise',
  purchase_intent: 'Purchase intent',
  demographic_signal: 'Demographic',
  switching_signal: 'Switching',
  buying_trigger: 'Buying triggers',
  feature_request: 'Feature requests',
  objection: 'Objections',
  misinformation: 'Misinformation',
}
/** The design's tab order; categories not listed follow by count. */
export const CATEGORY_ORDER = ['pain_point', 'question', 'praise', 'purchase_intent', 'demographic_signal', 'switching_signal']

export const categoryLabel = (c: string) => CATEGORY_LABEL[c] ?? c.replace(/_/g, ' ').replace(/^./, (ch) => ch.toUpperCase())

/** Category tabs: design order first, then the rest by count. */
export function categoryTabs(counts: Map<string, number>): { category: string; label: string; count: number }[] {
  const idx = (c: string) => { const i = CATEGORY_ORDER.indexOf(c); return i < 0 ? CATEGORY_ORDER.length : i }
  return [...counts.entries()]
    .map(([category, count]) => ({ category, label: categoryLabel(category), count }))
    .sort((a, b) => idx(a.category) - idx(b.category) || b.count - a.count || a.label.localeCompare(b.label))
}

/** Category chip tint — one calibrated family per category, never a hashed
 *  hue (Heinrich, 2026-08-22): green = good news (praise, purchase intent,
 *  buying triggers), warm red = friction (pain points, objections, switching),
 *  gold = asks (questions, feature requests), neutral = the rest. Class
 *  strings are written out in full so Tailwind's scanner sees them. */
const CATEGORY_FAMILY: Record<string, 'green' | 'red' | 'gold'> = {
  praise: 'green',
  purchase_intent: 'green',
  buying_trigger: 'green',
  pain_point: 'red',
  objection: 'red',
  switching_signal: 'red',
  question: 'gold',
  feature_request: 'gold',
}
const FAMILY_CHIP = {
  green: 'bg-positive/12 text-positive',
  red: 'bg-negative/12 text-negative',
  gold: 'bg-warning/15 text-warning',
  neutral: 'bg-muted text-muted-foreground',
} as const
export const categoryChip = (category: string): string => FAMILY_CHIP[CATEGORY_FAMILY[category] ?? 'neutral']

/** The phrases the language tile has room for: short ones (≤ `maxWords`
 *  words — long sentences wrap into a mess), shortest first, de-duplicated
 *  case-insensitively, at most `n`. */
export function shortPhrases<T extends { phrase: string }>(samples: T[], n = 8, maxWords = 8): T[] {
  const seen = new Set<string>()
  return samples
    .filter((s) => {
      const p = s.phrase.trim()
      const key = p.toLowerCase()
      if (!p || seen.has(key) || p.split(/\s+/).length > maxWords) return false
      seen.add(key)
      return true
    })
    .sort((a, b) => a.phrase.trim().length - b.phrase.trim().length)
    .slice(0, n)
}

/** Audience-mood colour job: the feeling's valence (Pass A's fixed emotion
 *  vocabulary). Positive = green, negative = clay, neutral = sand. */
export function emotionTone(emotion: string): 'positive' | 'negative' | 'neutral' {
  const e = emotion.toLowerCase()
  if (['frustrated', 'angry', 'disappointed', 'confused', 'anxious', 'worried', 'sad', 'fearful', 'annoyed'].includes(e)) return 'negative'
  if (e === 'neutral' || e === 'curious') return 'neutral'
  return 'positive'
}

/** Emotion counts → the top N with their share of everything counted. */
export function topEmotions(emotions: (string | null | undefined)[], n = 3): { emotion: string; count: number; pct: number; total: number }[] {
  const counts = new Map<string, number>()
  for (const e of emotions) if (e) counts.set(e, (counts.get(e) ?? 0) + 1)
  const total = [...counts.values()].reduce((a, b) => a + b, 0)
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, n)
    .map(([emotion, count]) => ({ emotion, count, pct: total > 0 ? (count / total) * 100 : 0, total }))
}

export { bucketKind }
export type { Bucket }
