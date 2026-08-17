import { Zap, Film, Megaphone, Play, Captions, LayoutGrid, Timer, Music } from 'lucide-react'
import { selectAll } from '@/lib/supabase-admin'
import { getSessionContext } from '@/lib/auth'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ProportionBar } from '@/components/proportion-bar'
import { SENTIMENT_BADGE } from '@/lib/ui-colors'
import { EngageSection } from './engage-section'

// Content — "What content works in this niche?" (Redesign Spec §6). Four
// layers over the latest update's videos: hook intelligence (hook_style ranked
// by engagement with real hook_text examples), content-type performance, top
// voices (the accounts driving the category conversation — strategy content
// pillar #5), and the full catalog as the evidence layer at the bottom.
// Demo-layout ranked tables with inline single-hue bars (magnitude, not
// identity — dataviz rules; values always labelled). Anchored on the newest
// gather with data, excluding in-flight runs, like the dashboard. Honesty
// rule (positioning): hooks are read from captions + comments — and, since
// Pass A v4 (TRANSCRIPTS_ENABLED), from the video's transcript when one was
// captured; still never the footage itself.

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

const fmt = (n: number) =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M`
  : n >= 1_000   ? `${(n / 1_000).toFixed(0)}K`
  : String(n)

const pretty = (s: string) => s.replace(/[-_]/g, ' ')

/** Max catalog rows rendered (the query stays run-scoped but uncapped — the
 *  aggregates above the table need the full update). */
const CATALOG_CAP = 100
/** Accounts shown in Top voices. */
const VOICES_SHOWN = 10

interface PerfRow {
  k: string
  count: number
  avgEng: number | null
  topExample: string | null
}

// Aggregate avg engagement + count by a classification field; the example is
// the hook_text of the group's highest-engagement video.
function perfBy(videos: VideoRow[], key: 'hook_style' | 'classified_type'): PerfRow[] {
  const map = new Map<string, { count: number; eng: number; engN: number; best: VideoRow | null }>()
  for (const v of videos) {
    const k = v[key]
    if (!k) continue
    const g = map.get(k) ?? { count: 0, eng: 0, engN: 0, best: null }
    g.count++
    if (Number(v.engagement_rate) > 0) {
      g.eng += Number(v.engagement_rate)
      g.engN++
      if (!g.best || Number(v.engagement_rate) > Number(g.best.engagement_rate)) g.best = v
    }
    map.set(k, g)
  }
  return [...map.entries()]
    .map(([k, { count, eng, engN, best }]) => ({
      k, count,
      avgEng: engN > 0 ? eng / engN : null,
      topExample: best?.hook_text ?? null,
    }))
    .sort((a, b) => (b.avgEng ?? -1) - (a.avgEng ?? -1))
}

// Literal Tailwind classes (ProportionBar rule — never interpolate).
const PLATFORM_COLOR: Record<string, string> = {
  tiktok: 'bg-chart-1',
  youtube: 'bg-chart-2',
  instagram: 'bg-chart-3',
}

const median = (nums: number[]): number | null => {
  if (nums.length === 0) return null
  const s = [...nums].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

const durationLabel = (secs: number) => {
  const m = Math.floor(secs / 60)
  const s = Math.round(secs % 60)
  return m > 0 ? `${m}:${String(s).padStart(2, '0')} min` : `${s}s`
}

/** One scoreboard row per entity: You / each competitor / the wider category. */
interface EntityRow {
  label: string
  videos: number
  platforms: Map<string, number>
  medianDuration: number | null
  avgEng: number | null
  engN: number
  views: number
}

function entityScoreboard(all: VideoRow[]): EntityRow[] {
  const groups = new Map<string, VideoRow[]>()
  for (const v of all) {
    const key = v.is_client ? 'You' : v.is_competitor ? (v.competitor_name ?? 'Competitor') : 'Wider category'
    groups.set(key, [...(groups.get(key) ?? []), v])
  }
  const rows = [...groups.entries()].map(([label, vids]) => {
    const platforms = new Map<string, number>()
    for (const v of vids) platforms.set(v.platform, (platforms.get(v.platform) ?? 0) + 1)
    const withEng = vids.filter((v) => Number(v.engagement_rate) > 0)
    return {
      label,
      videos: vids.length,
      platforms,
      medianDuration: median(vids.map((v) => Number(v.duration_seconds)).filter((d) => d > 0)),
      avgEng: withEng.length > 0 ? withEng.reduce((s, v) => s + Number(v.engagement_rate), 0) / withEng.length : null,
      engN: withEng.length,
      views: vids.reduce((s, v) => s + Number(v.views ?? 0), 0),
    }
  })
  const order = (r: EntityRow) => (r.label === 'You' ? 0 : r.label === 'Wider category' ? 2 : 1)
  return rows.sort((a, b) => order(a) - order(b) || b.videos - a.videos)
}

const DURATION_BANDS: { label: string; min: number; max: number }[] = [
  { label: 'Under 15s', min: 0, max: 15 },
  { label: '15–30s', min: 15, max: 30 },
  { label: '30–60s', min: 30, max: 60 },
  { label: 'Over 1 min', min: 60, max: Infinity },
]

function durationPerf(all: VideoRow[]) {
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
 *  coverage stated per row (the batch classifier covers most of a corpus, but
 *  never all — "n of m" keeps thin slices honest). */
interface EntityPlaybook {
  label: string
  total: number
  classified: number
  topFormats: { k: string; count: number }[]
  topHook: { k: string; count: number } | null
}

function entityPlaybooks(all: VideoRow[]): EntityPlaybook[] {
  const groups = new Map<string, VideoRow[]>()
  for (const v of all) {
    const key = v.is_client ? 'You' : v.is_competitor ? (v.competitor_name ?? 'Competitor') : 'Wider category'
    groups.set(key, [...(groups.get(key) ?? []), v])
  }
  const top = (vids: VideoRow[], key: 'classified_type' | 'hook_style') => {
    const counts = new Map<string, number>()
    for (const v of vids) {
      const k = v[key]
      if (k) counts.set(k, (counts.get(k) ?? 0) + 1)
    }
    return [...counts.entries()].map(([k, count]) => ({ k, count })).sort((a, b) => b.count - a.count)
  }
  const rows = [...groups.entries()].map(([label, vids]) => ({
    label,
    total: vids.length,
    classified: vids.filter((v) => v.classified_type != null).length,
    topFormats: top(vids, 'classified_type').slice(0, 3),
    topHook: top(vids, 'hook_style')[0] ?? null,
  }))
  const order = (r: EntityPlaybook) => (r.label === 'You' ? 0 : r.label === 'Wider category' ? 2 : 1)
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

export default async function ContentPage({
  searchParams,
}: {
  searchParams?: Promise<{ detail?: string }>
}) {
  const sp = (await searchParams) ?? {}
  // Auth + tenant via the RLS-enforced session client. See lib/auth.ts.
  const { supabase, clientId } = await getSessionContext()

  // Anchor on the newest gather WITH data, excluding in-flight runs (the
  // dashboard's videoRunId pattern) — the page keeps serving the previous
  // update while a new one is collecting.
  const { data: runningRuns } = await supabase.from('pipeline_runs').select('id')
    .eq('client_id', clientId).eq('status', 'running')
  const runningIds = ((runningRuns ?? []) as { id: string }[]).map((r) => r.id)
  let vidQ = supabase.from('videos').select('run_id').eq('client_id', clientId)
  if (runningIds.length) vidQ = vidQ.not('run_id', 'in', `(${runningIds.join(',')})`)
  const { data: latestVid } = await vidQ.order('scraped_at', { ascending: false }).limit(1).maybeSingle()

  if (!latestVid) {
    return (
      <div className="space-y-6">
        <PageHeader sub={null} />
        <EmptyState>Your content intelligence lands with your first update — check back then.</EmptyState>
      </div>
    )
  }
  const videoRunId = latestVid.run_id as string

  // Discovered corpus only — the client's own posts are a different segment
  // (Owned-Data-Plan: "segment, never blend") and never mix into market content
  // intelligence.
  const all = await selectAll<VideoRow>(() => supabase.from('videos')
    .select('id, platform, account_name, account_followers, video_url, views, likes, engagement_rate, upload_date, duration_seconds, audio_name, transcript_status, is_client, is_competitor, competitor_name, sentiment, classified_type, hook_style, hook_text, topics')
    .eq('client_id', clientId).eq('run_id', videoRunId).eq('source', 'discovered')
    .order('views', { ascending: false }).order('id', { ascending: true }))

  const analysed = all.filter((v) => v.classified_type != null)
  const hookPerf = perfBy(analysed, 'hook_style')
  const typePerf = perfBy(analysed, 'classified_type')
  const maxHookEng = Math.max(...hookPerf.map((h) => h.avgEng ?? 0), 0)
  const maxTypeEng = Math.max(...typePerf.map((t) => t.avgEng ?? 0), 0)

  const scoreboard = entityScoreboard(all)
  const durations = durationPerf(all)
  const maxDurEng = Math.max(...durations.map((d) => d.avgEng ?? 0), 0)
  const sounds = trendingSounds(all)
  const playbooks = entityPlaybooks(all).filter((p) => p.classified > 0)

  // ---- Top voices: the accounts driving the category conversation ----
  const byAccount = new Map<string, { videos: number; views: number; eng: number; engN: number; followers: number; entity: string }>()
  for (const v of all) {
    const g = byAccount.get(v.account_name) ?? { videos: 0, views: 0, eng: 0, engN: 0, followers: 0, entity: 'industry' }
    g.videos++
    g.views += Number(v.views ?? 0)
    if (Number(v.engagement_rate) > 0) { g.eng += Number(v.engagement_rate); g.engN++ }
    g.followers = Math.max(g.followers, Number(v.account_followers ?? 0))
    if (v.is_client) g.entity = 'brand'
    else if (v.is_competitor && g.entity === 'industry') g.entity = v.competitor_name ?? 'competitor'
    byAccount.set(v.account_name, g)
  }
  const voices = [...byAccount.entries()]
    .map(([name, g]) => ({ name, ...g, avgEng: g.engN > 0 ? g.eng / g.engN : null }))
    .sort((a, b) => b.views - a.views)
    .slice(0, VOICES_SHOWN)

  const roleChip = (entity: string) =>
    entity === 'brand' ? 'bg-positive/12 text-positive'
    : entity === 'industry' ? 'bg-muted text-muted-foreground'
    : 'bg-clay/10 text-clay'

  const roleOf = (v: VideoRow) =>
    v.is_client ? 'brand' : v.is_competitor ? (v.competitor_name ?? 'competitor') : 'industry'

  return (
    <div className="space-y-6">
      <PageHeader
        sub={`${all.length} videos in this update · ${analysed.length} analysed for hooks & format`}
      />

      {all.length === 0 && <EmptyState>No videos in this update yet — the next one lands soon.</EmptyState>}

      {/* Entity scoreboard — who posted what this update, side by side */}
      {scoreboard.length > 1 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base"><LayoutGrid className="size-4 text-primary" aria-hidden /> The field this update</CardTitle>
            <p className="text-xs text-muted-foreground">Your posting compared with competitors and the wider category conversation. Views are as platforms report them — Instagram doesn&rsquo;t share view counts, so Instagram-heavy rows undercount.</p>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-muted-foreground text-xs uppercase border-b">
                  <th className="pb-2 pr-3 text-left font-medium">Who</th>
                  <th className="pb-2 pr-3 text-right font-medium">Videos</th>
                  <th className="pb-2 pr-3 text-left font-medium">Where they post</th>
                  <th className="pb-2 pr-3 text-right font-medium">Typical length</th>
                  <th className="pb-2 pr-3 text-right font-medium">Avg engagement</th>
                  <th className="pb-2 text-right font-medium">Views</th>
                </tr>
              </thead>
              <tbody>
                {scoreboard.map((r) => {
                  const segments = [...r.platforms.entries()].map(([platform, count]) => ({
                    label: platform,
                    count,
                    pct: Math.round((count / r.videos) * 100),
                    color: PLATFORM_COLOR[platform] ?? 'bg-muted-foreground',
                  }))
                  return (
                    <tr key={r.label} className="border-b last:border-0">
                      <td className="py-2.5 pr-3">
                        <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${
                          r.label === 'You' ? 'bg-positive/12 text-positive'
                          : r.label === 'Wider category' ? 'bg-muted text-muted-foreground'
                          : 'bg-clay/10 text-clay'
                        }`}>{r.label}</span>
                      </td>
                      <td className="py-2.5 pr-3 text-right font-medium">{r.videos}</td>
                      <td className="py-2.5 pr-3 min-w-40">
                        <ProportionBar segments={segments} of="videos" />
                        <div className="mt-1 text-[11px] text-muted-foreground capitalize">
                          {segments.map((s) => `${s.label} ${s.pct}%`).join(' · ')}
                        </div>
                      </td>
                      <td className="py-2.5 pr-3 text-right text-muted-foreground">{r.medianDuration != null ? durationLabel(r.medianDuration) : '—'}</td>
                      <td className="py-2.5 pr-3 text-right">
                        {r.avgEng != null ? (
                          <span title={`across ${r.engN} of ${r.videos} videos with engagement data`}>
                            {r.avgEng.toFixed(1)}% <span className="text-[11px] text-muted-foreground">({r.engN} videos)</span>
                          </span>
                        ) : '—'}
                      </td>
                      <td className="py-2.5 text-right text-muted-foreground">{r.views > 0 ? fmt(r.views) : '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      {/* Worth a reply — the engagement digest (own run anchor; see engage-section.tsx) */}
      <EngageSection supabase={supabase} clientId={clientId} detail={sp.detail} />

      {/* Hook intelligence + content-type performance */}
      {(hookPerf.length > 0 || typePerf.length > 0) && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {hookPerf.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base"><Zap className="size-4 text-primary" aria-hidden /> What hooks are working</CardTitle>
                <p className="text-xs text-muted-foreground">
                  Opening styles ranked by the engagement they earn — read from each video&rsquo;s caption, its speech transcript when captured, and the conversation it sparked; never the footage.
                </p>
              </CardHeader>
              <CardContent className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-muted-foreground text-xs uppercase border-b">
                      <th className="pb-2 pr-2 text-left font-medium w-8">#</th>
                      <th className="pb-2 pr-3 text-left font-medium">Hook</th>
                      <th className="pb-2 pr-3 text-left font-medium">Engagement</th>
                      <th className="pb-2 text-right font-medium">Videos</th>
                    </tr>
                  </thead>
                  <tbody>
                    {hookPerf.map((h, i) => (
                      <tr key={h.k} className="border-b last:border-0 align-top">
                        <td className="py-2.5 pr-2">
                          <span className={`inline-grid size-5 place-items-center rounded text-[11px] font-semibold ${
                            i === 0 ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
                          }`}>{i + 1}</span>
                        </td>
                        <td className="py-2.5 pr-3">
                          <div className="capitalize font-medium">{pretty(h.k)}</div>
                          {h.topExample && (
                            <div className="mt-0.5 max-w-64 truncate text-xs italic text-muted-foreground" title={h.topExample}>
                              &ldquo;{h.topExample}&rdquo;
                            </div>
                          )}
                        </td>
                        <td className="py-2.5 pr-3">
                          <EngBar value={h.avgEng} max={maxHookEng} />
                        </td>
                        <td className="py-2.5 text-right text-muted-foreground">{h.count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          )}

          {typePerf.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base"><Film className="size-4 text-primary" aria-hidden /> What formats are working</CardTitle>
                <p className="text-xs text-muted-foreground">Video formats ranked by average engagement across this update.</p>
              </CardHeader>
              <CardContent className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-muted-foreground text-xs uppercase border-b">
                      <th className="pb-2 pr-3 text-left font-medium">Format</th>
                      <th className="pb-2 pr-3 text-left font-medium">Engagement</th>
                      <th className="pb-2 text-right font-medium">Videos</th>
                    </tr>
                  </thead>
                  <tbody>
                    {typePerf.map((t) => (
                      <tr key={t.k} className="border-b last:border-0">
                        <td className="py-2.5 pr-3 capitalize font-medium">{pretty(t.k)}</td>
                        <td className="py-2.5 pr-3"><EngBar value={t.avgEng} max={maxTypeEng} /></td>
                        <td className="py-2.5 text-right text-muted-foreground">{t.count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* Per-entity content playbook — needs classification coverage */}
      {playbooks.length > 1 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base"><Film className="size-4 text-primary" aria-hidden /> Content playbooks, side by side</CardTitle>
            <p className="text-xs text-muted-foreground">What each player leans on this update — coverage shown per row, because not every video can be read confidently.</p>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-muted-foreground text-xs uppercase border-b">
                  <th className="pb-2 pr-3 text-left font-medium">Who</th>
                  <th className="pb-2 pr-3 text-left font-medium">Leans on</th>
                  <th className="pb-2 pr-3 text-left font-medium">Favourite hook</th>
                  <th className="pb-2 text-right font-medium">Read from</th>
                </tr>
              </thead>
              <tbody>
                {playbooks.map((p) => (
                  <tr key={p.label} className="border-b last:border-0 align-top">
                    <td className="py-2.5 pr-3">
                      <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${
                        p.label === 'You' ? 'bg-positive/12 text-positive'
                        : p.label === 'Wider category' ? 'bg-muted text-muted-foreground'
                        : 'bg-clay/10 text-clay'
                      }`}>{p.label}</span>
                    </td>
                    <td className="py-2.5 pr-3">
                      {p.topFormats.length > 0 ? (
                        <span className="flex flex-wrap gap-1.5">
                          {p.topFormats.map((f) => (
                            <span key={f.k} className="inline-block rounded-full bg-muted px-2 py-0.5 text-xs capitalize">
                              {pretty(f.k)} <span className="text-muted-foreground">×{f.count}</span>
                            </span>
                          ))}
                        </span>
                      ) : <span className="text-muted-foreground">—</span>}
                    </td>
                    <td className="py-2.5 pr-3 capitalize text-muted-foreground">
                      {p.topHook ? `${pretty(p.topHook.k)} (${p.topHook.count})` : '—'}
                    </td>
                    <td className="py-2.5 text-right text-xs text-muted-foreground whitespace-nowrap">{p.classified} of {p.total} videos</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      {/* Duration sweet-spots + trending sounds */}
      {(durations.length > 0 || sounds.length > 0) && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {durations.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base"><Timer className="size-4 text-primary" aria-hidden /> Video length that earns attention</CardTitle>
                <p className="text-xs text-muted-foreground">Engagement by video length across this update — videos without a known length excluded.</p>
              </CardHeader>
              <CardContent className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-muted-foreground text-xs uppercase border-b">
                      <th className="pb-2 pr-3 text-left font-medium">Length</th>
                      <th className="pb-2 pr-3 text-left font-medium">Engagement</th>
                      <th className="pb-2 text-right font-medium">Videos</th>
                    </tr>
                  </thead>
                  <tbody>
                    {durations.map((d) => (
                      <tr key={d.label} className="border-b last:border-0">
                        <td className="py-2.5 pr-3 font-medium">{d.label}</td>
                        <td className="py-2.5 pr-3"><EngBar value={d.avgEng} max={maxDurEng} /></td>
                        <td className="py-2.5 text-right text-muted-foreground">{d.count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          )}

          {sounds.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base"><Music className="size-4 text-primary" aria-hidden /> Sounds gaining traction</CardTitle>
                <p className="text-xs text-muted-foreground">Audio used by two or more videos this update — TikTok &amp; Instagram only; YouTube doesn&rsquo;t share sound data.</p>
              </CardHeader>
              <CardContent className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-muted-foreground text-xs uppercase border-b">
                      <th className="pb-2 pr-3 text-left font-medium">Sound</th>
                      <th className="pb-2 pr-3 text-right font-medium">Videos</th>
                      <th className="pb-2 text-right font-medium">Views</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sounds.map((s) => (
                      <tr key={s.name} className="border-b last:border-0">
                        <td className="py-2.5 pr-3 max-w-64 truncate" title={s.name}>{s.name}</td>
                        <td className="py-2.5 pr-3 text-right font-medium">{s.count}</td>
                        <td className="py-2.5 text-right text-muted-foreground">{fmt(s.views)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* Top voices */}
      {voices.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base"><Megaphone className="size-4 text-primary" aria-hidden /> Top voices</CardTitle>
            <p className="text-xs text-muted-foreground">The accounts driving the category conversation this update, by reach.</p>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-muted-foreground text-xs uppercase border-b">
                  <th className="pb-2 pr-3 text-left font-medium">Account</th>
                  <th className="pb-2 pr-3 text-left font-medium">Who</th>
                  <th className="pb-2 pr-3 text-right font-medium">Videos</th>
                  <th className="pb-2 pr-3 text-right font-medium">Views</th>
                  <th className="pb-2 text-right font-medium">Avg engagement</th>
                </tr>
              </thead>
              <tbody>
                {voices.map((a) => (
                  <tr key={a.name} className="border-b last:border-0">
                    <td className="py-2.5 pr-3">
                      <div className="font-medium">@{a.name}</div>
                      {a.followers > 0 && <div className="text-xs text-muted-foreground">{fmt(a.followers)} followers</div>}
                    </td>
                    <td className="py-2.5 pr-3">
                      <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium capitalize ${roleChip(a.entity)}`}>{a.entity}</span>
                    </td>
                    <td className="py-2.5 pr-3 text-right text-muted-foreground">{a.videos}</td>
                    <td className="py-2.5 pr-3 text-right font-medium">{fmt(a.views)}</td>
                    <td className="py-2.5 text-right text-muted-foreground">{a.avgEng != null ? `${a.avgEng.toFixed(1)}%` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      {/* All videos — the evidence layer */}
      {all.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base"><Play className="size-4 text-primary" aria-hidden /> All videos</CardTitle>
            {all.length > CATALOG_CAP && (
              <p className="text-xs text-muted-foreground mt-1">Top {CATALOG_CAP} of {all.length} by views.</p>
            )}
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-muted-foreground text-xs uppercase border-b">
                  {['Platform', 'Account', 'Who', 'Posted', 'Length', 'Views', 'Likes', 'Eng.', 'Sentiment', 'Format', 'Hook', 'Topics'].map((h) => (
                    <th key={h} className={`pb-2 font-medium ${['Views', 'Likes', 'Eng.'].includes(h) ? 'text-right' : 'text-left'}`}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {all.slice(0, CATALOG_CAP).map((v) => (
                  <tr key={v.id} className="border-b last:border-0 align-top">
                    <td className="py-2 capitalize">{v.platform}</td>
                    <td className="py-2">
                      <a href={v.video_url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">@{v.account_name}</a>
                      {v.transcript_status === 'ok' && (
                        <Captions className="ml-1 inline size-3 align-[-1px] text-muted-foreground" aria-label="Speech transcript captured" />
                      )}
                    </td>
                    <td className="py-2">
                      <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium capitalize ${roleChip(roleOf(v))}`}>{roleOf(v)}</span>
                    </td>
                    <td className="py-2 text-xs text-muted-foreground whitespace-nowrap">{v.upload_date ?? '—'}</td>
                    <td className="py-2 text-xs text-muted-foreground whitespace-nowrap">{Number(v.duration_seconds) > 0 ? durationLabel(Number(v.duration_seconds)) : '—'}</td>
                    <td className="py-2 text-right">{Number(v.views) > 0 ? fmt(Number(v.views)) : '—'}</td>
                    <td className="py-2 text-right text-muted-foreground">{v.likes != null ? fmt(Number(v.likes)) : '—'}</td>
                    <td className="py-2 text-right">{v.engagement_rate != null ? `${v.engagement_rate}%` : '—'}</td>
                    <td className="py-2">{v.sentiment ? <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium capitalize ${SENTIMENT_BADGE[v.sentiment] ?? 'bg-muted text-muted-foreground'}`}>{v.sentiment}</span> : <span className="text-muted-foreground">—</span>}</td>
                    <td className="py-2 capitalize text-xs">{v.classified_type ? pretty(v.classified_type) : <span className="text-muted-foreground">—</span>}</td>
                    <td className="py-2 capitalize text-xs">{v.hook_style ? pretty(v.hook_style) : <span className="text-muted-foreground">—</span>}</td>
                    <td className="py-2 text-xs text-muted-foreground">{(v.topics ?? []).slice(0, 3).join(', ') || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

function PageHeader({ sub }: { sub: string | null }) {
  return (
    <div>
      <h1 className="text-2xl font-bold">Content</h1>
      {sub && <p className="text-sm text-muted-foreground mt-1">{sub}</p>}
    </div>
  )
}

/** Thin single-hue engagement bar with the value always labelled. */
function EngBar({ value, max }: { value: number | null; max: number }) {
  if (value == null || max <= 0) return <span className="text-muted-foreground">—</span>
  return (
    <span className="flex items-center gap-2" title={`${value.toFixed(1)}% average engagement`}>
      <span className="h-1.5 max-w-28 rounded-full bg-chart-2" style={{ width: `${Math.max(4, (value / max) * 100)}%` }} aria-hidden />
      <span className="text-xs font-medium">{value.toFixed(1)}%</span>
    </span>
  )
}

function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <Card>
      <CardContent className="py-10 text-center text-sm text-muted-foreground">{children}</CardContent>
    </Card>
  )
}
