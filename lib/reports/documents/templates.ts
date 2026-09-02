import type { Audience } from '../types'
import type { DocLens, DocPageKind, SellsTo } from './types'

/**
 * Document templates: a ROLE the agent writes as, a standing BRIEF, the fixed
 * SKELETON, and the researcher's ANCHOR questions. Kept in code, versioned
 * with the writer's prompt. A template arranges nothing; it says who is
 * writing, for whom, and what shape the answer takes.
 *
 * The skeleton is fixed on purpose (Heinrich, 2026-08-30): every issue of a
 * brief reads like the last one, so "what changed" is comparable and the
 * reader learns where things are. The writer fills blocks; it never adds or
 * drops a page.
 *
 * Four templates (2026-09-02). The Sales brief is the reference and its
 * output is unchanged; the other three are the same engine pointed at another
 * reader. What actually differs between them is small and deliberate: the
 * role and brief, the LENS (what a finding's consequence is called), the
 * skeleton's middle pages, and the anchors. Everything else — the finding
 * floor, the ordering by evidence, the confidence, the figure table, the
 * method page, the scrub — is the product's, not the template's.
 */

export interface SkeletonPage {
  kind: DocPageKind
  /** finding: one page per finding, up to settings.findings; competitor: one per included competitor; personas: two per page. */
  repeat?: 'findings' | 'competitors' | 'personas'
}

export interface AnchorQuestion {
  id: string
  /** `{company}`, `{competitor}` and `{market}` are filled in by the composer. */
  text: string
  /** Asked only for this register; undefined = always. */
  sellsTo?: SellsTo[]
  /** One per included competitor. */
  perCompetitor?: boolean
}

/** What a finding's consequence is called, for this reader. It prints as the
 *  eyebrow on a finding page and on a persona card, and it is what the writer
 *  is told the second half of a finding is for. */
export interface Lens extends DocLens {
  /** The whole instruction for that field, in the writer's schema. Written
   *  out per template rather than generated, so one template's wording can be
   *  tuned without moving another's prompt. */
  rule: string
}

export interface DocumentTemplate {
  key: string
  name: string
  audience: Audience
  /** One line for the picker. */
  description: string
  /** Who is writing, in the second person to the model. */
  role: string
  /** What the reader needs from it, in the second person to the model. */
  brief: string
  lens: Lens
  /** The reader, as the writer's rules name them: "a rep", "a director". */
  readerNoun: string
  skeleton: SkeletonPage[]
  anchors: AnchorQuestion[]
  /** Findings pages the skeleton prints when settings allow; the writer may fill fewer. */
  findingsMax: 3 | 4
}

/** The prompt is versioned per template: a change to one template's words
 *  must not read as a change to another's in the ai_call_log. */
export const promptVersion = (t: DocumentTemplate): string => `${t.key}_v1`

// ── the house rules every template inherits ────────────────────────────────

/** The clause every role opens with: what the writer has read. Kept in one
 *  place so a change to what the corpus IS reaches every template. */
const READ =
  'You have read this update\'s public conversation (comments and spoken video content around the brand, its competitors and the wider category)'

/** The clause every brief closes with. */
const NEVER_INVENT =
  'Never invent a product fact: where nothing in the conversation supports a natural claim, leave it out and record the open question.'

// ── sales ──────────────────────────────────────────────────────────────────

export const SALES_BRIEF: DocumentTemplate = {
  key: 'sales_brief',
  name: 'Sales brief',
  audience: 'sales',
  description: 'What buyers will say this month, what changed, what to say back and how sure we are: written from the update as the company\'s own consumer researcher would write it for the sales team. Read it, edit it, send it.',
  role:
    `You are the company's consumer researcher. ${READ} and you are writing the research brief the sales team reads. You report what the conversation shows and what it means for a sale; you are an intelligence function, not a sales coach. A finding is an argument developed from the evidence: what the conversation shows, what it means for a sale, and how sure the reading is.`,
  brief:
    `The reader talks to buyers this month and wants to know what is going on in the market and in buyers' heads: what they hesitate over, what they ask, what moves them, what they say about each competitor, and what changed since the last brief. Three or four findings, each developed properly, each an argument that changes how a rep understands the buyer. Name competitors, products and themes plainly. Keep advice to a line or two at most; the value is the reading, not the tip. ${NEVER_INVENT}`,
  lens: {
    means: 'What it means for a sale',
    short: 'for a sale',
    rule: 'What it means for a sale: the implication, developed in one paragraph, about the buyer and the market rather than about the rep.',
  },
  readerNoun: 'a rep',
  skeleton: [
    { kind: 'in_short' },
    { kind: 'finding', repeat: 'findings' },
    { kind: 'competitor', repeat: 'competitors' },
    { kind: 'personas', repeat: 'personas' },
    { kind: 'language' },
    { kind: 'method' },
  ],
  anchors: [
    { id: 'stops', text: 'What stops people from buying or getting {market}, or makes them hesitate before they commit?' },
    { id: 'asks', text: 'What do people ask before choosing {market}, and what do they want settled first?' },
    { id: 'trigger', text: 'What makes people decide it is time to buy or replace {market}: the event or the moment?' },
    { id: 'owners', text: 'What do people who already own or use {market} complain about, and what do they praise?' },
    { id: 'competitor', text: 'What do people say about {competitor}: what they praise, what they complain about, and how it compares with what they say about {company}?', perCompetitor: true },
    { id: 'professionals', text: 'What do people say about the professionals, clinics or advisers who fit, recommend or sell {market}: what makes them trust one or leave one?', sellsTo: ['professionals'] },
    { id: 'retail', text: 'What do people say about where they buy {market}: the shop, the range, the service, and what makes them go elsewhere?', sellsTo: ['retail'] },
    { id: 'businesses', text: 'What do people say about buying {market} for a business or a team: who decides, what they weigh, and what goes wrong after?', sellsTo: ['businesses'] },
  ],
  findingsMax: 4,
}

