// The five playbooks: task-shaped articles that walk a reader through doing
// one job on one Verbatim surface, step by step, ending in early access.
// Spine and copy contract: /Users/heinrichviljoen/.claude/plans/verbatim-playbooks-plan.md
// (§1, §3) and .agents/product-marketing.md. Numbers are imported from
// sample.ts wherever sample.ts holds them as values; a handful of figures
// live only inside sample.ts prose (analyst evidence sources, document-check
// claim text) and are restated here as plain numbers, matched against that
// prose, never invented.
import { themes, faceOff, personas, streamQuotes, type StreamQuote } from './sample'

// ─────────────────────────── small shared mocks ───────────────────────────
// Not part of the home page; built for the playbooks only.

/** One row in the reply inbox: an unanswered comment, tagged by what it is. */
export interface ReplyInboxRow {
  text: string
  intent: 'question' | 'buying' | 'objection'
  src: string
}

// Four rows, in intent order question / buying / objection / question, the
// order the plan's Content playbook panel names. Rows 1 and 4 reuse
// streamQuotes verbatim (same comment, same source); row 2 is written for
// the inbox in the same voice, row 3 reuses streamQuotes[5].
export const replyInboxRows: ReplyInboxRow[] = [
  { text: streamQuotes[17].text, intent: 'question', src: streamQuotes[17].src },
  { text: 'still torn between this and the cheaper one, need to order before the trip', intent: 'buying', src: 'Under a competitor’s YouTube, three days ago.' },
  { text: streamQuotes[5].text, intent: 'objection', src: streamQuotes[5].src },
  { text: streamQuotes[8].text, intent: 'question', src: streamQuotes[8].src },
]

/** A hook or post format that is working in the category this week. */
export interface FormatRow {
  format: string
  conversations: number
}

// The two citation counts come from analyst[0]'s evidence sources (the
// sizing-video and comparison-video citation counts written into that
// evidence's src prose in sample.ts).
export const formatRows: FormatRow[] = [
  { format: 'The sizing video', conversations: 27 },
  { format: 'The ten-day comparison', conversations: 19 },
]

/** One post in the five-post weekly content plan. */
export interface ContentPlanRow {
  post: string
  note: string
}

export const contentPlan: ContentPlanRow[] = [
  { post: 'Sizing answer', note: 'Answer torso length in the first comment under every fit video.' },
  { post: 'Hip belt', note: `${themes[1].conversations} conversations, none of them under your own videos.` },
  { post: 'Zip fix statement', note: `${themes[5].conversations} conversations this week, emerging.` },
  { post: 'Ten-day comparison', note: 'The format the category already watches before buying.' },
  { post: 'Warranty story', note: 'One replacement, told straight.' },
]

/** One row in the sales objection sheet: what they say, how to answer it. */
export interface ObjectionRow {
  objection: string
  answer: string
}

export const objectionSheet: ObjectionRow[] = [
  { objection: 'Durability, the zip', answer: 'The fix, and the warranty story: one replacement, no questions asked.' },
  { objection: 'Price', answer: `${themes[4].conversations} conversations mention price, and every one names durability or the zip beside it.` },
  { objection: 'Sizing', answer: 'The sizing answer: torso length, in the first comment under every fit video.' },
]

/** One row of the say-vs-hear comparison: a line you say, what the market does with it. */
export interface SayHearRow {
  claim: string
  verdict: 'echoed' | 'pushedBack'
  detail: string
}

// ────────────────────────────── visual unions ──────────────────────────────
// Rendered by one PlaybookVisual component (Session B) that reuses the home
// page's mocks. Each variant names the sample.ts slice it draws from; where
// a variant carries no payload, the component renders a fixed shape from a
// fixed sample.ts source.

/** The single "what you're looking at" panel for an article. */
export type PanelKind =
  | { kind: 'themeMap' } // the desktop theme map, sized by conversations, from `themes`
  | { kind: 'replyInbox' } // the reply inbox, from `replyInboxRows`
  | { kind: 'faceOff' } // the face-off bars, from `faceOff`
  | { kind: 'document' } // the Q4 launch brief with claim marks, from `analyst[2]`
  | { kind: 'profile'; persona: 0 | 1 | 2 } // a persona card, from `personas[persona]`

