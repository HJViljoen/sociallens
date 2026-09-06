// Illustrative market used across the marketing site: a hiking-backpack
// category with fictional brands (Northline, Ridgeway, Trailform, Cairnline).
// Numbers are consistent across every section that shows them, because the
// product's promise is that the same fact reads the same everywhere. Nothing
// here is a client, a testimonial or a real brand. Copy contract:
// .agents/product-marketing.md.

export const murmurLines = [
  'the strap absolutely digs in by hour six', 'which one for a 10 day trip? genuinely torn', 'nobody could explain the sizing',
  'held up better on the trail, did not expect that', "the hip belt is the reason I'd never go back", 'how loud the zips are',
  'returned it twice, third one finally fit', "the 40L is the one, don't let anyone tell you otherwise", 'does it fit under the seat though',
  'mine tore at the seam after 3 months', 'rain cover is a joke tbh', 'warranty replaced it no questions asked',
  'the cheaper one is honestly fine', 'sizing chart is useless for short torsos', "everyone says get the bigger one, don't",
  'two years daily use and zero complaints', 'the water bottle pocket is unreachable', 'why is nobody talking about the weight',
  "I'd pay more for a quieter zip", 'torn between these two for weeks now', "the frame creaks when it's full",
  'asked in store, got a shrug', 'fits like it was made for me', 'chest strap snapped on day two',
  'this review sold me on it', 'carried it 800km, still going', 'would kill for a proper small size',
  'the hip belt pockets are tiny', 'lasted one season', "genuinely the best money I've spent",
  "still can't decide", 'the shoulder straps are too wide apart', 'bought it for the colour, kept it for the fit',
  'the sizing video saved me', "don't buy this if you're under 5'6", 'zips gave up in the rain',
  'forty comments and no one from the brand', "it's fine. it's just fine.", 'the old model was better',
  'the new one fixed the belt', 'three trips in and the buckle is already loose', "is the medium too big for 5'4? asking for real",
  'best purchase this year, no notes', 'the mesh back is a sweat trap', "finally a bag that fits a woman's torso",
  'the reviews lied about the weight', 'I switched and I regret nothing', 'the compression straps are pointless',
  'fits a 15 inch laptop, barely', 'why is the small the same price as the large', 'held up in monsoon rain for two weeks',
  'the loops for poles are in the wrong place', 'waited for the sale and it never came',
]

/** A comment card in the streaming columns. `mark` is a substring to highlight. */
export interface StreamQuote {
  text: string
  mark?: string
  src: string
}

export const streamQuotes: StreamQuote[] = [
  { text: "love this bag but the strap absolutely digs in by hour six and I've tried everything", mark: 'the strap absolutely digs in by hour six', src: "Under a competitor's video on Instagram, three days ago." },
  { text: "asked three shops and nobody could explain the sizing. ended up guessing and it's too small", src: 'A Reddit thread with 41 replies, last week.' },
  { text: "I've had both for a year now and the cheaper one held up better on the trail, which I did not expect", mark: 'the cheaper one held up better on the trail', src: 'Said to camera in a YouTube review, two days ago.' },
  { text: 'which one for a 10 day trip? genuinely torn between the two', src: "Under a creator's TikTok, five days ago. Nobody from either brand answered." },
  { text: "the hip belt is the reason I'd never go back to the old one", src: 'Under a YouTube comparison, six days ago.' },
  { text: "nobody talks about how loud the zips are. that's the whole reason I sold mine", mark: "that's the whole reason I sold mine", src: 'Said to camera on TikTok, last week.' },
  { text: 'returned it twice, third one finally fit. the size chart is for a different species', src: 'A Reddit thread, four days ago.' },
  { text: 'warranty replaced it no questions asked, which is more than I can say for the last one', src: "Under a creator's YouTube video, yesterday." },
  { text: "does it actually fit under the seat though? every video says yes and then it doesn't", src: 'Under an Instagram reel, two days ago. 23 replies.' },
  { text: 'mine tore at the seam after 3 months and nobody at the brand has answered', mark: 'nobody at the brand has answered', src: "Under the brand's own TikTok, six days ago." },
  { text: 'the water bottle pocket is unreachable while wearing it, why does nobody test this', src: 'Said to camera on YouTube, last week.' },
  { text: "carried it 800km this summer, still going. the frame creaks but it's fine", src: 'A Reddit trip report, three days ago.' },
  { text: "I'd pay more for a quieter zip, that's genuinely it", src: "Under a competitor's Instagram post, yesterday." },
  { text: "everyone says get the bigger one. don't. you will fill it and hate yourself", mark: "don't. you will fill it and hate yourself", src: 'Said to camera on TikTok, four days ago.' },
  { text: 'bought it for the colour, kept it for the fit', src: "Under a creator's YouTube video, last week." },
  { text: 'the sizing video from that one creator saved me, the official guide did not', src: 'A Reddit thread, two days ago.' },
  { text: 'chest strap snapped on day two. day two.', src: 'Under an Instagram reel, five days ago.' },
  { text: 'forty comments asking about torso length and not one answer', src: 'Under your own TikTok, last week.' },
]

