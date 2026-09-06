import Link from 'next/link'
import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { SiteNav } from '../../_components/site-nav'
import { LeadForm } from '../../lead-form'
import { PlaybookPanel, PlaybookStepVisual, SendOnVisual } from '../../_components/playbook-visual'
import { playbooks, USE_CASES_PUBLIC } from '../../_data/playbooks'

const surfaceLabel: Record<string, string> = {
  market: 'Market page',
  content: 'Content page',
  competitive: 'Competitive page',
  analyst: 'Analyst page',
  studio: 'Studio',
  voice: 'Voice page',
}

export function generateStaticParams() {
  return playbooks.map((pb) => ({ slug: pb.slug }))
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params
  const pb = playbooks.find((p) => p.slug === slug)
  if (!pb) return {}
  const url = `https://verbatimintel.com/use-cases/${pb.slug}`
  return {
    title: pb.title,
    description: pb.summary,
    openGraph: { title: pb.title, description: pb.summary, url, type: 'article' },
    alternates: { canonical: url },
  }
}

// One use-case article, following the spine in the plan (§1): the job, how it
// usually goes, what you're looking at, the steps, what you send on, where
// the ask. A reading page — no dark hero, no part numbers.
export default async function UseCaseArticle({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const index = playbooks.findIndex((p) => p.slug === slug)
  if (!USE_CASES_PUBLIC || index === -1) notFound()
  const pb = playbooks[index]
  const prev = playbooks[(index - 1 + playbooks.length) % playbooks.length]
  const next = playbooks[(index + 1) % playbooks.length]

  return (
    <>
      <SiteNav variant="light" current="use-cases" />
      <article className="pb">
        <header className="pb-head" id="content" tabIndex={-1}>
          <div className="wrap">
            <span className="pb-label">{surfaceLabel[pb.surface]} · {pb.readMinutes} min</span>
            <h1>{pb.title}</h1>
            <p className="pb-dek">{pb.summary}</p>
          </div>
        </header>

        <section aria-labelledby="usually-h">
          <div className="wrap">
            <h2 id="usually-h">How this usually goes.</h2>
            {pb.usually.map((para, i) => (
              <p className="body" key={i}>{para}</p>
            ))}
          </div>
        </section>

        <section aria-labelledby="panel-h">
          <div className="wrap">
            <h2 id="panel-h">What you&rsquo;re looking at.</h2>
            <PlaybookPanel panel={pb.panel} />
            <p className="body" style={{ marginTop: 24 }}>{pb.panelCaption}</p>
          </div>
        </section>

        <section aria-labelledby="steps-h">
          <div className="wrap">
            <h2 id="steps-h">The steps.</h2>
            <ol className="pb-steps" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {pb.steps.map((step, i) => (
                <li className="pb-step" key={step.verb}>
                  <div className="n">{i + 1}</div>
                  <div>
                    <h4>{step.verb}</h4>
                    <p>{step.body}</p>
                    <PlaybookStepVisual show={step.show} />
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section aria-labelledby="send-h">
          <div className="wrap">
            <h2 id="send-h">What you send on.</h2>
            <div className="pb-send">
              <div className="panel-title"><b>{pb.sendOn.title}</b></div>
              <SendOnVisual sendOn={pb.sendOn} />
              <p>{pb.sendOn.body}</p>
            </div>
          </div>
        </section>

        <section aria-label="More use cases">
          <div className="wrap">
            <nav className="pb-nav" aria-label="More use cases">
              <Link href={`/use-cases/${prev.slug}`} className="prev">← {prev.title}</Link>
              <Link href={`/use-cases/${next.slug}`} className="next">{next.title} →</Link>
            </nav>
          </div>
        </section>
      </article>

      <section className="s band" id="early-access" aria-labelledby="line-h">
        <div className="wrap">
          <h2 id="line-h">They hear your name. <span>We hear the market.</span></h2>
          <p>{pb.askLine}</p>
          <LeadForm />
        </div>
      </section>
    </>
  )
}
