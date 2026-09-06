import { SiteNav } from './_components/site-nav'
import { Murmur } from './_components/murmur'
import { DotField } from './_components/dot-field'
import { Reveal } from './_components/reveal'
import { AnalystStage } from './_components/analyst-stage'
import { ReportCovers } from './_components/report-covers'
import { LeadForm } from './lead-form'
import { QuoteCard, BriefRow, ThemeMapGrid, FaceOffPanel, PersonaCard } from './_components/mocks'
import { streamQuotes, personas, brief } from './_data/sample'

// The marketing home page. Design contract: DESIGN.md ("The murmur"). Copy
// contract: .agents/product-marketing.md. The page has one job per screen:
// stop them, make them curious, move them on. Specifics live on /how-it-works.
// Sample data (an illustrative backpack market) comes from _data/sample.ts so
// every number reads the same everywhere it appears. Shared surface markup
// (theme map, face-off, brief rows, persona cards, quote cards) lives in
// _components/mocks.tsx, reused by the playbook articles.

export default function MarketingHome() {
  const colA = streamQuotes.filter((_, i) => i % 2 === 0)
  const colB = streamQuotes.filter((_, i) => i % 2 === 1)

  return (
    <>
      {/* Beat 1: the room */}
      <header className="hero" id="top">
        <SiteNav variant="dark" />
        <Murmur />
        <div className="wrap" id="content" tabIndex={-1}>
          <h1>Stop listening for your name.</h1>
          <p className="sub">
            Your name is <b className="num">0.02%</b> of the conversation. Verbatim is built for the other{' '}
            <b className="num">99.98%</b>.
          </p>
          <div className="cta">
            <a className="btn btn-green" href="#early-access">Get early access</a>
            <a className="btn btn-ghost" href="#model">See how it works</a>
          </div>
          <p className="from">Read from TikTok, Instagram, YouTube and Reddit. Comments, threads, and what people say to camera.</p>
        </div>
      </header>

      {/* Beat 2: the count */}
      <section className="s count" aria-labelledby="count-h">
        <div className="wrap">
          <h2 id="count-h" className="lead-xl">
            <span className="num">18,440 comments.</span>
            <span className="quiet">Your name came up</span>
            <span className="four">four times.</span>
          </h2>
          <div>
            <DotField />
            <div className="dots-caption">
              <span><i />Four comments named the brand.</span>
              <span>The other 18,436 are the market.</span>
            </div>
          </div>
          <p className="body">
            One brand&rsquo;s market, counted in our own data. A tool built to find your name hears four comments and calls it low volume. It isn&rsquo;t low volume. It&rsquo;s the wrong question.
          </p>
        </div>
      </section>

      {/* Beat 3: the reveal */}
      <section className="s-tight saying" aria-labelledby="saying-h">
        <div className="wrap">
          <div className="sticky">
            <h2 id="saying-h" className="lead">This is what the other 18,436 were saying.</h2>
            <p className="body" style={{ marginTop: 24 }}>
              What&rsquo;s wrong with the product they own. What they&rsquo;d switch for. What the creator they trust said to camera. The thread where forty people compared notes. None of it was asked for, and almost none of it says a brand&rsquo;s name.
            </p>
          </div>
          <div className="stream">
            <div className="col a">
              {colA.map((q) => <QuoteCard key={q.text} q={q} />)}
              {colA.map((q) => <QuoteCard key={`d-${q.text}`} q={q} dup />)}
            </div>
            <div className="col b">
              {colB.map((q) => <QuoteCard key={q.text} q={q} />)}
              {colB.map((q) => <QuoteCard key={`d-${q.text}`} q={q} dup />)}
            </div>
          </div>
        </div>
      </section>

      {/* The model */}
      <section className="s model-intro" id="model" aria-labelledby="model-h">
        <div className="wrap">
          <h2 id="model-h" className="lead">From all of that, Verbatim builds a working model of your market.</h2>
          <div>
            <p className="body">A model, not a feed of mentions: who the people in the conversation are, what they care about, and where you stand against your competitors. Rebuilt from what people said this week.</p>
            <p className="body">And every week, what changed.</p>
          </div>
        </div>
      </section>

      {/* Who they are */}
      <section className="surface" aria-labelledby="who-h">
        <div className="wrap">
          <div className="text">
            <h3 id="who-h">Who they are.</h3>
            <p className="body">The people in the conversation, sorted into the few kinds they turn out to be. For each one: what they want, what stops them, and the exact phrases they use.</p>
          </div>
          <Reveal className="panel">
            <div className="panel-title"><b>Who&rsquo;s in your market</b><span>Three profiles from this week&rsquo;s conversation</span></div>
            <div className="personas">
              {personas.map((p, i) => (
                <PersonaCard key={p.name} persona={p} index={i} />
              ))}
            </div>
          </Reveal>
        </div>
      </section>

      {/* What they talk about */}
      <section className="surface flip" aria-labelledby="what-h">
        <div className="wrap">
          <Reveal className="panel">
            <div className="panel-title"><b>What your market talks about</b><span>Sized by conversations this week</span></div>
            <ThemeMapGrid />
          </Reveal>
          <div className="text">
            <h3 id="what-h">What they talk about.</h3>
            <p className="body">The themes in the conversation, sized by how many people raised it and tracked week to week. Open any block and the people behind it are there, quoted exactly.</p>
          </div>
        </div>
      </section>

      {/* Where you stand */}
      <section className="surface" aria-labelledby="stand-h">
        <div className="wrap">
          <div className="text">
            <h3 id="stand-h">Where you stand.</h3>
            <p className="body">You against each competitor and against the category as a whole, theme by theme. Which themes they own, which you own, and the questions under your videos that nobody answered.</p>
          </div>
          <Reveal className="panel">
            <div className="panel-title"><b>The face-off</b><span>This week, against your closest competitor</span></div>
            <FaceOffPanel />
          </Reveal>
        </div>
      </section>

      {/* And every week */}
      <section className="surface flip" aria-labelledby="weekly-h">
        <div className="wrap">
          <div className="brief">
            <div className="h"><b>Your market this week</b><span>Week 36. Ten minutes.</span></div>
            <hr />
            {brief.filter((l) => l.kind !== 'do').map((l, i) => (
              <BriefRow key={i} line={l} />
            ))}
            <hr />
            {brief.filter((l) => l.kind === 'do').map((l, i) => (
              <BriefRow key={`do-${i}`} line={l} />
            ))}
          </div>
          <div className="text">
            <h3 id="weekly-h">And every week, what changed.</h3>
            <p className="body">The model is rebuilt from the week&rsquo;s conversation, and one page lands in your inbox: what moved and what we&rsquo;d do about it. Every line links to the exact words behind it.</p>
          </div>
        </div>
      </section>

      {/* The analyst */}
      <section className="stage-s" id="analyst" aria-labelledby="ask-h">
        <AnalystStage />
      </section>

      {/* The rooms */}
      <section className="rooms" id="reports" aria-labelledby="rooms-h">
        <div className="wrap">
          <div className="head">
            <h2 id="rooms-h" className="lead">The same market, written for whoever is in the room.</h2>
            <div>
              <p className="body">Leadership gets one page. Sales gets the objections and who they lose to. Build a report once, schedule it to go out with every update, and share it with a link that needs no login.</p>
              <p className="body">It goes out as your work, with Verbatim in the footer.</p>
            </div>
          </div>
          <ReportCovers />
          <div className="rules">
            <p><b>Scheduled.</b> Every update or monthly, to a recipient list you control, PDF attached.</p>
            <p><b>Shared by link.</b> Read-only, no account needed, expires when you say, one click to revoke.</p>
            <p><b>Yours.</b> Your company on every page, written for anyone you name. Every quote still traces to its source.</p>
          </div>
        </div>
      </section>

      {/* The line, and the ask */}
      <section className="s band" id="early-access" aria-labelledby="line-h">
        <div className="wrap">
          <h2 id="line-h">They hear your name. <span>We hear the market.</span></h2>
          <p>Listening tools are built to find a name. In a market that rarely says it, they return nothing and call it quiet. Verbatim starts from the category.</p>
          <LeadForm />
        </div>
      </section>
    </>
  )
}
