import Link from 'next/link'
import { Fragment, type ReactNode } from 'react'
import { PREVALENCE_BADGE } from '@/lib/ui-colors'
import { PREVALENCE_LABEL, glossaryRule } from '@/lib/calibration'
import { fmtInt, fmtPct, weekdayDate, shortDate, platformLabel, cap } from '@/lib/format'
import { categoryLabel, categoryChip, emotionTone, bucketKind, type Trajectory } from '@/lib/voice-tiles'
import { VoiceFilters } from '@/components/voice-filters'
import { HowToRead } from '@/components/how-to-read'
import { ExportMenu, ExportScope } from '@/components/export-menu'
import { PageFrame, PageGrid, PageBar, BarPill } from '@/components/shell/page-grid'
import { Tile, TileEmpty } from '@/components/shell/tile'
import { DetailDrawer } from '@/components/shell/detail-drawer'
import { DrawerLink } from '@/components/shell/drawer-link'
import { Sparkline } from '@/components/charts/sparkline'
import { RankedBar } from '@/components/charts/ranked-bar'
import { Mover } from '@/components/charts/mover'
import { ThemeMap, BucketLegend, EDGE, type ThemeBlock } from './theme-map'
import { loadVoice, isVoiceEmpty, voiceHref, type VoiceData, type VoiceEmpty, type ThemeDetail, type ThemeListRow } from '@/lib/pages/voice'
import type { PageModule, RenderMode, Renderable, Slide } from '@/lib/renderables/types'

// Voice of Customer renderers — the JSX half of the old page (split
// 2026-08-29, Reports & Exports T4), one pure function per tile. `mode`
// changes only what has no meaning on paper: links, the filter selects, the
// drawers, the "Next five" rotation.

const MOVER_ROWS = 6
const chip = 'inline-flex h-[18px] items-center rounded-full px-[7px] text-[10.5px] font-medium whitespace-nowrap'
const MOOD_COLOR = { positive: 'var(--positive)', negative: 'var(--negative)', neutral: 'var(--neutral-seg)' } as const

type D = VoiceData
type R = (data: D, mode: RenderMode) => ReactNode

const competitorName = (bucket: string) => bucket.replace(/^competitor:/, '')

/** Audience pills: the page's primary axis. */
function EntityPills({ d }: { d: D }) {
  if (d.entities.length === 0) return null
  const f = d.filters
  return (
    <>
      <Link href={voiceHref(f, { entity: null, type: null, themes: null, detail: null, theme: null })} scroll={false}>
        <BarPill active={f.entity === 'all'}>All audiences</BarPill>
      </Link>
      {d.entities.map((e) => (
        <Link key={e.bucket} href={voiceHref(f, { entity: e.bucket, type: null, themes: null, detail: null, theme: null })} scroll={false}>
          <BarPill active={f.entity === e.bucket}>
            {e.pillLabel}
            <span className="font-mono text-[11px] font-medium tabular-nums text-muted-foreground">{e.confirmed}</span>
          </BarPill>
        </Link>
      ))}
    </>
  )
}

// ── hero: the theme map ────────────────────────────────────────────────────
const map: R = (d, mode) => {
  const app = mode === 'app'
  const f = d.filters
  const blocks: ThemeBlock[] = d.map.blocks.map((b) => ({ ...b, href: voiceHref(f, { theme: b.id }) }))
  return (
    <Tile exportKey="voice.map" col={8} row={4} eyebrow="The conversation, by theme"
      meta={app && d.map.totalThemes > 0 ? <VoiceFilters stage={f.stage} min={String(f.min)} deepLinked={f.deepLinked} showStage={d.stagesPresent} /> : undefined}
      bodyClassName="gap-2"
      footer={d.map.totalThemes > 0 ? (
        <span className="flex items-center gap-2">
          {app ? <DrawerLink href={voiceHref(f, { detail: 'list' })}>All {fmtInt(d.map.shownCount)} themes →</DrawerLink> : <span>{fmtInt(d.map.shownCount)} themes</span>}
          <span className="font-normal text-muted-foreground">{d.map.tiersAll.confirmed} confirmed · {d.map.tiersAll.early} early · {d.map.tiersAll.heardOnce} heard once</span>
        </span>
      ) : undefined}
      footerNote={d.map.totalThemes > 0 ? <BucketLegend competitor={d.leadCompetitorName} /> : undefined}
    >
      {app && !d.pillsInBar && d.entities.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5"><EntityPills d={d} /></div>
      )}
      {d.map.totalThemes > 0 && (
        <div className="-mx-4 flex flex-wrap items-center gap-0.5 border-b border-border/80 px-4 pb-2">
          <TabLink label="All" count={d.tiersEntityConfirmed} active={f.type === 'all'} href={voiceHref(f, { type: null, detail: null, theme: null })} app={app} />
          {d.tabs.map((t) => (
            <TabLink key={t.category} label={t.label} count={t.count} active={f.type === t.category} href={voiceHref(f, { type: t.category, detail: null, theme: null })} app={app} />
          ))}
        </div>
      )}
      {blocks.length > 0 ? (
        <ThemeMap blocks={blocks} className="min-h-[240px]" />
      ) : (
        <TileEmpty>{d.map.emptyLine}</TileEmpty>
      )}
    </Tile>
  )
}

