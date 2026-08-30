import Link from 'next/link'
import { Fragment, type ReactNode } from 'react'
import { HowToRead } from '@/components/how-to-read'
import { Quotes } from '@/components/quotes'
import { ProportionBar } from '@/components/proportion-bar'
import { PageFrame, PageGrid, PageBar, BarPill } from '@/components/shell/page-grid'
import { Tile, StripCell, TileEmpty } from '@/components/shell/tile'
import { DetailDrawer } from '@/components/shell/detail-drawer'
import { DrawerLink } from '@/components/shell/drawer-link'
import { Sparkline } from '@/components/charts/sparkline'
import { StatValue, StatSentence, Delta } from '@/components/charts/stat'
import { RankedBar } from '@/components/charts/ranked-bar'
import { Ring } from '@/components/charts/ring'
import { RingSync } from '@/components/charts/ring-sync'
import { ClaimPopover } from '@/components/claim-popover'
import { Mover } from '@/components/charts/mover'
import { PlatformIcon } from '@/components/charts/platform-icon'
import { dashboardEmail } from '@/components/email/tiles'
import { fmtInt, fmtCompact, fmtPct, weekdayDate, shortDate, platformLabel } from '@/lib/format'
import { BUCKET_COLOR, loadDashboard, isDashboardEmpty, priorityLabel, type DashboardData, type DashboardEmpty } from '@/lib/pages/dashboard'
import type { PageModule, RenderMode, Renderable, Slide } from '@/lib/renderables/types'

// Dashboard renderers — the JSX half of the old app/dashboard/page.tsx
// (split 2026-08-29, Reports & Exports T3), one pure function per tile.
// `mode` changes only what has no meaning on paper: links deeper, the claim
// popover, the drawers. Colour means something here: you = green, competitor
// = orange, category = grey; the only underlined claim is the one that opens
// its voices (rule 5). Every tile gates on its data and shows an honest empty
// line at its size — the grid never collapses.

const MOVE_STYLE: Record<string, { color: string; good: 'up' | 'down' | 'neutral'; unit: string; fmt: (n: number) => string }> = {
  yourShare: { color: 'var(--you)', good: 'up', unit: 'pt', fmt: (n) => fmtPct(n) },
  compShare: { color: 'var(--comp)', good: 'down', unit: 'pt', fmt: (n) => fmtPct(n) },
  positive: { color: 'var(--positive)', good: 'up', unit: 'pt', fmt: (n) => fmtPct(n, 0) },
  volume: { color: 'var(--you)', good: 'up', unit: '', fmt: fmtCompact },
  themes: { color: 'var(--cat)', good: 'up', unit: '', fmt: fmtInt },
}

type D = DashboardData
type R = (data: D, mode: RenderMode) => ReactNode

