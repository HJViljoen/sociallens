import Link from 'next/link'
import { HeartCrack, Compass, Sparkles, Users, UserRound, Layers, Zap } from 'lucide-react'
import { getSessionContext } from '@/lib/auth'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Quotes } from '@/components/quotes'
import { CrowdFigure } from '@/components/crowd-figure'
import { glossaryRule, priorityWord, type GlossaryKey } from '@/lib/calibration'

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
  wants: string[]
  blockers: string[]
  triggers: string[]
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
  return {
    key: typeof p.key === 'string' && p.key ? p.key : p.name,
    name: p.name,
    oneLiner: typeof p.oneLiner === 'string' ? p.oneLiner : '',
    scope: p.scope === 'client' ? 'client' : 'category',
    wants: arr(p.wants),
    blockers: arr(p.blockers),
    triggers: arr(p.triggers),
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

  const activeIndex = Math.max(0, personas.findIndex((p) => p.key === sp.persona))
  const active = personas[activeIndex]
  const showSwitcher = personas.length > 1

  // Recommendations that speak to an audience, not to a channel — the same rows
  // Market shows, filtered to the ones this page can honestly stand behind.
  const { data: recRows } = await supabase
    .from('recommendations')
    .select('id, type, title, reasoning, hero_quote')
    .eq('client_id', clientId)
    .eq('run_id', latestRun.id as string)
    .in('type', ['audience_targeting', 'positioning_messaging', 'customer_experience', 'product'])
    .order('created_at', { ascending: false })
    .limit(3)
  const recs = (recRows ?? []) as { id: string; type: string; title: string; reasoning: string; hero_quote: string | null }[]

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
      <div className="grid gap-5 lg:min-h-[calc(100dvh-10rem)] lg:grid-cols-[1fr_1.55fr_1fr]">
        <div className="order-2 grid gap-5 lg:order-1 lg:grid-rows-[1fr_1.9fr]">
          <Card className="h-full">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm font-semibold">
                <UserRound className="size-4 text-muted-foreground" aria-hidden />
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
          <Block title="What they want" Icon={Compass} items={active.wants} className="h-full" />
        </div>

        <div className="order-1 flex h-full min-w-0 flex-col items-center lg:order-2">
          {/* The figure takes whatever height is left and stands ON the bottom
              edge: -mb-6 eats the pane's own padding so the hem lands on the
              edge itself rather than floating above it. h-full + w-auto keeps
              the silhouette's proportions whatever the window does. */}
          <div className="flex min-h-[26rem] w-full flex-1 items-end justify-center overflow-hidden">
            <CrowdFigure
              personaKey={active.key}
              title={active.name}
              lean={1}
              className="h-full w-auto max-w-full text-primary"
            />
          </div>
        </div>

        <div className="order-3 grid gap-5 lg:grid-rows-[2.4fr_1fr]">
          <Block title="What stops them" Icon={HeartCrack} items={active.blockers} className="h-full" />
          <Block title="What moves them" Icon={Zap} items={active.triggers} className="h-full" />
        </div>
      </div>

      {recs.length > 0 && (
        <section className="space-y-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <Sparkles className="size-4 text-muted-foreground" aria-hidden />
            What to do about it
          </h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {recs.map((r, i) => (
              <Card key={r.id}>
                <CardHeader className="pb-2">
                  <div className="text-xs font-medium text-muted-foreground">{priorityWord(i)}</div>
                  <CardTitle className="text-sm font-semibold leading-snug">{r.title}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  <p className="text-sm leading-snug text-foreground/85">{r.reasoning}</p>
                  {r.hero_quote && <Quotes items={[r.hero_quote]} />}
                </CardContent>
              </Card>
            ))}
          </div>
          <Link href="/dashboard/market" className="inline-block text-xs font-medium text-primary hover:underline">
            See all recommendations
          </Link>
        </section>
      )}
    </div>
  )
}

function Block({
  title,
  Icon,
  items,
  className = '',
}: {
  title: string
  Icon: typeof Compass
  items: string[]
  className?: string
}) {
  if (!items.length) return null
  return (
    <Card className={className}>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm font-semibold">
          <Icon className="size-4 text-muted-foreground" aria-hidden />
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="space-y-1.5 text-sm leading-snug text-foreground/85">
          {items.map((it, i) => (
            <li key={i} className="flex gap-2">
              <span className="mt-1.5 size-1 shrink-0 rounded-full bg-primary/50" aria-hidden />
              {it}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}

function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <Card>
      <CardContent className="py-10 text-center text-sm text-muted-foreground">{children}</CardContent>
    </Card>
  )
}
