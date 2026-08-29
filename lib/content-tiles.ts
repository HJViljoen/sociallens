// Pure shaping for the one-screen Content page tiles (the reply inbox + the
// playbook). Takes the rows the page fetched (videos of the latest update, the
// ranked engagement digest) and returns display-ready numbers and sentences —
// no I/O, no React — tested in lib/content-tiles.test.ts. Numbers rule: every
// figure is a count, a view total or a measured engagement rate; model labels
// (hook style, format, insight category) only group and order.
//
// `EngageCandidate` is imported for its shape only (lib/engage.ts owns the I/O
// and the ranking); attaching quotes/refs to a shaped row is the loader's job
// (lib/pages/content.ts) — this file never sees a Quote.

import type { EngageCandidate } from './engage'

// ── the reply inbox ───────────────────────────────────────────────────────

export type Intent = 'buying' | 'question' | 'objection' | 'misinformation'

export const INTENT_ORDER: Intent[] = ['buying', 'question', 'objection', 'misinformation']

export const INTENT_LABEL: Record<Intent, string> = {
  buying: 'Buying signal',
  question: 'Question',
  objection: 'Objection',
  misinformation: 'Misinformation',
}

/** Plural chip label: "Buying signals 4". */
export const INTENT_PLURAL: Record<Intent, string> = {
  buying: 'Buying signals',
  question: 'Questions',
  objection: 'Objections',
  misinformation: 'Misinformation',
}

/** audience_insights.category → the inbox's reading of it. */
export function intentOf(category: string): Intent {
  switch (category) {
    case 'purchase_intent':
    case 'buying_trigger':
    case 'switching_signal':
      return 'buying'
    case 'question':
      return 'question'
    case 'objection':
      return 'objection'
    case 'misinformation':
      return 'misinformation'
    default:
      return 'question'
  }
}

export const isIntent = (s: string | undefined | null): s is Intent =>
  s === 'buying' || s === 'question' || s === 'objection' || s === 'misinformation'

export interface InboxSource {
  /** The digest row's id — a comment id. */
  id: string
  category: string
  commentDate: string | null
  likes: number
  /** Account whose post the comment sits under (null when unknown). */
  account: string | null
}

export interface InboxRow<T extends InboxSource = InboxSource> {
  src: T
  intent: Intent
  /** "today" · "2d" · "3w" · "2mo" — or null when the comment is undated. */
  age: string | null
  /** "under your post · 41 likes" / "under @handle’s post" / "under a category video". */
  context: string
}

/** Age of a comment at `now`, coarse on purpose: the inbox reads by recency,
 *  not by timestamp. */
export function ageLabel(commentDate: string | null, now: string): string | null {
  if (!commentDate) return null
  const t = Date.parse(commentDate), n = Date.parse(now)
  if (!Number.isFinite(t) || !Number.isFinite(n)) return null
  const days = Math.max(0, Math.floor((n - t) / 86_400_000))
  if (days === 0) return 'today'
  if (days < 7) return `${days}d`
  if (days < 30) return `${Math.floor(days / 7)}w`
  return `${Math.floor(days / 30)}mo`
}

const normHandle = (h: string) => h.replace(/^@+/, '').trim().toLowerCase()

/** The quiet line under a quote: whose post it sits under, and how many
 *  liked it. "your post" only when the account is one of the client's own
 *  handles (or a video flagged as theirs) — never inferred. */
export function contextLine(
  src: Pick<InboxSource, 'account' | 'likes' | 'category'>,
  ownHandles: Set<string>,
  roleByAccount: Map<string, VoiceRole>,
): string {
  if (src.category === 'misinformation') return 'awareness only — never a reply prompt'
  const acct = src.account ? normHandle(src.account) : null
  let where: string
  if (acct && (ownHandles.has(acct) || roleByAccount.get(acct) === 'you')) where = 'under your post'
  else if (acct && roleByAccount.get(acct) === 'competitor') where = `under @${acct}’s post · competitor`
  else if (acct) where = `under @${acct}’s post`
  else where = 'under a category video'
  return src.likes > 0 ? `${where} · ${src.likes} ${src.likes === 1 ? 'like' : 'likes'}` : where
}

/** Intent first (buying → question → objection → misinformation), newest
 *  inside each intent; undated rows sink to the end of their intent. */
