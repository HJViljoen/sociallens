import Link from 'next/link'
import { HeartCrack, Compass, Users, UserRound, Layers, Zap } from 'lucide-react'
import { getSessionContext } from '@/lib/auth'
import { createQuotePicker, fetchInsightsByIds, fetchQuotesByAudience } from '@/lib/quotes'
import { PlatformMix, ShareOverTime, type PlatformRow, type ShareSeries } from '@/components/profile-stats'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Quotes } from '@/components/quotes'
import { CrowdFigure, assignFigures } from '@/components/crowd-figure'
import { ProfileConnectors } from '@/components/profile-connectors'
import { glossaryRule, type GlossaryKey } from '@/lib/calibration'

// Consumer Profile — "who is actually talking?" (Pass E).
//
// Every other page answers WHAT the conversation says. This one answers WHO is
// having it: a few personas built from the run's insight population, each one a
// grouping of counted insights rather than a character someone imagined.
//
// The figure in the middle is one of the real bodies from the crowd
// illustration standing behind every page — the same drawing, brought forward.
// Around it sit the blocks that are actually evidenced; a block with nothing
// behind it is not rendered, because an empty "who they are" is honest and an
// invented one is a product-contract violation.
//
// Scope: for most tenants the corpus is dominated by the wider category, so the
// personas describe the CATEGORY's conversation — people the brand has not
// necessarily won. The header says so rather than letting the reader assume
// these are their customers.

/** The calibrated word carries its own rule as a tooltip, same as every other
 *  chip in the app — the ladder is a published contract, not a vibe. */
const PREVALENCE_GLOSSARY: Record<string, GlossaryKey> = {
  Dominant: 'dominant',
  Widespread: 'widespread',
  Recurring: 'recurring',
  'Early signal': 'early_signal',
}