export interface Persona {
  name: string
  share: number
  wants: string
  stops: string
  tips: string
  talk: string[]
}

export const personas: Persona[] = [
  { name: 'The long-trip planner', share: 41, wants: "One bag for ten days that doesn't punish them on day six.", stops: 'Nobody will say which size they need.', tips: 'A creator they trust naming a specific model.', talk: ['which one for a 10 day trip', 'genuinely torn', 'by hour six'] },
  { name: 'The upgrader who got burned', share: 32, wants: 'Proof it holds up, from someone who owns it.', stops: 'Paid more once and the cheap one lasted longer.', tips: 'A warranty story with a happy ending.', talk: ['held up better', 'did not expect', 'sold mine'] },
  { name: 'The first-timer sizing blind', share: 27, wants: 'A straight answer on fit before they order.', stops: 'Sizing guides that assume you already know.', tips: 'One reply from the brand under the video.', talk: ['nobody could explain', 'ended up guessing', 'too small'] },
]

export type Movement = 'gaining' | 'fading' | 'emerging' | 'steady'

export interface Theme {
  label: string
  conversations: number
  movement?: Movement
  /** grid spans on the 12-column desktop theme map */
  col: number
  row: number
  big?: boolean
  you?: boolean
}

export const themes: Theme[] = [
  { label: 'Fit and sizing', conversations: 412, movement: 'gaining', col: 5, row: 3, big: true },
  { label: 'Hip belt comfort', conversations: 288, movement: 'gaining', col: 4, row: 3, big: true, you: true },
  { label: 'Durability on trail', conversations: 251, col: 3, row: 2 },
  { label: 'Rain cover', conversations: 88, col: 3, row: 1 },
  { label: 'Price vs the cheaper one', conversations: 197, movement: 'fading', col: 4, row: 2 },
  { label: 'Zips and noise', conversations: 143, movement: 'emerging', col: 3, row: 2 },
  { label: 'Capacity for long trips', conversations: 131, col: 3, row: 2 },
  { label: 'Warranty', conversations: 64, col: 2, row: 2 },
  { label: 'Colours', conversations: 41, col: 4, row: 1 },
  { label: 'Airline carry-on', conversations: 37, movement: 'emerging', col: 4, row: 1 },
  { label: 'Water bottle pocket', conversations: 29, col: 4, row: 1 },
]

export interface FaceOffRow {
  label: string
  you: { pct: number; text: string }
  them: { pct: number; text: string }
  cat?: { pct: number; text: string }
}

export const faceOff: FaceOffRow[] = [
  { label: 'Share of the conversation', you: { pct: 34, text: '18%' }, them: { pct: 51, text: '27%' }, cat: { pct: 100, text: '55%' } },
  { label: 'Sentiment towards you', you: { pct: 100, text: '71%' }, them: { pct: 90, text: '64%' }, cat: { pct: 82, text: '58%' } },
  { label: 'Questions left unanswered this week', you: { pct: 100, text: '63' }, them: { pct: 19, text: '12' } },
]