export function orderInbox<T extends InboxSource>(rows: InboxRow<T>[]): InboxRow<T>[] {
  const rank = (i: Intent) => INTENT_ORDER.indexOf(i)
  const when = (r: InboxRow<T>) => (r.src.commentDate ? Date.parse(r.src.commentDate) : -Infinity)
  return [...rows].sort((a, b) => rank(a.intent) - rank(b.intent) || when(b) - when(a))
}

/** Shape + order the digest rows for the inbox tile. */
export function inboxRows<T extends InboxSource>(
  sources: T[],
  opts: { now: string; ownHandles: Set<string>; roleByAccount: Map<string, VoiceRole> },
): InboxRow<T>[] {
  return orderInbox(
    sources.map((src) => ({
      src,
      intent: intentOf(src.category),
      age: ageLabel(src.commentDate, opts.now),
      context: contextLine(src, opts.ownHandles, opts.roleByAccount),
    })),
  )
}

/** Chip counts per intent, in INTENT_ORDER, zero-count intents dropped. */
export function intentCounts(rows: { intent: Intent }[]): { intent: Intent; count: number }[] {
  const m = new Map<Intent, number>()
  for (const r of rows) m.set(r.intent, (m.get(r.intent) ?? 0) + 1)
  return INTENT_ORDER.filter((i) => (m.get(i) ?? 0) > 0).map((i) => ({ intent: i, count: m.get(i)! }))
}

/** Shape the engage candidates (moved from engage-section.tsx, Reports &
 *  Exports T7, 2026-08-29) into ordered inbox rows — intent first, then
 *  recency (`inboxRows`). The candidate itself rides along as `src` so the
 *  loader can still reach its comment/insight fields; it attaches the quote
 *  (a candidate's comment text is a third party's words) and the reply link. */
export function shapeInbox(
  candidates: EngageCandidate[],
  opts: { now: string; ownHandles: Set<string>; roleByAccount: Map<string, VoiceRole> },
): InboxRow<EngageCandidate & InboxSource>[] {
  const sources = candidates.map((c) => ({
    ...c,
    id: c.comment.id,
    commentDate: c.comment.commentDate,
    likes: c.comment.likes,
    account: c.comment.account,
  }))
  return inboxRows(sources, opts)
}

// ── what works right now ──────────────────────────────────────────────────

export interface PerfVideo {
  engagement_rate: number | string | null
  hook_style?: string | null
  classified_type?: string | null
}

export interface PerfMultiple {
  k: string
  count: number
  avgEng: number
  /** group average ÷ the update's median video engagement */
  multiple: number
}

