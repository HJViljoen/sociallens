import Link from 'next/link'
import type { Metadata } from 'next'
import { SiteNav } from '../_components/site-nav'
import { LeadForm } from '../lead-form'
import { playbooks } from '../_data/playbooks'

const surfaceLabel: Record<string, string> = {
  market: 'Market page',
  content: 'Content page',
  competitive: 'Competitive page',
  analyst: 'Analyst page',
  studio: 'Studio',
  voice: 'Voice page',
}

const description =
  'Five things to do with Verbatim this week: task-shaped walkthroughs for planning a campaign, a week of content, a leadership meeting, checking a brief and writing sales objections.'

export const metadata: Metadata = {
  title: 'Use cases',
  description,
  openGraph: {
    title: 'Use cases',
    description,
    url: 'https://verbatimintel.com/use-cases',
    type: 'website',
  },
  alternates: { canonical: 'https://verbatimintel.com/use-cases' },
}

// The use-cases index: rows, not cards (plan §4). A light sticky nav, a short
// header, five rows in read order, then the standard closing band.
export default function UseCasesIndex() {
  return (
    <>
      <SiteNav variant="light" current="use-cases" />
      <header className="hiw-head" id="content" tabIndex={-1}>
        <div className="wrap">
          <h1>Five things to do with it this week.</h1>
          <p>Each one starts from a job you already have to do, and walks through doing it on one Verbatim surface, step by step.</p>
        </div>
      </header>

      <section className="s-tight" aria-labelledby="index-h">
        <h2 id="index-h" className="sr-only">Use cases</h2>
        <div className="wrap">
          <div className="pb-index">
            {playbooks.map((pb) => (
              <Link href={`/use-cases/${pb.slug}`} className="pb-row" key={pb.slug}>
                <span className="pb-job">{pb.title}</span>
                <span className="pb-surface">{surfaceLabel[pb.surface]}</span>
                <span className="pb-summary">{pb.summary}</span>
                <span className="pb-time">{pb.readMinutes} min</span>
                <span className="pb-arrow" aria-hidden="true">→</span>
              </Link>
            ))}
          </div>
        </div>
      </section>

      <section className="s band" id="early-access" aria-labelledby="line-h">
        <div className="wrap">
          <h2 id="line-h">They hear your name. <span>We hear the market.</span></h2>
          <p>Pick the job you have this week, and run it once on your own market.</p>
          <LeadForm />
        </div>
      </section>
    </>
  )
}
