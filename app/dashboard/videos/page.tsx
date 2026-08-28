import { Captions } from 'lucide-react'
import { selectAll } from '@/lib/supabase-admin'
import { getSessionContext } from '@/lib/auth'
import { HowToRead } from '@/components/how-to-read'
import { SENTIMENT_BADGE } from '@/lib/ui-colors'
import { fmtInt, fmtCompact, fmtPct, weekdayDate, platformLabel } from '@/lib/format'
import { accountSeries } from '@/lib/dashboard-tiles'
import {
  perfVsMedian, medianEngagement, fmtMultiple, bestDuration, fieldSentence, topVoices, roleByAccount, initials, handleKey, isIntent,
  type FieldRow, type VoiceRole, type DurationBandPerf, type PerfMultiple,
} from '@/lib/content-tiles'
import { PageFrame, PageGrid, PageBar, BarPill } from '@/components/shell/page-grid'
import { Tile, TileEmpty } from '@/components/shell/tile'
import { DetailDrawer } from '@/components/shell/detail-drawer'
import { DrawerLink } from '@/components/shell/drawer-link'
import { EnhancedTable } from '@/components/shell/enhanced-table'
import { Sparkline } from '@/components/charts/sparkline'
import { Delta } from '@/components/charts/stat'
import { RankedBar } from '@/components/charts/ranked-bar'
import { PlatformIcon } from '@/components/charts/platform-icon'
import { loadEngageDigest, shapeInbox, EngageInboxTile, EngageDrawers } from './engage-section'

// Content — "what content works, and who to answer?", on one screen (one-screen
// redesign, 2026-08-22: the playbook + the reply inbox). "What works right now"
// leads (hooks + formats as multiples of the median video, best length, top
// sound) · "Worth a reply" is the inbox at its side · the field this update
// (entity scoreboard + one grounded sentence) · top voices · your own accounts
// (moved here from Trends: follower sparklines + the top explained movement).
// Grid: 7×3 + 5×4 + 4×3 + 3×3 + 5×2 = 72 cells. Every tile gates
// on its data and shows an honest empty line at its size. Numbers rule: counts,
// views and measured engagement — hook styles, formats and insight categories
// only group and order. Video tiles anchor on the newest update WITH videos,
// excluding in-flight ones; the inbox anchors on the latest completed analysis
// (engage-section.tsx), so the two can differ while an update is mid-flight.
// Hooks are read from captions + comments — and the speech transcript when one
// was captured — never the footage itself.

interface VideoRow {
  id: string
  platform: string
  account_name: string
  account_followers: number | null
  video_url: string
  views: number | null
  likes: number | null
  engagement_rate: number | null
  upload_date: string | null
  duration_seconds: number | null
  audio_name: string | null
  transcript_status: string | null
  is_client: boolean
  is_competitor: boolean
  competitor_name: string | null
  sentiment: string | null
  classified_type: string | null
  hook_style: string | null
  hook_text: string | null
  topics: string[] | null
}

const pretty = (s: string) => s.replace(/[-_]/g, ' ')

/** Max catalog rows rendered in the "All videos" drawer (the query stays
 *  uncapped — the tiles need the full update). */
const CATALOG_CAP = 100
/** Accounts in the "All voices" drawer, and in the tile. */
const VOICES_ALL = 12
const VOICES_SHOWN = 5
/** Hook styles / formats listed per column in "What works right now". */
const PERF_SHOWN = 6
/** Bar track width shared by both columns — the lists read on one scale. */
const PERF_BAR = 72

const durationLabel = (secs: number) => {
  const m = Math.floor(secs / 60)
  const s = Math.round(secs % 60)
  return m > 0 ? `${m}:${String(s).padStart(2, '0')} min` : `${s}s`
}

type EntityKind = FieldRow['kind']
const entityKey = (v: VideoRow): { label: string; kind: EntityKind } =>
  v.is_client ? { label: 'You', kind: 'you' }
  : v.is_competitor ? { label: v.competitor_name ?? 'Competitor', kind: 'competitor' }
  : { label: 'Category creators', kind: 'category' }

