import { Quotes } from '@/components/quotes'
import type { ClaimResult, Judgement, AskSummary, Verdict } from '@/lib/ask/types'

// A document, annotated — the agent's other face.
//
// THE ONE RULE THAT DIFFERS FROM QUESTION MODE: silence here is clean space.
// The question box may offer the nearest thing it does have, because someone
// asked one thing and wants help. Here the agent walks EVERY claim in a
// campaign, and if each silent one got an adjacent-thing consolation a
// nine-claim brief would become nine tangents — and the summary line would stop
// meaning anything. Heinrich, 2026-08-22: "if nothing relates to something,
// just stay silent."
//
// So an untested claim shows its claim and its badge and then stops. No
// explanation, no filler. The blank is the information.

const VERDICT_META: Record<Verdict, { label: string; fg: string; bg: string }> = {
  echoes: { label: 'Supported', fg: 'text-primary', bg: 'bg-primary/10' },
  contradicts: { label: 'Contradicted', fg: 'text-clay', bg: 'bg-clay/10' },
  // Same visual weight as the other two. It is the verdict that keeps the
  // product honest, and shrinking it would quietly turn "we don't know" into
  // "nothing to see".
  silent: { label: 'Untested', fg: 'text-muted-foreground', bg: 'bg-muted' },
}

export function AgentDocumentView({
  claims,
  summary,
  judgement,
  quotesByClaim,
  activeRef = null,
  anchored,
  onSelect,
}: {
  claims: ClaimResult[]
  summary: AskSummary
  judgement: Judgement[]
  quotesByClaim: Map<string, string[]>
  /** Set when the split view is driving selection from the document side. */
  activeRef?: string | null
  /** Refs whose span was found in the document. A claim NOT in here was never
   *  written down — worth saying out loud rather than leaving as a silent
   *  absence of a highlight. */
  anchored?: Set<string>
  onSelect?: (ref: string) => void
}) {
  const numberOf = new Map(claims.map((c, i) => [c.ref, i + 1]))

  return (
    <div className="space-y-6">
      <p className="text-[15px] text-foreground">
        <span className="tabular-nums">{summary.supported}</span> supported ·{' '}
        <span className="tabular-nums">{summary.contradicted}</span> contradicted ·{' '}
        <span className="tabular-nums">{summary.untested}</span> untested
      </p>

      <section className="space-y-3">
        {claims.map((c, i) => {
          const meta = VERDICT_META[c.verdict]
          const quotes = quotesByClaim.get(c.ref) ?? []
          return (
            <div
              key={c.ref}
              data-ref={c.ref}
              onClick={onSelect ? () => onSelect(c.ref) : undefined}
              className={`space-y-3 rounded-2xl border p-4 transition-colors ${
                activeRef === c.ref ? 'border-primary/50 bg-primary/5' : 'border-border/60'
              } ${onSelect ? 'cursor-pointer' : ''}`}
            >
              <div className="flex items-start gap-3">
                <span className="mt-0.5 shrink-0 text-xs font-semibold text-muted-foreground tabular-nums">
                  {i + 1}
                </span>
                <p className="min-w-0 flex-1 text-[15px] font-medium leading-snug text-foreground">{c.claim}</p>
                <span
                  className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${meta.bg} ${meta.fg}`}
                >
                  {meta.label}
                </span>
              </div>

              {/* A claim the document never states. Not a failure of the check —
                  a plan resting on something it never says out loud is worth
                  knowing before money is spent on it. */}
              {anchored && !anchored.has(c.ref) && (
                <p className="text-xs text-muted-foreground">Not stated directly in the document.</p>
              )}

              {/* Untested stops here. Deliberately. */}
              {c.verdict !== 'silent' && (
                <div className="space-y-3 border-l-2 border-border pl-3">
                  {/* The voices lead. The sentence under them is a reading OF
                      them, and saying so is the difference between evidence and
                      a sentence that merely sounds like evidence. */}
                  {quotes.length > 0 && <Quotes items={quotes} />}
                  {c.theySay && (
                    <div>
                      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        In summary
                      </p>
                      <p className="mt-1 text-sm leading-relaxed text-foreground/85">{c.theySay}</p>
                    </div>
                  )}
                  <p className="text-xs text-muted-foreground">
                    {c.conversationCount} {c.conversationCount === 1 ? 'conversation' : 'conversations'}
                    {c.themeRefs?.length ? ` · ${c.themeRefs.map((t) => t.label).filter(Boolean).join(' · ')}` : ''}
                  </p>
                </div>
              )}
            </div>
          )
        })}
      </section>

      {judgement.length > 0 && (
        <section className="space-y-2">
          <h3 className="text-sm font-semibold">What I&rsquo;d take from that</h3>
          <div className="space-y-3 rounded-lg bg-muted/40 p-4">
            {judgement.map((j, i) => {
              const cites = (j.basedOnRefs ?? [])
                .map((ref) => numberOf.get(ref))
                .filter((n): n is number => Boolean(n))
                .sort((a, b) => a - b)
              return (
                <div key={i} className="space-y-1">
                  <p className="text-[15px] leading-snug text-foreground/85">{j.text}</p>
                  <p className="text-xs text-muted-foreground">
                    {cites.length > 0
                      ? `Reasoning from ${cites.length === 1 ? 'claim' : 'claims'} ${cites.join(', ')} above.`
                      : 'Not drawn from any single claim above — this one is inference.'}
                  </p>
                </div>
              )
            })}
          </div>
        </section>
      )}
    </div>
  )
}
