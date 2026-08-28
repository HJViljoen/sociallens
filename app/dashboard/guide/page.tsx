import Link from 'next/link'
import { GLOSSARY, type GlossaryKey } from '@/lib/calibration'
import { SettingsFrame } from '@/components/settings-frame'
import { ListSearch } from '@/components/shell/list-search'

// The Guide (component-map §4b): one section per page — what it tells you,
// how to read it, what to do with it each week, what it can't tell you. The
// "how to read it" definitions are the calibrated GLOSSARY in
// lib/calibration.ts, the same source the "How to read this page" pills use,
// so there is one wording for every label. Every behavioural claim here must
// match the code (AGENTS.md); when in doubt this page says less, not more.

interface Section {
  id: string
  title: string
  href: string
  tells: string
  read: GlossaryKey[]
  weekly: string[]
  cannot: string[]
}

const SECTIONS: Section[] = [
  {
    id: 'dashboard', title: 'Dashboard', href: '/dashboard',
    tells: 'Where you stand this update: what was tracked, the executive brief, audience sentiment, your share of the tracked conversation, the themes your market is talking about, movement since your first update, the top recommendation, and your own accounts.',
    read: ['conversations', 'sentiment', 'new'],
    weekly: ['Read the brief first — it is written from this update’s counted figures.', 'Click the underlined recommendation to see the voices behind it before deciding anything.', 'Check the movement row: arrows only appear when a change clears the band, so a missing arrow means "no clear change", not "no data".'],
    cannot: ['It samples the public conversation around your tracked names; it is not every comment on the internet.', 'Model confidence is shown as a word, never a number — there is no score to compare week to week.'],
  },
  {
    id: 'market', title: 'Market Intelligence', href: '/dashboard/market',
    tells: 'What to do: this update’s recommendations ordered by evidence, the key insights behind them, the short read, what you say versus what the audience hears, what other people’s videos say about you, and the news around your names.',
    read: ['strong_evidence', 'early_signal', 'act_now', 'plan_next', 'worth_considering', 'say_vs_hear', 'about_you', 'news'],
    weekly: ['Start at Recommendations, top row: "Act now" is the single best-grounded action this update.', 'Open an item to see how many conversations and voices ground it, on which platforms, and read the quotes — then follow "See all the voices" into Voice of Customer.', 'Use "Say vs hear" to check your own claims against the conversation; "Not talked about" means silence, not disagreement.'],
    cannot: ['Recommendations are grounded in what people said, not in your sales data — treat them as evidence, not instruction.', '"In the news" is context beside the conversation, never claimed as the cause of anything measured.'],
  },
  {
    id: 'voice', title: 'Voice of Customer', href: '/dashboard/voice',
    tells: 'What they are saying: the conversation by theme, with each block sized by the number of conversations, tinted by whose audience is talking; the selected theme in full beside the map; what is gaining and fading; the phrases your customers use; and their mood.',
    read: ['conversations', 'dominant', 'widespread', 'recurring', 'early_signal', 'new'],
    weekly: ['Switch audience (yours · a competitor’s · the category) and the category tabs inside the map to narrow the conversation.', 'Click a block to read the theme beside the map: its reach within its group, its history across updates, and the voices behind it.', 'Borrow the language — the phrases are verbatim, in your customers’ words.'],
    cannot: ['A theme is confirmed only when heard in more than one conversation; single mentions are kept for the record but never headline.', 'Demographic evidence is counted, never quoted.'],
  },
  {
    id: 'profile', title: 'Consumer Profile', href: '/dashboard/profile',
    tells: 'Who is talking: the kinds of person the conversation contains, drawn from everything the analysis already reads, with the evidence for each.',
    read: ['conversations'],
    weekly: ['Use it as the "who" behind the themes when you brief creative or plan a campaign.', 'Expect it to appear only once a few kinds of person are clearly distinguishable in the data — an empty profile is honest, not broken.'],
    cannot: ['It describes the people who comment publicly on the tracked conversation, not your customer base.'],
  },
  {
    id: 'competitive', title: 'Competitive Intel', href: '/dashboard/competitive',
    tells: 'Where you stand against each competitor: the face-off (videos, comments, share, engagement, sentiment, themes — each row shown only when it can be counted on both sides), share of the tracked conversation over time, and the cross-brand findings with what each competitor’s audience says.',
    read: ['conversations', 'sentiment'],
    weekly: ['Pick a competitor in the list to see the face-off and the share line; the full comparison, including the wider category, sits below.', 'Read the findings by kind — where you lead, threats, content gaps — and open one for the competitor audience’s own words.', 'Findings marked "thin" are drawn from few videos: a hint, not a finding.'],
    cannot: ['Share is share of the tracked conversation by videos, not market share.', 'A finding about a competitor quotes that competitor’s audience, never yours.'],
  },
  {
    id: 'videos', title: 'Content', href: '/dashboard/videos',
    tells: 'What content works and who to answer: hooks and formats that beat this update’s median, the reply inbox (comments worth answering, by intent), the field this update, the top voices, and your own accounts.',
    read: ['conversations'],
    weekly: ['Work the inbox: buying signals first, then questions; "Reply →" opens the comment where the platform allows it, otherwise the post.', 'Compare hooks and formats against the median before planning next week’s posts.', 'Open "All videos" to sort and filter every video this update.'],
    cannot: ['Hooks are read from captions, transcripts where captured, and the conversation — never from the footage itself.', 'The inbox is a ranked pick within this update’s window, not everything said.'],
  },
  {
    id: 'agent', title: 'Verbatim Agent', href: '/dashboard/agent',
    tells: 'Bring your own question or document: the agent answers from what your customers actually said — answer first, proof attached — and says so when the data cannot speak.',
    read: ['conversations', 'strong_evidence'],
    weekly: ['Paste a brief, a plan or a claim; each statement in it is checked against the conversation and marked supported, contradicted, or not talked about.', 'Ask the question you are arguing about in the meeting — the answer comes with the quotes.'],
    cannot: ['It cannot invent evidence: an honest "we don’t have this" is a real answer.', 'Chats are visible to your whole workspace for now.'],
  },
  {
    id: 'reports', title: 'Reports', href: '/dashboard/reports',
    tells: 'The archive of every update’s report — the email as it was sent, readable here and linked into the pages it came from.',
    read: [],
    weekly: ['If you only look once a week, this is the page: what changed since the last update, with the numbers behind it.'],
    cannot: ['Reports are stored per update; nothing is regenerated after the fact.'],
  },
  {
    id: 'settings', title: 'Settings', href: '/dashboard/settings',
    tells: 'What is tracked for your workspace (brand, competitor and category terms, platforms, your own accounts), how often the update runs and who receives it, what Verbatim reads from and where reports go, your plan, and your team.',
    read: [],
    weekly: ['Keep the competitor list and the recipient list current — a teammate who joins by invite is added to the report automatically.', 'Owners and admins can change settings; members see them read-only.'],
    cannot: ['Search terms, platforms and analysis depth are set with you at onboarding — they drive cost and quality, so they are changed by us on request, not from this page.'],
  },
]