// ── strip: five counted receipts ───────────────────────────────────────────
const strip: R = ({ strip: s }, mode) => {
  const platformMax = s.platforms[0]?.count ?? 0
  const hover = mode === 'app' && s.historyLabels.length > 1 ? { labels: s.historyLabels } : undefined
  return (
    <Tile col={12} row={1} variant="strip">
      <StripCell eyebrow="Tracking">
        {s.termTotal > 0 ? (
          <StatSentence
            value={s.termTotal}
            unit="terms"
            base={<span className="text-secondary-foreground">{s.termCounts.brand} brand · {s.termCounts.competitor} competitor · {s.termCounts.category} category</span>}
            aside={<span className="ml-auto flex items-center gap-1 text-muted-foreground">{s.platformsTracked.map((p) => <PlatformIcon key={p} platform={p} />)}{s.cadence && <span className="ml-1 text-[11px]">{s.cadence}</span>}</span>}
          />
        ) : <TileEmpty>Add search terms in Settings to start tracking.</TileEmpty>}
      </StripCell>
      <StripCell eyebrow={s.videos.period ? 'Videos this update' : 'Videos tracked'}>
        {s.videos.now != null ? (
          <StatSentence
            value={fmtInt(s.videos.now)}
            delta={s.videos.prev != null ? s.videos.now - s.videos.prev : null}
            good="neutral"
            base={s.videos.period ? (s.videos.allTime != null ? `vs last update · ${fmtInt(s.videos.allTime)} all-time` : 'vs last update') : 'all-time, across every update'}
            aside={s.videos.series.length > 1 ? <Sparkline values={s.videos.series} color="var(--you)" fill hover={hover} /> : undefined}
          />
        ) : <TileEmpty>Counted with the first update.</TileEmpty>}
      </StripCell>
      <StripCell eyebrow={s.comments.period ? 'Comments analysed' : 'Comments read'}>
        {s.comments.now != null ? (
          <StatSentence
            value={fmtInt(s.comments.now)}
            delta={s.comments.prev != null ? s.comments.now - s.comments.prev : null}
            good="up"
            base={s.comments.period ? (s.comments.allTime != null ? `vs last update · ${fmtInt(s.comments.allTime)} all-time` : 'vs last update') : 'all-time, across every update'}
            aside={s.comments.series.length > 1 ? <Sparkline values={s.comments.series} color="var(--you)" fill hover={hover} /> : undefined}
          />
        ) : <TileEmpty>Counted with the first update.</TileEmpty>}
      </StripCell>
      <StripCell eyebrow="Themes heard">
        {s.tiers.confirmed + s.tiers.early + s.tiers.once > 0 ? (
          <StatSentence
            value={s.tiers.confirmed}
            unit="confirmed"
            base={<span className="font-mono tabular-nums text-secondary-foreground">{s.tiers.early} early · {s.tiers.once} heard once{s.registryCount > 0 ? ` · ${fmtInt(s.registryCount)} followed over time` : ''}</span>}
          />
        ) : <TileEmpty>Themes land with the first analysed update.</TileEmpty>}
      </StripCell>
      <StripCell eyebrow="Where the conversation is">
        {s.platforms.length > 0 ? (
          <div className="flex flex-col gap-[3px] text-[11.5px] leading-[1.3]">
            {s.platforms.slice(0, 4).map((p) => (
              <RankedBar key={p.platform} label={<span className="flex items-center gap-1.5"><PlatformIcon platform={p.platform} className="text-muted-foreground" />{platformLabel(p.platform)}</span>} pct={(p.count / platformMax) * 100} color="var(--you)" count={p.count} barWidth={70} />
            ))}
          </div>
        ) : <TileEmpty>Counted with the first update.</TileEmpty>}
      </StripCell>
    </Tile>
  )
}