interface Persona {
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
function normalisePersona(p: Partial<Persona> | null): Persona | null {
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

interface ProfileRow {
  headline: string | null
  personas: Partial<Persona>[]
  run_date: string
  run_id: string
}

export default async function ConsumerProfilePage({
  searchParams,
}: {
  searchParams: Promise<{ persona?: string }>
}) {
  const sp = await searchParams
  const { supabase, clientId } = await getSessionContext()

  // Latest closed run, same anchor as every other page — an in-flight run has
  // no profile yet, so the previous one keeps serving.
  const { data: latestRun } = await supabase
    .from('pipeline_runs').select('id')
    .eq('client_id', clientId).in('status', ['completed', 'partial'])
    .order('started_at', { ascending: false }).limit(1).maybeSingle()

  if (!latestRun) {
    return (
      <div className="space-y-6">
        <EmptyState>Your consumer profile lands with your first update — check back then.</EmptyState>
      </div>
    )
  }

  // Newest stored profile, not "the newest run's profile". Pass E is
  // flag-gated and profiles can be written offline, so pinning to the latest
  // run would blank this page the moment a run completes without one — and the
  // empty state would claim there is too little conversation, which would be a
  // false statement about the data rather than about the pass.
  const { data: profileRow } = await supabase
    .from('consumer_profiles')
    .select('headline, personas, run_date, run_id')
    .eq('client_id', clientId)
    .order('run_date', { ascending: false })
    .limit(1)
    .maybeSingle()

  const profile = profileRow as ProfileRow | null
  const personas = (profile?.personas ?? [])
    .map((p) => normalisePersona(p as Partial<Persona>))
    .filter((p): p is Persona => Boolean(p))
  const isStale = Boolean(profile) && profile?.run_id !== (latestRun.id as string)

  if (!personas.length) {
    return (
      <div className="space-y-6">
        <EmptyState>
          There is not yet enough conversation to describe who is talking. The profile appears once a
          few kinds of person are clearly distinguishable in the data.
        </EmptyState>
      </div>
    )
  }

  // Each persona's share of the conversation this profile covers. Apportioned
  // across the cast rather than measured against the whole corpus: the profile
  // describes these people, so "a third of this profile" is a claim the page
  // can actually stand behind. A conversation that speaks to two of them counts
  // toward both, which is why this is a share of the profile and not of the
  // category.
  const profileVideoTotal = personas.reduce((n, p) => n + (p.sourceVideoCount || 0), 0)
  const shareOf = (p: Persona) =>
    profileVideoTotal > 0 ? Math.round((p.sourceVideoCount / profileVideoTotal) * 100) : 0

  // One silhouette per persona, decided across the whole cast so no two share
  // a body while another goes unused.
  const figures = assignFigures(personas.map((p) => p.key))

  const activeIndex = Math.max(0, personas.findIndex((p) => p.key === sp.persona))
  const active = personas[activeIndex]
  const showSwitcher = personas.length > 1

  // Where each persona turns up. Platform lives on the insight, so this is a
  // read over the ids the personas already carry — the base table, not the
  // view, because these ids must resolve even where a newer run has superseded
  // the rows but not yet pruned them.
  const allInsightIds = [...new Set(personas.flatMap((p) => p.insightIds))]
  const insightRows = allInsightIds.length
    ? await fetchInsightsByIds<{ id: string; platform: string | null; source_video_id: string | null }>(
        supabase,
        allInsightIds,
        'id, platform, source_video_id',
      )
    : []
  const insightMeta = new Map(insightRows.map((r) => [r.id, r]))
  // Profile-wide totals, counted in DISTINCT conversations per platform. Not
  // the sum of the rows below: a conversation where two kinds of person both
  // speak belongs to both of them, and adding the rows up would count it twice
  // — the one number on this card a client might quote in a meeting is the one
  // that must not be inflated.
  const videosByPlatform = new Map<string, Set<string>>()
  for (const r of insightRows) {
    if (!r.platform || !r.source_video_id) continue
    const set = videosByPlatform.get(r.platform) ?? new Set<string>()
    set.add(r.source_video_id)
    videosByPlatform.set(r.platform, set)
  }
  const platformTotals = new Map([...videosByPlatform].map(([p, v]) => [p, v.size] as const))
  const grandTotal = [...platformTotals.values()].reduce((n, v) => n + v, 0)
  const platformRows: PlatformRow[] = personas.map((p) => {
    // Counted in conversations, the same unit the rest of the page uses: a
    // video with ten insights from one persona is one conversation, not ten.
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
  const platforms = [...platformTotals.entries()].sort((a, b) => b[1] - a[1]).map(([p]) => p)

  // How the mix has moved. Personas are matched across runs on their key, which
  // continuity keeps stable — matching on name would break the moment a
  // persona was reworded.
  const { data: historyRows } = await supabase
    .from('consumer_profiles')
    .select('run_date, personas')
    .eq('client_id', clientId)
    .order('run_date', { ascending: true })
    .limit(12)
  const history = (historyRows ?? []) as { run_date: string; personas: Partial<Persona>[] }[]
  const shareDates = history.map((h) => h.run_date)
  const shareSeries: ShareSeries[] = personas.map((p) => ({
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

  // One real voice per block. The page describes people; without their words
  // the description is a claim the reader has to take on trust — and the
  // product is called Verbatim. The picker de-duplicates across calls, so each
  // block gets a different person rather than the same quote three times.
  const voiceIds = active.insightIds.slice(0, 60)
  const quotesByAudience = voiceIds.length ? await fetchQuotesByAudience(supabase, voiceIds) : new Map()
  const pickVoice = createQuotePicker(quotesByAudience, new Map())
  const voiceFor = (text: string) => (voiceIds.length ? pickVoice(voiceIds, 1, text)[0] : undefined)
  const drivesVoice = voiceFor(active.wants)
  const stopsVoice = voiceFor(active.blockers)
  const worksVoice = voiceFor(active.triggers)

  const scopeLabel =
    active.scope === 'client'
      ? { text: 'Your audience', Icon: Users, fg: 'text-primary', bg: 'bg-primary/10' }
      : { text: 'Wider category', Icon: Layers, fg: 'text-slate', bg: 'bg-slate/10' }

  return (
    // min-h-full + flex: the grid must be able to claim the remaining height,
    // which is what lets the figure reach the bottom of the pane.
    <div className="flex min-h-full flex-col gap-5">
      {/* Every kind of person on one bar: with a handful of personas the whole
          cast should be visible at once — a stepper hid four of them behind an
          arrow and made the reader page to find out who else is here. */}
      {showSwitcher ? (
        <div className="flex flex-wrap items-center gap-1 rounded-full border border-border bg-card p-1">
          {personas.map((p) => (
            <Link
              key={p.key}
              href={`/dashboard/profile?persona=${encodeURIComponent(p.key)}`}
              scroll={false}
              aria-current={p.key === active.key ? 'page' : undefined}
              className={`flex-1 rounded-full px-4 py-2 text-center text-sm font-medium transition-colors ${
                p.key === active.key
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'
              }`}
            >
              {p.name}
            </Link>
          ))}
        </div>
      ) : (
        <h2 className="text-lg font-semibold leading-tight">{active.name}</h2>
      )}

      {/* Four blocks around a figure that stands on its own — no card, running
          off the bottom edge, the way it stands in the crowd behind every other
          page. The persona's description is one of the blocks rather than a
          caption under the figure, so nothing follows the figure down. */}
      {/* relative: the connector overlay positions against this box. */}
      {/* Capped and centred: on a wide monitor an edge-to-edge grid pushed the
          blocks away from the figure and left the composition stretched. The
          margin outside is what pulls everything back around the subject.
          key: remounts the composition when the persona changes, which replays
          the entrance animations and re-measures the connectors. */}
      <div
        key={active.key}
        data-connector-root
        // The centre column, not the row height, is what caps the figure: at 0.9fr its
        // width bound the silhouette to well under the height available. Wider centre
        // + a wider cap gives the figure real scale while keeping margin outside.
        className="relative mx-auto grid w-full max-w-[84rem] gap-6 lg:min-h-[calc(100dvh-10rem)] lg:grid-cols-[1fr_1.15fr_1fr] lg:gap-7"
      >
        <ProfileConnectors />
        <div className="order-2 flex flex-col gap-6 lg:order-1 lg:h-full lg:justify-center lg:gap-16">
          <div data-connector="left" className="profile-in-left relative">
          <Card className="rounded-3xl ring-1 ring-primary/25">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base font-semibold">
                <UserRound className="size-[1.15rem] text-muted-foreground" aria-hidden />
                Who this is
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm leading-relaxed text-foreground/85">{active.oneLiner}</p>
              <div className="flex flex-wrap items-center gap-1.5">
                <span
                  className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${scopeLabel.bg} ${scopeLabel.fg}`}
                >
                  <scopeLabel.Icon className="size-3.5" aria-hidden />
                  {scopeLabel.text}
                </span>
                {personas.length > 1 && active.prevalence && PREVALENCE_GLOSSARY[active.prevalence] && (
                  <span
                    className="inline-flex items-center rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground"
                    title={glossaryRule(PREVALENCE_GLOSSARY[active.prevalence])}
                  >
                    {active.prevalence}
                  </span>
                )}
              </div>
              <p className="text-xs text-muted-foreground" title={glossaryRule('conversations')}>
                Heard across {active.sourceVideoCount}{' '}
                {active.sourceVideoCount === 1 ? 'conversation' : 'conversations'}
              </p>
              {isStale && (
                // The profile can lag the latest run; saying which update it is
                // from beats presenting an older reading as current.
                <p className="text-xs text-muted-foreground">From your update of {profile?.run_date}.</p>
              )}
            </CardContent>
          </Card>
          </div>
          <Block title="What drives them" Icon={Compass} body={active.wants} quote={drivesVoice} className="profile-in-left profile-delay-2" connector="left" />
          <SharePill percent={shareOf(active)} />
        </div>

        <div className="relative z-10 order-1 flex h-full min-w-0 flex-col items-center lg:order-2">
          {/* The figure takes whatever height is left and stands ON the bottom
              edge: -mb-6 eats the pane's own padding so the hem lands on the
              edge itself rather than floating above it. h-full + w-auto keeps
              the silhouette's proportions whatever the window does. */}
          <div className="flex min-h-[26rem] w-full flex-1 items-end justify-center overflow-hidden">
            <CrowdFigure
              personaKey={active.key}
              variant={figures.get(active.key)}
              title={active.name}
              lean={1}
              className="profile-figure-in profile-figure-fade h-full w-auto max-w-full text-primary"
            />
          </div>
        </div>

        <div className="order-3 flex flex-col gap-6 lg:h-full lg:justify-center lg:gap-16">
          <Block title="What stops them" Icon={HeartCrack} body={active.blockers} quote={stopsVoice} className="profile-in-right" connector="right" />
          <Block title="What works on them" Icon={Zap} body={active.triggers} quote={worksVoice} className="profile-in-right profile-delay-2" connector="right" />
        </div>
      </div>

      <PlatformMix rows={platformRows} platforms={platforms} totals={Object.fromEntries(platformTotals)} grandTotal={grandTotal} />
      <ShareOverTime dates={shareDates} series={shareSeries} />

    </div>
  )
}

/** A written read, not a list. Same register as the dashboard's executive
 *  brief: the reader is here to understand a person, not to scan attributes —
 *  with one real voice under it, because otherwise the read is a claim the
 *  reader has to take on trust. */
function Block({
  title,
  Icon,
  body,
  quote,
  className = '',
  connector,
}: {
  title: string
  Icon: typeof Compass
  body: string
  quote?: string
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
          {quote && <Quotes items={[quote]} />}
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
function SharePill({ percent }: { percent: number }) {
  if (!percent) return null
  return (
    <div
      // A child of the column, not an overlay pinned to the corner: absolutely
      // positioned it was invisible to the column's own spacing, so the blocks
      // centred as though it were not there and left it stranded at the bottom.
      // In the flow it is spaced with them and takes the column's width for
      // free.
      // Back to its earlier weight, but short of the column width: at full
      // width it read as a fifth block; a little inset it reads as a footnote
      // belonging to the two above it.
      data-connector="left"
      className="profile-in-left profile-delay-3 hidden w-[92%] items-center gap-4 rounded-full border border-primary/25 bg-card px-6 py-4 backdrop-blur-xl lg:flex"
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