/** The selected theme in full — the pane beside the map, and one slide per
 *  theme in the full export. */
function ThemeBody({ t, showNew }: { t: ThemeDetail; showNew: boolean }) {
  return (
    <>
      <h3 className="text-[15px] font-semibold leading-[1.3] tracking-[-0.005em] [text-wrap:pretty]">{t.label}</h3>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-1.5">
          <span title={glossaryRule(t.prevalence)} className={`${chip} ${PREVALENCE_BADGE[t.prevalence]}`}>{PREVALENCE_LABEL[t.prevalence]}</span>
          <span className={`${chip} ${categoryChip(t.category)}`}>{categoryLabel(t.category)}</span>
          {t.emotion && <span className={`${chip} capitalize bg-inner text-muted-foreground`}>{t.emotion}</span>}
          {showNew && t.isNew && <span title={glossaryRule('new')} className={`${chip} bg-inner text-muted-foreground`}>New</span>}
        </div>
        {t.description && <p className="text-[13px] leading-[1.5] text-foreground/90">{t.description}</p>}
        <div className="space-y-1.5 border-t border-border/70 pt-3">
          <div className="flex items-baseline gap-1.5">
            <span className="font-mono text-[22px] font-semibold tabular-nums leading-none" style={{ color: EDGE[t.kind] }}>{fmtInt(t.count)}</span>
            <span className="text-[11.5px] text-muted-foreground">of {fmtInt(t.denom)} {t.groupName} conversations</span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-inner" aria-hidden>
            <div className="h-full rounded-full" style={{ width: `${Math.max(3, t.pct)}%`, background: EDGE[t.kind] }} />
          </div>
        </div>
        {t.history && (
          <div className="flex items-center gap-3 border-t border-border/70 pt-3">
            <Sparkline values={t.history.evidence} color={EDGE[t.kind]} width={120} height={30} />
            <p className="text-[11px] text-muted-foreground">
              conversations per update, across the {t.history.evidence.length} updates this theme has appeared in ({shortDate(t.history.dates[0])} → {shortDate(t.history.dates[t.history.dates.length - 1])})
            </p>
          </div>
        )}
        {t.quotes.length > 0 && (
          <div className="space-y-2 border-t border-border/70 pt-3">
            <p className="text-[10.5px] font-semibold uppercase tracking-[0.07em] text-muted-foreground">The voices behind it</p>
            {t.quotes.map((q, n) => (
              <blockquote key={n} className="border-l-2 border-border pl-2 text-[12.5px] italic leading-[1.4] text-foreground/90">“{q.text}”</blockquote>
            ))}
            <p className="text-[11px] text-muted-foreground">a sample of the conversations behind this theme</p>
          </div>
        )}
        {t.withheld > 0 && (
          <p className="text-[11px] text-muted-foreground">
            {t.withheld} {t.withheld === 1 ? 'comment describes' : 'comments describe'} who these commenters are. Counted, not quoted.
          </p>
        )}
      </div>
    </>
  )
}

