import { Quotes } from '@/components/quotes'
import type { AgentAnswer } from '@/lib/agent/types'

// Rendering the three registers.
//
// The labels are the CLIENT's words, not ours. "Grounded / judgement / silent"
// is the vocabulary of the people who built it; a head of marketing reading
// this on a Tuesday needs to know which sentences their customers stand behind
// and which ones are the tool's opinion. Same structure, human words.
//
// Answer first. The client asked a question — the answer is the first thing on
// the page, and the evidence sits under it as support, not as a preamble to it.

function ConversationCount({ n }: { n: number }) {
  // "Conversations" is a fixed word (lib/calibration.ts GLOSSARY) and means
  // distinct source videos. The number is always shown beside the claim rather
  // than turned into a magnitude word.
  return (
    <span className="text-xs text-muted-foreground">
      {n} {n === 1 ? 'conversation' : 'conversations'}
    </span>
  )
}

export function AgentAnswerView({ answer }: { answer: AgentAnswer }) {
  const hasGrounded = answer.grounded.length > 0
  // The model's refs ("G1", "G3") are internal handles and mean nothing to a
  // reader. Number the findings as they appear and cite THOSE, so "based on 1
  // and 2" points at something visible on the same screen.
  const numberOf = new Map(answer.grounded.map((g, i) => [g.id, i + 1]))

  return (
    <div className="space-y-6">
      <p className="text-[17px] leading-relaxed text-foreground">{answer.answer}</p>

      {hasGrounded && (
        <section className="space-y-4">
          <h3 className="text-sm font-semibold">What your customers said</h3>
          {answer.grounded.map((point, i) => (
            <div key={point.id} className="space-y-2 rounded-lg border border-border/60 p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="text-[15px] leading-snug text-foreground">
                  <span className="mr-2 text-xs font-semibold text-muted-foreground tabular-nums">{i + 1}</span>
                  {point.text}
                </p>
                <ConversationCount n={point.conversationCount} />
              </div>
              <Quotes items={point.quotes.map((q) => q.text)} />
              {point.themeRefs.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  {point.themeRefs.map((t) => t.label).filter(Boolean).join(' · ')}
                </p>
              )}
            </div>
          ))}
        </section>
      )}

      {answer.nearest.length > 0 && (
        <section className="space-y-3">
          <h3 className="text-sm font-semibold">Not what you asked, but close</h3>
          {answer.nearest.map((n, i) => (
            <div key={i} className="flex flex-wrap items-baseline justify-between gap-2 rounded-lg border border-dashed border-border/60 p-4">
              <p className="text-[15px] leading-snug text-foreground/90">{n.text}</p>
              <ConversationCount n={n.conversationCount} />
            </div>
          ))}
        </section>
      )}

      {answer.judgement.length > 0 && (
        <section className="space-y-2">
          <h3 className="text-sm font-semibold">What I&rsquo;d take from that</h3>
          {/* Visually distinct from the evidence above on purpose. A reader
              skimming must never mistake this column for the one their
              customers stand behind. */}
          <div className="space-y-3 rounded-lg bg-muted/40 p-4">
            {answer.judgement.map((j, i) => {
              const cites = j.basedOn.map((ref) => numberOf.get(ref)).filter((n): n is number => Boolean(n))
              return (
                <div key={i} className="space-y-1">
                  <p className="text-[15px] leading-snug text-foreground/85">{j.text}</p>
                  {/* Which findings this rests on. A proposal a reader cannot
                      trace back to the evidence is just an opinion — and the
                      two that carry no citation say so rather than borrowing
                      credibility from the ones above them. */}
                  <p className="text-xs text-muted-foreground">
                    {cites.length > 0
                      ? `Reasoning from ${cites.length === 1 ? 'finding' : 'findings'} ${cites.sort((a, b) => a - b).join(', ')} above.`
                      : 'Not drawn from any single finding above — this one is inference.'}
                  </p>
                </div>
              )
            })}
          </div>
        </section>
      )}

      {answer.silent && (
        <p className="text-sm text-muted-foreground">
          Nothing in the conversation we have analysed speaks to this.
        </p>
      )}
    </div>
  )
}