// ── hero: the executive brief ──────────────────────────────────────────────
const hero: R = (d, mode) => {
  const h = d.hero
  const app = mode === 'app'
  const claimEvidence = h.oneThing && h.voices > 0
    ? { voices: h.voices, platforms: h.platforms, quotes: h.quotes.map((q) => q.text), href: `/dashboard/market?rec=${encodeURIComponent(h.oneThing.id)}`, hrefLabel: 'See all the voices in Market Intelligence →' }
    : null
  return (
    <Tile exportKey="dashboard.hero" col={7} row={3} variant="hero" distribute="between" eyebrow="Executive brief · this update" meta={weekdayDate(d.runDate)}
      lead={h.show ? h.headline : undefined}
      footer={h.oneThing ? (
        <span className="inline-flex max-w-full items-baseline gap-2">
          <span className="font-mono text-muted-foreground">→</span>
          <span className="min-w-0 truncate">
            The one thing to do:{' '}
            {app
              ? (claimEvidence
                  ? <ClaimPopover evidence={claimEvidence}>{h.oneThing.title}</ClaimPopover>
                  : <Link href="/dashboard/market" className="hover:underline">{h.oneThing.title}</Link>)
              : <span>{h.oneThing.title}</span>}
          </span>
        </span>
      ) : null}
      footerNote={app ? <DrawerLink href="/dashboard?detail=brief" className="font-medium text-foreground hover:underline">Read the full brief →</DrawerLink> : undefined}
    >
      {h.show ? (
        <>
          {h.beats.length > 0 && (
            <div className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-3">
              {h.beats.slice(0, 3).map((b) => (
                <div key={b.metric} className="min-w-0">
                  <div className="font-mono text-[18px] font-semibold leading-none tabular-nums tracking-[-0.02em]">{b.figure}</div>
                  <p className="mt-1.5 line-clamp-3 text-[12.5px] leading-[1.55] text-secondary-foreground">{b.before}<span className="font-semibold text-foreground">{b.figure}</span>{b.after}</p>
                </div>
              ))}
            </div>
          )}
          {h.quotes.length > 0 && (
            <div className="flex flex-col gap-1.5 border-l-2 border-border pl-3">
              {h.quotes.slice(0, 2).map((q, i) => (
                <blockquote key={i} className="max-w-[44rem] font-serif text-[14px] leading-[1.45] text-foreground">
                  <span className="line-clamp-1">“{q.text}”</span>
                </blockquote>
              ))}
              {h.voices > 0 && <span className="font-mono text-[10.5px] text-muted-foreground">{h.quotes.length > 1 ? 'two' : 'one'} of {fmtInt(h.voices)} voices behind the top recommendation</span>}
            </div>
          )}
        </>
      ) : (
        <TileEmpty>Your first brief lands with the next update.</TileEmpty>
      )}
    </Tile>
  )
}

// ── sentiment ──────────────────────────────────────────────────────────────
const sentiment: R = ({ sentiment: s }) => (
  <Tile exportKey="dashboard.sentiment" col={5} row={1} eyebrow="Audience sentiment" meta={s ? `${fmtInt(s.judged)} judged · to date` : undefined} distribute="center">
    {s ? (
      <>
        <div className="flex items-end gap-3">
          <StatValue size="lg" unit="positive">{fmtPct(s.positivePct, 0)}</StatValue>
          {s.deltaText && (
            <span className={`mb-0.5 font-mono text-[11px] ${s.deltaText.good === null ? 'text-muted-foreground' : s.deltaText.good ? 'text-positive' : 'text-negative'}`}>{s.deltaText.text}</span>
          )}
          {s.tierLabel && <span className="mb-0.5 ml-auto text-[11px] text-muted-foreground">{s.tierLabel}</span>}
        </div>
        <ProportionBar segments={s.segments} of="videos" />
        <div className="flex flex-wrap gap-x-3 text-[11px] text-secondary-foreground">
          {s.segments.map((seg) => (
            <span key={seg.label} className="flex items-center gap-1"><span className={`size-1.5 rounded-[2px] ${seg.color}`} aria-hidden />{seg.label} {fmtInt(seg.count)}</span>
          ))}
        </div>
      </>
    ) : <TileEmpty>Sentiment lands with the next update.</TileEmpty>}
  </Tile>
)