// ── the theme pane: the selected block, in full ────────────────────────────
const theme: R = (d, mode) => {
  const t = d.theme
  return (
    <Tile exportKey="voice.theme" col={4} row={4} eyebrow="Theme"
      meta={t ? `${t.bucketName} · ${categoryLabel(t.category)}` : undefined}
      bodyClassName="overflow-y-auto pr-1"
      footer={mode === 'app' && t && t.memberThemes.length > 0 ? <Link href={`/dashboard/videos?themes=${encodeURIComponent(t.memberThemes.join(','))}`}>Videos behind this theme →</Link> : undefined}
    >
      {t ? <ThemeBody t={t} showNew={d.showNew} /> : <TileEmpty>Select a block on the map to read the theme in full.</TileEmpty>}
    </Tile>
  )
}

// ── gaining and fading ─────────────────────────────────────────────────────
const movers: R = (d, mode) => {
  const { rows, steadyCount } = d.movers
  return (
    <Tile exportKey="voice.movers" col={4} row={2} eyebrow="Gaining and fading" meta={rows.length > 0 ? `${fmtInt(rows.length)} moved` : undefined}
      footer={mode === 'app' && rows.length > 0 ? <DrawerLink href={voiceHref(d.filters, { detail: 'movers' })}>All movers →</DrawerLink> : undefined}
    >
      {d.updatesCount < 2 ? (
        <TileEmpty>Movement lands with your second update.</TileEmpty>
      ) : rows.length === 0 ? (
        <TileEmpty>No theme has moved clearly yet — {steadyCount > 0 ? `${steadyCount} heard in more than one update, all steady so far` : 'the themes heard so far are all new this update'}.</TileEmpty>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col justify-between overflow-hidden">
          {rows.slice(0, MOVER_ROWS).map((t) => <MoverRow key={t.key} t={t} />)}
        </div>
      )}
    </Tile>
  )
}

// ── how your customers talk ────────────────────────────────────────────────
const phrases: R = (d, mode) => (
  <Tile exportKey="voice.phrases" col={4} row={2} eyebrow="How your customers talk" meta={d.phrases.total > 0 ? `${fmtInt(d.phrases.total)} phrases` : undefined} distribute="center"
    footer={mode === 'app' && d.phrases.total > 0 ? <Link href={voiceHref(d.filters, { detail: 'language' })} scroll={false}>Borrow the language →</Link> : undefined}
  >
    {d.phrases.shown.length > 0 ? (
      // One clean row of chips on the fixed one-screen grid (a chip that
      // doesn't fit wraps out of view, never gets cut mid-word); two rows
      // when the grid stacks.
      <div className="flex max-h-[112px] flex-wrap content-start gap-1 overflow-hidden">
        {d.phrases.shown.map((s, i) => (
          <span key={i} title={s.platform ? platformLabel(s.platform) : undefined} className="inline-flex h-[20px] max-w-full items-center truncate rounded-[4px] bg-inner px-2 text-[11px] italic leading-none text-foreground/80">
            {s.phrase}
          </span>
        ))}
      </div>
    ) : <TileEmpty>The phrases your customers use land with your next update.</TileEmpty>}
  </Tile>
)

// ── audience mood ──────────────────────────────────────────────────────────
const mood: R = (d) => {
  const moodMax = d.moods[0]?.pct ?? 0
  return (
    <Tile exportKey="voice.mood" col={4} row={2} eyebrow="Audience mood" meta={d.moods.length > 0 ? `of ${fmtInt(d.moods[0].total)} read` : undefined} distribute="center">
      {d.moods.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          {d.moods.map((m) => (
            <RankedBar key={m.emotion} label={cap(m.emotion)} pct={moodMax > 0 ? (m.pct / moodMax) * 100 : 0} color={MOOD_COLOR[emotionTone(m.emotion)]} count={fmtPct(m.pct, 0)} barWidth={120} />
          ))}
        </div>
      ) : <TileEmpty>Mood lands with your next update.</TileEmpty>}
    </Tile>
  )
}