export const faceOffOwns = {
  them: { title: 'Theme they own: durability', quote: 'the cheaper one held up better on the trail' },
  you: { title: 'Theme you own: the hip belt', quote: "the reason I'd never go back to the old one" },
}

export interface BriefLine {
  kind: 'up' | 'down' | 'new' | 'do'
  parts: (string | { u: string })[]
}

export const brief: BriefLine[] = [
  { kind: 'up', parts: ['Fit and sizing questions doubled after the two biggest creators reviewed the new range. ', { u: '63 conversations' }, ' asked and nobody answered.'] },
  { kind: 'up', parts: ['Zips are the new complaint: ', { u: '143 conversations' }, ', most of them under competitor reviews, and rising for the second week.'] },
  { kind: 'down', parts: ['Rain cover complaints fell for the second week.'] },
  { kind: 'new', parts: ['New this week: airline carry-on limits, ', { u: '37 conversations' }, ', most of them in one Reddit thread.'] },
  { kind: 'do', parts: ["What we'd do: put a sizing answer in the first comment under every fit video, and answer the zip complaints before the competitor does. The hip belt is your strongest unprompted selling point and none of that talk is under your own videos."] },
]

export interface Evidence {
  text: string
  n: number
  quote: string
  src: string
}

export interface Question {
  kind: 'question'
  chip: string
  q: string
  answer: string
  evidence: Evidence[]
  read: string
  silent: string
}

export interface DocumentCheck {
  kind: 'document'
  chip: string
  file: string
  meta: string
  answer: string
  title: string
  /** paragraphs; a segment with `mark` is a checked claim */
  paragraphs: { text: string; mark?: 'ok' | 'no' }[][]
  claims: { k: 'ok' | 'no' | 'silent'; b: string; t: string }[]
}

export type AnalystItem = Question | DocumentCheck