// ── share of tracked conversation ──────────────────────────────────────────
const share: R = ({ share: s }, mode) => {
  const app = mode === 'app'
  const body = s && s.segments.length > 0 ? (
    <>
      <Ring interactive={app} segments={s.segments.map((seg) => ({ label: seg.label, value: seg.value, color: seg.color }))} size={128} thickness={16} center={s.client ? fmtPct(s.client.pct) : undefined} sub={s.client ? 'you' : undefined} />
      <div role="list" className="flex min-w-0 flex-1 flex-col gap-1 text-[11.5px]">
        {s.segments.map((seg, i) => (
          <div key={seg.label} data-seg={i} tabIndex={app ? 0 : undefined} role="listitem" aria-label={`${seg.label} ${fmtPct(seg.pct)}`} className="flex items-center gap-1.5 px-1.5 py-0.5 -mx-1.5 outline-none focus-visible:ring-1 focus-visible:ring-ring">
            <span className="size-2 shrink-0 rounded-[2px]" style={{ background: seg.color }} aria-hidden />
            <span className="min-w-0 flex-1 truncate text-secondary-foreground">{seg.label}</span>
            <span className="font-mono text-[11.5px] font-semibold tabular-nums">{fmtPct(seg.pct)}</span>
            <span className="w-14 text-right"><Delta value={seg.delta} unit="pt" good={seg.good} /></span>
          </div>
        ))}
        <p className="mt-1 line-clamp-2 px-0 text-[11px] leading-[1.4] text-muted-foreground">
          {s.client ? `${fmtInt(s.client.videos)} of your videos` : 'none of your videos'}{s.topCompetitor ? ` · ${fmtInt(s.topCompetitor.videos)} ${s.topCompetitor.name}` : ''}{s.rest ? ` · ${fmtInt(s.rest.videos)} category` : ''}.
          {s.client && s.topCompetitor ? (s.client.pct >= s.topCompetitor.pct ? ` You lead the tracked brands; ${s.topCompetitor.name} follows.` : ` ${s.topCompetitor.name} leads the tracked brands.`) : ''}
        </p>
      </div>
    </>
  ) : null
  return (
    <Tile exportKey="dashboard.share" col={5} row={2} eyebrow="Share of tracked conversation" meta={s?.usePeriodShare ? 'by videos · this update' : 'by videos · all updates'}
      footer={app ? <Link href="/dashboard/competitive">Where you stand{s?.topCompetitor ? ` vs ${s.topCompetitor.name}` : ''} →</Link> : undefined}
      distribute="center"
    >
      {body ? (
        app
          ? <RingSync className="flex flex-1 items-center gap-4">{body}</RingSync>
          : <div className="flex flex-1 items-center gap-4">{body}</div>
      ) : <TileEmpty>Share lands once a competitor is tracked and analysed.</TileEmpty>}
    </Tile>
  )
}

// ── what your market is talking about ──────────────────────────────────────
const themes: R = ({ themes: t }, mode) => {
  const app = mode === 'app'
  return (
    <Tile exportKey="dashboard.themes" col={5} row={2} eyebrow="What your market is talking about" meta="conversations per theme"
      footer={app ? <Link href="/dashboard/voice">All {t.confirmed > 0 ? `${t.confirmed} confirmed ` : ''}themes →</Link> : undefined}
      footerNote={
        <span className="flex items-center gap-2.5">
          <span className="flex items-center gap-1"><span className="size-2 rounded-[2px]" style={{ background: BUCKET_COLOR.client }} aria-hidden />you</span>
          <span className="flex items-center gap-1"><span className="size-2 rounded-[2px]" style={{ background: BUCKET_COLOR.category }} aria-hidden />category</span>
          {t.topCompetitorName && <span className="flex items-center gap-1"><span className="size-2 rounded-[2px]" style={{ background: BUCKET_COLOR.competitor }} aria-hidden />{t.topCompetitorName}</span>}
        </span>
      }
    >
      {t.rows.length > 0 ? (
        <div className="flex flex-col gap-[5px]">
          {t.rows.map((row, i) => (
            <RankedBar
              key={`${i}-${row.label}`}
              label={row.label}
              dot
              color={BUCKET_COLOR[row.bucket]}
              pct={(row.conversations / t.max) * 100}
              count={row.conversations}
              badge={row.isNew ? <span className="rounded-full bg-accent px-1.5 py-px text-[10px] font-medium text-accent-foreground">New</span> : undefined}
              href={app ? `/dashboard/voice?themes=${encodeURIComponent(row.memberThemes.join(','))}` : undefined}
            />
          ))}
          {t.analysedConversations > 0 && <span className="sr-only">of {t.analysedConversations} conversations analysed</span>}
        </div>
      ) : <TileEmpty>Themes land with the first analysed update.</TileEmpty>}
    </Tile>
  )
}

