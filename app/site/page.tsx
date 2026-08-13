import { LeadForm } from './lead-form'

// The marketing one-pager. Design contract: DESIGN.md ("Annotated transcript").
// Copy contract: .agents/product-marketing.md — positioning, capability map,
// VoC bank, voice, banned list. Three hard rules worth repeating here: no
// em-dashes in copy (the arrow in the funnel strip is data notation, not
// prose), no comprehensiveness claims (we sample, and the filtering story is
// the stronger one anyway), and anything unshipped is labelled "in
// development" rather than written in present tense.

export default function MarketingHome() {
  return (
    <>
      {/* ── Hero — use case up front, marker on the pain ──────────────── */}
      <section className="relative overflow-hidden">
        <div className="crowd-bg crowd-bg--live" aria-hidden />
        <div className="relative z-10 mx-auto w-full max-w-6xl px-5 pb-24 pt-20 sm:pb-32 sm:pt-28">
          <h1 className="animate-in fade-in slide-in-from-bottom-4 duration-700 motion-reduce:animate-none max-w-3xl font-heading text-[clamp(2.2rem,5.6vw,4.5rem)] font-medium leading-[1.08] tracking-tight">
            Know what your market is saying, without reading{' '}
            <span className="marker marker--draw">ten thousand comments.</span>
          </h1>
          <p className="animate-in fade-in slide-in-from-bottom-4 fill-mode-backwards duration-700 delay-300 motion-reduce:animate-none mt-7 max-w-xl text-lg leading-relaxed text-muted-foreground">
            Verbatim reads the public conversation around your brand, your competitors and the wider
            category, then sends you one weekly report: what people are saying, what changed, and
            what to do about it.
          </p>
          <div className="animate-in fade-in slide-in-from-bottom-4 fill-mode-backwards duration-700 delay-500 motion-reduce:animate-none mt-9 flex flex-wrap items-center gap-3">
            <a
              href="#early-access"
              className="flex h-12 items-center rounded-lg bg-primary px-6 text-sm font-semibold text-primary-foreground transition duration-200 ease-site hover:brightness-110 active:scale-[0.97]"
            >
              Get early access
            </a>
            <a
              href="#what"
              className="flex h-12 items-center rounded-lg px-6 text-sm font-semibold text-foreground/80 underline decoration-border underline-offset-4 transition-colors duration-200 ease-site hover:text-foreground hover:decoration-foreground/50"
            >
              See a sample insight
            </a>
          </div>
          <p className="animate-in fade-in fill-mode-backwards duration-700 delay-700 motion-reduce:animate-none mt-10 font-mono text-xs text-muted-foreground">
            tiktok · instagram · youtube
          </p>
        </div>
      </section>

      {/* ── Premise: prose beside a marked-up transcript artifact ─────── */}
      <section className="border-t border-border">
        <div className="mx-auto grid w-full max-w-6xl gap-12 px-5 py-16 sm:py-24 lg:grid-cols-[1.1fr_1fr] lg:gap-16">
          <div>
            <h2 className="font-heading text-3xl font-medium tracking-tight sm:text-4xl">
              Your market is already talking
            </h2>
            <p className="mt-5 leading-relaxed text-muted-foreground">
              Around every brand there&rsquo;s a running conversation: what people love, what annoys
              them, what they wish existed, how they compare you to the alternatives. Thousands of
              comments a week. Nobody was asked and nobody was paid, which makes it the most honest
              read on a market that exists.
            </p>
            <p className="mt-4 leading-relaxed text-muted-foreground">
              Almost nobody uses it. It&rsquo;s too much to read, it sits across several platforms,
              and most of it happens somewhere other than your own posts. So brands stay blind on
              the exact channel where their buyers say what they want. Verbatim reads it every week
              and marks what matters.
            </p>
          </div>

          {/* Transcript excerpt — quotes as artifacts, one marked. */}
          <figure className="self-center">
            <div className="rounded-xl bg-card p-6 shadow-[0_16px_40px_-20px_rgba(13,33,23,0.25)] ring-1 ring-black/[0.04] sm:p-7">
              <div className="space-y-5">
                <div>
                  <blockquote className="font-heading text-lg italic leading-snug">
                    &ldquo;love this bag but <span className="marker">the strap absolutely digs in
                    by hour six</span>&rdquo;
                  </blockquote>
                  <p className="mt-1.5 font-mono text-xs text-muted-foreground">
                    @packlight.kay · instagram · 3d
                  </p>
                </div>
                <div>
                  <blockquote className="font-heading text-lg italic leading-snug text-foreground/80">
                    &ldquo;same, the padding on mine wore flat within a month&rdquo;
                  </blockquote>
                  <p className="mt-1.5 font-mono text-xs text-muted-foreground">
                    reply · instagram · 3d
                  </p>
                </div>
                <div>
                  <blockquote className="font-heading text-lg italic leading-snug text-foreground/80">
                    &ldquo;is the new strap any better? deciding between this and two others&rdquo;
                  </blockquote>
                  <p className="mt-1.5 font-mono text-xs text-muted-foreground">
                    @tomas.runs · tiktok · 1d
                  </p>
                </div>
              </div>
              <div className="mt-6 flex flex-wrap items-center gap-x-2 gap-y-1.5 border-t border-border pt-4">
                <span className="rounded bg-secondary px-2 py-1 font-mono text-[11px] text-secondary-foreground">
                  theme: strap comfort
                </span>
                <span className="font-mono text-[11px] text-muted-foreground">
                  47 conversations · growing
                </span>
              </div>
            </div>
            <figcaption className="mt-3 text-center font-mono text-[11px] text-muted-foreground">
              illustrative example
            </figcaption>
          </figure>
        </div>
      </section>

      {/* ── Scope: three audiences across the top, then the data layer ── */}
      <section id="scope" className="scroll-mt-16 border-t border-border">
        <div className="mx-auto w-full max-w-6xl px-5 py-16 sm:py-24">
          <div className="max-w-2xl">
            <h2 className="font-heading text-3xl font-medium tracking-tight sm:text-4xl">
              Three conversations at once
            </h2>
            <p className="mt-5 leading-relaxed text-muted-foreground">
              Most tools watch your own mentions. The useful signal usually sits everywhere else: in
              your rivals&rsquo; comment sections, and in the category conversation where nobody has
              picked a brand yet.
            </p>
          </div>

          <dl className="mt-12 grid gap-x-10 gap-y-8 md:grid-cols-3">
            <div>
              <dt className="font-semibold">Your brand</dt>
              <dd className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                What people say about you, wherever they say it. Including your own accounts: your
                posts, the replies under them, and how your following moves week to week.
              </dd>
            </div>
            <div>
              <dt className="font-semibold">Your competitors</dt>
              <dd className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                What their customers praise, complain about and ask for. Their unhappy customers are
                the clearest brief you will ever get.
              </dd>
            </div>
            <div>
              <dt className="font-semibold">Your category</dt>
              <dd className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                The wider conversation among people who haven&rsquo;t chosen anyone yet: what they
                want, what confuses them, what they&rsquo;re comparing.
              </dd>
            </div>
          </dl>

          <div className="mt-12 border-t border-border pt-8 sm:flex sm:gap-12">
            <p className="shrink-0 font-mono text-xs text-muted-foreground sm:w-40">what gets read</p>
            <div className="mt-3 sm:mt-0">
              <p className="max-w-2xl leading-relaxed text-muted-foreground">
                Comments and replies, plus what&rsquo;s said in the videos themselves, transcribed
                and analysed alongside the conversation around them.
              </p>
              <p className="mt-3 max-w-2xl font-mono text-xs leading-relaxed text-muted-foreground">
                in development: news and web context around your market, and more platforms,
                starting with reddit.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ── How it works — the filtering story, with the real funnel ──── */}
      <section id="how" className="scroll-mt-16 border-t border-border bg-muted/40">
        <div className="mx-auto w-full max-w-6xl px-5 py-16 sm:py-24">
          <div className="lg:grid lg:grid-cols-[1fr_2fr] lg:gap-16">
            <h2 className="font-heading text-3xl font-medium tracking-tight sm:text-4xl">
              How it works
            </h2>
            <ol className="mt-10 space-y-10 border-l border-border pl-8 lg:mt-2">
              {[
                {
                  n: '1',
                  title: 'Give us the facts',
                  body: 'Your brand. Your competitors. That’s everything you need to know. No keyword tuning, no query syntax, no research expertise. Verbatim works out where the conversation is and goes to find it.',
                },
                {
                  n: '2',
                  title: 'It throws most of it away',
                  body: 'A week’s gather is mostly noise: spam, off-topic clips, brands that share your name. All of it gets judged for relevance before anything is analysed, because an insight built on the wrong conversation is worse than no insight.',
                },
                {
                  n: '3',
                  title: 'What survives gets read properly',
                  body: 'The remaining conversation is grouped into themes, weighed by how many independent voices sit behind each one, and turned into findings. A passing remark never gets promoted into a trend.',
                },
                {
                  n: '4',
                  title: 'You get answers, not homework',
                  body: 'A report with the insights that matter this week, each one traceable to what real people said. It lands in your inbox before Monday’s meeting.',
                },
              ].map((s) => (
                <li key={s.n} className="relative">
                  <span
                    className="absolute -left-8 top-0.5 flex h-6 w-6 -translate-x-1/2 items-center justify-center rounded-full bg-primary font-mono text-xs text-primary-foreground"
                    aria-hidden
                  >
                    {s.n}
                  </span>
                  <h3 className="text-lg font-semibold">{s.title}</h3>
                  <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted-foreground">
                    {s.body}
                  </p>
                </li>
              ))}
            </ol>
          </div>

          {/* The funnel: the filtering claim, made falsifiable. */}
          <div className="mt-14 rounded-xl bg-card px-6 py-6 ring-1 ring-black/[0.04] sm:px-8">
            <p className="font-mono text-[11px] text-muted-foreground">
              one real weekly run, end to end
            </p>
            <div className="mt-4 flex flex-wrap items-baseline gap-x-3 gap-y-2 font-mono text-sm">
              <span>521 videos</span>
              <span className="text-muted-foreground" aria-hidden>
                →
              </span>
              <span>5,059 comments</span>
              <span className="text-muted-foreground" aria-hidden>
                →
              </span>
              <span>120 themes</span>
              <span className="text-muted-foreground" aria-hidden>
                →
              </span>
              <span className="marker">5 recommendations</span>
            </div>
            <p className="mt-4 max-w-2xl text-sm leading-relaxed text-muted-foreground">
              That last number is the point. Everything before it is work you don&rsquo;t have to do.
            </p>
          </div>
        </div>
      </section>

      {/* ── What you get — stacked, so the page changes rhythm here ───── */}
      <section id="what" className="scroll-mt-16 border-t border-border">
        <div className="mx-auto w-full max-w-6xl px-5 py-16 sm:py-24">
          <h2 className="max-w-2xl font-heading text-3xl font-medium tracking-tight sm:text-4xl">
            What you get every week
          </h2>

          <dl className="mt-10 grid gap-x-12 gap-y-8 sm:grid-cols-2">
            {[
              {
                t: 'What your market is talking about',
                d: 'The themes moving your category, ranked by how much real evidence sits behind them. The voices are one click away.',
              },
              {
                t: 'What your competitors’ customers say',
                d: 'What people praise and complain about in rival audiences, and the gaps that leaves open for you.',
              },
              {
                t: 'Recommendations you can defend',
                d: 'Every recommendation leads with a verbatim quote. When you take it to your team, the evidence comes with you.',
              },
              {
                t: 'What changed this week',
                d: 'New themes, sentiment shifts, competitor moves, and how your own audience responded. The movement, week over week.',
              },
            ].map((item) => (
              <div key={item.t}>
                <dt className="font-semibold">{item.t}</dt>
                <dd className="mt-1.5 max-w-lg text-sm leading-relaxed text-muted-foreground">
                  {item.d}
                </dd>
              </div>
            ))}
          </dl>

          {/* One report excerpt, styled like the product's own output. */}
          <figure className="mt-14">
            <div className="mx-auto max-w-2xl rounded-xl bg-card p-6 shadow-[0_16px_40px_-20px_rgba(13,33,23,0.25)] ring-1 ring-black/[0.04] sm:p-8">
              <p className="font-mono text-[11px] text-muted-foreground">
                from a weekly report · recommendation
              </p>
              <p className="mt-3 font-heading text-xl font-medium leading-snug sm:text-2xl">
                Lead your next drop&rsquo;s messaging with{' '}
                <span className="marker">all-day carry comfort</span>
              </p>
              <p className="mt-3 leading-relaxed text-muted-foreground">
                Your competitor&rsquo;s customers are asking for it, and nobody in the category owns
                it yet.
              </p>
              <blockquote className="mt-5 border-l-2 border-primary/40 pl-4 font-heading italic leading-snug text-foreground/80">
                &ldquo;love this bag but the strap absolutely digs in by hour six&rdquo;
              </blockquote>
              <p className="mt-4 font-mono text-[11px] text-muted-foreground">
                grounded in 47 conversations
              </p>
            </div>
            <figcaption className="mt-3 text-center font-mono text-[11px] text-muted-foreground">
              illustrative example
            </figcaption>
          </figure>
        </div>
      </section>

      {/* ── Philosophy — the founder's line, quoted properly ──────────── */}
      <section className="bg-[var(--pine)] text-[#EFF3EC]">
        <div className="mx-auto w-full max-w-6xl px-5 py-16 sm:py-24">
          <blockquote className="max-w-3xl font-heading text-3xl font-medium italic leading-snug tracking-tight sm:text-5xl">
            &ldquo;If you only need to look once a week, it&rsquo;s doing its job.&rdquo;
          </blockquote>
          <p className="mt-4 font-mono text-xs text-[#9DB6A9]">
            the principle verbatim is built on
          </p>
          <div className="mt-12 grid gap-8 md:grid-cols-2">
            <div>
              <h3 className="font-semibold">The work happens before you read it</h3>
              <p className="mt-2.5 max-w-md text-sm leading-relaxed text-[#C4D2C6]">
                Tools that show you numbers get used every day, because someone has to work out what
                the numbers mean. Verbatim does that work. One weekly read is enough, and the
                evidence is there whenever you want to go deeper.
              </p>
            </div>
            <div>
              <h3 className="font-semibold">Every insight has a source</h3>
              <p className="mt-2.5 max-w-md text-sm leading-relaxed text-[#C4D2C6]">
                No synthetic consumers and no black-box scores. Every insight traces back to
                something a real person actually said, quoted exactly as they said it.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ── Founder's note — the human behind the product ─────────────── */}
      <section className="border-b border-border">
        <div className="mx-auto w-full max-w-6xl px-5 py-16 sm:py-20">
          <figure className="max-w-2xl">
            <figcaption className="font-mono text-xs text-muted-foreground">
              a note from the founder
            </figcaption>
            <blockquote className="mt-5 font-heading text-xl italic leading-relaxed sm:text-2xl">
              &ldquo;The comments under a brand&rsquo;s videos, and under its competitors&rsquo;
              videos, hold better market research than most brands ever commission. Nobody reads
              them, because nobody can. I built the system that does.&rdquo;
            </blockquote>
            <p className="mt-5 leading-relaxed text-muted-foreground">
              Verbatim runs every week on a real brand&rsquo;s market today. Now I&rsquo;m looking
              for five brands to shape it with. If that could be you, I read every request that
              comes through this page.
            </p>
            <p className="mt-5 text-sm font-semibold">
              Heinrich Viljoen
              <span className="ml-2 font-normal text-muted-foreground">founder, Verbatim</span>
            </p>
          </figure>
        </div>
      </section>

      {/* ── Design partners ───────────────────────────────────────────── */}
      <section id="early-access" className="scroll-mt-16">
        <div className="mx-auto w-full max-w-6xl px-5 py-16 sm:py-24">
          <div className="grid gap-10 lg:grid-cols-2 lg:gap-16">
            <div>
              <h2 className="font-heading text-3xl font-medium tracking-tight sm:text-4xl">
                Taking five design partners this quarter
              </h2>
              <p className="mt-5 leading-relaxed text-muted-foreground">
                Design partner means you run Verbatim on your real market and shape what gets built.
                The exchange is simple:
              </p>
              <ul className="mt-6 space-y-3 text-sm leading-relaxed text-foreground/85">
                <li className="flex gap-3">
                  <span className="mt-2 h-1 w-4 shrink-0 bg-primary" aria-hidden />
                  You get the full platform, a weekly report on your market, launch pricing locked
                  in early, and a direct line to me.
                </li>
                <li className="flex gap-3">
                  <span className="mt-2 h-1 w-4 shrink-0 bg-primary" aria-hidden />
                  I ask that you actually use it, and that we talk for half an hour every two weeks
                  about what&rsquo;s working and what isn&rsquo;t.
                </li>
                <li className="flex gap-3">
                  <span className="mt-2 h-1 w-4 shrink-0 bg-primary" aria-hidden />
                  Three months, then you decide. If it&rsquo;s not earning its keep, you leave on 14
                  days&rsquo; notice.
                </li>
              </ul>
              <p className="mt-6 text-sm text-muted-foreground">
                Verbatim is new. You&rsquo;ll hit rough edges, and your feedback decides what gets
                built next. Five spots. If it&rsquo;s not a fit yet, you&rsquo;ll hear that honestly.
              </p>
            </div>
            <div className="rounded-xl bg-card p-6 shadow-[0_16px_40px_-20px_rgba(13,33,23,0.25)] ring-1 ring-black/[0.04] sm:p-8">
              <LeadForm />
            </div>
          </div>
        </div>
      </section>
    </>
  )
}
