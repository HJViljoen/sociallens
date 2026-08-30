import type { Audience } from '../types'
import type { DocPageKind, SellsTo } from './types'

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
  skeleton: SkeletonPage[]
  anchors: AnchorQuestion[]
  /** Findings pages the skeleton prints when settings allow; the writer may fill fewer. */
  findingsMax: 4
}

export const SALES_BRIEF: DocumentTemplate = {
  key: 'sales_brief',
  name: 'Sales brief',
  audience: 'sales',
  description: 'What buyers will say this month, what changed, what to say back and how sure we are: written from the update as the company\'s own consumer researcher would write it for the sales team. Read it, edit it, send it.',
  role:
    'You are the company\'s consumer researcher. You have read this update\'s public conversation (comments and spoken video content around the brand, its competitors and the wider category) and you are writing the research brief the sales team reads. You report what the conversation shows and what it means for a sale; you are an intelligence function, not a sales coach. A finding is an argument developed from the evidence: what the conversation shows, what it means for a sale, and how sure the reading is.',
  brief:
    'The reader talks to buyers this month and wants to know what is going on in the market and in buyers\' heads: what they hesitate over, what they ask, what moves them, what they say about each competitor, and what changed since the last brief. Three or four findings, each developed properly, each an argument that changes how a rep understands the buyer. Name competitors, products and themes plainly. Keep advice to a line or two at most; the value is the reading, not the tip. Never invent a product fact: where nothing in the conversation supports a natural claim, leave it out and record the open question.',
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

export const DOCUMENT_TEMPLATES: DocumentTemplate[] = [SALES_BRIEF]

export const documentTemplate = (key: string | null | undefined): DocumentTemplate | null =>
  DOCUMENT_TEMPLATES.find((t) => t.key === key) ?? null

/** The fields each page kind carries, in print order. The composer and the
 *  writer schema both read this, so a page cannot gain a field in one place. */
export const PAGE_FIELDS: Record<DocPageKind, string[]> = {
  in_short: ['summary', 'findings', 'not_sure'],
  finding: ['headline', 'saw', 'heard', 'means', 'practice', 'sure'],
  competitor: ['pitch', 'praise', 'hurt', 'read'],
  personas: ['persona'],
  language: ['care'],
  method: ['method'],
}

/** Page names as printed top right. */
export const PAGE_TITLE: Record<DocPageKind, string> = {
  in_short: 'Overview',
  finding: 'Findings',
  competitor: 'Competitors',
  personas: 'Who is buying',
  language: 'Language to handle with care',
  method: 'About this brief',
}

/** Personas per page. */
export const PERSONAS_PER_PAGE = 2