export default function GuidePage() {
  return (
    <SettingsFrame active="guide" title="Guide" context="how each page works, and how to read it" contentTitle="Every page, in order" contentMeta={`${SECTIONS.length} pages`}>
      <div className="flex flex-col gap-4">
        <ListSearch scope="guide-sections" placeholder="Search the guide…" />
        <div id="guide-sections" className="flex flex-col gap-3">
          {SECTIONS.map((s) => (
            <section key={s.id} id={s.id} data-search={`${s.title} ${s.tells} ${s.weekly.join(' ')} ${s.cannot.join(' ')} ${s.read.map((k) => GLOSSARY[k][0]).join(' ')}`.toLowerCase()} className="scroll-mt-4 rounded-md bg-inner px-4 py-3.5">
              <div className="flex items-baseline justify-between gap-3">
                <h3 className="text-[14px] font-semibold">{s.title}</h3>
                <Link href={s.href} className="shrink-0 text-[12px] font-medium hover:underline">Open the page →</Link>
              </div>
              <p className="mt-1.5 text-[12.5px] leading-[1.55] text-secondary-foreground">{s.tells}</p>
              {s.read.length > 0 && (
                <div className="mt-3">
                  <p className="mb-1 text-[10.5px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">How to read it</p>
                  <dl className="flex flex-col gap-1">
                    {s.read.map((k) => (
                      <div key={k} className="flex gap-2 text-[12px] leading-[1.45]">
                        <dt className="shrink-0 font-semibold text-foreground">{GLOSSARY[k][0]}</dt>
                        <dd className="text-secondary-foreground">— {GLOSSARY[k][1]}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              )}
              <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
                <div>
                  <p className="mb-1 text-[10.5px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">What to do with it each week</p>
                  <ul className="flex flex-col gap-1">
                    {s.weekly.map((w, i) => <li key={i} className="flex gap-2 text-[12px] leading-[1.45]"><span className="mt-[7px] size-1 shrink-0 rounded-full bg-you" aria-hidden />{w}</li>)}
                  </ul>
                </div>
                <div>
                  <p className="mb-1 text-[10.5px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">What it can’t tell you</p>
                  <ul className="flex flex-col gap-1">
                    {s.cannot.map((w, i) => <li key={i} className="flex gap-2 text-[12px] leading-[1.45] text-secondary-foreground"><span className="mt-[7px] size-1 shrink-0 rounded-full bg-cat" aria-hidden />{w}</li>)}
                  </ul>
                </div>
              </div>
            </section>
          ))}
          <p className="px-1 text-[11px] text-muted-foreground">Every label in ‘how to read it’ is assigned by a fixed rule from counted data — never worded by the AI.</p>
        </div>
      </div>
    </SettingsFrame>
  )
}
