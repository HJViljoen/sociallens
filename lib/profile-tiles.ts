import type { PlatformRow, ShareSeries } from '../components/profile-stats'

// Pure shaping for the Consumer Profile page — split out of the old
// app/dashboard/profile/page.tsx (Reports & Exports, 2026-08-29). No I/O, no
// React; tested in lib/profile-tiles.test.ts.

export interface Persona {
  key: string
  name: string
  oneLiner: string
  scope: 'category' | 'client'
  wants: string
  blockers: string
  triggers: string
  howTheyTalk: string[]
  who: { signal: string; count: number }[]
  insightIds: string[]
  evidenceCount: number
  sourceVideoCount: number
  prevalence: string
}

/** The row is jsonb written by a pass whose shape will change. Read it
 *  defensively so a v2 profile, or a hand-written row, degrades instead of
 *  500-ing the route. */
export function normalisePersona(p: Partial<Persona> | null): Persona | null {
  if (!p || typeof p.name !== 'string' || !p.name) return null
  const arr = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])
  const text = (v: unknown): string =>
    typeof v === 'string' ? v : Array.isArray(v) ? arr(v).join('. ') : ''
  return {
    key: typeof p.key === 'string' && p.key ? p.key : p.name,
    name: p.name,
    oneLiner: typeof p.oneLiner === 'string' ? p.oneLiner : '',
    scope: p.scope === 'client' ? 'client' : 'category',
    // Legacy rows stored these as bullet arrays; join rather than drop so a
    // profile written before the prose change still reads.
    wants: text(p.wants),
    blockers: text(p.blockers),
    triggers: text(p.triggers),
    howTheyTalk: arr(p.howTheyTalk),
    who: Array.isArray(p.who)
      ? p.who.filter((w) => w && typeof w.signal === 'string' && Number.isFinite(w.count))
      : [],
    insightIds: arr(p.insightIds),
    evidenceCount: Number.isFinite(p.evidenceCount) ? (p.evidenceCount as number) : 0,
    sourceVideoCount: Number.isFinite(p.sourceVideoCount) ? (p.sourceVideoCount as number) : 0,
    prevalence: typeof p.prevalence === 'string' ? p.prevalence : '',
  }
}

/** Each persona's share of the conversation THIS PROFILE covers. Apportioned
 *  across the cast rather than measured against the whole corpus: the profile
 *  describes these people, so "a third of this profile" is a claim the page
 *  can actually stand behind. A conversation that speaks to two of them counts
 *  toward both, which is why this is a share of the profile and not of the
 *  category. */
export function shareOf(p: Pick<Persona, 'sourceVideoCount'>, profileVideoTotal: number): number {
  return profileVideoTotal > 0 ? Math.round((p.sourceVideoCount / profileVideoTotal) * 100) : 0
}

export interface InsightMetaRow {
  platform: string | null
  source_video_id: string | null
}

/** Where each kind of person turns up, across the whole cast — distinct
 *  conversations per platform, biggest first is the caller's job (this just
 *  counts). */
export function platformTotals(insightRows: InsightMetaRow[]): Map<string, number> {
  const byPlatform = new Map<string, Set<string>>()
  for (const r of insightRows) {
    if (!r.platform || !r.source_video_id) continue
    const set = byPlatform.get(r.platform) ?? new Set<string>()
    set.add(r.source_video_id)
    byPlatform.set(r.platform, set)
  }
  return new Map([...byPlatform].map(([p, v]) => [p, v.size] as const))
}

/** One PlatformRow per persona — counted in conversations, the same unit the
 *  rest of the page uses: a video with ten insights from one persona is one
 *  conversation, not ten. */
export function platformRows(
  personas: Pick<Persona, 'key' | 'name' | 'insightIds'>[],
  insightMeta: Map<string, InsightMetaRow>,
): PlatformRow[] {
  return personas.map((p) => {
    const seen = new Map<string, Set<string>>()
    for (const id of p.insightIds) {
      const meta = insightMeta.get(id)
      if (!meta?.platform || !meta.source_video_id) continue
      const set = seen.get(meta.platform) ?? new Set<string>()
      set.add(meta.source_video_id)
      seen.set(meta.platform, set)
    }
    const counts: Record<string, number> = {}
    let total = 0
    for (const [platform, videos] of seen) {
      counts[platform] = videos.size
      total += videos.size
    }
    return { key: p.key, name: p.name, total, counts }
  })
}

export interface ProfileHistoryRow {
  run_date: string
  personas: Partial<Persona>[]
}

/** How the mix has moved: each persona's share of ITS OWN update's profile, at
 *  every stored update. Personas are matched on key across updates (continuity
 *  keeps it stable; matching on name would break the moment a persona was
 *  reworded) — null where the persona did not exist in that update, a gap
 *  rather than a zero. */
export function shareSeries(
  personas: Pick<Persona, 'key' | 'name'>[],
  history: ProfileHistoryRow[],
): ShareSeries[] {
  return personas.map((p) => ({
    key: p.key,
    name: p.name,
    points: history.map((h) => {
      const list = Array.isArray(h.personas) ? h.personas : []
      const totals = list.reduce((n, q) => n + (Number(q?.sourceVideoCount) || 0), 0)
      const mine = list.find((q) => q?.key === p.key)
      if (!mine || !totals) return null
      return Math.round(((Number(mine.sourceVideoCount) || 0) / totals) * 100)
    }),
  }))
}