export const median = (nums: number[]): number | null => {
  if (nums.length === 0) return null
  const s = [...nums].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

/** Median engagement of the update's videos that carry an engagement rate —
 *  the "1×" every hook and format multiple is read against. */
export function medianEngagement(videos: PerfVideo[]): number | null {
  return median(videos.map((v) => Number(v.engagement_rate)).filter((e) => e > 0))
}

/** Hook styles / formats as multiples of the median video's engagement, best
 *  first. Groups under `minCount` videos are dropped — one video can't make a
 *  style, and a singleton at 40% would print "12×". */
export function perfVsMedian(
  videos: PerfVideo[],
  key: 'hook_style' | 'classified_type',
  opts: { minCount?: number; top?: number } = {},
): PerfMultiple[] {
  // Three videos is the floor for a multiple — two can be one fluke twice.
  const minCount = opts.minCount ?? 3
  const top = opts.top ?? 5
  const med = medianEngagement(videos)
  if (med == null || med <= 0) return []
  const groups = new Map<string, { count: number; eng: number; engN: number }>()
  for (const v of videos) {
    const k = v[key]
    if (!k) continue
    const g = groups.get(k) ?? { count: 0, eng: 0, engN: 0 }
    g.count++
    const e = Number(v.engagement_rate)
    if (e > 0) { g.eng += e; g.engN++ }
    groups.set(k, g)
  }
  return [...groups.entries()]
    .filter(([, g]) => g.engN >= minCount)
    .map(([k, g]) => {
      const avgEng = g.eng / g.engN
      return { k, count: g.count, avgEng, multiple: avgEng / med }
    })
    .sort((a, b) => b.multiple - a.multiple || b.count - a.count)
    .slice(0, top)
}

/** "2.4×" — one decimal under 10, none above. */
export const fmtMultiple = (m: number) => `${m >= 10 ? Math.round(m) : (Math.round(m * 10) / 10).toFixed(1).replace(/\.0$/, '')}×`

export interface DurationBandPerf { label: string; count: number; avgEng: number | null; engN: number }

export interface DurationVerdict {
  best: DurationBandPerf
  /** best band's average ÷ the update's median video engagement — the same
   *  "1×" the hook and format multiples read against; null without a median */
  multiple: number | null
}

/** The best-earning length band, read against the update's median video.
 *  Bands need `minCount` videos with engagement to count. */
export function bestDuration(bands: DurationBandPerf[], median: number | null, minCount = 2): DurationVerdict | null {
  const ok = bands.filter((b) => b.avgEng != null && b.avgEng > 0 && b.engN >= minCount) as (DurationBandPerf & { avgEng: number })[]
  if (ok.length === 0) return null
  const best = [...ok].sort((a, b) => b.avgEng - a.avgEng)[0]
  return { best, multiple: median != null && median > 0 ? best.avgEng / median : null }
}

// ── the field this update ─────────────────────────────────────────────────

export interface FieldRow {
  label: string
  kind: 'you' | 'competitor' | 'category'
  videos: number
  views: number
  avgEng: number | null
}

/** One honest sentence from the scoreboard: engagement per video, posting
 *  volume, reach — each clause only when the numbers behind it exist. */
export function fieldSentence(rows: FieldRow[]): string | null {
  if (rows.length < 2) return null
  const you = rows.find((r) => r.kind === 'you') ?? null
  const comp = rows.filter((r) => r.kind === 'competitor').sort((a, b) => b.videos - a.videos)[0] ?? null
  const cat = rows.find((r) => r.kind === 'category') ?? null
  const parts: string[] = []

  if (you && comp) {
    let eng: string | null = null
    if (you.avgEng != null && comp.avgEng != null) {
      const ratio = you.avgEng / comp.avgEng
      eng = ratio >= 1.1 ? `You out-engage ${comp.label} per video`
        : ratio <= 1 / 1.1 ? `${comp.label} out-engages you per video`
        : `You and ${comp.label} engage about the same per video`
    }
    const post = you.videos < comp.videos ? `posted ${you.videos} ${you.videos === 1 ? 'video' : 'videos'} to their ${comp.videos}`
      : you.videos > comp.videos ? `posted ${you.videos} videos to their ${comp.videos}`
      : `posted as often (${you.videos} each)`
    if (eng) {
      const youAhead = eng.startsWith('You out-engage'), postFewer = you.videos < comp.videos
      const joiner = youAhead === postFewer ? ' but ' : ' and '
      parts.push(`${eng}${joiner}${post}`)
    } else parts.push(`You ${post}`)
  } else if (comp && cat && !you) {
    parts.push(`${comp.label} posted ${comp.videos} ${comp.videos === 1 ? 'video' : 'videos'} this update`)
  } else if (you && cat && !comp) {
    parts.push(`You posted ${you.videos} ${you.videos === 1 ? 'video' : 'videos'} this update`)
  }

  const byViews = [...rows].filter((r) => r.views > 0).sort((a, b) => b.views - a.views)
  if (byViews.length > 1) {
    const lead = byViews[0]
    parts.push(lead.kind === 'you' ? 'you own reach' : lead.kind === 'category' ? 'category creators own reach' : `${lead.label} owns reach`)
  }
  if (parts.length === 0) return null
  const s = parts.join('; ')
  return `${s.charAt(0).toUpperCase()}${s.slice(1)}.`
}

// ── the scoreboard, duration bands, playbooks, sounds (moved from the old
// page.tsx, Reports & Exports T7, 2026-08-29) — page-local pure transforms
// over the update's video rows, grouped by entity: You / each competitor /
// category creators. `EntityVideo` is the narrow shape they need, so
// lib/pages/content.ts's DB row type only has to line up structurally.

export interface EntityVideo {
  is_client: boolean
  is_competitor: boolean
  competitor_name: string | null
  duration_seconds: number | string | null
  engagement_rate: number | string | null
  views: number | string | null
  classified_type: string | null
  hook_style: string | null
  audio_name: string | null
}

export type EntityKind = FieldRow['kind']

/** One video's entity: You / a named competitor / category creators. */
export const entityKey = (v: EntityVideo): { label: string; kind: EntityKind } =>
  v.is_client ? { label: 'You', kind: 'you' }
  : v.is_competitor ? { label: v.competitor_name ?? 'Competitor', kind: 'competitor' }
  : { label: 'Category creators', kind: 'category' }

/** One scoreboard row per entity: You / each competitor / category creators. */
export interface EntityRow extends FieldRow {
  medianDuration: number | null
  engN: number
}

/** "0:32 min" for anything over a minute, "45s" under. */
export const durationLabel = (secs: number): string => {
  const m = Math.floor(secs / 60)
  const s = Math.round(secs % 60)
  return m > 0 ? `${m}:${String(s).padStart(2, '0')} min` : `${s}s`
}

/** "before_after" → "before after" — the label a machine-slug reads as, once
 *  case is handled by CSS `capitalize`. */
export const pretty = (s: string) => s.replace(/[-_]/g, ' ')

/** The field this update: one row per entity, ranked You-first. */
export function entityScoreboard(all: EntityVideo[]): EntityRow[] {
  const groups = new Map<string, { kind: EntityKind; vids: EntityVideo[] }>()
  for (const v of all) {
    const { label, kind } = entityKey(v)
    const g = groups.get(label) ?? { kind, vids: [] }
    g.vids.push(v)
    groups.set(label, g)
  }
  const rows = [...groups.entries()].map(([label, { kind, vids }]) => {
    const withEng = vids.filter((v) => Number(v.engagement_rate) > 0)
    return {
      label, kind,
      videos: vids.length,
      medianDuration: median(vids.map((v) => Number(v.duration_seconds)).filter((d) => d > 0)),
      avgEng: withEng.length > 0 ? withEng.reduce((s, v) => s + Number(v.engagement_rate), 0) / withEng.length : null,
      engN: withEng.length,
      views: vids.reduce((s, v) => s + Number(v.views ?? 0), 0),
    }
  })
  const order = (r: EntityRow) => (r.kind === 'you' ? 0 : r.kind === 'category' ? 2 : 1)
  return rows.sort((a, b) => order(a) - order(b) || b.videos - a.videos)
}

const DURATION_BANDS: { label: string; min: number; max: number }[] = [
  { label: 'Under 15 s', min: 0, max: 15 },
  { label: '15–30 s', min: 15, max: 30 },
  { label: '30–60 s', min: 30, max: 60 },
  { label: '60 s+', min: 60, max: Infinity },
]

/** Videos grouped into length bands, non-empty bands only. */
export function durationPerf(all: EntityVideo[]): DurationBandPerf[] {
  return DURATION_BANDS.map((band) => {
    const vids = all.filter((v) => {
      const d = Number(v.duration_seconds)
      return d > 0 && d >= band.min && d < band.max
    })
    const withEng = vids.filter((v) => Number(v.engagement_rate) > 0)
    return {
      label: band.label,
      count: vids.length,
      avgEng: withEng.length > 0 ? withEng.reduce((s, v) => s + Number(v.engagement_rate), 0) / withEng.length : null,
      engN: withEng.length,
    }
  }).filter((b) => b.count > 0)
}

/** Per-entity content playbook: top formats + hook style, with classification
 *  coverage stated per row ("n of m" keeps thin slices honest). */
export interface EntityPlaybook {
  label: string
  kind: EntityKind
  total: number
  classified: number
  topFormats: { k: string; count: number }[]
  topHook: { k: string; count: number } | null
}

export function entityPlaybooks(all: EntityVideo[]): EntityPlaybook[] {
  const groups = new Map<string, { kind: EntityKind; vids: EntityVideo[] }>()
  for (const v of all) {
    const { label, kind } = entityKey(v)
    const g = groups.get(label) ?? { kind, vids: [] }
    g.vids.push(v)
    groups.set(label, g)
  }
  const top = (vids: EntityVideo[], key: 'classified_type' | 'hook_style') => {
    const counts = new Map<string, number>()
    for (const v of vids) {
      const k = v[key]
      if (k) counts.set(k, (counts.get(k) ?? 0) + 1)
    }
    return [...counts.entries()].map(([k, count]) => ({ k, count })).sort((a, b) => b.count - a.count)
  }
  const rows = [...groups.entries()].map(([label, { kind, vids }]) => ({
    label, kind,
    total: vids.length,
    classified: vids.filter((v) => v.classified_type != null).length,
    topFormats: top(vids, 'classified_type').slice(0, 3),
    topHook: top(vids, 'hook_style')[0] ?? null,
  }))
  const order = (r: EntityPlaybook) => (r.kind === 'you' ? 0 : r.kind === 'category' ? 2 : 1)
  return rows.sort((a, b) => order(a) - order(b) || b.total - a.total)
}

/** Sounds used by 2+ videos this update (TikTok/Instagram carry audio names;
 *  singletons are mostly per-video "original sound" noise). */
export function trendingSounds(all: EntityVideo[]): { name: string; count: number; views: number }[] {
  const map = new Map<string, { count: number; views: number }>()
  for (const v of all) {
    if (!v.audio_name) continue
    const g = map.get(v.audio_name) ?? { count: 0, views: 0 }
    g.count++
    g.views += Number(v.views ?? 0)
    map.set(v.audio_name, g)
  }
  return [...map.entries()]
    .filter(([, g]) => g.count >= 2)
    .map(([name, g]) => ({ name, ...g }))
    .sort((a, b) => b.count - a.count || b.views - a.views)
    .slice(0, 6)
}

// ── top voices ────────────────────────────────────────────────────────────

export type VoiceRole = 'you' | 'competitor' | 'creator'

export interface VoiceVideo {
  account_name: string
  views: number | string | null
  is_client: boolean
  is_competitor: boolean
  competitor_name: string | null
  classified_type?: string | null
}

export interface Voice {
  name: string
  role: VoiceRole
  /** the competitor's tracked name, when role = competitor */
  competitorName: string | null
  videos: number
  views: number
  /** most common format across the account's videos this update, when any is classified */
  topFormat: string | null
}

/** Accounts by views this update, most first. Role: the client's own account
 *  → you; a tracked competitor's → competitor; everyone else → creator. */
export function topVoices(videos: VoiceVideo[], n = 4): Voice[] {
  const by = new Map<string, { role: VoiceRole; competitorName: string | null; videos: number; views: number; formats: Map<string, number> }>()
  for (const v of videos) {
    const key = normHandle(v.account_name)
    if (!key) continue
    const g = by.get(key) ?? { role: 'creator', competitorName: null, videos: 0, views: 0, formats: new Map() }
    g.videos++
    g.views += Number(v.views ?? 0)
    if (v.is_client) g.role = 'you'
    else if (v.is_competitor && g.role !== 'you') { g.role = 'competitor'; g.competitorName = g.competitorName ?? v.competitor_name ?? null }
    if (v.classified_type) g.formats.set(v.classified_type, (g.formats.get(v.classified_type) ?? 0) + 1)
    by.set(key, g)
  }
  return [...by.entries()]
    .map(([name, g]) => ({
      name,
      role: g.role,
      competitorName: g.competitorName,
      videos: g.videos,
      views: g.views,
      topFormat: [...g.formats.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? null,
    }))
    .sort((a, b) => b.views - a.views || b.videos - a.videos || a.name.localeCompare(b.name))
    .slice(0, n)
}

/** account_name → role, for the inbox's context lines. */
export function roleByAccount(videos: VoiceVideo[]): Map<string, VoiceRole> {
  const m = new Map<string, VoiceRole>()
  for (const v of videos) {
    const key = normHandle(v.account_name)
    if (!key) continue
    const role: VoiceRole = v.is_client ? 'you' : v.is_competitor ? 'competitor' : 'creator'
    const prev = m.get(key)
    if (!prev || role === 'you' || (role === 'competitor' && prev === 'creator')) m.set(key, role)
  }
  return m
}

/** "amputee.coach" → "AC", "ossur" → "OS", "runningblade_life" → "RL". */
export function initials(handle: string): string {
  const h = normHandle(handle)
  const parts = h.split(/[._\-\s]+/).filter(Boolean)
  const letters = parts.length >= 2 ? parts[0][0] + parts[1][0] : h.slice(0, 2)
  return letters.toUpperCase()
}

export const handleKey = normHandle
