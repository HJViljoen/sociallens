import type { ReportSection, ReportTemplate } from './types'

/**
 * The four starters (spec §5). A template only ARRANGES pages the pipeline
 * already produces and sets the cover register — never new analysis. Keys are
 * the pages' static renderables (components/pages/<page>/index.tsx); a key the
 * registry does not know is dropped at build time with a warning, so a
 * renamed tile degrades a template rather than breaking it.
 *
 * Kept in code, not rows: versioned with the pages they name. A tenant's own
 * arrangement is saved to report_templates from the Studio.
 */
export const STARTER_TEMPLATES: ReportTemplate[] = [
  {
    key: 'weekly_digest',
    name: 'Weekly digest',
    audience: 'general',
    description: 'What changed since the last update, where you stand, what the market is talking about, comments worth a reply and where you stand against competitors — the update that goes out after every scheduled update, on paper and by email.',
    sections: [
      { page: 'dashboard', params: {}, keys: ['dashboard.strip', 'dashboard.hero', 'dashboard.sentiment', 'dashboard.share', 'dashboard.themes', 'dashboard.movement', 'dashboard.recommendation', 'dashboard.accounts'] },
      { page: 'content', params: {}, keys: ['content.inbox'], framing: 'Comments worth a reply this update.' },
      { page: 'competitive', params: {}, keys: ['competitive.standings'] },
    ],
  },
  {
    key: 'monthly_marketing_review',
    name: 'Monthly marketing review',
    audience: 'marketing',
    description: 'Where you stand, what the market is saying, the competitive picture and what is working in content — the round-up a marketing lead takes into the monthly meeting.',
    sections: [
      { page: 'dashboard', params: {}, keys: ['dashboard.strip', 'dashboard.hero', 'dashboard.sentiment', 'dashboard.share', 'dashboard.themes', 'dashboard.movement', 'dashboard.recommendation', 'dashboard.accounts'] },
      { page: 'voice', params: {}, keys: ['voice.map', 'voice.theme', 'voice.movers', 'voice.phrases', 'voice.mood', 'voice.ribbon'] },
      { page: 'market', params: {}, keys: ['market.shortRead', 'market.news', 'market.detail'] },
      { page: 'competitive', params: {}, keys: ['competitive.standings', 'competitive.faceoff', 'competitive.shareLine', 'competitive.table'] },
      { page: 'content', params: {}, keys: ['content.works', 'content.inbox', 'content.field', 'content.voices', 'content.accounts'] },
    ],
  },
  {
    key: 'leadership_one_pager',
    name: 'Leadership one-pager',
    audience: 'leadership',
    description: 'The executive brief, the four numbers that moved and the one recommendation — two slides after the cover, for someone who will read the cover.',
    sections: [
      { page: 'dashboard', params: {}, keys: ['dashboard.strip', 'dashboard.hero', 'dashboard.sentiment', 'dashboard.share', 'dashboard.movement', 'dashboard.recommendation'] },
    ],
  },
  {
    key: 'sales_objections_competitors',
    name: 'Sales: objections & competitors',
    audience: 'sales',
    description: 'What customers push back on, in their words, and how each competitor is talked about — for the people who hear the objections first.',
    sections: [
      { page: 'voice', params: { type: 'pain_point' }, keys: ['voice.map', 'voice.theme', 'voice.phrases', 'voice.mood', 'voice.ribbon'], framing: 'The pain points customers raise, in their own words.' },
      { page: 'voice', params: { type: 'objection' }, keys: ['voice.map', 'voice.theme'], framing: 'The objections heard before a purchase.' },
      { page: 'competitive', params: {}, keys: ['competitive.standings', 'competitive.faceoff', 'competitive.shareLine', 'competitive.table', 'competitive.finding'], variant: 'full' },
      { page: 'content', params: {}, keys: ['content.inbox'], framing: 'Comments worth a reply this update.' },
    ],
  },
  {
    key: 'content_what_to_make_next',
    name: 'Content: what to make next',
    audience: 'content',
    description: 'What is working right now, the playbooks side by side, how customers actually talk, and the recommendations — for the people making the next video.',
    sections: [
      { page: 'content', params: {}, keys: ['content.works', 'content.inbox', 'content.field', 'content.voices', 'content.accounts', 'content.playbooks'] },
      { page: 'voice', params: {}, keys: ['voice.phrases', 'voice.mood', 'voice.ribbon'], framing: 'How customers say it — the words to borrow.' },
      { page: 'market', params: { group: 'recs' }, keys: ['market.shortRead', 'market.detail'] },
    ],
  },
]

export const starterTemplate = (key: string): ReportTemplate | null => STARTER_TEMPLATES.find((t) => t.key === key) ?? null

/** Mint section ids for a fresh report from a template's sections. */
export function instantiate(sections: Omit<ReportSection, 'id'>[]): ReportSection[] {
  return sections.map((s) => ({ ...s, id: newSectionId() }))
}

export function newSectionId(): string {
  const c = globalThis.crypto
  if (c?.randomUUID) return c.randomUUID().slice(0, 8)
  return Math.random().toString(36).slice(2, 10)
}
