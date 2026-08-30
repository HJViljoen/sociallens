import Link from 'next/link'
import type { ReactNode } from 'react'
import { HeartCrack, Compass, Users, UserRound, Layers, Zap } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Quotes } from '@/components/quotes'
import { CrowdFigure, assignFigures, type FigureKey } from '@/components/crowd-figure'
import { ProfileConnectors } from '@/components/profile-connectors'
import { PlatformMix, ShareOverTime } from '@/components/profile-stats'
import { Tile } from '@/components/shell/tile'
import { glossaryRule, type GlossaryKey } from '@/lib/calibration'
import { loadProfile, isProfileEmpty, type ProfileData, type ProfileEmpty, type PersonaDetail } from '@/lib/pages/profile'
import type { Quote, PageModule, RenderMode, Renderable, Slide } from '@/lib/renderables/types'

// Consumer Profile renderers — the JSX half of the old page (split
// 2026-08-29, Reports & Exports T7), one pure function per renderable. `mode`
// changes only what has no meaning on paper: the switcher's `Link`s become
// plain pills, `ProfileConnectors` (a client component that measures the DOM)
// and the CSS entrance-animation classes are app-only, and the `key={active}`
// remount trick is skipped.
//
// This page keeps its bespoke `Card` + 3-column grid rather than
// `PageGrid`/`Tile` — the composition (switcher, figure, blocks) is one
// renderable, `profile.persona`, exactly as it read before.

/** The calibrated word carries its own rule as a tooltip, same as every other
 *  chip in the app — the ladder is a published contract, not a vibe. */
const PREVALENCE_GLOSSARY: Record<string, GlossaryKey> = {
  Dominant: 'dominant',
  Widespread: 'widespread',
  Recurring: 'recurring',
  'Early signal': 'early_signal',
}

type D = ProfileData
type R = (data: D, mode: RenderMode) => ReactNode

// ── the composition: switcher + figure + blocks ────────────────────────────
const persona: R = (d, mode) => {
  const app = mode === 'app'
  const figure = assignFigures(d.personas.map((p) => p.key)).get(d.activeKey) ?? 'a'
  return (
    <>
      {/* Every kind of person on one bar: with a handful of personas the whole
          cast should be visible at once — a stepper hid four of them behind an
          arrow and made the reader page to find out who else is here. */}
      {d.personas.length > 1 ? (
        <div className="flex flex-wrap items-center gap-1 rounded-full border border-border bg-card p-1">
          {d.personas.map((p) => {
            const isActive = p.key === d.activeKey
            const cls = `flex-1 rounded-full px-4 py-2 text-center text-sm font-medium transition-colors ${
              isActive
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'
            }`
            return app ? (
              <Link
                key={p.key}
                href={`/dashboard/profile?persona=${encodeURIComponent(p.key)}`}
                scroll={false}
                aria-current={isActive ? 'page' : undefined}
                className={cls}
              >
                {p.name}
              </Link>
            ) : (
              <span key={p.key} aria-current={isActive ? 'page' : undefined} className={cls}>{p.name}</span>
            )
          })}
        </div>
      ) : (
        <h2 className="text-lg font-semibold leading-tight">{d.active.name}</h2>
      )}
      <PersonaBody p={d.active} figure={figure} mode={mode} isStale={d.isStale} staleRunDate={d.staleRunDate} personaCount={d.personas.length} />
    </>
  )
}

/** Four blocks around a figure that stands on its own — no card, running off
 *  the bottom edge, the way it stands in the crowd behind every other page.
 *  The persona's description is one of the blocks rather than a caption under
 *  the figure, so nothing follows the figure down. */