export const analyst: AnalystItem[] = [
  {
    kind: 'question',
    chip: 'Who does our audience actually listen to?',
    q: 'We’re about to spend the Q4 budget on creator placements. Who does our audience actually listen to?',
    answer: 'Three creators, and none of them are on your list.',
    evidence: [
      { text: 'One creator’s sizing video is cited more than your own size guide.', n: 1, quote: '“the sizing video from that one creator saved me, the official guide did not”', src: 'A Reddit thread. One of 27 conversations.' },
      { text: 'Long-trip planners decide on comparisons, and two channels carry almost all of them.', n: 2, quote: '“this review sold me on it, I’d been torn for weeks”', src: 'Under a YouTube comparison. One of 19 conversations.' },
      { text: 'The three creators you placed with last quarter are not cited once in a buying conversation.', n: 3, quote: '“saw the ad, went and watched the comparison instead”', src: 'Under a creator’s TikTok. One of 14 conversations.' },
    ],
    read: 'Put the budget behind the sizing video and the two comparison channels. Your audience has already told you who it trusts. Sponsoring the list you have buys reach in rooms where no one is deciding.',
    silent: 'Nothing on Instagram creators in the buying conversations. That is not a verdict on them. I have no evidence either way.',
  },
  {
    kind: 'question',
    chip: 'Who is winning the long-trip buyer, and why?',
    q: 'Which of our competitors is winning the long-trip buyer, and why?',
    answer: 'The cheaper one, on durability stories told by people who own both.',
    evidence: [
      { text: 'Long-trip planners decide on comparisons, and the comparisons are being won on durability. Most of them name the zip.', n: 1, quote: '“carried it 800km this summer, still going. the frame creaks but it’s fine”', src: 'A Reddit trip report. One of 31 conversations from people who own both.' },
      { text: 'Their sizing questions get answered by other owners. Yours don’t get answered at all.', n: 2, quote: '“asked in the thread and three people replied with their torso length, sorted”', src: 'A Reddit thread under their name. One of 27 conversations.' },
      { text: 'Price comes up in 197 conversations, and never on its own. Every one of them names durability or the zip beside it.', n: 3, quote: '“I’d pay more for a quieter zip, that’s genuinely it”', src: 'Under a competitor’s Instagram post. One of 197 conversations.' },
    ],
    read: 'The long-trip buyer is going to the stories other owners tell, in threads where your owners are silent. Features and price barely come into it. Fix the zip, then get your owners talking where the planners are reading.',
    silent: 'Nothing on their warranty. If they have a good one, nobody mentions it.',
  },
  {
    kind: 'document',
    chip: 'Q4 launch brief.pdf',
    file: 'Q4 launch brief.pdf',
    meta: '9 claims found',
    answer: 'Nine claims. Four the market backs, one it contradicts, four it has nothing to say about.',
    title: 'Q4 launch brief',
    paragraphs: [
      [
        { text: 'Our customers choose us for ' }, { text: 'the hip belt, which no competitor matches', mark: 'ok' }, { text: '. The main objection at checkout is ' }, { text: 'price', mark: 'no' }, { text: ', so the Q4 message leads with value and a limited launch offer.' },
      ],
      [
        { text: 'The new colour range will drive most of the seasonal lift, supported by three creator placements. ' }, { text: 'Sizing confusion', mark: 'ok' }, { text: ' is a known support cost and the FAQ update will address it. ' }, { text: 'The 40L is our hero product', mark: 'ok' }, { text: ' and stays the focus of paid.' },
      ],
    ],
    claims: [
      { k: 'ok', b: 'Supported', t: 'The hip belt is your most-cited strength. 41 conversations, none of them under your own videos.' },
      { k: 'no', b: 'Contradicted', t: 'Price is not the objection. Durability and the zip are, 143 conversations this week. Price only ever appears beside them.' },
      { k: 'ok', b: 'Supported, and bigger than you think', t: 'Sizing is the largest theme in the market, 412 conversations. A FAQ will not reach where they are asking.' },
      { k: 'ok', b: 'Supported', t: 'The 40L is the size owners recommend to each other. 58 conversations.' },
      { k: 'silent', b: 'Silent', t: 'The market has nothing to say about colours or the creator placements. Left unmarked.' },
    ],
  },
]

export interface ReportCover {
  title: string
  audience: string
  sections: number
  pages: number
  /** how it travels; rendered with the bold part emphasised */
  send: { before: string; bold: string; after: string }
  tiles: ('' | 'g' | 'w' | 'g w')[]
}

export const reportCovers: ReportCover[] = [
  { title: 'Weekly digest', audience: 'Written for the team', sections: 8, pages: 9, send: { before: 'Goes out with ', bold: 'every update', after: ' to the marketing team. PDF attached, link inside.' }, tiles: ['g w', '', '', '', 'g', 'w'] },
  { title: 'Monthly marketing review', audience: 'Written for the head of marketing', sections: 6, pages: 7, send: { before: '', bold: 'First update of the month', after: ', to the head of marketing. Movement since last month leads.' }, tiles: ['w', 'g', '', '', 'g w', ''] },
  { title: 'Leadership one-pager', audience: 'Written for leadership', sections: 1, pages: 2, send: { before: 'One page, ', bold: 'shared by link', after: ' before the leadership meeting. Expires in 30 days.' }, tiles: ['g w', 'w', '', '', '', 'g'] },
  { title: 'Sales: objections and competitors', audience: 'Written for sales', sections: 5, pages: 6, send: { before: 'Objections in the market’s words and who you lose to, ', bold: 'sent to the sales lead', after: ' monthly.' }, tiles: ['', 'g', 'g', '', 'w', 'w'] },
  { title: 'Content: what to make next', audience: 'Written for the content team', sections: 4, pages: 5, send: { before: 'Hooks that worked, questions nobody answered, ', bold: 'to the content team', after: ' every update.' }, tiles: ['w', 'w', 'g', '', '', 'g'] },
]
