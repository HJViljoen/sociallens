import { Captions } from 'lucide-react'
import { Fragment, type ReactNode } from 'react'
import { HowToRead } from '@/components/how-to-read'
import { SENTIMENT_BADGE } from '@/lib/ui-colors'
import { fmtInt, fmtCompact, fmtPct, weekdayDate, platformLabel } from '@/lib/format'
import {
  pretty, durationLabel, initials,
  type PerfMultiple, type EntityKind, type VoiceRole,
} from '@/lib/content-tiles'
import { ENGAGE_CATEGORY_LABEL } from '@/lib/engage'
import { ExportMenu, ExportScope } from '@/components/export-menu'
import { PageFrame, PageGrid, PageBar, BarPill } from '@/components/shell/page-grid'
import { Tile, TileEmpty } from '@/components/shell/tile'
import { DetailDrawer } from '@/components/shell/detail-drawer'
import { DrawerLink } from '@/components/shell/drawer-link'
import { EnhancedTable } from '@/components/shell/enhanced-table'
import { Sparkline } from '@/components/charts/sparkline'
import { Delta } from '@/components/charts/stat'
import { RankedBar } from '@/components/charts/ranked-bar'
import { PlatformIcon } from '@/components/charts/platform-icon'
import {
  loadContent, isContentEmpty, type ContentData, type ContentEmpty, type ContentCatalogRow,
} from '@/lib/pages/content'
import type { PageModule, PrintVariant, RenderMode, Renderable, Slide } from '@/lib/renderables/types'
import { basePath, inboxTile, repliesBody, prettyTheme, EngageDetailBody } from './engage-section'

// Content — "what content works, and who to answer?", on one screen (one-screen
// redesign, 2026-08-22: the playbook + the reply inbox; renderers split from
// the loader 2026-08-29, Reports & Exports T7). "What works right now" leads
// (hooks + formats as multiples of the median video, best length, top sound)
// · "Worth a reply" is the inbox at its side (components/pages/content/
// engage-section.tsx) · the field this update (entity scoreboard + one
// grounded sentence) · top voices · your own accounts. Every tile gates on
// its data and shows an honest empty line at its size. `mode` changes only
// what has no meaning on paper: links deeper, the reply/"why it surfaced"
// links, the video catalog's client-side sort/filter (EnhancedTable).

/** Accounts in the "All voices" drawer/slide, and in the tile. */
const VOICES_SHOWN = 5
/** Hook styles / formats listed per column in "What works right now". */
const PERF_BAR = 72

type D = ContentData
type R = (data: D, mode: RenderMode) => ReactNode

// Colour jobs (MASTER rule 2): you = green, a competitor = orange (then paler
// oranges — already baked into d.field.rows[].color), category / creators = grey.
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

/** One column of "What works right now": heading, then rows of
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

/** "2.4×" — one decimal under 10, none above. */
const fmtMultiple = (m: number) => `${m >= 10 ? Math.round(m) : (Math.round(m * 10) / 10).toFixed(1).replace(/\.0$/, '')}×`

// ── what works right now ────────────────────────────────────────────────────
const works: R = (d, mode) => {
  const app = mode === 'app'
  const w = d.works
  return (
    <Tile exportKey="content.works" col={7} row={3} eyebrow="What works right now" meta="vs median · this update"
      distribute="between" bodyClassName="gap-4"
      footer={d.playbooks.length > 1 ? (app ? <DrawerLink href={`${basePath}?detail=playbooks`}>Playbooks side by side →</DrawerLink> : <span>Playbooks side by side</span>) : undefined}
    >
      {w.hooks.length > 0 || w.formats.length > 0 ? (
        <>
          <div className="grid grid-cols-2 gap-x-6">
            <PerfList heading="Hooks" rows={w.hooks} max={w.perfMax} empty="Hooks land once 3+ videos share a style." />
            <PerfList heading="Formats" rows={w.formats} max={w.perfMax} empty="Formats land once 3+ videos share one." />
          </div>
          {(w.duration || w.topSound) && (
            <div className="grid grid-cols-2 gap-x-6">
              {w.duration && (
                <StatCell label="Best length" value={w.duration.best.label}
                  note={w.duration.multiple != null
                    ? `${fmtMultiple(w.duration.multiple)} the median · ${fmtInt(w.duration.best.count)} videos`
                    : `${fmtPct(w.duration.best.avgEng ?? 0)} average · ${fmtInt(w.duration.best.count)} videos`}
                />
              )}
              {w.topSound && (
                <StatCell label="Top sound" value={`${fmtInt(w.topSound.count)} videos`} note={`“${w.topSound.name}”`} noteTitle={w.topSound.name} />
              )}
            </div>
          )}
        </>
      ) : (
        <TileEmpty>Hooks and formats land once this update’s videos are analysed.</TileEmpty>
      )}
    </Tile>
  )
}

