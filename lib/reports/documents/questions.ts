import type { DocumentTemplate } from './templates'
import type { DocumentSettings } from './types'
import type { MergedConcern } from './merge'

/**
 * The researcher's questions (pure). Fixed anchors first, the register's
 * question when the reader sells through professionals or shops, one per
 * included competitor, then the update's loudest concerns until the cap.
 * Anchors outnumber the data-driven questions on purpose: the brief reads
 * the same way each week because it asks the same things each week, and the
 * week's own concerns add to that, they do not replace it.
 */

export interface ResearchQuestion {
  id: string
  text: string
  purpose: 'anchor' | 'register' | 'competitor' | 'concern'
  competitor?: string
  concernId?: string
}

/** What the reader sells, in words the corpus uses: "products like Össur's
 *  (prosthetic leg, prosthetic arm)". A hashtag is a search term, not a noun. */
export function marketPhrase(company: string, industryKeywords: string[]): string {
  const words = industryKeywords
    .map((k) => k.trim())
    .filter((k) => k && !k.startsWith('#'))
    .map((k) => k.replace(/^#/, ''))
    .filter((k, i, arr) => arr.indexOf(k) === i)
    .slice(0, 3)
  const own = `products like ${possessive(company)}`
  return words.length ? `${own} (${words.join(', ')})` : own
}

export const possessive = (name: string): string => (/s$/i.test(name) ? `${name}'` : `${name}'s`)

export function composeQuestions(
  template: DocumentTemplate,
  s: { company: string; industryKeywords: string[]; competitors: { name: string; thin: boolean }[]; concerns: MergedConcern[] },
  settings: DocumentSettings,
  max: number,
): ResearchQuestion[] {
  const market = marketPhrase(s.company, s.industryKeywords)
  const fill = (text: string, competitor?: string) =>
    text.replace(/\{market\}/g, market).replace(/\{company\}/g, s.company).replace(/\{competitor\}/g, competitor ?? '')

  const out: ResearchQuestion[] = []
  for (const a of template.anchors) {
    if (a.perCompetitor) continue
    if (a.sellsTo && !a.sellsTo.includes(settings.sellsTo)) continue
    out.push({ id: a.id, text: fill(a.text), purpose: a.sellsTo ? 'register' : 'anchor' })
  }
  const perCompetitor = template.anchors.find((a) => a.perCompetitor)
  if (perCompetitor) {
    // Two at most: a third competitor's card is written from the signals alone.
    for (const c of s.competitors.slice(0, 2)) {
      out.push({ id: `${perCompetitor.id}:${slug(c.name)}`, text: fill(perCompetitor.text, c.name), purpose: 'competitor', competitor: c.name })
    }
  }
  const room = Math.max(0, Math.min(3, max - out.length))
  // The loudest concerns, but not one that an anchor already covers head on:
  // the anchors ask about cost and hesitation; a concern literally about
  // price would spend a question twice.
  const covered = /\b(price|cost|afford|insurance|payment|pay)\b/i
  const concerns = s.concerns.filter((c) => !covered.test(c.label)).slice(0, room)
  for (const c of concerns) {
    out.push({
      id: `concern:${c.id}`,
      text: c.description
        ? `${c.description.replace(/\s+$/, '').replace(/([^.!?])$/, '$1.')} What do people say about this, and what would settle it for them?`
        : `What do people say about ${lower(c.label)}, and what would settle it for them?`,
      purpose: 'concern',
      concernId: c.id,
    })
  }
  return out.slice(0, max)
}

const lower = (label: string) => label.replace(/^([A-Z])/, (m) => m.toLowerCase())
const slug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