/** One step's "what you'll see" visual. */
export type StepVisual =
  | { kind: 'brief'; lines: number[] } // one or more `brief` rows, in order given
  | { kind: 'quote'; quote: StreamQuote } // one streaming-quote card
  | { kind: 'sayHear'; rows: SayHearRow[] } // say-vs-hear rows, written inline per step
  | { kind: 'inboxRows'; rows: number[] } // a subset of `replyInboxRows`, by index
  | { kind: 'formatRows' } // the shared `formatRows` array
  | { kind: 'contentPlan' } // the shared `contentPlan` array
  | { kind: 'objectionSheet' } // the shared `objectionSheet` array
  | { kind: 'standings' } // static Northline / Ridgeway / category row; no payload
  | { kind: 'faceOffRows' } // all rows of `faceOff`
  | { kind: 'faceOffOwns' } // the `faceOffOwns` "theme they own / you own" pair
  | { kind: 'analystAnswer'; item: 0 | 1; evidence: number } // `analyst[item]`'s answer line + one evidence card
  | { kind: 'claimRow'; claim: number } // one row of `analyst[2].claims`, by index
  | { kind: 'fileChip' } // the `analyst[2]` file chip (name + claims-found count)
  | { kind: 'profile'; persona: 0 | 1 | 2 } // a persona card, from `personas[persona]`
  | { kind: 'phrasesAndQuote'; persona: 0 | 1 | 2; quote: StreamQuote } // a persona's phrase chips + one quote card
  | { kind: 'reportCover'; cover: number } // `reportCovers[cover]` alone
  | { kind: 'reportCoverLink'; cover: number } // `reportCovers[cover]` plus a share-link mock

export interface Playbook {
  slug: string
  title: string // the job, as the reader says it
  // Five product surfaces map one-to-one to the five playbooks. 'voice' is
  // added to the plan's sketch (market/content/competitive/analyst/studio)
  // because §3.5's primary surface is the Voice page (phrases, quotes); the
  // plan's sketch omitted it, and Studio there is the send-on only.
  surface: 'market' | 'content' | 'competitive' | 'analyst' | 'studio' | 'voice'
  audience: string // "head of marketing", "content lead", ...
  readMinutes: number
  summary: string // one sentence for the index card and meta description
  usually: string[] // 2 paragraphs
  panel: PanelKind
  panelCaption: string
  steps: { verb: string; body: string; show: StepVisual }[] // 3–5
  sendOn: { kind: 'report' | 'link' | 'answer'; title: string; body: string; template?: string }
  limits: string[] // 2–3 bullets
  askLine: string // one line above the closing band
}