// ── hear these voices ──────────────────────────────────────────────────────
const ribbon: R = (d, mode) => {
  const app = mode === 'app'
  const { cards, total } = d.ribbon
  const f = d.filters
  return (
    <Tile exportKey="voice.ribbon" col={12} row={2} eyebrow="Hear these voices"
      meta={cards.length > 0 ? `${cards.length} of ${fmtInt(total)}` : undefined}
      footer={app && cards.length > 0 && total > cards.length ? <Link href={voiceHref(f, { seed: String(f.seed + 1), detail: null })} scroll={false}>Next five →</Link> : undefined}
    >
      {cards.length > 0 ? (
        <div className="-mx-4 flex min-h-0 flex-1 flex-col items-stretch divide-y divide-border/80 sm:flex-row sm:divide-x sm:divide-y-0">
          {cards.map((c, i) => {
            const body = (
              <>
                <span className={`${chip} max-w-full self-start truncate ${categoryChip(c.themeCategory)}`}>{c.themeLabel}</span>
                <blockquote className="min-h-0 border-l-2 border-border pl-2.5 text-[12.5px] italic leading-[1.4] text-foreground/90">
                  <span className="line-clamp-4">“{c.quote.text}”</span>
                  {c.who && <span className="mt-1 block text-[10.5px] not-italic text-muted-foreground">{c.who}</span>}
                </blockquote>
              </>
            )
            const cls = 'flex min-w-0 flex-1 basis-0 flex-col justify-center gap-2 px-4 py-1 hover:bg-inner'
            return app
              ? <Link key={i} href={voiceHref(f, { theme: c.themeId })} scroll={false} className={cls}>{body}</Link>
              : <div key={i} className={cls}>{body}</div>
          })}
        </div>
      ) : (
        <TileEmpty>{d.map.totalThemes === 0 ? 'Verbatim voices land with your first analysed update.' : 'No quotable voices under these filters yet — the list has every theme.'}</TileEmpty>
      )}
    </Tile>
  )
}

/** One category tab, "Label N" — a Link so the server filters. A quiet chip
 *  rather than an underline so the row can wrap onto a second line cleanly. */
function TabLink({ label, count, active, href, app }: { label: string; count: number; active: boolean; href: string; app: boolean }) {
  const cls = `inline-flex h-[22px] shrink-0 items-center gap-1 whitespace-nowrap rounded-md px-2 text-[11.5px] font-medium transition-colors ${
    active ? 'bg-foreground text-tile' : 'text-muted-foreground hover:bg-inner hover:text-foreground'
  }`
  const body = (
    <>
      {label}
      <span className={`font-mono text-[10.5px] tabular-nums ${active ? 'text-tile/70' : 'text-muted-foreground/80'}`}>{count}</span>
    </>
  )
  return app ? <Link href={href} scroll={false} className={cls}>{body}</Link> : <span className={cls}>{body}</span>
}

/** One gaining/fading row: the Mover chart row for a theme trajectory. A
 *  gaining theme draws green, a fading one clay; an emerging theme is a
 *  "New" row with its count and no delta (nothing before it to compare). */
function MoverRow({ t, sparkWidth }: { t: Trajectory; sparkWidth?: number }) {
  const kind = bucketKind(t.bucket)
  const suffix = kind === 'competitor' ? ` · ${competitorName(t.bucket)}’s` : kind === 'client' ? ' · yours' : ''
  const label = (
    <span className="flex min-w-0 items-center gap-1.5">
      {t.movement === 'emerging' && <span className={`${chip} bg-inner text-muted-foreground`}>New</span>}
      <span className="truncate">{t.label}{suffix ? <span className="text-muted-foreground">{suffix}</span> : null}</span>
    </span>
  )
  return (
    <Mover
      label={label}
      series={t.evidence}
      value={t.latestEvidence}
      delta={t.movement === 'emerging' ? null : t.evidenceDelta}
      good="up"
      color={t.movement === 'fading' ? 'var(--negative)' : t.movement === 'emerging' ? 'var(--you)' : 'var(--positive)'}
      sparkWidth={sparkWidth ?? 72}
    />
  )
}