function PersonaBody({
  p, figure, mode, isStale, staleRunDate, personaCount,
}: {
  p: PersonaDetail
  figure: FigureKey
  mode: RenderMode
  isStale: boolean
  staleRunDate: string | null
  personaCount: number
}) {
  const app = mode === 'app'
  const scopeLabel =
    p.scope === 'client'
      ? { text: 'Your audience', Icon: Users, fg: 'text-accent-foreground', bg: 'bg-accent' }
      : { text: 'Wider category', Icon: Layers, fg: 'text-muted-foreground', bg: 'bg-inner' }
  return (
    // relative: the connector overlay positions against this box. Capped and
    // centred so the blocks stay pulled around the subject on a wide monitor.
    // key (app only): remounts the composition when the persona changes,
    // which replays the entrance animations and re-measures the connectors.
    <div
      key={app ? p.key : undefined}
      data-connector-root
      // On paper the composition gets a definite height (the slide body's),
      // which is what lets the figure's h-full mean something; on screen it
      // takes the pane.
      // lg:/xl: never fire in Chrome's print media (the page box measures
      // under 1024px there), so paper states the three columns outright.
      className={`relative mx-auto grid w-full max-w-[84rem] ${app ? 'gap-6 lg:min-h-[calc(100dvh-10rem)] lg:grid-cols-[1fr_1.15fr_1fr] lg:gap-7' : 'h-[540px] grid-cols-[1fr_1.15fr_1fr] gap-7 overflow-hidden'}`}
    >
      {/* ProfileConnectors measures the DOM client-side (ResizeObserver +
          getPointAtLength) — app only; print has no equivalent measurement pass. */}
      {app && <ProfileConnectors />}
      <div className={app ? 'order-2 flex flex-col gap-6 lg:order-1 lg:h-full lg:justify-center lg:gap-16' : 'order-1 flex h-full flex-col justify-center gap-8'}>
        <div data-connector="left" className={app ? 'profile-in-left relative' : 'relative'}>
          <Card className="rounded-3xl ring-1 ring-primary/25">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base font-semibold">
                <UserRound className="size-[1.15rem] text-muted-foreground" aria-hidden />
                Who this is
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm leading-relaxed text-foreground/85">{p.oneLiner}</p>
              <div className="flex flex-wrap items-center gap-1.5">
                <span
                  className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${scopeLabel.bg} ${scopeLabel.fg}`}
                >
                  <scopeLabel.Icon className="size-3.5" aria-hidden />
                  {scopeLabel.text}
                </span>
                {personaCount > 1 && p.prevalence && PREVALENCE_GLOSSARY[p.prevalence] && (
                  <span
                    className="inline-flex items-center rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground"
                    title={glossaryRule(PREVALENCE_GLOSSARY[p.prevalence])}
                  >
                    {p.prevalence}
                  </span>
                )}
              </div>
              <p className="text-xs text-muted-foreground" title={glossaryRule('conversations')}>
                Heard across {p.sourceVideoCount}{' '}
                {p.sourceVideoCount === 1 ? 'conversation' : 'conversations'}
              </p>
              {isStale && staleRunDate && (
                // The profile can lag the latest run; saying which update it is
                // from beats presenting an older reading as current.
                <p className="text-xs text-muted-foreground">From your update of {staleRunDate}.</p>
              )}
            </CardContent>
          </Card>
        </div>
        <Block title="What drives them" Icon={Compass} body={p.wants} quote={p.drivesQuote} className={app ? 'profile-in-left profile-delay-2' : ''} connector="left" />
        <SharePill percent={p.share} app={app} />
      </div>

      <div className={app ? 'relative z-10 order-1 flex h-full min-w-0 flex-col items-center lg:order-2' : 'relative z-10 order-2 flex h-full min-w-0 flex-col items-center'}>
        {/* The figure takes whatever height is left and stands ON the bottom
            edge: -mb-6 eats the pane's own padding so the hem lands on the
            edge itself rather than floating above it. h-full + w-auto keeps
            the silhouette's proportions whatever the window does. */}
        <div className="flex min-h-[26rem] w-full flex-1 items-end justify-center overflow-hidden">
          <CrowdFigure
            personaKey={p.key}
            variant={figure}
            title={p.name}
            lean={1}
            className={app ? 'profile-figure-in profile-figure-fade h-full w-auto max-w-full text-primary' : 'w-auto max-w-full text-primary'}
            // Paper: a percentage height has nothing definite to resolve
            // against inside the zoomed slide body, so the figure is sized outright.
            style={app ? undefined : { height: 430 }}
          />
        </div>
      </div>

      <div className={app ? 'order-3 flex flex-col gap-6 lg:h-full lg:justify-center lg:gap-16' : 'order-3 flex h-full flex-col justify-center gap-8'}>
        <Block title="What stops them" Icon={HeartCrack} body={p.blockers} quote={p.stopsQuote} className={app ? 'profile-in-right' : ''} connector="right" />
        <Block title="What works on them" Icon={Zap} body={p.triggers} quote={p.worksQuote} className={app ? 'profile-in-right profile-delay-2' : ''} connector="right" />
      </div>
    </div>
  )
}

/** A written read, not a list. Same register as the dashboard's executive
 *  brief: the reader is here to understand a person, not to scan attributes —
 *  with one real voice under it, because otherwise the read is a claim the
 *  reader has to take on trust. */
function Block({
  title, Icon, body, quote, className = '', connector,
}: {
  title: string
  Icon: typeof Compass
  body: string
  quote?: Quote | null
  className?: string
  connector?: 'left' | 'right'
}) {
  if (!body.trim()) return null
  return (
    <div data-connector={connector} className={`relative ${className}`}>
      <Card className="rounded-3xl ring-1 ring-primary/25">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base font-semibold">
            <Icon className="size-[1.15rem] text-muted-foreground" aria-hidden />
            {title}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-[15px] leading-relaxed text-foreground/85">{body}</p>
          {quote && <Quotes items={[quote.text]} />}
        </CardContent>
      </Card>
    </div>
  )
}

/** How much of this profile the person on screen accounts for.
 *
 *  A bar rather than a bare number, so the size registers before the digits do.
 *  Sits out of the reading path at the bottom-left: it is context for the
 *  analysis, not part of it. */
function SharePill({ percent, app }: { percent: number; app: boolean }) {
  if (!percent) return null
  return (
    <div
      data-connector="left"
      className={
        app
          ? 'profile-in-left profile-delay-3 hidden w-[92%] items-center gap-4 rounded-full border border-primary/25 bg-card px-6 py-4 lg:flex'
          : 'flex w-[92%] items-center gap-4 rounded-full border border-primary/25 bg-card px-6 py-4'
      }
      title="This persona's share of the conversations the profile covers. A conversation that speaks to two of these people counts toward both."
    >
      <span className="shrink-0 text-sm font-medium text-muted-foreground">Share of profile</span>
      <span className="h-2 flex-1 overflow-hidden rounded-full bg-primary/15">
        <span className="block h-full rounded-full bg-primary/70" style={{ width: `${percent}%` }} />
      </span>
      <span className="shrink-0 text-lg font-semibold tabular-nums">{percent}%</span>
    </div>
  )
}

function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <Card>
      <CardContent className="py-10 text-center text-sm text-muted-foreground">{children}</CardContent>
    </Card>
  )
}

// ── where each one turns up / how the mix has moved ────────────────────────
// Not `Tile`-based in app mode (this page's bespoke `Card` grid, kept as-is);
// on paper they sit two-up on one slide, so print wraps each in a plain
// `col=6 row=4` `Tile` for the print grid's placement only.
const platformMix: R = (d, mode) => {
  const body = <PlatformMix rows={d.platformMix.rows} platforms={d.platformMix.platforms} />
  return mode === 'print' ? <Tile col={6} row={4} className="bg-transparent shadow-none">{body}</Tile> : body
}

const shareOverTime: R = (d, mode) => {
  const body = <ShareOverTime dates={d.shareOverTime.dates} series={d.shareOverTime.series} />
  return mode === 'print' ? <Tile col={6} row={4} className="bg-transparent shadow-none">{body}</Tile> : body
}

/** Full export: one persona per slide — key `profile.persona:<index>`. */
const PERSONA_SLIDE_PREFIX = 'profile.persona:'

/** A renderable for a full-export persona slide; the registry resolves the
 *  `profile.persona:<n>` keys through this so the module stays a fixed catalogue. */
export function profilePersonaSlide(n: number): Renderable<D> {
  return {
    key: `${PERSONA_SLIDE_PREFIX}${n}`,
    title: 'Persona',
    render: (d) => {
      const p = d.full?.[n]
      if (!p) return null
      const figure = assignFigures(d.personas.map((x) => x.key)).get(p.key) ?? 'a'
      return <PersonaBody p={p} figure={figure} mode="print" isStale={d.isStale} staleRunDate={d.staleRunDate} personaCount={d.personas.length} />
    },
  }
}

const renderables: Record<string, Renderable<D>> = {
  'profile.persona': { key: 'profile.persona', title: 'Consumer profile', render: persona },
  'profile.platformMix': { key: 'profile.platformMix', title: 'Where each one turns up', render: platformMix },
  'profile.shareOverTime': { key: 'profile.shareOverTime', title: 'How the mix has moved', render: shareOverTime },
}

export const profilePage: PageModule<D> = {
  key: 'profile',
  title: 'Consumer Profile',
  async load(scope) {
    const d = await loadProfile(scope)
    return isProfileEmpty(d) ? null : d
  },
  slides(d, variant): Slide[] {
    const slides: Slide[] = [
      { title: 'Consumer profile', keys: ['profile.persona'], layout: 'single' },
      { title: 'Where they turn up, and how the mix has moved', keys: ['profile.platformMix', 'profile.shareOverTime'], layout: 'grid' },
    ]
    if (variant === 'full') {
      for (let n = 0; n < (d.full?.length ?? 0); n++) slides.push({ title: `Persona · ${d.full![n].name}`, keys: [`${PERSONA_SLIDE_PREFIX}${n}`], layout: 'single' })
    }
    return slides
  },
  renderables: new Proxy(renderables, {
    get(target, key: string) {
      if (key in target) return target[key]
      if (typeof key === 'string' && key.startsWith(PERSONA_SLIDE_PREFIX)) return profilePersonaSlide(Number(key.slice(PERSONA_SLIDE_PREFIX.length)))
      return undefined
    },
  }),
  snapshotTitle: (d) => `Consumer Profile · ${d.brand} · ${d.runDate}`,
}

/** The app page: the switcher + composition, then the two summary cards —
 *  same order the old page returned, no `PageFrame`/`PageGrid` (this page's
 *  own bespoke layout). */
export function ProfilePage({ data: d }: { data: ProfileData | ProfileEmpty; params: Record<string, string | undefined> }) {
  if (isProfileEmpty(d)) {
    return (
      <div className="space-y-6">
        <EmptyState>
          {d.reason === 'no-run'
            ? 'Your consumer profile lands with your first update — check back then.'
            : 'There is not yet enough conversation to describe who is talking. The profile appears once a few kinds of person are clearly distinguishable in the data.'}
        </EmptyState>
      </div>
    )
  }
  return (
    // min-h-full + flex: the grid must be able to claim the remaining height,
    // which is what lets the figure reach the bottom of the pane.
      <div className="relative flex min-h-full flex-col gap-5">
        {renderables['profile.persona'].render(d, 'app')}
        {renderables['profile.platformMix'].render(d, 'app')}
        {renderables['profile.shareOverTime'].render(d, 'app')}
      </div>
  )
}