// ── movement since the first update ────────────────────────────────────────
const movement: R = ({ movement: mv, updatesCount }, mode) => (
  <Tile exportKey="dashboard.movement" col={4} row={2} eyebrow="Since your first update"
    meta={mv ? `${updatesCount} updates · ${shortDate(mv.dates[0])} → ${shortDate(mv.dates[mv.dates.length - 1])}` : undefined}
    footer={mv && mode === 'app' ? <Link href="/dashboard/competitive">Where you stand over time →</Link> : undefined}
    distribute="center"
  >
    {mv ? (
      <div className="flex flex-col gap-3">
        {mv.rows.map((r) => {
          const st = MOVE_STYLE[r.key]
          return <Mover key={r.key} label={r.label} series={r.series} value={st.fmt(r.value)} delta={r.delta} unit={st.unit} good={st.good} color={st.color} />
        })}
      </div>
    ) : <TileEmpty>Your first comparison lands with the next update — two updates are needed to show movement.</TileEmpty>}
  </Tile>
)

// ── top recommendation ─────────────────────────────────────────────────────
const recommendation: R = ({ hero: h }, mode) => {
  const app = mode === 'app'
  const grounded = h.voices > 0 ? `Grounded in ${fmtInt(h.voices)} voices${h.platforms.length > 1 ? ` · ${h.platforms.length} platforms` : ''}` : null
  return (
    <Tile exportKey="dashboard.recommendation" col={3} row={1} distribute="center" hoverable={app && !!h.oneThing} className="py-3" eyebrow="Top recommendation" meta={h.oneThing ? priorityLabel(h.oneThing.priority) : undefined}
      footer={h.oneThing ? (
        app ? (
          <Link href={`/dashboard/market?rec=${encodeURIComponent(h.oneThing.id)}`} className="after:absolute after:inset-0">
            {grounded ? `${grounded} →` : 'Why, and the voices →'}
          </Link>
        ) : (grounded ?? undefined)
      ) : undefined}
    >
      {h.oneThing ? (
        <p className="line-clamp-2 text-[12.5px] font-semibold leading-[1.2] tracking-[-0.01em]">{h.oneThing.title}</p>
      ) : <TileEmpty>Recommendations land with the next update.</TileEmpty>}
    </Tile>
  )
}

// ── your accounts ──────────────────────────────────────────────────────────
const accounts: R = ({ accounts: a }, mode) => (
  <Tile exportKey="dashboard.accounts" col={3} row={1} distribute="center" eyebrow="On your accounts" meta={a.series.length > 0 ? 'followers · 30 days' : undefined}
    footer={a.topEvent ? (mode === 'app' ? <Link href="/dashboard/videos">{a.topEvent.magnitude_label} →</Link> : a.topEvent.magnitude_label) : undefined}
  >
    {a.series.length > 0 ? (
      <div className="flex flex-col gap-[3px]">
        {a.series.slice(0, 3).map((s) => (
          <div key={s.platform} className="flex items-center gap-2 text-[12px]">
            <PlatformIcon platform={s.platform} className="text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate text-[11.5px]">{platformLabel(s.platform)}</span>
            <Sparkline values={s.values} color="var(--you)" width={48} height={16} />
            <span className="w-10 text-right font-mono text-[11.5px] font-semibold tabular-nums">{fmtCompact(s.latest)}</span>
            <span className="w-11 text-right"><Delta value={s.deltaPct} unit="%" decimals={1} good="up" /></span>
          </div>
        ))}
      </div>
    ) : <TileEmpty>Add your own handles in Settings to follow your accounts here.</TileEmpty>}
  </Tile>
)