/** A ranked section of the list drawer. */
function ThemeList({ title, hint, rows, href, compact }: {
  title: string
  hint: string
  rows: ThemeListRow[]
  href: (id: string) => string
  compact?: boolean
}) {
  if (rows.length === 0) return null
  return (
    <section className="space-y-1.5">
      <h3 className="flex items-baseline gap-2 text-[10.5px] font-semibold uppercase tracking-[0.07em] text-muted-foreground">
        {title} <span className="font-mono normal-case tracking-normal">{rows.length}</span>
        <span className="font-normal normal-case tracking-normal opacity-80">{hint}</span>
      </h3>
      <div className="flex flex-col">
        {rows.map((t) => (
          <Link key={t.id} href={href(t.id)} scroll={false} className="flex items-center gap-2 rounded-sm py-[3px] hover:bg-inner">
            <span className="size-1.5 shrink-0 rounded-full" style={{ background: EDGE[t.kind] }} aria-hidden />
            <span className={`min-w-0 flex-1 truncate ${compact ? 'text-[12px] text-muted-foreground' : 'text-[12.5px]'}`}>{t.label}</span>
            {t.isNew && <span className={`${chip} bg-inner text-muted-foreground`}>New</span>}
            {!compact && <span className={`${chip} hidden sm:inline-flex ${categoryChip(t.category)}`}>{categoryLabel(t.category)}</span>}
            <span className="w-7 shrink-0 text-right font-mono text-[11.5px] font-semibold tabular-nums">{t.count}</span>
          </Link>
        ))}
      </div>
    </section>
  )
}

/** Full export: one confirmed theme per slide — key `voice.theme:<index>`. */
const THEME_SLIDE_PREFIX = 'voice.theme:'

const renderables: Record<string, Renderable<D>> = {
  'voice.map': { key: 'voice.map', title: 'The conversation, by theme', render: map },
  'voice.theme': { key: 'voice.theme', title: 'Theme', render: theme },
  'voice.movers': { key: 'voice.movers', title: 'Gaining and fading', render: movers },
  'voice.phrases': { key: 'voice.phrases', title: 'How your customers talk', render: phrases },
  'voice.mood': { key: 'voice.mood', title: 'Audience mood', render: mood },
  'voice.ribbon': { key: 'voice.ribbon', title: 'Hear these voices', render: ribbon },
}

const GRID_ORDER = ['voice.map', 'voice.theme', 'voice.movers', 'voice.phrases', 'voice.mood', 'voice.ribbon']

/** A renderable for a full-export theme slide; the registry resolves the
 *  `voice.theme:<n>` keys through this so the module stays a fixed catalogue. */
export function voiceThemeSlide(n: number): Renderable<D> {
  return {
    key: `${THEME_SLIDE_PREFIX}${n}`,
    title: 'Theme',
    render: (d) => {
      const t = d.allThemes?.[n]
      return t ? (
        <div className="grid h-full min-h-0 grid-cols-[3fr_2fr] gap-6">
          <div className="min-h-0 overflow-hidden"><ThemeBody t={t} showNew={d.showNew} /></div>
        </div>
      ) : null
    },
  }
}

export const voicePage: PageModule<D> = {
  key: 'voice',
  title: 'Voice of Customer',
  async load(scope) {
    const d = await loadVoice(scope)
    return isVoiceEmpty(d) ? null : d
  },
  slides(d, variant): Slide[] {
    const slides: Slide[] = [
      { title: 'The conversation, by theme', keys: ['voice.map', 'voice.theme'], layout: 'grid' },
      { title: 'What is moving, and how they say it', keys: ['voice.movers', 'voice.phrases', 'voice.mood', 'voice.ribbon'], layout: 'grid' },
    ]
    if (variant === 'full') for (let n = 0; n < (d.allThemes?.length ?? 0); n++) slides.push({ title: `Theme · ${d.allThemes![n].label}`, keys: [`${THEME_SLIDE_PREFIX}${n}`], layout: 'single' })
    return slides
  },
  renderables: new Proxy(renderables, {
    get(target, key: string) {
      if (key in target) return target[key]
      if (typeof key === 'string' && key.startsWith(THEME_SLIDE_PREFIX)) return voiceThemeSlide(Number(key.slice(THEME_SLIDE_PREFIX.length)))
      return undefined
    },
  }),
  snapshotTitle: (d) => `Voice of Customer · ${d.brand} · ${weekdayDate(d.runDate)}`,
}

