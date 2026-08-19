import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft, Check, X, Minus, Lightbulb } from 'lucide-react'
import { getSessionContext } from '@/lib/auth'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Quotes } from '@/components/quotes'
import { createQuotePicker, fetchQuotesByAudience } from '@/lib/quotes'
import { glossaryRule } from '@/lib/calibration'
import type { ClaimResult, Judgement, Verdict } from '@/lib/ask/types'

// One check, annotated.
//
// The page's job is to make the register separation VISIBLE, not merely true in
// the data: the evidence column carries counts and real voices and never the
// model's opinion; the judgement section is labelled as the model's own view
// and sits apart, after the evidence, citing the claims it reasons from.
//
// "Untested" is given the same visual weight as the other two verdicts. It is
// the answer that keeps the product honest, and burying it would quietly turn
// "we don't know" into "nothing to see".

const VERDICT_META: Record<Verdict, { label: string; Icon: typeof Check; fg: string; bg: string; note: string }> = {
  echoes: {
    label: 'Supported',
    Icon: Check,
    fg: 'text-primary',
    bg: 'bg-primary/10',
    note: 'People independently say the same thing.',
  },
  contradicts: {
    label: 'Contradicted',
    Icon: X,
    fg: 'text-clay',
    bg: 'bg-clay/10',
    note: 'The conversation pushes back on this.',
  },
  silent: {
    label: 'Untested',
    Icon: Minus,
    fg: 'text-slate',
    bg: 'bg-slate/10',
    note: 'Nothing in the tracked conversation speaks to this — it is not wrong, it is unmeasured here.',
  },
}

interface CheckRow {
  id: string
  kind: string
  title: string | null
  input_text: string
  source_filename: string | null
  claims: ClaimResult[]
  summary: { supported?: number; contradicted?: number; untested?: number } | null
  judgement: Judgement[]
  created_at: string
}

export default async function AskCheckPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ notice?: string }>
}) {
  const { id } = await params
  const { notice } = await searchParams
  const { supabase, clientId } = await getSessionContext()

  const { data } = await supabase
    .from('plan_checks')
    .select('id, kind, title, input_text, source_filename, claims, summary, judgement, created_at')
    .eq('client_id', clientId)
    .eq('id', id)
    .maybeSingle()

  if (!data) notFound()
  const check = data as CheckRow
  const claims = Array.isArray(check.claims) ? check.claims : []
  const judgement = Array.isArray(check.judgement) ? check.judgement : []

  // Voices resolved live from insight_evidence — nothing verbatim is stored in
  // the check itself, so an erased comment cannot survive inside an answer.
  const perClaim = 40
  const allIds = [...new Set(claims.flatMap((c) => (c.insightIds ?? []).slice(0, perClaim)))]
  const quotesByAudience = allIds.length ? await fetchQuotesByAudience(supabase, allIds) : new Map()
  const pick = createQuotePicker(quotesByAudience, new Map())
  const quotesByClaim = new Map<string, string[]>()
  for (const c of claims) {
    if (c.verdict === 'silent' || !c.insightIds?.length) continue
    // Same slice that was fetched — asking the picker for ids nobody loaded
    // would quietly return fewer voices than exist.
    quotesByClaim.set(c.ref, pick(c.insightIds.slice(0, perClaim), 2, `${c.claim}. ${c.theySay ?? ''}`))
  }

  const s = check.summary ?? {}

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/dashboard/ask"
          className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" aria-hidden />
          All checks
        </Link>
        <h1 className="mt-2 text-xl font-semibold">
          {check.title || (check.kind === 'plan' ? 'Plan check' : 'Idea check')}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {s.supported ?? 0} supported · {s.contradicted ?? 0} contradicted · {s.untested ?? 0} untested
          {check.source_filename ? ` · from ${check.source_filename}` : ''}
        </p>
      </div>

      {notice && (
        <Card>
          <CardContent className="py-3 text-sm text-muted-foreground">{notice}</CardContent>
        </Card>
      )}

      {/* Evidence. Counts and real voices only — never the model's view. */}
      <section className="space-y-3">
        {claims.map((c) => {
          const meta = VERDICT_META[c.verdict] ?? VERDICT_META.silent
          const quotes = quotesByClaim.get(c.ref) ?? []
          return (
            <Card key={c.ref}>
              <CardContent className="space-y-3 py-4">
                <div className="flex flex-wrap items-start gap-3">
                  <span
                    className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${meta.bg} ${meta.fg}`}
                    title={meta.note}
                  >
                    <meta.Icon className="size-3.5" aria-hidden />
                    {meta.label}
                  </span>
                  <p className="flex-1 text-[15px] font-medium leading-snug">{c.claim}</p>
                </div>

                {c.verdict === 'silent' ? (
                  <p className="text-sm leading-snug text-muted-foreground">{meta.note}</p>
                ) : (
                  <div className="space-y-3 border-l-2 border-border pl-3">
                    {/* The voices lead. They are the part that was verified —
                        the summary beneath them is a reading OF them, and
                        labelling it as such is the difference between evidence
                        and a sentence that merely sounds like evidence. */}
                    {quotes.length > 0 && <Quotes items={quotes} />}
                    <div>
                      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        In summary
                      </p>
                      <p className="mt-1 text-sm leading-relaxed text-foreground/85">{c.theySay}</p>
                    </div>
                    <p className="text-xs text-muted-foreground" title={glossaryRule('conversations')}>
                      Heard across {c.conversationCount}{' '}
                      {c.conversationCount === 1 ? 'conversation' : 'conversations'}
                      {c.themeRefs?.length ? ` · ${c.themeRefs.map((t) => t.label).join(' · ')}` : ''}
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          )
        })}
      </section>

      {/* Judgement — deliberately after the evidence, deliberately labelled.
          The reader must never have to guess which of the two they are reading. */}
      {judgement.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-semibold">
              <Lightbulb className="size-4 text-muted-foreground" aria-hidden />
              What I would do about it
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              This part is my read, not measured findings — the evidence above is the measured part.
            </p>
          </CardHeader>
          <CardContent className="space-y-3">
            {judgement.map((j, i) => (
              <div key={i} className="space-y-1">
                <p className="text-sm leading-relaxed text-foreground/85">{j.text}</p>
                {j.basedOnRefs?.length > 0 && (
                  <p className="text-xs text-muted-foreground">
                    Reasoning from {j.basedOnRefs.join(', ')}
                  </p>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <details className="text-sm">
        <summary className="cursor-pointer text-xs font-medium text-muted-foreground hover:text-foreground">
          What was submitted
        </summary>
        <pre className="mt-2 whitespace-pre-wrap rounded-lg border border-border bg-card p-3 text-xs leading-relaxed text-foreground/80">
          {check.input_text}
        </pre>
      </details>
    </div>
  )
}
