import { AUDIENCES, type Audience, type CoverText, type FigureTable } from './types'

/**
 * The cover (Stage 2, spec §4): a few sentences in the reader's register over
 * figures the code computed. The prose carries `[[figure_key]]` placeholders;
 * the numbers are written in at render from the frozen figure table — the
 * same rule as composeDashboardNarrative's [[n]], with named keys because a
 * cover may cite several. A key the table does not hold drops its sentence.
 *
 * The model half (generateCover) lives in lib/reports/cover-model.ts so this
 * file stays pure and tested; when the model is unavailable or its prose is
 * unusable, composeFallbackCover writes the cover in code. A build never
 * waits on, or fails for, the model.
 */

export const FIGURE_KEY_RE = /\[\[([a-z][a-z0-9_]*)\]\]/g

export type CoverPart = { text: string } | { figure: string; key: string }

/** Split the stored body into text and substituted figures, sentence by
 *  sentence; a sentence citing a key the table lacks is dropped whole. */
export function substituteFigures(body: string, figures: FigureTable): CoverPart[] {
  const parts: CoverPart[] = []
  for (const sentence of splitSentences(body)) {
    const keys = [...sentence.matchAll(FIGURE_KEY_RE)].map((m) => m[1])
    if (keys.some((k) => !figures[k])) continue
    let last = 0
    for (const m of sentence.matchAll(FIGURE_KEY_RE)) {
      const i = m.index ?? 0
      if (i > last) parts.push({ text: sentence.slice(last, i) })
      parts.push({ figure: figures[m[1]].value, key: m[1] })
      last = i + m[0].length
    }
    const tail = sentence.slice(last)
    parts.push({ text: (tail.endsWith(' ') ? tail : `${tail} `) })
  }
  // Trim the trailing space of the last text part.
  const lastPart = parts[parts.length - 1]
  if (lastPart && 'text' in lastPart) lastPart.text = lastPart.text.replace(/\s+$/, '')
  return parts
}

export function splitSentences(body: string): string[] {
  return body
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+(?=[A-Z\[“"])/)
    .map((s) => s.trim())
    .filter(Boolean)
}

/** Plain text of a substituted cover — for previews and the snapshot title. */
export function coverPlainText(body: string, figures: FigureTable): string {
  return substituteFigures(body, figures).map((p) => ('text' in p ? p.text : p.figure)).join('').replace(/\s+/g, ' ').trim()
}

export const readerOf = (register: Audience): string => AUDIENCES.find((a) => a.key === register)?.reader ?? 'the reader'
export const audienceLabel = (register: Audience): string => AUDIENCES.find((a) => a.key === register)?.label ?? 'General'

/** The cover written in code: true, plain, and enough. */
export function composeFallbackCover(args: {
  title: string
  register: Audience
  reader?: string | null
  company: string
  period: string
  sectionTitles: string[]
  figures: FigureTable
}): CoverText {
  const f = args.figures
  const s: string[] = []
  s.push(`${args.title}, prepared by ${args.company} for ${args.reader?.trim() || readerOf(args.register)}, from the ${args.period.replace(/^Update of /, 'update of ')}.`)
  if (f.videos && f.comments) s.push('It rests on [[videos]] conversations and [[comments]] comments, every one read in full.')
  else if (f.videos) s.push('It rests on [[videos]] conversations, every one read in full.')
  if (f.sentiment_positive_pct) s.push('Across the conversations rated for sentiment, [[sentiment_positive_pct]] were positive.')
  if (f.share_of_voice_pct && f.top_competitor && f.top_competitor_share_pct) s.push('Your share of the tracked conversation stood at [[share_of_voice_pct]], against [[top_competitor_share_pct]] for [[top_competitor]].')
  else if (f.your_share_pct && f.lead_competitor && f.lead_competitor_share_pct) s.push('Your share of the tracked conversation stood at [[your_share_pct]], against [[lead_competitor_share_pct]] for [[lead_competitor]].')
  if (f.top_theme) s.push('The theme heard most was [[top_theme]].')
  if (f.top_recommendation) s.push('The recommendation that ranks first this update: [[top_recommendation]].')
  if (args.sectionTitles.length) s.push(`The pages that follow: ${dedupeTitles(args.sectionTitles).join(' · ')}.`)
  return { title: args.title, body: s.join(' '), register: args.register, fallback: true, generatedAt: new Date().toISOString(), model: null }
}

/** "Voice of Customer · Össur · Sun 23 Aug" → "Voice of Customer"; repeats collapse. */
export function dedupeTitles(titles: string[]): string[] {
  const out: string[] = []
  for (const t of titles) {
    const short = t.split(' · ')[0].trim()
    if (short && !out.includes(short)) out.push(short)
  }
  return out
}

// ── the scrub ─────────────────────────────────────────────────────────────
// The write-time rules of the executive brief (lib/pipeline/narrative.ts),
// applied sentence by sentence to model prose that names figures by key.

const KEYED_FIGURE_RE = /\[\[([a-z][a-z0-9_]*)\]\]/g

export interface ScrubbedCover {
  body: string
  /** Sentences dropped: an unknown key, a leaked digit that could not be re-anchored, or nothing left after the strip. */
  dropped: number
  /** True when a magnitude word or a literal number had to be removed. */
  leaked: boolean
}

/** Keep only sentences that cite known keys, strip magnitude words, and
 *  drop any sentence in which the model typed a number of its own — a
 *  figure in a cover is either substituted by code or absent. */
export function scrubCover(body: string, figures: FigureTable, rules: { magnitude: RegExp; figure: RegExp; tidy: (s: string) => string }): ScrubbedCover {
  const kept: string[] = []
  let dropped = 0
  let leaked = false
  for (const raw of splitSentences(body)) {
    const keys = [...raw.matchAll(KEYED_FIGURE_RE)].map((m) => m[1])
    if (keys.some((k) => !figures[k])) { dropped += 1; continue }
    const withoutKeys = raw.replace(KEYED_FIGURE_RE, ' ')
    // A literal number outside a placeholder: the model wrote a figure.
    rules.figure.lastIndex = 0
    if (withoutKeys.replace(rules.figure, '') !== withoutKeys) { dropped += 1; leaked = true; continue }
    const stripped = raw.replace(rules.magnitude, '')
    if (stripped !== raw) leaked = true
    const text = rules.tidy(stripped)
    if (!text || text.replace(KEYED_FIGURE_RE, '').replace(/[\s.,;:!?]/g, '') === '') { dropped += 1; continue }
    kept.push(text)
  }
  return { body: kept.join(' '), dropped, leaked }
}