// ── leadership ─────────────────────────────────────────────────────────────

export const LEADERSHIP_BRIEF: DocumentTemplate = {
  key: 'leadership_brief',
  name: 'Leadership brief',
  audience: 'leadership',
  description: 'Three readings of what the market is saying, what moved since last time, and where the company stands against the names it is measured against. Short on purpose: the pages a board member will actually read.',
  role:
    `You are the company's consumer researcher. ${READ} and you are writing the short brief the executive team reads. You report what the conversation shows and what it means for the business: demand, reputation, and where the company sits against the alternatives. You do not recommend a strategy; you give the reading the strategy would have to answer to.`,
  brief:
    'The reader is deciding where the company puts its attention and money, and has five minutes. Three findings, each one a reading a director could repeat in a meeting and defend. Weight what is CHANGING over what is merely true: a director already knows the category. Say plainly where the evidence is thin, because a thin reading acted on is worse than none. Keep advice out of it entirely except where a single line is unavoidable. ' + NEVER_INVENT,
  lens: {
    means: 'What it means for the business',
    short: 'for the business',
    rule: 'What it means for the business: the implication, developed in one paragraph, about demand, reputation or where the company sits, rather than about what anyone should do next.',
  },
  readerNoun: 'a director',
  skeleton: [
    { kind: 'in_short' },
    { kind: 'finding', repeat: 'findings' },
    { kind: 'standing' },
    { kind: 'method' },
  ],
  anchors: [
    { id: 'weigh', text: 'What do people weigh when they choose between {market} and the alternatives, and which of those things do they treat as settled?' },
    { id: 'regarded', text: 'What do people say about {company} itself: what they credit it with, and what they hold against it?' },
    { id: 'shifting', text: 'What is changing in what people want from {market}, compared with what they used to ask for?' },
    { id: 'switch', text: 'What makes someone move from one maker of {market} to another, and what keeps them where they are?' },
    { id: 'competitor', text: 'What do people say about {competitor}: what they praise, what they complain about, and how it compares with what they say about {company}?', perCompetitor: true },
  ],
  findingsMax: 3,
}

// ── marketing ──────────────────────────────────────────────────────────────

export const MARKET_BRIEF: DocumentTemplate = {
  key: 'market_brief',
  name: 'Market brief',
  audience: 'marketing',
  description: 'What the audience already believes, which claims land and which come back, who is in the conversation and what words they use for it: the brief the marketing team works from between campaigns.',
  role:
    `You are the company's consumer researcher. ${READ} and you are writing the brief the marketing team works from. You report what the audience already believes, what it does with what the company says, and where the company's own words and the audience's words are not the same words. You are describing the market, not writing the campaign.`,
  brief:
    'The reader decides what the company says next and wants to know what it will be heard as. Four findings about belief and language: what people already think before anyone tells them anything, which claims they argue with, what they call the thing themselves. Where the company makes a claim and the conversation answers it differently, that gap IS the finding. Keep advice to a line or two; naming the gap precisely is worth more than a suggestion. ' + NEVER_INVENT,
  lens: {
    means: 'What it means for the message',
    short: 'for the message',
    rule: 'What it means for the message: the implication, developed in one paragraph, about what the audience already hears and believes, rather than about what to write.',
  },
  readerNoun: 'the marketing team',
  skeleton: [
    { kind: 'in_short' },
    { kind: 'finding', repeat: 'findings' },
    { kind: 'say_hear' },
    { kind: 'competitor', repeat: 'competitors' },
    { kind: 'personas', repeat: 'personas' },
    { kind: 'language' },
    { kind: 'method' },
  ],
  anchors: [
    { id: 'believe', text: 'What do people already believe about {market} before anyone tells them anything?' },
    { id: 'words', text: 'What words do people use for {market} themselves, and what do they call the problem it solves?' },
    { id: 'doubt', text: 'Which claims about {market} do people doubt, argue with, or ask for proof of?' },
    { id: 'notice', text: 'What makes people stop on, share or argue about something to do with {market}?' },
    { id: 'competitor', text: 'What do people say about {competitor}: what they praise, what they complain about, and how it compares with what they say about {company}?', perCompetitor: true },
  ],
  findingsMax: 4,
}

