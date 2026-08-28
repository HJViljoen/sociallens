import Link from 'next/link'
import { Card, CardContent } from '@/components/ui/card'
import { Quotes } from './quotes'
import type { DashboardNarrative } from '@/lib/dashboard-narrative'

// The dashboard hero: the executive brief. A bold claim, the woven narrative
// (each beat's figure rendered bold — the number is authoritative, substituted
// by lib/dashboard-narrative from run_summary, never the model), the real voice
// behind it, and the verdict — the single top action, folded in from the old
// "one thing to act on" card so the page states the action once.

export interface Verdict {
  /** Calibrated word — "Act now" / "Plan next" / "Worth considering". */
  word: string
  title: string
  href: string
  cta: string
}

export function InsightNarrative({
  narrative,
  verdict,
  quotes,
}: {
  narrative: DashboardNarrative
  verdict: Verdict | null
  quotes: string[]
}) {
  return (
    <Card className="ring-1 ring-primary/20">
      <CardContent className="space-y-5 py-7 sm:px-9">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-secondary-foreground">
          <span aria-hidden>✦</span> Executive brief
        </div>

        <p className="text-2xl font-semibold leading-tight text-foreground sm:text-3xl">{narrative.headline}</p>

        {narrative.beats.length > 0 && (
          <p className="text-[15px] leading-relaxed text-foreground/80">
            {narrative.beats.map((b, i) => (
              <span key={b.metric}>
                {i > 0 ? ' ' : ''}
                {b.before}
                <strong className="font-semibold text-foreground">{b.figure}</strong>
                {b.after}
              </span>
            ))}
          </p>
        )}

        {quotes.length > 0 && <Quotes items={quotes} />}

        {verdict && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-border/60 pt-4">
            <span className="rounded-full bg-accent px-2.5 py-0.5 text-xs font-semibold text-accent-foreground">{verdict.word}</span>
            <span className="text-sm font-medium">{verdict.title}</span>
            <Link
              href={verdict.href}
              className="ml-auto inline-flex items-center gap-1 rounded-full bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90"
            >
              {verdict.cta} <span aria-hidden>→</span>
            </Link>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