// ── the full brief (the drawer in the app; its own slide on paper) ─────────
function BriefBody({ d, mode }: { d: D; mode: RenderMode }) {
  const h = d.hero
  const app = mode === 'app'
  return (
    <div className="space-y-4">
      <p className="font-serif text-[17px] font-medium leading-snug">{h.headline}</p>
      {h.beats.map((b) => (
        <p key={b.metric} className="text-[13px] leading-[1.5]">{b.before}<strong className="font-semibold">{b.figure}</strong>{b.after}</p>
      ))}
      {h.fallback && <p className="text-[11px] text-muted-foreground">Composed from this update’s counted figures.</p>}
      {h.oneThing && (
        <div className="rounded-[4px] bg-inner p-3">
          <p className="text-[10.5px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">{priorityLabel(h.oneThing.priority)}</p>
          <p className="mt-1 text-[13.5px] font-semibold">{h.oneThing.title}</p>
          <p className="mt-1 text-[12.5px] text-secondary-foreground">{h.oneThing.reasoning}</p>
          {app && <Link href={`/dashboard/market?rec=${encodeURIComponent(h.oneThing.id)}`} className="mt-2 inline-block text-[12px] font-medium underline underline-offset-2">See the full picture →</Link>}
        </div>
      )}
      {h.quotes.length > 0 && (
        <div>
          <p className="mb-2 text-[10.5px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">In their words</p>
          <Quotes items={h.quotes.map((q) => q.text)} />
        </div>
      )}
      {app && d.funnel.length > 0 && (
        <DrawerLink href="/dashboard?detail=funnel" className="inline-block text-[12px] font-medium underline underline-offset-2">How this update was built →</DrawerLink>
      )}
    </div>
  )
}

function FunnelBody({ d }: { d: D }) {
  return (
    <>
      <ol className="space-y-2.5 border-l-2 border-border pl-4">
        {d.funnel.map((s) => (
          <li key={s.label} className="flex items-baseline gap-3">
            <span className="w-16 shrink-0 text-right font-mono text-[18px] font-semibold tabular-nums">{fmtInt(s.n)}</span>
            <span className="text-[12.5px] text-muted-foreground">{s.label}</span>
          </li>
        ))}
      </ol>
      <p className="mt-4 text-[11px] text-muted-foreground">a conversation is one video and the comments it sparked; themes are confirmed only when heard in more than one conversation</p>
    </>
  )
}

/** The brief as one slide: the prose and the voices on the left; the one
 *  thing to do and how the update was built on the right. */
const brief: R = (d) => {
  const h = d.hero
  return (
    <div className="grid h-full min-h-0 grid-cols-[3fr_2fr] gap-8">
      <div className="min-h-0 space-y-4 overflow-hidden">
        <p className="font-serif text-[20px] font-medium leading-snug [text-wrap:pretty]">{h.headline}</p>
        {h.beats.map((b) => (
          <p key={b.metric} className="text-[14px] leading-[1.5]">{b.before}<strong className="font-semibold">{b.figure}</strong>{b.after}</p>
        ))}
        {h.fallback && <p className="text-[11px] text-muted-foreground">Composed from this update’s counted figures.</p>}
        {h.quotes.length > 0 && (
          <div>
            <p className="mb-2 text-[10.5px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">In their words</p>
            <Quotes items={h.quotes.map((q) => q.text)} />
          </div>
        )}
      </div>
      <div className="min-h-0 space-y-5 overflow-hidden">
        {h.oneThing && (
          <div className="rounded-[4px] bg-inner p-3">
            <p className="text-[10.5px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">{priorityLabel(h.oneThing.priority)}</p>
            <p className="mt-1 text-[13.5px] font-semibold">{h.oneThing.title}</p>
            <p className="mt-1 text-[12.5px] text-secondary-foreground">{h.oneThing.reasoning}</p>
          </div>
        )}
        {d.funnel.length > 0 && (
          <div>
            <p className="mb-3 text-[10.5px] font-semibold uppercase tracking-[0.06em] text-secondary-foreground">How this update was built</p>
            <FunnelBody d={d} />
          </div>
        )}
      </div>
    </div>
  )
}