/** One scoreboard row per entity: You / each competitor / category creators. */
interface EntityRow extends FieldRow {
  medianDuration: number | null
  engN: number
}

const medianOf = (nums: number[]): number | null => {
  if (nums.length === 0) return null
  const s = [...nums].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

function entityScoreboard(all: VideoRow[]): EntityRow[] {
  const groups = new Map<string, { kind: EntityKind; vids: VideoRow[] }>()
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
      medianDuration: medianOf(vids.map((v) => Number(v.duration_seconds)).filter((d) => d > 0)),
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

function durationPerf(all: VideoRow[]): DurationBandPerf[] {
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
interface EntityPlaybook {
  label: string
  kind: EntityKind
  total: number
  classified: number
  topFormats: { k: string; count: number }[]
  topHook: { k: string; count: number } | null
}

function entityPlaybooks(all: VideoRow[]): EntityPlaybook[] {
  const groups = new Map<string, { kind: EntityKind; vids: VideoRow[] }>()
  for (const v of all) {
    const { label, kind } = entityKey(v)
    const g = groups.get(label) ?? { kind, vids: [] }
    g.vids.push(v)
    groups.set(label, g)
  }
  const top = (vids: VideoRow[], key: 'classified_type' | 'hook_style') => {
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
function trendingSounds(all: VideoRow[]) {
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

// Colour jobs (MASTER rule 2): you = green, a competitor = orange (then paler
// oranges), category / creators = grey.
const KIND_COLOR: Record<EntityKind, string> = { you: 'var(--you)', competitor: 'var(--comp)', category: 'var(--cat)' }
const COMPETITOR_COLORS = ['var(--comp)', 'color-mix(in srgb, var(--comp) 70%, var(--tile))', 'color-mix(in srgb, var(--comp) 48%, var(--tile))', 'var(--mixed)']
const ROLE_COLOR: Record<VoiceRole, string> = { you: 'var(--you)', competitor: 'var(--comp)', creator: 'var(--cat)' }
const ROLE_WORD: Record<VoiceRole, string> = { you: 'you', competitor: 'competitor', creator: 'creator' }
// Literal Tailwind classes (never interpolated).
const KIND_CHIP: Record<EntityKind, string> = {
  you: 'bg-accent text-accent-foreground',
  competitor: 'bg-comp/15 text-foreground',
  category: 'bg-inner text-muted-foreground',
}
const ROLE_CHIP: Record<VoiceRole, string> = {
  you: 'bg-accent text-accent-foreground',
  competitor: 'bg-comp/15 text-foreground',
  creator: 'bg-inner text-muted-foreground',
}

/** One column of "What works right now": heading, then up to PERF_SHOWN rows of
 *  label | bar | multiple — one row height, one font size, one bar scale. */
function PerfList({ heading, rows, max, empty }: { heading: string; rows: PerfMultiple[]; max: number; empty: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <span className="mb-0.5 text-[10px] font-semibold uppercase tracking-[0.07em] text-muted-foreground">{heading}</span>
      {rows.length > 0 ? rows.map((r) => (
        <RankedBar key={r.k} className="h-[22px]" barWidth={PERF_BAR} color="var(--primary)"
          pct={max > 0 ? (r.multiple / max) * 100 : 0}
          label={<span className="capitalize" title={`${r.count} videos · ${fmtPct(r.avgEng)} average engagement`}>{pretty(r.k)}</span>}
          count={fmtMultiple(r.multiple)}
        />
      )) : <TileEmpty>{empty}</TileEmpty>}
    </div>
  )
}

/** A small stat cell: eyebrow, mono value, one quiet note. */
function StatCell({ label, value, note, noteTitle }: { label: string; value: string; note: string; noteTitle?: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 border-t border-border/70 pt-2.5">
      <span className="text-[10px] font-semibold uppercase tracking-[0.07em] text-muted-foreground">{label}</span>
      <span className="truncate font-mono text-[15px] font-semibold tabular-nums leading-[1.2]">{value}</span>
      <span className="truncate text-[11.5px] text-muted-foreground" title={noteTitle}>{note}</span>
    </div>
  )
}

export default async function ContentPage({
  searchParams,
}: {
  searchParams?: Promise<{ detail?: string; intent?: string }>
}) {
  const sp = (await searchParams) ?? {}
  const intentFilter = isIntent(sp.intent) ? sp.intent : null
  // Auth + tenant via the RLS-enforced session client. See lib/auth.ts.
  const { supabase, clientId } = await getSessionContext()

  // Only the anchor query below needs the in-flight run ids; everything else
  // is keyed on the client alone, so it goes out in the same wave as the
  // running-runs lookup — round trips, not rows, are the cost (the DB pays a
  // ~0.5s wake-up on the first requests after idle, and every sequential wave
  // pays it again).
  const [{ data: runningRuns }, { data: tc }, digest, snapRows, { data: eventData }] = await Promise.all([
    supabase.from('pipeline_runs').select('id').eq('client_id', clientId).eq('status', 'running'),
    supabase.from('tracking_configs').select('own_handles').eq('client_id', clientId).maybeSingle(),
    loadEngageDigest(supabase, clientId),
    // Daily follower snapshots (three platforms cross the 1000-row cap in ~11 months).
    selectAll<{ platform: string; snapshot_date: string; followers: number | null }>(() =>
      supabase.from('account_snapshots').select('platform, snapshot_date, followers').eq('client_id', clientId).order('snapshot_date', { ascending: true }),
    ),
    // Measured movements on the client's own accounts, newest first (Trends' logic).
    supabase.from('account_events')
      .select('platform, metric, event_date, severity, magnitude_label, explained, explanation')
      .eq('client_id', clientId).order('event_date', { ascending: false }),
  ])

  // Anchor on the newest update WITH videos, excluding in-flight ones (the
  // dashboard's videoRunId pattern) — the page keeps serving the previous
  // update while a new one is collecting.
  const runningIds = ((runningRuns ?? []) as { id: string }[]).map((r) => r.id)
  let vidQ = supabase.from('videos').select('run_id, scraped_at').eq('client_id', clientId)
  if (runningIds.length) vidQ = vidQ.not('run_id', 'in', `(${runningIds.join(',')})`)
  const { data: latestVid } = await vidQ.order('scraped_at', { ascending: false }).limit(1).maybeSingle()

  const ownHandles = new Set(
    Object.values(((tc as { own_handles?: Record<string, string> } | null)?.own_handles ?? {}) as Record<string, string>)
      .filter((h): h is string => typeof h === 'string' && h.length > 0)
      .map(handleKey),
  )

  if (!latestVid) {
    return (
      <PageFrame>
        <PageBar title="Content" context="What content works, and who to answer?" />
        <PageGrid>
          <Tile col={12} row={2} eyebrow="Your first update">
            <TileEmpty>Your content intelligence lands with your first update — check back then.</TileEmpty>
          </Tile>
        </PageGrid>
      </PageFrame>
    )
  }
  const videoRunId = latestVid.run_id as string
  const updateDate = latestVid.scraped_at as string | null

  // Discovered videos only — the client's own posts are a different segment
  // (Owned-Data-Plan: "segment, never blend") and never mix into market content
  // intelligence.
  const all = await selectAll<VideoRow>(() => supabase.from('videos')
    .select('id, platform, account_name, account_followers, video_url, views, likes, engagement_rate, upload_date, duration_seconds, audio_name, transcript_status, is_client, is_competitor, competitor_name, sentiment, classified_type, hook_style, hook_text, topics')
    .eq('client_id', clientId).eq('run_id', videoRunId).eq('source', 'discovered')
    .order('views', { ascending: false }).order('id', { ascending: true }))

  // ── the inbox ──────────────────────────────────────────────────────────
  const roles = roleByAccount(all)
  const inbox = digest ? shapeInbox(digest, { now: new Date().toISOString(), ownHandles, roleByAccount: roles }) : []

  // ── what works right now ───────────────────────────────────────────────
  const analysed = all.filter((v) => v.classified_type != null)
  const hooks = perfVsMedian(analysed, 'hook_style', { top: PERF_SHOWN })
  const formats = perfVsMedian(analysed, 'classified_type', { top: PERF_SHOWN })
  // One scale for both columns: the same multiple draws the same bar.
  const perfMax = Math.max(hooks[0]?.multiple ?? 0, formats[0]?.multiple ?? 0)
  const duration = bestDuration(durationPerf(all), medianEngagement(analysed))
  const sounds = trendingSounds(all)
  const topSound = sounds[0] ?? null
  const playbooks = entityPlaybooks(all).filter((p) => p.classified > 0)

  // ── the field ──────────────────────────────────────────────────────────
  const scoreboard = entityScoreboard(all)
  const fieldRows = [
    ...scoreboard.filter((r) => r.kind === 'you'),
    ...scoreboard.filter((r) => r.kind === 'competitor').slice(0, 2),
    ...scoreboard.filter((r) => r.kind === 'category'),
  ]
  const fieldEngMax = Math.max(...fieldRows.map((r) => r.avgEng ?? 0), 0)
  const sentence = fieldSentence(scoreboard)
  let compIdx = 0
  const rowColor = (r: EntityRow) => r.kind === 'competitor' ? COMPETITOR_COLORS[Math.min(compIdx++, COMPETITOR_COLORS.length - 1)] : KIND_COLOR[r.kind]
  const fieldColors = new Map(fieldRows.map((r) => [r.label, rowColor(r)]))

  // ── top voices ─────────────────────────────────────────────────────────
  const voices = topVoices(all, VOICES_SHOWN)
  const voicesAll = topVoices(all, VOICES_ALL)
  const voiceMax = voices[0]?.views ?? 0
  const voiceLine = (v: { role: VoiceRole; competitorName: string | null; topFormat: string | null; videos: number }) =>
    [
      v.role === 'competitor' && v.competitorName ? `competitor · ${v.competitorName}` : ROLE_WORD[v.role],
      v.topFormat ? pretty(v.topFormat) : null,
      `${v.videos} ${v.videos === 1 ? 'video' : 'videos'}`,
    ].filter(Boolean).join(' · ')

  // ── your accounts (Trends' logic: snapshots → series; events newest first,
  // the first explained one speaks) ──────────────────────────────────────
  const accounts = accountSeries(snapRows, 30)
  const events = (eventData ?? []) as { platform: string; metric: string; event_date: string; severity: number; explained: boolean; magnitude_label: string; explanation: string | null }[]
  const sortedEvents = [...events].sort((a, b) => b.event_date.localeCompare(a.event_date) || b.severity - a.severity)
  const topEvent = sortedEvents.find((e) => e.explained && e.explanation) ?? sortedEvents[0] ?? null
  const explainedPlatforms = new Set(sortedEvents.filter((e) => e.explained && e.metric === 'followers').map((e) => e.platform))

  // ── overlays ───────────────────────────────────────────────────────────
  const basePath = '/dashboard/videos'
  const closeHref = intentFilter ? `${basePath}?intent=${intentFilter}` : basePath
  const showLegend = sp.detail === 'legend'

  const context = `What content works, and who to answer?${updateDate ? ` · ${weekdayDate(updateDate)}` : ''}`

  return (
    <PageFrame>
      <PageBar title="Content" context={context}>
        <BarPill>This update</BarPill>
        <BarPill>All platforms</BarPill>
        <HowToRead items={['conversations']} open={showLegend} basePath={basePath} />
      </PageBar>

      <PageGrid>
        {/* ── what works right now (the lead) ────────────────────────── */}
        <Tile col={7} row={3} eyebrow="What works right now" meta="vs median · this update"
          distribute="between" bodyClassName="gap-4"
          footer={playbooks.length > 1 ? <DrawerLink href={`${basePath}?detail=playbooks`}>Playbooks side by side →</DrawerLink> : undefined}
        >
          {hooks.length > 0 || formats.length > 0 ? (
            <>
              <div className="grid grid-cols-2 gap-x-6">
                <PerfList heading="Hooks" rows={hooks} max={perfMax} empty="Hooks land once 3+ videos share a style." />
                <PerfList heading="Formats" rows={formats} max={perfMax} empty="Formats land once 3+ videos share one." />
              </div>
              {(duration || topSound) && (
                <div className="grid grid-cols-2 gap-x-6">
                  {duration && (
                    <StatCell label="Best length" value={duration.best.label}
                      note={duration.multiple != null
                        ? `${fmtMultiple(duration.multiple)} the median · ${fmtInt(duration.best.count)} videos`
                        : `${fmtPct(duration.best.avgEng ?? 0)} average · ${fmtInt(duration.best.count)} videos`}
                    />
                  )}
                  {topSound && (
                    <StatCell label="Top sound" value={`${fmtInt(topSound.count)} videos`} note={`“${topSound.name}”`} noteTitle={topSound.name} />
                  )}
                </div>
              )}
            </>
          ) : (
            <TileEmpty>Hooks and formats land once this update’s videos are analysed.</TileEmpty>
          )}
        </Tile>

        {/* ── the reply inbox ────────────────────────────────────────── */}
        <EngageInboxTile digest={digest} rows={inbox} filter={intentFilter} />

        {/* ── the field this update ──────────────────────────────────── */}
        <Tile col={4} row={3} eyebrow="The field this update" meta={`${fmtInt(all.length)} videos · ${fmtInt(analysed.length)} analysed`}
          distribute="between" bodyClassName="gap-3"
          footer={all.length > 0 ? <DrawerLink href={`${basePath}?detail=videos`}>All {fmtInt(all.length)} videos →</DrawerLink> : undefined}
          footerNote={scoreboard.length > fieldRows.length ? `${scoreboard.length - fieldRows.length} more in the playbooks` : undefined}
        >
          {scoreboard.length > 1 ? (
            <>
              <table className="w-full border-collapse text-[12px] leading-[1.3]">
                <thead>
                  <tr className="text-[10px] uppercase tracking-[0.06em] text-muted-foreground">
                    <th className="pb-1.5 text-left font-semibold">Who</th>
                    <th className="pb-1.5 text-right font-semibold">Videos</th>
                    <th className="pb-1.5 text-right font-semibold">Views</th>
                    <th className="pb-1.5 pl-3 text-left font-semibold">Eng.</th>
                  </tr>
                </thead>
                <tbody>
                  {fieldRows.map((r) => (
                    <tr key={r.label} className="border-t border-border/70">
                      <td className="w-[42%] py-2 pr-2">
                        <span className="flex items-center gap-1.5">
                          <span className="size-1.5 shrink-0 rounded-full" style={{ background: fieldColors.get(r.label) }} aria-hidden />
                          <span className="truncate">{r.label}</span>
                        </span>
                      </td>
                      <td className="py-2 text-right font-mono tabular-nums">{fmtInt(r.videos)}</td>
                      <td className="py-2 text-right font-mono tabular-nums text-muted-foreground">{r.views > 0 ? fmtCompact(r.views) : '—'}</td>
                      <td className="py-2 pl-3">
                        {r.avgEng != null ? (
                          <span className="flex items-center gap-1.5" title={`across ${r.engN} of ${r.videos} videos with engagement data`}>
                            <span className="h-1.5 w-[48px] shrink-0 overflow-hidden rounded-full bg-inner" aria-hidden>
                              <span className="block h-full rounded-full" style={{ width: `${Math.max(2, (r.avgEng / (fieldEngMax || 1)) * 100)}%`, background: fieldColors.get(r.label) }} />
                            </span>
                            <span className="font-mono text-[11.5px] tabular-nums">{fmtPct(r.avgEng)}</span>
                          </span>
                        ) : <span className="text-muted-foreground">—</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {sentence && <p className="line-clamp-3 text-[12px] leading-[1.45] text-muted-foreground">{sentence}</p>}
            </>
          ) : all.length > 0 ? (
            <TileEmpty>The field fills in once a competitor or your own posts are tracked — this update has {fmtInt(all.length)} category videos.</TileEmpty>
          ) : (
            <TileEmpty>No videos in this update yet — the next one lands soon.</TileEmpty>
          )}
        </Tile>

        {/* ── top voices ─────────────────────────────────────────────── */}
        <Tile col={3} row={3} eyebrow="Top voices" meta="by views · this update"
          distribute="center"
          footer={voicesAll.length > voices.length ? <DrawerLink href={`${basePath}?detail=voices`}>All voices →</DrawerLink> : undefined}
        >
          {voices.length > 0 ? (
            <div className="flex flex-col">
              {voices.map((v) => (
                <div key={v.name} className="flex items-center gap-2.5 border-t border-border/70 py-2 first:border-t-0 first:pt-0 last:pb-0">
                  <span className="grid size-[26px] shrink-0 place-items-center rounded-full text-[10px] font-semibold text-tile" style={{ background: ROLE_COLOR[v.role] }} aria-hidden>{initials(v.name)}</span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[12.5px] font-semibold">@{v.name}</div>
                    <div className="truncate text-[11px] text-muted-foreground">{voiceLine(v)}</div>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <span className="font-mono text-[11.5px] font-semibold tabular-nums">{v.views > 0 ? fmtCompact(v.views) : '—'}</span>
                    <span className="h-1.5 w-[56px] overflow-hidden rounded-full bg-inner" aria-hidden>
                      <span className="block h-full rounded-full" style={{ width: `${Math.max(2, voiceMax > 0 ? (v.views / voiceMax) * 100 : 0)}%`, background: ROLE_COLOR[v.role] }} />
                    </span>
                  </div>
                </div>
              ))}
            </div>
          ) : <TileEmpty>Voices land with the first update that finds videos.</TileEmpty>}
        </Tile>

        {/* ── your accounts ──────────────────────────────────────────── */}
        <Tile col={5} row={2} eyebrow="On your accounts" meta={accounts.length > 0 ? 'followers · daily · 30 days' : undefined}
          distribute="between" bodyClassName="gap-3"
        >
          {accounts.length > 0 ? (
            <>
              <div className="flex flex-col gap-2">
                {accounts.slice(0, 3).map((a) => (
                  <div key={a.platform} className="flex items-center gap-3">
                    <PlatformIcon platform={a.platform} size={14} className="shrink-0 text-secondary-foreground" />
                    <span className="sr-only">{platformLabel(a.platform)}</span>
                    <div className="min-w-0 flex-1"><Sparkline values={a.values} width={270} height={28} fill /></div>
                    <div className="flex min-w-[96px] flex-col items-end">
                      <span className="font-mono text-[12.5px] font-semibold tabular-nums">{fmtCompact(a.latest)}</span>
                      <span className="whitespace-nowrap">
                        <Delta value={a.delta} good="up" />
                        {explainedPlatforms.has(a.platform) && <span className="font-mono text-[11px] text-muted-foreground"> · explained</span>}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
              {topEvent && (
                <p className="flex items-start gap-2 text-[12px] leading-[1.45]">
                  <span className="mt-[6px] size-1.5 shrink-0 rounded-full bg-warning" aria-hidden />
                  <span className="line-clamp-2">
                    {topEvent.explained && topEvent.explanation
                      ? topEvent.explanation
                      : `${topEvent.magnitude_label} on ${platformLabel(topEvent.platform)} — the conversation we track doesn’t account for it, so it stays unexplained.`}
                  </span>
                </p>
              )}
            </>
          ) : <TileEmpty>Add your own handles in Settings to follow your accounts here.</TileEmpty>}
        </Tile>
      </PageGrid>

      {/* ── drawers: one click deeper ────────────────────────────────── */}
      <EngageDrawers digest={digest} rows={inbox} detail={sp.detail} filter={intentFilter} />

      <DetailDrawer value="playbooks" closeHref={closeHref} title="Content playbooks, side by side" description="what each player leans on this update — coverage shown per row, because not every video can be read confidently">
        <table className="w-full text-[12px]">
          <thead>
            <tr className="border-b text-[10px] uppercase tracking-[0.06em] text-muted-foreground">
              <th className="pb-1.5 pr-3 text-left font-semibold">Who</th>
              <th className="pb-1.5 pr-3 text-left font-semibold">Leans on</th>
              <th className="pb-1.5 pr-3 text-left font-semibold">Favourite hook</th>
              <th className="pb-1.5 text-right font-semibold">Read from</th>
            </tr>
          </thead>
          <tbody>
            {playbooks.map((p) => (
              <tr key={p.label} className="border-b align-top last:border-0">
                <td className="py-2 pr-3">
                  <span className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium ${KIND_CHIP[p.kind]}`}>{p.label}</span>
                </td>
                <td className="py-2 pr-3">
                  {p.topFormats.length > 0 ? (
                    <span className="flex flex-wrap gap-1">
                      {p.topFormats.map((f) => (
                        <span key={f.k} className="inline-block rounded-full bg-inner px-2 py-0.5 text-[11px] capitalize">
                          {pretty(f.k)} <span className="text-muted-foreground">×{f.count}</span>
                        </span>
                      ))}
                    </span>
                  ) : <span className="text-muted-foreground">—</span>}
                </td>
                <td className="py-2 pr-3 capitalize text-muted-foreground">{p.topHook ? `${pretty(p.topHook.k)} (${p.topHook.count})` : '—'}</td>
                <td className="whitespace-nowrap py-2 text-right text-[11px] text-muted-foreground">{p.classified} of {p.total} videos</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-3 text-[11px] text-muted-foreground">Hooks are read from each video’s caption, its speech transcript when captured, and the conversation it sparked — never the footage.</p>
      </DetailDrawer>

      <DetailDrawer value="voices" closeHref={closeHref} title="Top voices this update" description="the accounts driving the category conversation, by views">
        <table className="w-full text-[12px]">
          <thead>
            <tr className="border-b text-[10px] uppercase tracking-[0.06em] text-muted-foreground">
              <th className="pb-1.5 pr-3 text-left font-semibold">Account</th>
              <th className="pb-1.5 pr-3 text-left font-semibold">Who</th>
              <th className="pb-1.5 pr-3 text-right font-semibold">Videos</th>
              <th className="pb-1.5 text-right font-semibold">Views</th>
            </tr>
          </thead>
          <tbody>
            {voicesAll.map((v) => (
              <tr key={v.name} className="border-b last:border-0">
                <td className="py-1.5 pr-3">
                  <div className="font-medium">@{v.name}</div>
                  {v.topFormat && <div className="text-[11px] capitalize text-muted-foreground">{pretty(v.topFormat)}</div>}
                </td>
                <td className="py-1.5 pr-3"><span className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium ${ROLE_CHIP[v.role]}`}>{v.role === 'competitor' && v.competitorName ? v.competitorName : ROLE_WORD[v.role]}</span></td>
                <td className="py-1.5 pr-3 text-right font-mono tabular-nums text-muted-foreground">{v.videos}</td>
                <td className="py-1.5 text-right font-mono tabular-nums font-semibold">{v.views > 0 ? fmtCompact(v.views) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </DetailDrawer>

      <DetailDrawer value="videos" closeHref={closeHref} title="All videos" description={all.length > CATALOG_CAP ? `top ${CATALOG_CAP} of ${fmtInt(all.length)} by views` : `${fmtInt(all.length)} videos this update, by views`}>
        <EnhancedTable filterPlaceholder="Filter videos — account, who, format, hook, topic…">
          <table className="w-full min-w-[860px] text-[11.5px]">
            <thead>
              <tr className="border-b text-[10px] uppercase tracking-[0.06em] text-muted-foreground">
                {([['Platform', 'str'], ['Account', 'str'], ['Who', 'str'], ['Posted', 'str'], ['Length', 'num'], ['Views', 'num'], ['Likes', 'num'], ['Eng.', 'num'], ['Sentiment', 'str'], ['Format', 'str'], ['Hook', 'str'], ['Topics', null]] as [string, string | null][]).map(([h, sort]) => (
                  <th key={h} data-sort={sort ?? undefined} className={`pb-1.5 pr-2 font-semibold ${['Views', 'Likes', 'Eng.', 'Length'].includes(h) ? 'text-right' : 'text-left'}`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {all.slice(0, CATALOG_CAP).map((v) => {
                const { label, kind } = entityKey(v)
                return (
                  <tr key={v.id} data-search={`${v.account_name} ${label} ${platformLabel(v.platform)} ${v.classified_type ?? ''} ${v.hook_style ?? ''} ${(v.topics ?? []).join(' ')} ${v.sentiment ?? ''}`.toLowerCase()} className="border-b align-top last:border-0">
                    <td className="py-1.5 pr-2 capitalize">{platformLabel(v.platform)}</td>
                    <td className="py-1.5 pr-2" data-v={v.account_name ?? ''}>
                      <a href={v.video_url} target="_blank" rel="noopener noreferrer" className="text-foreground hover:underline">@{v.account_name}</a>
                      {v.transcript_status === 'ok' && (
                        <Captions className="ml-1 inline size-3 align-[-1px] text-muted-foreground" aria-label="Speech transcript captured" />
                      )}
                    </td>
                    <td className="py-1.5 pr-2" data-v={label}><span className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-[10.5px] font-medium ${KIND_CHIP[kind]}`}>{label}</span></td>
                    <td className="whitespace-nowrap py-1.5 pr-2 text-muted-foreground" data-v={v.upload_date ?? ''}>{v.upload_date ?? '—'}</td>
                    <td className="whitespace-nowrap py-1.5 pr-2 text-right text-muted-foreground" data-v={Number(v.duration_seconds) || ''}>{Number(v.duration_seconds) > 0 ? durationLabel(Number(v.duration_seconds)) : '—'}</td>
                    <td className="py-1.5 pr-2 text-right font-mono tabular-nums" data-v={Number(v.views) || ''}>{Number(v.views) > 0 ? fmtCompact(Number(v.views)) : '—'}</td>
                    <td className="py-1.5 pr-2 text-right font-mono tabular-nums text-muted-foreground" data-v={v.likes != null ? Number(v.likes) : ''}>{v.likes != null ? fmtCompact(Number(v.likes)) : '—'}</td>
                    <td className="py-1.5 pr-2 text-right font-mono tabular-nums" data-v={v.engagement_rate ?? ''}>{v.engagement_rate != null ? `${v.engagement_rate}%` : '—'}</td>
                    <td className="py-1.5 pr-2">{v.sentiment ? <span className={`inline-block rounded-full px-2 py-0.5 text-[10.5px] font-medium capitalize ${SENTIMENT_BADGE[v.sentiment] ?? 'bg-inner text-muted-foreground'}`}>{v.sentiment}</span> : <span className="text-muted-foreground">—</span>}</td>
                    <td className="py-1.5 pr-2 capitalize">{v.classified_type ? pretty(v.classified_type) : <span className="text-muted-foreground">—</span>}</td>
                    <td className="py-1.5 pr-2 capitalize">{v.hook_style ? pretty(v.hook_style) : <span className="text-muted-foreground">—</span>}</td>
                    <td className="py-1.5 text-muted-foreground">{(v.topics ?? []).slice(0, 3).join(', ') || '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </EnhancedTable>
      </DetailDrawer>
    </PageFrame>
  )
}
