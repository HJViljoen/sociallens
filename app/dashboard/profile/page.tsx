import Link from 'next/link'
import { HeartCrack, Compass, Sparkles, Users, Layers, Quote as QuoteIcon, Zap } from 'lucide-react'
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
  evidenceCount: number
  sourceVideoCount: number
  prevalence: string
  quotes?: string[]
}

interface ProfileRow {
  headline: string | null
  personas: Persona[]
  insight_population: number
  run_date: string
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

  const { data: profileRow } = await supabase
    .from('consumer_profiles')
    .select('headline, personas, insight_population, run_date')
    .eq('client_id', clientId)
    .eq('run_id', latestRun.id as string)
    .maybeSingle()

  const profile = profileRow as ProfileRow | null
  const personas = (profile?.personas ?? []).filter((p) => p && p.name)

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

  const active =
    personas.find((p) => p.key === sp.persona) ?? personas[0]
  const showSwitcher = personas.length > 1

  // Recommendations that speak to an audience, not to a channel — the same rows
  // Market shows, filtered to the ones this page can honestly stand behind.
  const { data: recRows } = await supabase
    .from('recommendations')
    .select('id, type, title, reasoning, hero_quote')
    .eq('client_id', clientId)
    .in('type', ['audience_targeting', 'positioning_messaging', 'customer_experience', 'product'])
    .order('created_at', { ascending: false })
    .limit(3)
  const recs = (recRows ?? []) as { id: string; type: string; title: string; reasoning: string; hero_quote: string | null }[]

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
          </CardContent>
        </Card>
      )}

      {/* Persona switcher — the primary axis of this page. Same chip vocabulary
          as Voice's entity bar so a persona reads as the same kind of thing. */}
      {showSwitcher && (
        <div className="flex flex-wrap items-center gap-2">
          {personas.map((p) => (
            <PersonaChip key={p.key} persona={p} active={p.key === active.key} />
          ))}
        </div>
      )}

      {/* The figure, with the evidenced blocks around it. On mobile the figure
          sits above the blocks; from lg it is the centre column. */}
      <div className="grid gap-4 lg:grid-cols-[1fr_auto_1fr] lg:items-start">
        <div className="space-y-4">
          <Block
            title="What they want"
            Icon={Compass}
            items={active.wants}
            glossary="Drawn from what this group asks for and praises."
          />
          <Block
            title="What stops them"
            Icon={HeartCrack}
            items={active.blockers}
            glossary="Objections and pain points raised by this group."
          />
        </div>

        <div className="flex flex-col items-center gap-3 py-2 lg:w-64">
          <CrowdFigure
            personaKey={active.key}
            title={active.name}
            lean={1}
            className="h-56 w-auto text-primary sm:h-72 lg:h-80"
          />
          <div className="text-center">
            <h2 className="text-lg font-semibold leading-tight">{active.name}</h2>
            <p className="mt-1 text-sm leading-snug text-muted-foreground">{active.oneLiner}</p>
            <div className="mt-3 flex flex-wrap items-center justify-center gap-1.5">
              <span
                className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${scopeLabel.bg} ${scopeLabel.fg}`}
              >
                <scopeLabel.Icon className="size-3.5" aria-hidden />
                {scopeLabel.text}
              </span>
              {active.prevalence && PREVALENCE_GLOSSARY[active.prevalence] && (
                <span
                  className="inline-flex items-center rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground"
                  title={glossaryRule(PREVALENCE_GLOSSARY[active.prevalence])}
                >
                  {active.prevalence}
                </span>
              )}
            </div>
            <p className="mt-2 text-xs text-muted-foreground" title={glossaryRule('conversations')}>
              {active.evidenceCount} conversations across {active.sourceVideoCount} videos
            </p>
          </div>
        </div>

        <div className="space-y-4">
          <Block
            title="What pushes them to act"
            Icon={Zap}
            items={active.triggers}
            glossary="The circumstances this group says moved them."
          />
          {active.who.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-sm font-semibold">
                  <Users className="size-4 text-muted-foreground" aria-hidden />
                  What they reveal about themselves
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-1.5 text-sm">
                {active.who.map((w) => (
                  <div key={w.signal} className="flex items-baseline justify-between gap-3">
                    <span className="text-foreground/85">{w.signal}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">{w.count}</span>
                  </div>
                ))}
                {/* Counts, never quotes — this is the one block where the
                    people being described are the subject. */}
                <p className="pt-1 text-xs text-muted-foreground">
                  Counted where the conversation states it. Nothing is inferred.
                </p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {(active.howTheyTalk.length > 0 || (active.quotes?.length ?? 0) > 0) && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-semibold">
              <QuoteIcon className="size-4 text-muted-foreground" aria-hidden />
              How they talk
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {active.howTheyTalk.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {active.howTheyTalk.map((phrase, i) => (
                  <span key={i} className="rounded-md bg-muted px-2 py-1 text-xs text-foreground/80">
                    {phrase}
                  </span>
                ))}
              </div>
            )}
            {(active.quotes?.length ?? 0) > 0 && (
              <details className="group">
                <summary className="cursor-pointer text-xs font-medium text-muted-foreground hover:text-foreground">
                  See the voices
                </summary>
                <div className="pt-3">
                  <Quotes items={active.quotes ?? []} />
                </div>
              </details>
            )}
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

function PersonaChip({ persona, active }: { persona: Persona; active: boolean }) {
  return (
    <Link
      href={`/dashboard/profile?persona=${encodeURIComponent(persona.key)}`}
      scroll={false}
      className={`inline-flex items-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium transition-colors ${
        active
          ? 'border-transparent bg-primary/10 text-primary'
          : 'border-border text-foreground hover:bg-muted/40'
      }`}
    >
      {persona.name}
      <span className={active ? 'opacity-70' : 'text-muted-foreground'}>· {persona.evidenceCount}</span>
    </Link>
  )
}

function Block({
  title,
  Icon,
  items,
  glossary,
}: {
  title: string
  Icon: typeof Compass
  items: string[]
  glossary: string
}) {
  if (!items.length) return null
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm font-semibold" title={glossary}>
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