const renderables: Record<string, Renderable<D>> = {
  'dashboard.strip': { key: 'dashboard.strip', title: 'Counted receipts', render: strip },
  'dashboard.hero': { key: 'dashboard.hero', title: 'Executive brief', render: hero },
  'dashboard.sentiment': { key: 'dashboard.sentiment', title: 'Audience sentiment', render: sentiment },
  'dashboard.share': { key: 'dashboard.share', title: 'Share of tracked conversation', render: share },
  'dashboard.themes': { key: 'dashboard.themes', title: 'What your market is talking about', render: themes },
  'dashboard.movement': { key: 'dashboard.movement', title: 'Since your first update', render: movement },
  'dashboard.recommendation': { key: 'dashboard.recommendation', title: 'Top recommendation', render: recommendation },
  'dashboard.accounts': { key: 'dashboard.accounts', title: 'On your accounts', render: accounts },
  'dashboard.brief': { key: 'dashboard.brief', title: 'The executive brief', render: brief },
}

// The email says the same tiles in tables (Stage 3); a tile without an email
// renderer is on the paper only.
for (const [k, fn] of Object.entries(dashboardEmail)) renderables[k].email = fn

/** The grid, in the page's order. */
const GRID_ORDER = ['dashboard.strip', 'dashboard.hero', 'dashboard.sentiment', 'dashboard.share', 'dashboard.themes', 'dashboard.movement', 'dashboard.recommendation', 'dashboard.accounts']

export function dashboardSlides(): Slide[] {
  return [
    { title: 'Where you stand', keys: ['dashboard.strip', 'dashboard.hero', 'dashboard.sentiment', 'dashboard.share'], layout: 'grid' },
    { title: 'The executive brief', keys: ['dashboard.brief'], layout: 'single' },
    { title: 'What is moving', keys: ['dashboard.themes', 'dashboard.movement', 'dashboard.recommendation', 'dashboard.accounts'], layout: 'grid' },
  ]
}

export const dashboardPage: PageModule<D> = {
  key: 'dashboard',
  title: 'Dashboard',
  async load(scope) {
    const d = await loadDashboard(scope)
    return isDashboardEmpty(d) ? null : d
  },
  slides: () => dashboardSlides(),
  renderables,
  snapshotTitle: (d) => `Dashboard · ${d.brand} · ${weekdayDate(d.runDate)}`,
}

/** The app page: page bar, the grid, the drawers. */
export function DashboardPage({ data: d, detail }: { data: DashboardData | DashboardEmpty; detail?: string; params: Record<string, string | undefined> }) {
  if (isDashboardEmpty(d)) {
    return (
      <PageFrame>
        <PageBar title="Dashboard" context={d.brand} />
        <PageGrid>
          <Tile col={12} row={2} eyebrow="Your first update">
            <TileEmpty>Your first analysis {d.nextUpdate ? `lands with the ${d.nextUpdate.replace('next update ', '')} update` : 'is on its way'} — check back then.</TileEmpty>
          </Tile>
        </PageGrid>
      </PageFrame>
    )
  }
  return (
    <PageFrame>
      <PageBar title="Dashboard" context={d.context}>
        {d.updatesCount > 1 && <BarPill>Last {d.updatesCount} updates</BarPill>}
        <HowToRead items={d.legendItems} open={detail === 'legend'} basePath="/dashboard" />
      </PageBar>

      <PageGrid>
        {GRID_ORDER.map((key) => <Fragment key={key}>{renderables[key].render(d, 'app')}</Fragment>)}
      </PageGrid>

      {/* ── drawers: one click deeper ────────────────────────────────── */}
      <DetailDrawer value="brief" closeHref="/dashboard" title="The executive brief" description={`${d.brand} · ${weekdayDate(d.runDate)}`}>
        <BriefBody d={d} mode="app" />
      </DetailDrawer>

      <DetailDrawer value="funnel" closeHref="/dashboard" title="How this update was built" description="every figure is counted from stored data — nothing is estimated">
        <FunnelBody d={d} />
      </DetailDrawer>
    </PageFrame>
  )
}