// ── the field this update ───────────────────────────────────────────────────
const field: R = (d, mode) => {
  const app = mode === 'app'
  const f = d.field
  return (
    <Tile exportKey="content.field" col={4} row={3} eyebrow="The field this update" meta={`${fmtInt(f.totalVideos)} videos · ${fmtInt(f.analysedVideos)} analysed`}
      distribute="between" bodyClassName="gap-3"
      footer={f.totalVideos > 0 ? (app ? <DrawerLink href={`${basePath}?detail=videos`}>All {fmtInt(f.totalVideos)} videos →</DrawerLink> : <span>All {fmtInt(f.totalVideos)} videos</span>) : undefined}
      footerNote={f.hiddenCount > 0 ? `${f.hiddenCount} more in the playbooks` : undefined}
    >
      {f.rows.length > 1 ? (
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
              {f.rows.map((r) => (
                <tr key={r.label} className="border-t border-border/70">
                  <td className="w-[42%] py-2 pr-2">
                    <span className="flex items-center gap-1.5">
                      <span className="size-1.5 shrink-0 rounded-full" style={{ background: r.color }} aria-hidden />
                      <span className="truncate">{r.label}</span>
                    </span>
                  </td>
                  <td className="py-2 text-right font-mono tabular-nums">{fmtInt(r.videos)}</td>
                  <td className="py-2 text-right font-mono tabular-nums text-muted-foreground">{r.views > 0 ? fmtCompact(r.views) : '—'}</td>
                  <td className="py-2 pl-3">
                    {r.avgEng != null ? (
                      <span className="flex items-center gap-1.5" title={`across ${r.engN} of ${r.videos} videos with engagement data`}>
                        <span className="h-1.5 w-[48px] shrink-0 overflow-hidden rounded-full bg-inner" aria-hidden>
                          <span className="block h-full rounded-full" style={{ width: `${Math.max(2, (r.avgEng / (f.engMax || 1)) * 100)}%`, background: r.color }} />
                        </span>
                        <span className="font-mono text-[11.5px] tabular-nums">{fmtPct(r.avgEng)}</span>
                      </span>
                    ) : <span className="text-muted-foreground">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {f.sentence && <p className="line-clamp-3 text-[12px] leading-[1.45] text-muted-foreground">{f.sentence}</p>}
        </>
      ) : f.totalVideos > 0 ? (
        <TileEmpty>The field fills in once a competitor or your own posts are tracked — this update has {fmtInt(f.totalVideos)} category videos.</TileEmpty>
      ) : (
        <TileEmpty>No videos in this update yet — the next one lands soon.</TileEmpty>
      )}
    </Tile>
  )
}

// ── top voices ───────────────────────────────────────────────────────────────
const voiceLine = (v: { role: VoiceRole; competitorName: string | null; topFormat: string | null; videos: number }) =>
  [
    v.role === 'competitor' && v.competitorName ? `competitor · ${v.competitorName}` : ROLE_WORD[v.role],
    v.topFormat ? pretty(v.topFormat) : null,
    `${v.videos} ${v.videos === 1 ? 'video' : 'videos'}`,
  ].filter(Boolean).join(' · ')

const voicesTile: R = (d, mode) => {
  const app = mode === 'app'
  const v = d.voices
  return (
    <Tile exportKey="content.voices" col={3} row={3} eyebrow="Top voices" meta="by views · this update"
      distribute="center"
      footer={v.all.length > v.shown.length ? (app ? <DrawerLink href={`${basePath}?detail=voices`}>All voices →</DrawerLink> : <span>All voices</span>) : undefined}
    >
      {v.shown.length > 0 ? (
        <div className="flex flex-col">
          {v.shown.slice(0, VOICES_SHOWN).map((vv) => (
            <div key={vv.name} className="flex items-center gap-2.5 border-t border-border/70 py-2 first:border-t-0 first:pt-0 last:pb-0">
              <span className="grid size-[26px] shrink-0 place-items-center rounded-full text-[10px] font-semibold text-tile" style={{ background: ROLE_COLOR[vv.role] }} aria-hidden>{initials(vv.name)}</span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[12.5px] font-semibold">@{vv.name}</div>
                <div className="truncate text-[11px] text-muted-foreground">{voiceLine(vv)}</div>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                <span className="font-mono text-[11.5px] font-semibold tabular-nums">{vv.views > 0 ? fmtCompact(vv.views) : '—'}</span>
                <span className="h-1.5 w-[56px] overflow-hidden rounded-full bg-inner" aria-hidden>
                  <span className="block h-full rounded-full" style={{ width: `${Math.max(2, v.max > 0 ? (vv.views / v.max) * 100 : 0)}%`, background: ROLE_COLOR[vv.role] }} />
                </span>
              </div>
            </div>
          ))}
        </div>
      ) : <TileEmpty>Voices land with the first update that finds videos.</TileEmpty>}
    </Tile>
  )
}

// ── your accounts ───────────────────────────────────────────────────────────
const accounts: R = (d) => {
  const a = d.accounts
  return (
    <Tile exportKey="content.accounts" col={5} row={2} eyebrow="On your accounts" meta={a.series.length > 0 ? 'followers · daily · 30 days' : undefined}
      distribute="between" bodyClassName="gap-3"
    >
      {a.series.length > 0 ? (
        <>
          <div className="flex flex-col gap-2">
            {a.series.slice(0, 3).map((s) => (
              <div key={s.platform} className="flex items-center gap-3">
                <PlatformIcon platform={s.platform} size={14} className="shrink-0 text-secondary-foreground" />
                <span className="sr-only">{platformLabel(s.platform)}</span>
                <div className="min-w-0 flex-1"><Sparkline values={s.values} width={270} height={28} fill /></div>
                <div className="flex min-w-[96px] flex-col items-end">
                  <span className="font-mono text-[12.5px] font-semibold tabular-nums">{fmtCompact(s.latest)}</span>
                  <span className="whitespace-nowrap">
                    <Delta value={s.delta} good="up" />
                    {a.explainedPlatforms.includes(s.platform) && <span className="font-mono text-[11px] text-muted-foreground"> · explained</span>}
                  </span>
                </div>
              </div>
            ))}
          </div>
          {a.topEvent && (
            <p className="flex items-start gap-2 text-[12px] leading-[1.45]">
              <span className="mt-[6px] size-1.5 shrink-0 rounded-full bg-warning" aria-hidden />
              <span className="line-clamp-2">
                {a.topEvent.explained && a.topEvent.explanation
                  ? a.topEvent.explanation
                  : `${a.topEvent.magnitude_label} on ${platformLabel(a.topEvent.platform)} — the conversation we track doesn’t account for it, so it stays unexplained.`}
              </span>
            </p>
          )}
        </>
      ) : <TileEmpty>Add your own handles in Settings to follow your accounts here.</TileEmpty>}
    </Tile>
  )
}

// ── content playbooks, side by side ─────────────────────────────────────────
const playbooksBody: R = (d) => (
  <>
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
        {d.playbooks.map((p) => (
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
  </>
)

// ── top voices this update, in full ─────────────────────────────────────────
const allVoicesBody: R = (d) => (
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
      {d.voices.all.map((v) => (
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
)

// ── the video catalog ────────────────────────────────────────────────────────
function CatalogTable({ rows }: { rows: ContentCatalogRow[] }) {
  return (
    <table className="w-full min-w-[860px] text-[11.5px]">
      <thead>
        <tr className="border-b text-[10px] uppercase tracking-[0.06em] text-muted-foreground">
          {([['Platform', 'str'], ['Account', 'str'], ['Who', 'str'], ['Posted', 'str'], ['Length', 'num'], ['Views', 'num'], ['Likes', 'num'], ['Eng.', 'num'], ['Sentiment', 'str'], ['Format', 'str'], ['Hook', 'str'], ['Topics', null]] as [string, string | null][]).map(([h, sort]) => (
            <th key={h} data-sort={sort ?? undefined} className={`pb-1.5 pr-2 font-semibold ${['Views', 'Likes', 'Eng.', 'Length'].includes(h) ? 'text-right' : 'text-left'}`}>{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((v) => (
          <tr key={v.id} data-search={`${v.account} ${v.entityLabel} ${platformLabel(v.platform)} ${v.format ?? ''} ${v.hook ?? ''} ${v.topics.join(' ')} ${v.sentiment ?? ''}`.toLowerCase()} className="border-b align-top last:border-0">
            <td className="py-1.5 pr-2 capitalize">{platformLabel(v.platform)}</td>
            <td className="py-1.5 pr-2" data-v={v.account}>
              <a href={v.videoUrl} target="_blank" rel="noopener noreferrer" className="text-foreground hover:underline">@{v.account}</a>
              {v.hasTranscript && (
                <Captions className="ml-1 inline size-3 align-[-1px] text-muted-foreground" aria-label="Speech transcript captured" />
              )}
            </td>
            <td className="py-1.5 pr-2" data-v={v.entityLabel}><span className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-[10.5px] font-medium ${KIND_CHIP[v.entityKind]}`}>{v.entityLabel}</span></td>
            <td className="whitespace-nowrap py-1.5 pr-2 text-muted-foreground" data-v={v.uploadDate ?? ''}>{v.uploadDate ?? '—'}</td>
            <td className="whitespace-nowrap py-1.5 pr-2 text-right text-muted-foreground" data-v={v.durationSeconds || ''}>{v.durationSeconds > 0 ? durationLabel(v.durationSeconds) : '—'}</td>
            <td className="py-1.5 pr-2 text-right font-mono tabular-nums" data-v={v.views || ''}>{v.views > 0 ? fmtCompact(v.views) : '—'}</td>
            <td className="py-1.5 pr-2 text-right font-mono tabular-nums text-muted-foreground" data-v={v.likes ?? ''}>{v.likes != null ? fmtCompact(v.likes) : '—'}</td>
            <td className="py-1.5 pr-2 text-right font-mono tabular-nums" data-v={v.engagementRate ?? ''}>{v.engagementRate != null ? `${v.engagementRate}%` : '—'}</td>
            <td className="py-1.5 pr-2">{v.sentiment ? <span className={`inline-block rounded-full px-2 py-0.5 text-[10.5px] font-medium capitalize ${SENTIMENT_BADGE[v.sentiment] ?? 'bg-inner text-muted-foreground'}`}>{v.sentiment}</span> : <span className="text-muted-foreground">—</span>}</td>
            <td className="py-1.5 pr-2 capitalize">{v.format ? pretty(v.format) : <span className="text-muted-foreground">—</span>}</td>
            <td className="py-1.5 pr-2 capitalize">{v.hook ? pretty(v.hook) : <span className="text-muted-foreground">—</span>}</td>
            <td className="py-1.5 text-muted-foreground">{v.topics.slice(0, 3).join(', ') || '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

/** `content.catalog` — the "All videos" drawer/slide, first 100 by views. The
 *  app wraps the table in `EnhancedTable` ('use client', sort/filter); print
 *  renders the plain table it wraps. */
const catalogBody: R = (d, mode) => {
  const table = <CatalogTable rows={d.catalog.rows} />
  return mode === 'app' ? <EnhancedTable filterPlaceholder="Filter videos — account, who, format, hook, topic…">{table}</EnhancedTable> : table
}

const renderables: Record<string, Renderable<D>> = {
  'content.works': { key: 'content.works', title: 'What works right now', render: works },
  'content.inbox': { key: 'content.inbox', title: 'Worth a reply', render: inboxTile },
  'content.field': { key: 'content.field', title: 'The field this update', render: field },
  'content.voices': { key: 'content.voices', title: 'Top voices', render: voicesTile },
  'content.accounts': { key: 'content.accounts', title: 'On your accounts', render: accounts },
  'content.playbooks': { key: 'content.playbooks', title: 'Content playbooks, side by side', render: playbooksBody },
  'content.catalog': { key: 'content.catalog', title: 'All videos', render: catalogBody },
  'content.allVoices': { key: 'content.allVoices', title: 'Top voices this update', render: allVoicesBody },
  'content.replies': { key: 'content.replies', title: 'Worth a reply', render: repliesBody },
}

/** The grid, in the page's order. */
const GRID_ORDER = ['content.works', 'content.inbox', 'content.field', 'content.voices', 'content.accounts']

export function contentSlides(variant: PrintVariant): Slide[] {
  const slides: Slide[] = [
    { title: 'What works right now, and worth a reply', keys: ['content.works', 'content.inbox'], layout: 'grid' },
    { title: 'The field, your voices, your accounts', keys: ['content.field', 'content.voices', 'content.accounts'], layout: 'grid' },
    { title: 'Content playbooks, side by side', keys: ['content.playbooks'], layout: 'single' },
    { title: 'Top voices this update', keys: ['content.allVoices'], layout: 'single' },
  ]
  if (variant === 'full') {
    slides.push({ title: 'Worth a reply — the full inbox', keys: ['content.replies'], layout: 'single' })
    slides.push({ title: 'All videos', keys: ['content.catalog'], layout: 'single' })
  }
  return slides
}

export const contentPage: PageModule<D> = {
  key: 'content',
  title: 'Content',
  async load(scope) {
    const d = await loadContent(scope)
    return isContentEmpty(d) ? null : d
  },
  slides: (_d, variant) => contentSlides(variant),
  renderables,
  snapshotTitle: (d) => `Content · ${d.method.company} · ${d.updateDate ? weekdayDate(d.updateDate) : 'this update'}`,
}

/** The app page: page bar, the grid, the drawers. */
export function ContentPage({ data: d, params }: { data: ContentData | ContentEmpty; params: Record<string, string | undefined> }) {
  if (isContentEmpty(d)) {
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
  const filter = d.selection.intent
  const closeHref = filter ? `${basePath}?intent=${filter}` : basePath
  const showLegend = d.selection.detail === 'legend'
  const repliesCloseHref = `${basePath}?detail=replies${filter ? `&intent=${filter}` : ''}`

  return (
    <ExportScope page="content" params={params} tiles={Object.values(renderables).map((r) => ({ key: r.key, title: r.title }))}>
    <PageFrame>
      <PageBar title="Content" context={d.context}>
        <ExportMenu />
        <BarPill>This update</BarPill>
        <BarPill>All platforms</BarPill>
        <HowToRead items={['conversations']} open={showLegend} basePath={basePath} />
      </PageBar>

      <PageGrid>
        {GRID_ORDER.map((key) => <Fragment key={key}>{renderables[key].render(d, 'app')}</Fragment>)}
      </PageGrid>

      {/* ── drawers: one click deeper ────────────────────────────────── */}

      <DetailDrawer value="playbooks" closeHref={closeHref} title="Content playbooks, side by side" description="what each player leans on this update — coverage shown per row, because not every video can be read confidently">
        {playbooksBody(d, 'app')}
      </DetailDrawer>

      <DetailDrawer value="voices" closeHref={closeHref} title="Top voices this update" description="the accounts driving the category conversation, by views">
        {allVoicesBody(d, 'app')}
      </DetailDrawer>

      <DetailDrawer value="videos" closeHref={closeHref} title="All videos" description={d.catalog.total > d.catalog.rows.length ? `top ${fmtInt(d.catalog.rows.length)} of ${fmtInt(d.catalog.total)} by views` : `${fmtInt(d.catalog.total)} videos this update, by views`}>
        {catalogBody(d, 'app')}
      </DetailDrawer>

      <DetailDrawer value="replies" closeHref={closeHref} title="Worth a reply" description={d.inbox.windowDays != null ? `${d.selection.intent ? d.inbox.rows.filter((r) => r.intent === d.selection.intent).length : d.inbox.total} moments this update · each links to where it happened` : undefined}>
        {repliesBody(d, 'app')}
      </DetailDrawer>

      <DetailDrawer open={d.engageDetail != null} closeHref={repliesCloseHref} title={d.engageDetail ? prettyTheme(d.engageDetail.theme) : 'Why it surfaced'} description={d.engageDetail ? (ENGAGE_CATEGORY_LABEL[d.engageDetail.category] ?? 'Flagged') : undefined}>
        {d.engageDetail && <EngageDetailBody detail={d.engageDetail} />}
      </DetailDrawer>
    </PageFrame>
    </ExportScope>
  )
}
