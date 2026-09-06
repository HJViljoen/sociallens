import { SiteNav } from '../_components/site-nav'
import { LeadForm } from '../lead-form'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'How Verbatim works',
  description:
    'Gather, analyse, deliver. Where Verbatim listens, how thousands of comments become a model of your market, and what lands in your inbox.',
}

// The specifics the home page leaves out, in three parts. Every mechanism on
// this page was checked against the pipeline as it runs (2026-09-06); the
// sample market is the same illustrative backpack category as the home page.
export default function HowItWorks() {
  return (
    <>
      <SiteNav variant="light" current="how-it-works" />
      <header className="hiw-head">
        <div className="wrap">
          <h1>They hear your name. <span>We hear the market.</span></h1>
          <p>Listening tools start from a keyword you register. Verbatim starts from the category: the comment threads, the Reddit threads and what’s said to camera around your kind of product, whether or not anyone types your name. Here is what happens, in three parts.</p>
          <div className="index">
            <a href="#gather"><span className="n">1</span><span><b>Gather</b><span>Where it listens, what it keeps, what it throws out.</span></span></a>
            <a href="#analyse"><span className="n">2</span><span><b>Analyse</b><span>How thousands of comments become a model of your market.</span></span></a>
            <a href="#deliver"><span className="n">3</span><span><b>Deliver</b><span>What you see, what lands in your inbox, what you send on.</span></span></a>
          </div>
        </div>
      </header>

      {/* 1 GATHER */}
      <section className="part g1" id="gather" aria-labelledby="g-h">
        <div className="wrap">
          <div className="part-head">
            <div className="big">1</div>
            <div>
              <h2 id="g-h">Gather. Where it listens.</h2>
              <p>Every week Verbatim goes out to four platforms and comes back with what people said around your category: the videos, the threads underneath them, and what was said out loud.</p>
            </div>
          </div>

          <div className="platforms">
            <div className="pf"><b>TikTok</b><ul><li>Videos found by search, and the comment thread under each</li><li>The platform’s caption track when there is one, transcribed otherwise</li></ul></div>
            <div className="pf"><b>Instagram</b><ul><li>Reels found by search, and the comments under each</li><li>The audio transcribed, so a spoken review counts</li></ul></div>
            <div className="pf"><b>YouTube</b><ul><li>Videos found by search, and the comment thread under each</li><li>The caption track, read alongside the comments</li></ul></div>
            <div className="pf"><b>Reddit</b><ul><li>Posts and comments in the communities where your category is discussed</li><li>Communities found per category, not hand-picked</li></ul></div>
          </div>
          <div className="also">
            <div><b>The news around it</b>Headlines about your brand, your competitors and the category, so a spike in the conversation can be read against what caused it.</div>
            <div><b>Your own accounts</b>Your public TikTok, Instagram and YouTube profiles, checked daily: followers, recent posts, and your audience’s replies.</div>
          </div>

          <div className="hiw-sub">
            <div>
              <h3>Three lists seed every search.</h3>
              <p className="body">Your brand, your competitors, and the category. Every video that comes back is sorted by who it’s actually about, and a video that names a lookalike brand is checked before it’s counted as yours.</p>
              <p className="fine">Competitor and category terms are search terms only. Attribution comes from the names, confirmed one video at a time.</p>
            </div>
            <div className="seed">
              <div className="lists">
                <div className="list"><b>Your brand</b><div className="chips"><span>Northline</span><span>Northline Packs</span></div></div>
                <div className="list"><b>Competitors</b><div className="chips"><span>Ridgeway</span><span>Trailform</span><span>Cairnline</span></div></div>
                <div className="list"><b>Category</b><div className="chips"><span>hiking backpack</span><span>40L pack</span><span>thru-hike gear</span></div></div>
              </div>
              <div className="arrow" aria-hidden="true"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg></div>
              <div className="buckets">
                <div className="bucket"><i style={{ background: 'var(--green)' }} /><div><b>You</b><span>Videos about your brand, and your own posts.</span></div></div>
                <div className="bucket"><i style={{ background: 'var(--orange)' }} /><div><b>Each competitor</b><span>Videos about them, named and confirmed.</span></div></div>
                <div className="bucket"><i style={{ background: '#C5CBD1' }} /><div><b>The rest of the category</b><span>Everything else. Usually most of it, and where the market talks without naming anyone.</span></div></div>
              </div>
            </div>
          </div>

          <div className="hiw-sub full">
            <div className="intro">
              <h3>Finding the communities.</h3>
              <p className="body">For Reddit, likely communities are proposed, then probed with a sample of real posts. One only goes live if it keeps talking about your category, and it drops out again when it goes quiet.</p>
            </div>
            <div className="gate communities">
              <div className="gate-row"><div><span style={{ fontWeight: 500 }}>r/ultralight</span><div className="why">12 recent posts probed, 9 about the category.</div><div className="ratio"><i style={{ width: '75%' }} /></div></div><span className="verdict keep">Active</span></div>
              <div className="gate-row"><div><span style={{ fontWeight: 500 }}>r/CampingGear</span><div className="why">12 recent posts probed, 5 about the category.</div><div className="ratio"><i style={{ width: '42%' }} /></div></div><span className="verdict keep">Active</span></div>
              <div className="gate-row"><div><span style={{ fontWeight: 500 }}>r/hiking</span><div className="why">12 recent posts probed, 2 about the category.</div><div className="ratio"><i style={{ width: '17%', background: 'var(--hair)' }} /></div></div><span className="verdict drop">Not used</span></div>
            </div>
          </div>

          <div className="hiw-sub flip">
            <div>
              <h3>Everything goes through the filter.</h3>
              <p className="body">Before a comment is analysed it passes three checks: is the video about your category, is the brand it names really the one it seems to be, and is the comment a real person actually saying something. Off-topic videos go, lookalike brands go, spam is set aside. Short comments stay. “too small” is an opinion.</p>
              <p className="fine">Anyone who asks to be removed is taken out within seven days and never gathered again.</p>
            </div>
            <div className="gate">
              <div className="gate-row"><div><span className="voice">“asked three shops and nobody could explain the sizing”</span><div className="why">On topic, from a real person, under a category video.</div></div><span className="verdict keep">Read</span></div>
              <div className="gate-row"><div><span className="voice">“too small”</span><div className="why">Short, but it’s a verdict on fit. Kept.</div></div><span className="verdict keep">Read</span></div>
              <div className="gate-row"><div><span className="voice">“🔥🔥🔥”</span><div className="why">No words. Flagged, never analysed.</div></div><span className="verdict flag">Flagged</span></div>
              <div className="gate-row"><div><span className="voice">“check my profile for the best deals”</span><div className="why">Link bait. Flagged.</div></div><span className="verdict flag">Flagged</span></div>
              <div className="gate-row"><div><span style={{ fontWeight: 500 }}>A video about a different “Northline”</span><div className="why">Lookalike brand name. Counted as the rest of the category, never as yours.</div></div><span className="verdict flag">Not yours</span></div>
            </div>
          </div>

        </div>
      </section>

      {/* 2 ANALYSE */}
      <section className="part" id="analyse" aria-labelledby="a-h">
        <div className="wrap">
          <div className="part-head">
            <div className="big">2</div>
            <div>
              <h2 id="a-h">Analyse. How it reads.</h2>
              <p>The analysis runs in passes, each one building on the last, and every pass keeps the quotes it stands on. Four stages turn thousands of comments into a model of your market you can act on.</p>
            </div>
          </div>

          <div className="steps">
            <div className="st">
              <div className="n">1</div>
              <div>
                <h4>Read each video with its thread.</h4>
                <p>What kind of video it is, how the audience received it, and everything people volunteer in the comments: pain points, questions, buying intent, objections, praise, the moment someone switched. The transcript is read too, so a spoken claim counts.</p>
                <p className="never"><b>Each insight keeps its exact quote.</b> A quote that doesn’t match the source word for word is dropped, and the insight goes with it.</p>
              </div>
              <div className="demo">
                <div className="row"><div><span className="voice">“asked three shops and nobody could explain the sizing”</span><div className="k">Matches the source comment.</div></div><span className="chip g">Kept · question</span></div>
                <div className="row"><div><span className="voice">“nobody at the shops could explain sizing”</span><div className="k">Paraphrased. Not what the person wrote.</div></div><span className="chip r">Dropped</span></div>
                <div className="row"><div><span className="voice">“the hip belt is the reason I’d never go back”</span><div className="k">Matches. Praise, with a switching signal.</div></div><span className="chip g">Kept · praise</span></div>
              </div>
            </div>

            <div className="st stack">
              <div className="n">2</div>
              <div>
                <h4>Find the themes, and keep them.</h4>
                <p>Insights are grouped by meaning within each bucket: yours, each competitor’s, the rest of the category. A theme only stands once enough independent people have raised it; below that it’s shown as an early signal and never acted on.</p>
                <p className="never"><b>Themes keep their identity week to week,</b> so gaining, fading and emerging mean something.</p>
              </div>
              <div className="demo">
                <div className="themes">
                  <div><b>Fit and sizing</b><span>412 conversations</span><br /><span className="up">gaining</span></div>
                  <div><b>Hip belt comfort</b><span>288 conversations</span><br /><span>steady</span></div>
                  <div><b>Zips and noise</b><span>143 conversations</span><br /><span className="up">emerging</span></div>
                  <div><b>Price vs the cheaper one</b><span>197 conversations</span><br /><span className="down">fading</span></div>
                  <div><b>Airline carry-on</b><span>37 conversations</span><br /><span className="up">emerging</span></div>
                  <div><b>Strap width</b><span className="early">Early signal</span></div>
                </div>
              </div>
            </div>

            <div className="st">
              <div className="n">3</div>
              <div>
                <h4>Compare you to the field.</h4>
                <p>With the themes in place, the buckets are read against each other: which topics each side owns, where the gaps are, what looks like a threat, and how sentiment differs between people talking about you and people talking about them.</p>
                <p className="never"><b>Sentiment is how the audience received each video,</b> shown as a share of conversations, never as a score.</p>
              </div>
              <div className="demo">
                <div className="cmp">
                  <span>Share of tracked videos</span><div><div className="bar you"><i style={{ width: '34%' }} /></div></div>
                  <span /><div><div className="bar them"><i style={{ width: '51%' }} /></div></div>
                  <span /><div><div className="bar cat"><i style={{ width: '100%' }} /></div></div>
                  <span>Theme they own</span><span>Durability on trail</span>
                  <span>Theme you own</span><span>Hip belt comfort</span>
                  <span>Gap</span><span>Sizing questions under your videos go unanswered. Under theirs, other owners answer.</span>
                </div>
              </div>
            </div>

            <div className="st stack">
              <div className="n">4</div>
              <div>
                <h4>Analyse the market.</h4>
                <p>From all of it: the kinds of person in the conversation and what moves each of them, the market insights, a short read, and ranked recommendations grounded in the quotes retrieved for them. A separate check compares what you say in your own videos with what the audience hears back.</p>
                <p className="never"><b>Everything is said in calibrated words.</b> A count of conversations and a plain label: strong evidence or early signal. No scores, no magnitudes the data can’t back.</p>
              </div>
              <div className="demo">
                <div className="kv"><span className="k">Profile</span><span><b>The long-trip planner</b> · 41% of the conversation</span></div>
                <div className="kv"><span className="k">Wants</span><span>One bag for ten days that doesn’t punish them on day six.</span></div>
                <div className="kv"><span className="k">You say</span><span>“Built for ten-day trips.”</span></div>
                <div className="kv"><span className="k">They hear</span><span><span className="chip a">Contradicted</span> The ten-day question is answered by a competitor’s owners, not yours.</span></div>
                <div className="row"><span>Sizing confusion</span><span className="chip g">Strong evidence</span></div>
                <div className="row"><span>Strap width</span><span className="chip">Early signal</span></div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 3 DELIVER */}
      <section className="part d3" id="deliver" aria-labelledby="d-h">
        <div className="wrap">
          <div className="part-head">
            <div className="big">3</div>
            <div>
              <h2 id="d-h">Deliver. What you see.</h2>
              <p>The model lives in the app. The brief comes to you. And whatever someone else in the company needs goes out as a report with your name on it.</p>
            </div>
          </div>

          <div className="hiw-sub full">
            <div className="intro">
              <h3>The app.</h3>
              <p className="body">Every page is one view of the same model, and every claim on every page opens to the conversations behind it.</p>
            </div>
            <div className="pages">
              <div className="pg"><b>Dashboard</b><span>Where you stand this week, the short brief, and what changed since last time.</span></div>
              <div className="pg"><b>Market</b><span>The recommendations, the market insights, what you say versus what they hear, and the news around it.</span></div>
              <div className="pg"><b>Voice</b><span>The theme map, what’s gaining and fading, the phrases people use, and the quotes.</span></div>
              <div className="pg"><b>Consumer profile</b><span>The kinds of people in the conversation and what moves each of them.</span></div>
              <div className="pg"><b>Competitive</b><span>Standings, the face-off against each competitor, and the findings behind them.</span></div>
              <div className="pg"><b>Content</b><span>Which hooks and formats work in your category, the questions under your videos nobody answered, and your own accounts.</span></div>
              <div className="pg"><b>Analyst</b><span>Ask anything. Hand it a plan.</span></div>
              <div className="pg"><b>Studio</b><span>Build reports, your own or from a template, and schedule where they go.</span></div>
              <div className="pg"><b>Reports</b><span>Everything that’s been built and everything that’s been sent.</span></div>
            </div>
          </div>

          <div className="hiw-sub">
            <div>
              <h3>The weekly digest.</h3>
              <p className="body">It goes out after the run, to the people you list. What changed leads. Then a short cover paragraph, the week’s numbers as tables, a link to the full report, and the PDF attached.</p>
              <p className="fine">The email itself is never stored. Only who it went to, and when.</p>
            </div>
            <div className="mail">
              <div className="mh"><b>Your market this week</b><span>From Verbatim, Monday 06:00. To 4 people.</span></div>
              <div className="mb">
                <div className="d"><i className="up">↑</i><span>Fit and sizing questions doubled after two creator reviews. 63 conversations asked, nobody answered.</span></div>
                <div className="d"><i className="up">↑</i><span>Zips are the new complaint, 143 conversations, rising for the second week.</span></div>
                <div className="d"><i className="down">↓</i><span>Rain cover complaints fell for the second week.</span></div>
                <p className="cover">The market spent the week on fit. Two creator reviews of the new range turned sizing into the biggest theme, and the questions are landing under your videos, where nobody is answering them yet.</p>
                <div className="foot">Open the full report · PDF attached</div>
              </div>
            </div>
          </div>

          <div className="hiw-sub full dark">
            <div className="intro">
              <h3>Reports for whoever is in the room.</h3>
              <p className="body">Five starters, or your own. Each one is built from the same model, written for the audience you name, with your company’s name on every page. Landscape, one section per page, so it drops straight into a meeting.</p>
            </div>
            <div>
              <div className="reports">
                <div className="rp"><b>Weekly digest</b><span>the team</span></div>
                <div className="rp"><b>Monthly marketing review</b><span>head of marketing</span></div>
                <div className="rp"><b>Leadership one-pager</b><span>leadership</span></div>
                <div className="rp"><b>Sales: objections and competitors</b><span>sales</span></div>
                <div className="rp"><b>Content: what to make next</b><span>content team</span></div>
              </div>
              <div className="ship">
                <div><b>Scheduled</b>Every update, or the first update of the month. Up to 25 recipients. PDF attached. Review before it sends, if you want to.</div>
                <div><b>Shared by link</b>No login. Thirty days by default, or 7, 90, never. One click to revoke. Optional password. Never indexed.</div>
                <div><b>Yours</b>Your company on every page, written for anyone you name. Verbatim in the footer.</div>
              </div>
            </div>
          </div>

          <div className="hiw-sub flip">
            <div>
              <h3>A link that works without an account.</h3>
              <p className="body">Send it to the CEO, the agency, the board. They open the report exactly as you built it, evidence popovers included, and you can see who opened it.</p>
            </div>
            <div className="link-mock" aria-hidden="true">
              <div className="url">verbatimintel.com/r/7k2m…q9d</div>
              <div className="opts"><span>Expires: 7 days</span><span className="on">30 days</span><span>90 days</span><span>Never</span></div>
              <div className="opts"><span className="on">Password</span><span>Revoke</span><span>Opened 3 times</span></div>
            </div>
          </div>
        </div>
      </section>

      <section className="honest" aria-labelledby="honest-h">
        <div className="wrap">
          <h2 id="honest-h" className="lead">Two different tools.</h2>
          <div className="diff">
            <div className="col-l">
              <b>A listening tool</b>
              <ul>
                <li>Starts from your name.</li>
                <li>Reads what’s said when you’re mentioned.</li>
                <li>Tells you when you come up.</li>
                <li>Returns a dashboard for you to make sense of.</li>
              </ul>
            </div>
            <div className="col-v">
              <b>Verbatim</b>
              <ul>
                <li>Starts from your category.</li>
                <li>Reads the threads underneath, where people say what they really think.</li>
                <li>Tells you what the market wants, and what changed.</li>
                <li>Returns a market already analysed: a brief, the insights, and an analyst you can question.</li>
              </ul>
            </div>
          </div>
          <p className="body diff-line">If you need to know the moment you’re mentioned, choose a listening tool. If you need to understand your market, choose Verbatim.</p>
        </div>
      </section>

      <section className="hiw-close" id="early-access" aria-labelledby="close-h">
        <div className="wrap">
          <h2 id="close-h">Stop listening for your name.</h2>
          <p>Verbatim runs every week on a real brand’s market today. A few more brands join this quarter.</p>
          <LeadForm />
        </div>
      </section>

    </>
  )
}
