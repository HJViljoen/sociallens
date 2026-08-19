import Link from 'next/link'
import { HeartCrack, Compass, Sparkles, Users, Layers, Quote as QuoteIcon, Zap, ChevronLeft, ChevronRight } from 'lucide-react'
import { getSessionContext } from '@/lib/auth'
import { createQuotePicker, fetchQuotesByAudience } from '@/lib/quotes'
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
        <PageHeader />
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
        <PageHeader />
        <EmptyState>
          There is not yet enough conversation to describe who is talking. The profile appears once a
          few kinds of person are clearly distinguishable in the data.
        </EmptyState>
      </div>
    )
  }

  const activeIndex = Math.max(0, personas.findIndex((p) => p.key === sp.persona))
  const active = personas[activeIndex]
  // A stepper rather than a row of chips: the personas are a small set you page
  // through, and the figure is what changes, so the control belongs above it
  // and out of the way. Wraps, so there is no dead end at either end.
  const prev = personas[(activeIndex - 1 + personas.length) % personas.length]
  const next = personas[(activeIndex + 1) % personas.length]
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

  // Voices resolved live from insight_evidence rather than read from the stored
  // profile: a quote copied into this table would outlive the comment it came
  // from, and the privacy page promises that deleting a comment removes every
  // quote of it in the product.
  const quoteIds = active.insightIds.slice(0, 150)
  const quotesByAudience = quoteIds.length ? await fetchQuotesByAudience(supabase, quoteIds) : new Map()
  const quotes = quoteIds.length
    ? createQuotePicker(quotesByAudience, new Map())(
        quoteIds,
        3,
        [active.name, active.oneLiner, ...active.wants, ...active.blockers].join('. '),
      )
    : []

  const scopeLabel =
    active.scope === 'client'
      ? { text: 'Your audience', Icon: Users, fg: 'text-primary', bg: 'bg-primary/10' }
      : { text: 'Wider category', Icon: Layers, fg: 'text-slate', bg: 'bg-slate/10' }

  return (
    <div className="space-y-6">
      <PageHeader />

      {profile?.headline && (
        <Card>
          <CardContent className="py-5 text-[15px] leading-relaxed text-foreground/90">
            {profile.headline}
            {isStale && (
              // Say which update this is from rather than presenting an older
              // profile as current — the profile can lag the latest run.
              <span className="mt-2 block text-xs text-muted-foreground">
                From your update of {profile.run_date}. The next one refreshes this.
              </span>
            )}
          </CardContent>
        </Card>
      )}

      {/* The figure is the subject: it sits in the middle, the blocks arrange
          around it, and the stepper sits above it because paging personas is a
          change to the figure, not a filter on the page. On mobile the figure
          leads and the blocks stack under it. */}
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,22rem)_minmax(0,1fr)]">
        {/* Left: what drives them, then what holds them back. */}
        <div className="order-2 flex flex-col gap-4 lg:order-1 lg:pt-16">
          <Block title="What they want" Icon={Compass} items={active.wants} />
          <Block title="What stops them" Icon={HeartCrack} items={active.blockers} />
        </div>

        {/* The figure lives in a block like everything else, and runs to that
            block's bottom edge — it is the subject of the card, not a picture
            floating on the page. Text sits at the top so nothing follows the
            figure down. */}
        <div className="order-1 flex flex-col items-center lg:order-2">
          {showSwitcher && (
            <div className="mb-4 flex items-center gap-1 rounded-full border border-border bg-card px-1 py-1">
              <StepLink href={`/dashboard/profile?persona=${encodeURIComponent(prev.key)}`} label="Previous persona" Icon={ChevronLeft} />
              <span className="min-w-[9rem] px-2 text-center text-sm font-medium">{active.name}</span>
              <StepLink href={`/dashboard/profile?persona=${encodeURIComponent(next.key)}`} label="Next persona" Icon={ChevronRight} />
            </div>
          )}

          <Card className="flex w-full flex-col overflow-hidden pb-0">
            <CardContent className="pb-0 text-center">
              {!showSwitcher && <h2 className="mb-1 text-lg font-semibold leading-tight">{active.name}</h2>}
              <p className="text-sm leading-snug text-muted-foreground">{active.oneLiner}</p>
              <div className="mt-3 flex flex-wrap items-center justify-center gap-1.5">
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
              <p className="mt-2 text-xs text-muted-foreground" title={glossaryRule('conversations')}>
                Heard across {active.sourceVideoCount}{' '}
                {active.sourceVideoCount === 1 ? 'conversation' : 'conversations'}
              </p>
            </CardContent>
            {/* -mb keeps the silhouette bleeding into the card's bottom edge
                rather than sitting on a cushion of padding. */}
            <CrowdFigure
              personaKey={active.key}
              title={active.name}
              lean={1}
              className="mt-6 h-56 w-full text-primary sm:h-72 lg:h-80"
            />
          </Card>
        </div>

        {/* Right: what moves them, then how they sound. */}
        <div className="order-3 flex flex-col gap-4 lg:pt-8">
          <Block title="What moves them" Icon={Zap} items={active.triggers} />
          {active.howTheyTalk.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-sm font-semibold">
                  <QuoteIcon className="size-4 text-muted-foreground" aria-hidden />
                  How they sound
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-1.5">
                  {active.howTheyTalk.map((phrase, i) => (
                    <span key={i} className="rounded-md bg-muted px-2 py-1 text-xs text-foreground/80">
                      {phrase}
                    </span>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {quotes.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-semibold">
              <QuoteIcon className="size-4 text-muted-foreground" aria-hidden />
              In their own words
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Quotes items={quotes} />
          </CardContent>
        </Card>
      )}

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

function PageHeader() {
  return (
    <div>
      <h1 className="text-xl font-semibold">Consumer Profile</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Who is talking in your category, built from what they said — not a customer list.
      </p>
    </div>
  )
}

/** One arrow of the persona stepper. A Link, not a button: the page is a
 *  server component and the persona lives in the URL, so paging is a navigation
 *  and stays shareable. */
function StepLink({ href, label, Icon }: { href: string; label: string; Icon: typeof ChevronLeft }) {
  return (
    <Link
      href={href}
      scroll={false}
      aria-label={label}
      className="inline-flex size-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
    >
      <Icon className="size-4" aria-hidden />
    </Link>
  )
}

function Block({ title, Icon, items }: { title: string; Icon: typeof Compass; items: string[] }) {
  if (!items.length) return null
  return (
    <Card>
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