// ── content ────────────────────────────────────────────────────────────────

export const CONTENT_BRIEF: DocumentTemplate = {
  key: 'content_brief',
  name: 'Content brief',
  audience: 'content',
  description: 'What the audience asks and nobody answers, what it gets wrong, and the words it uses: written from the update for the people who make the videos and posts.',
  role:
    `You are the company's consumer researcher. ${READ} and you are writing the brief the people who make the content read. You report what the audience asks, what it misunderstands, what it says about the videos and posts themselves, and what language it uses. You do not write the content calendar; you describe the audience the content has to meet.`,
  brief:
    'The reader decides what to make next and wants to know what the audience is actually asking for. Four findings about attention and understanding: what draws people in, what they came to find out, where they get it wrong, what they say they want more of. A question the conversation puts repeatedly and nobody answers is a finding in its own right. Keep advice to a line or two; what the audience asked is stronger than a suggestion about what to make. ' + NEVER_INVENT,
  lens: {
    means: 'What it means for what to make',
    short: 'for what to make',
    rule: 'What it means for what to make: the implication, developed in one paragraph, about what the audience is asking to be shown, rather than about one video.',
  },
  readerNoun: 'the content team',
  skeleton: [
    { kind: 'in_short' },
    { kind: 'finding', repeat: 'findings' },
    { kind: 'asked' },
    { kind: 'language' },
    { kind: 'method' },
  ],
  anchors: [
    { id: 'unanswered', text: 'What do people ask about {market} that nobody in the conversation answers?' },
    { id: 'watch', text: 'What do people say about the videos and posts about {market} themselves: what they came for, what they liked, what they skipped?' },
    { id: 'wrong', text: 'What do people get wrong about {market}, and where does the confusion start?' },
    { id: 'more', text: 'What do people say they want to see or be shown more of about {market}?' },
  ],
  findingsMax: 4,
}

export const DOCUMENT_TEMPLATES: DocumentTemplate[] = [SALES_BRIEF, LEADERSHIP_BRIEF, MARKET_BRIEF, CONTENT_BRIEF]

export const documentTemplate = (key: string | null | undefined): DocumentTemplate | null =>
  DOCUMENT_TEMPLATES.find((t) => t.key === key) ?? null

/** The fields each page kind carries, in print order. The composer and the
 *  writer schema both read this, so a page cannot gain a field in one place. */
export const PAGE_FIELDS: Record<DocPageKind, string[]> = {
  in_short: ['summary', 'findings', 'not_sure'],
  finding: ['headline', 'saw', 'heard', 'means', 'practice', 'sure'],
  competitor: ['pitch', 'praise', 'hurt', 'read'],
  standing: ['standing'],
  say_hear: ['gap'],
  asked: ['asked'],
  personas: ['persona'],
  language: ['care'],
  method: ['method'],
}

/** Page names as printed top right. */
export const PAGE_TITLE: Record<DocPageKind, string> = {
  in_short: 'Overview',
  finding: 'Findings',
  competitor: 'Competitors',
  standing: 'Standing in the conversation',
  say_hear: 'What is claimed and what comes back',
  asked: 'What the audience asks',
  personas: 'Who is buying',
  language: 'Language to handle with care',
  method: 'About this brief',
}

/** Personas per page. */
export const PERSONAS_PER_PAGE = 2

/** Claims per page on the say_hear page: a claim is printed whole and four
 *  of them ran off the sheet. */
export const CLAIMS_PER_PAGE = 2

/** Questions on the asked page: two columns of four fill the sheet. */
export const ASKED_MAX = 8

/** Skeleton order, for the eval: a page kind may repeat, but the kinds
 *  themselves must come in the order the template declares. */
export const skeletonOrder = (t: DocumentTemplate): DocPageKind[] => t.skeleton.map((p) => p.kind)