export const playbooks: Playbook[] = [
  // ───────────────────────────── 3.1 Market ─────────────────────────────
  {
    slug: 'plan-a-campaign',
    title: 'Plan a campaign around what the market actually argues about',
    surface: 'market',
    audience: 'head of marketing',
    readMinutes: 6,
    summary: 'Build the Q4 campaign on the themes the market is already arguing about, with the evidence attached, instead of on the brief’s guesses.',
    usually: [
      'The brief usually starts from last quarter’s message and a hunch about the objection. Someone remembers a customer call about price, and that becomes the line the whole campaign leads with.',
      'The research behind it is a survey of people who already bought, answering questions the brief chose to ask. Nobody checks what the wider market is arguing about this week, so the campaign launches answering an objection nobody in the market is actually making.',
    ],
    panel: { kind: 'themeMap' },
    panelCaption: `What the category talked about this week, sized by conversations. ${themes[0].label} is gaining at ${themes[0].conversations}. ${themes[5].label} is emerging at ${themes[5].conversations}.`,
    steps: [
      {
        verb: 'Read the short read first.',
        body: 'Start with the one paragraph on the Market page that says what moved this week, before the theme map. It reads like the brief you’d want handed to you before a meeting: what’s up, what’s down, what’s new.',
        show: { kind: 'brief', lines: [0, 1, 2] },
      },
      {
        verb: 'Open the theme that’s gaining.',
        body: `${themes[0].label} is the biggest mover this week, at ${themes[0].conversations} conversations. Open it and read past the count to the comment underneath it: someone asked three shops and nobody could explain the sizing.`,
        show: { kind: 'quote', quote: streamQuotes[1] },
      },
      {
        verb: 'Check what you say against what they hear.',
        body: '‘Built for ten-day trips’ gets pushed back: long-trip planners are deciding on a comparison you’re not part of. ‘The most comfortable hip belt’ gets echoed, in 41 conversations, none of them under your own videos.',
        show: {
          kind: 'sayHear',
          rows: [
            { claim: 'Built for ten-day trips', verdict: 'pushedBack', detail: 'Long-trip planners are deciding on a comparison you’re not part of.' },
            { claim: 'The most comfortable hip belt', verdict: 'echoed', detail: '41 conversations, none of them under your own videos.' },
          ],
        },
      },
      {
        verb: 'Take the recommendation, not the theme.',
        body: 'The Market page doesn’t stop at the theme, it ranks the recommendation: put a sizing answer in the first comment under every fit video, and lead the campaign with the hip belt before the competitor gets there first.',
        show: { kind: 'brief', lines: [4] },
      },
    ],
    sendOn: {
      kind: 'report',
      title: 'Monthly marketing review',
      body: 'Schedule it for the first update of the month, so the campaign gets re-checked against the market while it’s running, not after.',
      template: 'Monthly marketing review',
    },
    limits: [
      'A theme below the evidence floor is an early signal, not a campaign brief.',
      'The market is what people said in public, not a panel you can query on demand.',
      'If the conversation is silent on your message, the say-vs-hear row says so, and that silence is the answer.',
    ],
    askLine: 'Run this on your own category before the next campaign brief.',
  },

  // ──────────────────────────── 3.2 Content ─────────────────────────────
  {
    slug: 'plan-a-week-of-content',
    title: 'Plan a week of content from the questions nobody answered',
    surface: 'content',
    audience: 'content lead / social manager',
    readMinutes: 5,
    summary: 'Turn the unanswered questions under your videos and your competitors’ into next week’s posts, in the order the market asked them.',
    usually: [
      'The content calendar usually comes from a trend list and whatever performed last month. Someone skims the comments on the brand’s own posts for a hook, and that’s as far as the research goes.',
      'Nobody reads the questions sitting under a competitor’s video, because nobody on the team is watching there. Forty people ask about torso length across three different videos, and the week’s content is about colours.',
    ],
    panel: { kind: 'replyInbox' },
    panelCaption: `${faceOff[2].you.text} questions went unanswered this week, across your own videos and your competitors’, sorted by what they are: a question, a buying signal, an objection.`,
    steps: [
      {
        verb: 'Start with the questions, not the hooks.',
        body: 'Filter the reply inbox to questions before you look at anything else. That’s the demand side of next week’s content, already sorted by what people actually asked.',
        show: { kind: 'inboxRows', rows: [0, 3] },
      },
      {
        verb: 'Answer the one asked most, where it was asked.',
        body: 'Forty comments ask about torso length under your own TikTok, and not one has an answer. That’s the brief for next week’s sizing video, not a reply owed to one comment.',
        show: { kind: 'quote', quote: streamQuotes[17] },
      },
      {
        verb: 'Steal the format that works.',
        body: `Look at what’s working in the category this week, not just on your own channel. A sizing video is cited in ${formatRows[0].conversations} conversations, more than the brand’s own size guide. A ten-day comparison carries ${formatRows[1].conversations}. Both are formats you can make.`,
        show: { kind: 'formatRows' },
      },
      {
        verb: 'Reply before you post.',
        body: 'The buying signals in the inbox don’t wait for the content calendar. Answer them in the thread today, then let next week’s post do the rest of the work.',
        show: { kind: 'inboxRows', rows: [1] },
      },
      {
        verb: 'Plan the week from the list.',
        body: 'Five posts, in the order the market asked for them: the sizing answer, the hip belt nobody’s talking about under your own videos, a statement on the zip complaint before it grows further, the ten-day comparison, and a warranty story.',
        show: { kind: 'contentPlan' },
      },
    ],
    sendOn: {
      kind: 'report',
      title: 'Content: what to make next',
      body: 'The plan travels as the report, every update, to the content team, with the quotes behind each post attached.',
      template: 'Content: what to make next',
    },
    limits: [
      'The inbox is what people asked in public, not what they said in a DM.',
      'Replies are yours to write. Verbatim drafts nothing in your name.',
      'A format that worked once isn’t a rule yet. Wait for it to repeat.',
    ],
    askLine: 'Plan next week from what your audience actually asked.',
  },

  // ─────────────────────────── 3.3 Competitive ──────────────────────────
  {
    slug: 'prepare-for-the-leadership-meeting',
    title: 'Walk into the leadership meeting with the market on one page',
    surface: 'competitive',
    audience: 'head of marketing / founder',
    readMinutes: 6,
    summary: 'Show where you stand against the closest competitor and the category, with counts instead of sentiment scores, on a page leadership can read in two minutes.',
    usually: [
      'The deck usually gets assembled from platform analytics and a listening tool’s mention count. The competitor slide is one slide of anecdote, built from whatever someone on the team happened to notice.',
      'Someone in the room asks why you’re losing the long-trip buyer, and the answer is a shrug, because every number on the slide is about you, and the question is about them.',
    ],
    panel: { kind: 'faceOff' },
    panelCaption: `Share of tracked videos: ${faceOff[0].you.text} you, ${faceOff[0].them.text} Ridgeway, ${faceOff[0].cat?.text} the rest of the category. Sentiment towards you: ${faceOff[1].you.text}, against Ridgeway’s ${faceOff[1].them.text}. Unanswered questions this week: ${faceOff[2].you.text} against Ridgeway’s ${faceOff[2].them.text}.`,
    steps: [
      {
        verb: 'Pick the competitor the meeting is about.',
        body: 'Not the whole category, one name: Ridgeway, the one winning the long-trip buyer. The face-off is built to answer one competitor at a time, the way the meeting will actually ask about them.',
        show: { kind: 'standings' },
      },
      {
        verb: 'Read the face-off as counts.',
        body: 'Share of the conversation, sentiment, unanswered questions: three rows, all counts, none of them a survey score. It’s the shape leadership already reads on every other slide, measuring the market instead of your own funnel.',
        show: { kind: 'faceOffRows' },
      },
      {
        verb: 'Name the theme they own and the one you own.',
        body: 'Ridgeway owns durability on the trail, the story their owners tell each other unprompted. You own the hip belt, the reason people say they’d never go back to the old one. Naming both on the same slide is the honest version of the competitor slide.',
        show: { kind: 'faceOffOwns' },
      },
      {
        verb: 'Ask the analyst the question you’ll be asked.',
        body: 'Which of our competitors is winning the long-trip buyer, and why? The answer is Ridgeway, on durability stories told by people who own both bags, and it comes with the evidence attached, not a guess for the room.',
        show: { kind: 'analystAnswer', item: 1, evidence: 0 },
      },
      {
        verb: 'Build the one-pager and share the link.',
        body: 'One section, two pages: the leadership one-pager takes the same evidence and puts it on a page readable in the two minutes leadership actually has. Share it by link, thirty days, no login.',
        show: { kind: 'reportCoverLink', cover: 2 },
      },
    ],
    sendOn: {
      kind: 'link',
      title: 'Leadership one-pager',
      body: 'One page, and the evidence popovers still work in the link. It expires in thirty days, and revoking it is one click.',
      template: 'Leadership one-pager',
    },
    limits: [
      'Share is share of tracked videos, not of the whole web.',
      'Sentiment is how the audience received each video, never a survey score.',
      'A change only counts once it clears a band, so one quiet week isn’t a trend.',
    ],
    askLine: 'Bring the market to the next meeting instead of the deck.',
  },

  // ───────────────────────────── 3.4 Analyst ────────────────────────────
  {
    slug: 'check-a-brief-before-it-goes-out',
    title: 'Check a brief against the market before it goes out',
    surface: 'analyst',
    audience: 'brand / marketing manager',
    readMinutes: 5,
    summary: 'Paste the launch brief and get every claim in it marked supported, contradicted or silent, with the conversations behind each.',
    usually: [
      'The brief usually gets reviewed by the people who wrote it. Its claims come from the last research deck, and nobody has an afternoon free to check them against what the market is saying now.',
      '‘Price is the main objection at checkout’ survives another quarter because nobody can disprove it in the meeting. The campaign launches leading with value, in a market that’s arguing about zips.',
    ],
    panel: { kind: 'document' },
    panelCaption: 'The Q4 launch brief, checked line by line: nine claims, four the market backs, one it contradicts, four it has nothing to say about.',
    steps: [
      {
        verb: 'Paste the brief as it is.',
        body: 'No reformatting, no summarising first. Paste the brief the way it was written, and the analyst finds the claims inside it on its own: nine, in this one.',
        show: { kind: 'fileChip' },
      },
      {
        verb: 'Read the contradicted claim first.',
        body: `‘The main objection at checkout is price’ is the one the market pushes back on. Durability and the zip are driving the objection, in ${themes[5].conversations} conversations this week.`,
        show: { kind: 'claimRow', claim: 1 },
      },
      {
        verb: 'Take the supported claims further.',
        body: `Sizing confusion is bigger than the brief assumes: ${themes[0].conversations} conversations, most of them nowhere near a FAQ page.`,
        show: { kind: 'claimRow', claim: 2 },
      },
      {
        verb: 'Leave the silent ones alone.',
        body: 'Colours and the creator placements: the market has nothing to say about either, and the analyst won’t invent a view just to fill the row.',
        show: { kind: 'claimRow', claim: 4 },
      },
      {
        verb: 'Ask the follow-up.',
        body: '‘We’re about to spend the Q4 budget on creator placements. Who does our audience actually listen to?’ Three creators, and none of them are on the current list.',
        show: { kind: 'analystAnswer', item: 0, evidence: 0 },
      },
    ],
    sendOn: {
      kind: 'answer',
      title: 'The checked brief',
      body: 'Export the checked brief as a PDF, marks and all, with the evidence behind every claim, and send it to whoever wrote it.',
    },
    limits: [
      'A claim the conversation doesn’t speak to stays unmarked. That’s the point, not a gap.',
      'The analyst never invents a quote to fill a silent row.',
      'It reads the conversation around your category, not your sales data.',
    ],
    askLine: 'Check your next brief against your own market.',
  },

  // ────────────────────────────── 3.5 Voice ─────────────────────────────
  {
    slug: 'write-objections-in-the-markets-words',
    title: 'Write the sales objections in the market’s own words',
    surface: 'voice',
    audience: 'founder / sales lead',
    readMinutes: 6,
    summary: 'Build the objection sheet from what people actually say when they choose the other brand, and give sales the words, not the summary.',
    usually: [
      'Objections usually come from the sales team’s memory and a battlecard written a year ago. The language on it is the company’s own, polished in a meeting room.',
      'A rep answers price, because that’s what the battlecard says, while the buyer actually meant the zip broke on the one they had before.',
    ],
    panel: { kind: 'profile', persona: 1 },
    panelCaption: `The upgrader who got burned: ${personas[1].share}% of the conversation, in their own words: ${personas[1].talk.join(', ')}.`,
    steps: [
      {
        verb: 'Find the people who left.',
        body: 'The upgrader who got burned is the one to start with: paid more once, and the cheap one lasted longer, so proof is what stops them, not price.',
        show: { kind: 'profile', persona: 1 },
      },
      {
        verb: 'Take the phrases, not the paraphrase.',
        body: 'The Voice page keeps the actual words: held up better, did not expect, sold mine. One buyer put it plainly: they’d had both for a year, and the cheaper one held up better on the trail, which they did not expect.',
        show: { kind: 'phrasesAndQuote', persona: 1, quote: streamQuotes[2] },
      },
      {
        verb: 'Pair each objection with the theme you own.',
        body: 'Durability is the theme Ridgeway owns. The hip belt is yours, cited in 41 conversations, none of them under your own videos. Every objection pairs with a theme somewhere; find yours before you answer theirs.',
        show: { kind: 'faceOffOwns' },
      },
      {
        verb: 'Write the answer in their register.',
        body: `Three pairs: durability and the zip get the fix and the warranty story. Price gets the real number: ${themes[4].conversations} conversations mention it, and every one names durability or the zip beside it. Sizing gets the sizing answer, in their words, not yours.`,
        show: { kind: 'objectionSheet' },
      },
      {
        verb: 'Send it monthly.',
        body: 'Sales: objections and competitors goes out on the first update of the month, straight to the sales lead, with the quotes behind every line.',
        show: { kind: 'reportCover', cover: 3 },
      },
    ],
    sendOn: {
      kind: 'report',
      title: 'Sales: objections and competitors',
      body: 'The sheet goes out as your own work, with the quotes behind every objection attached underneath.',
      template: 'Sales: objections and competitors',
    },
    limits: [
      'These are public conversations, not your own lost deals.',
      'A phrase needs enough independent people behind it before it earns a place on the sheet.',
      'Verbatim gives the words. The answers are still yours to write.',
    ],
    askLine: 'Give sales the market’s words before the next call.',
  },
]