/** The app page: page bar, the grid, the drawers. */
export function VoicePage({ data: d, detail, params }: { data: VoiceData | VoiceEmpty; detail?: string; params: Record<string, string | undefined> }) {
  const showLegend = detail === 'legend'
  if (isVoiceEmpty(d)) {
    return (
      <PageFrame>
        <PageBar title="Voice of Customer" context="What are they saying?">
          <HowToRead items={d.legendItems} open={showLegend} basePath="/dashboard/voice" />
        </PageBar>
        <PageGrid>
          <Tile col={12} row={2} eyebrow="The conversation, by theme">
            <TileEmpty>Your customer voices land with your first update — check back then.</TileEmpty>
          </Tile>
        </PageGrid>
      </PageFrame>
    )
  }
  const f = d.filters
  const closeHref = voiceHref(f, { detail: null })
  const themeHref = (id: string) => voiceHref(f, { theme: id })
  // The export carries the seed the reader is looking at, so the snapshot
  // shows these five voices, not a fresh draw.
  const exportParams = { ...params, seed: String(f.seed) }
  return (
    <ExportScope page="voice" params={exportParams} tiles={GRID_ORDER.map((k) => ({ key: k, title: renderables[k].title }))}>
    <PageFrame>
      <PageBar title="Voice of Customer" context={`What are they saying? · ${weekdayDate(d.runDate)}`}>
        {d.pillsInBar && <EntityPills d={d} />}
        <ExportMenu />
        <HowToRead items={d.legendItems} open={showLegend} basePath="/dashboard/voice" />
      </PageBar>

      <PageGrid>
        {GRID_ORDER.map((key) => <Fragment key={key}>{renderables[key].render(d, 'app')}</Fragment>)}
      </PageGrid>

      {/* ── drawers: one click deeper ────────────────────────────────── */}

      <DetailDrawer value="list" closeHref={closeHref} title={`All ${fmtInt(d.map.shownCount)} themes`}
        description={`${d.list.entityLabel}${d.list.typeLabel ? ` · ${d.list.typeLabel}` : ''} · widest-heard first`}>
        <div className="space-y-5">
          <ThemeList title="Confirmed" hint="heard in more than one conversation" rows={d.list.confirmed} href={themeHref} />
          <ThemeList title="Early signals" hint="heard once so far, but clearly" rows={d.list.early} href={themeHref} />
          <ThemeList title="Heard once" hint="single mentions, kept for the record" rows={d.list.heardOnce} href={themeHref} compact />
          {d.map.shownCount === 0 && <p className="text-muted-foreground">No themes match these filters.</p>}
        </div>
      </DetailDrawer>

      <DetailDrawer value="movers" closeHref={closeHref} title="Gaining and fading" description={`themes heard in ≥2 of your ${d.updatesCount} updates · conversations per update, delta vs last`}>
        <div className="space-y-5">
          {(['gaining', 'fading', 'emerging'] as const).map((m) => {
            const rows = d.movers.rows.filter((t) => t.movement === m)
            if (rows.length === 0) return null
            return (
              <section key={m} className="space-y-2">
                <h3 className="text-[10.5px] font-semibold uppercase tracking-[0.07em] text-muted-foreground">
                  {m === 'gaining' ? 'Gaining' : m === 'fading' ? 'Fading' : 'New since your first update'} <span className="font-mono normal-case tracking-normal">{rows.length}</span>
                </h3>
                <div className="flex flex-col gap-2">
                  {rows.map((t) => <MoverRow key={t.key} t={t} sparkWidth={88} />)}
                </div>
              </section>
            )
          })}
          {d.movers.steadyCount > 0 && <p className="text-[11px] text-muted-foreground">{d.movers.steadyCount} more {d.movers.steadyCount === 1 ? 'theme has' : 'themes have'} held steady across the updates {d.movers.steadyCount === 1 ? 'it was' : 'they were'} heard in.</p>}
          {d.movers.rows.length === 0 && <p className="text-muted-foreground">Nothing has moved clearly yet.</p>}
        </div>
      </DetailDrawer>

      <DetailDrawer open={detail === 'language'} closeHref={closeHref} title="How your customers talk" description={`${fmtInt(d.phrases.total)} phrases, verbatim — the words to borrow`}>
        <div className="flex flex-wrap gap-1.5">
          {d.phrases.all.map((s, i) => (
            <span key={i} title={s.platform ? platformLabel(s.platform) : undefined} className="rounded-[4px] bg-inner px-2.5 py-1 text-[12px] italic leading-[1.35] text-foreground/80">{s.phrase}</span>
          ))}
        </div>
        {d.phrases.total > d.phrases.all.length && <p className="mt-3 text-[11px] text-muted-foreground">showing {fmtInt(d.phrases.all.length)} of {fmtInt(d.phrases.total)}</p>}
      </DetailDrawer>
    </PageFrame>
    </ExportScope>
  )
}
