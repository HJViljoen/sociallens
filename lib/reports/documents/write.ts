import { z } from 'zod'
import { DOCUMENT_BLOCK_MAX } from '../../config'
import { CALIBRATED_PROSE_RULE } from '../../pipeline/prose-rules'
import type { FigureTable } from '../types'
import type { DocumentTemplate } from './templates'
import { SALES_BRIEF } from './templates'
import type { DocumentSettings } from './types'
import { SELLS_TO } from './types'
import type { Signals } from './signals'
import type { ResearchAnswer } from './research'
import { possessive } from './questions'
import { noDashes } from './scrub'

/**
 * The writing pass's prompt and schema (pure, tested). One call writes the
 * whole skeleton. What reaches the model: the role and brief, the register,
 * the previous brief's headlines (continuity), the figure table as KEYS and
 * labels, the agent's grounded points as indexed items with their counts as
 * keys, the merged concerns, the delta in words, each competitor's own
 * claims and its users' themes, say-vs-hear, the personas. Never a comment's
 * words, never a number, never a person's name. Every block cites the
 * indices it rests on; code resolves them and decides how sure we are.
 */

/** Kept for the one caller that has no template in hand; every build uses
 *  promptVersion(template) instead. */
export const DOCUMENT_PROMPT_VERSION = 'sales_brief_v1'

export interface PreviousBrief {
  summary: string
  headlines: string[]
}

export interface WriterArgs {
  template: DocumentTemplate
  settings: DocumentSettings
  company: string
  period: string
  reader: string | null
  figures: FigureTable
  signals: Signals
  answers: ResearchAnswer[]
  previous: PreviousBrief | null
  thin: boolean
  /** Product names with digits the writer may repeat (compose.allowedTokens). */
  allow?: string[]
}

const cap = (field: string) => DOCUMENT_BLOCK_MAX[field] ?? 400

/**
 * The schema is built from the template's SKELETON: a brief with no competitor
 * page is never asked for competitor blocks, and the model is never handed a
 * field whose page will not be printed. The three constants below are on every
 * document (the overview, the findings, what is not settled); the rest appear
 * only when the skeleton asks for the page.
 *
 * Everything the model is asked for is REQUIRED — OpenAI's structured output
 * is strict, so an absent page means an absent key, never an optional one.
 */
export function writerSchema(t: DocumentTemplate) {
  const has = (kind: string) => t.skeleton.some((p) => p.kind === kind)
  const shape: Record<string, z.ZodTypeAny> = {
    in_short: z.object({
      summary: z.string().describe(`The executive summary: what the conversation shows this update, what changed since the last brief, and what matters ${t.lens.short}, developed in one or two paragraphs (separate paragraphs with a blank line). Under ${cap('summary')} characters. Cite figures by [[key]] only.`),
    }),
    findings: z.array(z.object({
      headline: z.string().describe(`The argument in one line, a claim not a topic. Under ${cap('headline')} characters, no full stop.`),
      saw: z.string().describe(`What the conversation shows: the observation developed across sources in two or three paragraphs (separate paragraphs with a blank line), in the analytical third person, citing counts by [[key]] where a count carries the point. Under ${cap('saw')} characters.`),
      means: z.string().describe(`${t.lens.rule} Under ${cap('means')} characters.`),
      practice: z.array(z.string()).describe(`In practice: at most two lines ${t.readerNoun} can act on, each resting on a grounded point. May be empty. Each under ${cap('practice')} characters.`),
      sure_note: z.string().describe(`One or two sentences on the basis of the reading: what supports it and what is thin. Under ${cap('sure')} characters.`),
      based_on: z.array(z.string()).describe('The grounded point indices (G3) and concern indices (S1) this finding rests on. At least one G.'),
      quote_from: z.string().nullable().describe('The one grounded point (G index) whose voice best carries the finding, or null.'),
      continued_from: z.string().nullable().describe("If this finding carries one of the previous brief's headlines, that headline verbatim; else null."),
    })),
    not_sure_yet: z.array(z.string()).describe(`Questions ${t.readerNoun} would want answered that the conversation could not settle this update, one line each. Up to five, each under ${cap('not_sure')} characters.`),
  }
  if (has('competitor')) {
    shape.competitors = z.array(z.object({
      name: z.string(),
      pitch: z.string().describe(`What they are pitching in their own videos, as a read not a list. Under ${cap('pitch')} characters.`),
      praise: z.string().describe(`What their users praise. Under ${cap('praise')} characters.`),
      hurt: z.string().describe(`Where their users hurt. Under ${cap('hurt')} characters.`),
      read: z.string().describe(`The read for the reader when this competitor comes up: what to ask about, what not to compare. Under ${cap('read')} characters.`),
      based_on: z.array(z.string()),
    }))
  }
  if (has('personas')) {
    shape.persona_lines = z.array(z.object({
      name: z.string(),
      line: z.string().describe(`What this person means ${t.lens.short}: one or two sentences on where they are and what would move them, drawn from the profile. Under ${cap('persona')} characters.`),
    }))
  }
  if (has('language')) {
    shape.care = z.array(z.string()).describe('Words or claims that draw pushback or that the audience contradicts, each as "the words: why". Up to five.')
  }
  if (has('standing')) {
    shape.standing = z.string().describe(`Where the company sits in this conversation and why: what the shares and the movement mean read together, in one or two paragraphs (separate paragraphs with a blank line). The numbers are printed beside it, so read them, do not recite them. Under ${cap('standing')} characters.`)
  }
  if (has('say_hear')) {
    shape.say_hear = z.array(z.object({
      claim: z.string().describe('The claim the company makes, in its own words, exactly as it is listed in the inputs.'),
      read: z.string().describe(`What the audience does with that claim: what comes back, and where the two are not talking about the same thing. Under ${cap('gap')} characters.`),
      based_on: z.array(z.string()),
    })).describe('One per claim listed in the inputs, up to four. Skip a claim the conversation says nothing about.')
  }
  if (has('asked')) {
    shape.asked = z.array(z.string()).describe(`Questions the conversation puts and does not settle, each as "the question: what is behind it". The question in the audience\'s own framing, not the company\'s. Up to six, each under ${cap('asked')} characters.`)
  }
  return z.object(shape)
}

/** The reference schema (the Sales brief's), so a caller that only wants the
 *  type has one. Every build uses writerSchema(template). */
export const WriterSchema = writerSchema(SALES_BRIEF)

/** What the writer may return. A section is absent when the template's
 *  skeleton has no page for it; compose treats absent and empty the same. */
export interface WriterOutput {
  in_short: { summary: string }
  findings: {
    headline: string
    saw: string
    means: string
    practice: string[]
    sure_note: string
    based_on: string[]
    quote_from: string | null
    continued_from: string | null
  }[]
  not_sure_yet: string[]
  competitors?: { name: string; pitch: string; praise: string; hurt: string; read: string; based_on: string[] }[]
  persona_lines?: { name: string; line: string }[]
  care?: string[]
  standing?: string
  say_hear?: { claim: string; read: string; based_on: string[] }[]
  asked?: string[]
}

const registerLine = (s: DocumentSettings) => {
  const r = SELLS_TO.find((x) => x.key === s.sellsTo)
  return r ? `${r.label} (${r.hint})` : s.sellsTo
}

export function buildWriterPrompts(a: WriterArgs): { system: string; user: string } {
  const t = a.template
  const has = (kind: string) => t.skeleton.some((p) => p.kind === kind)
  const findingsMax = a.thin ? Math.min(Math.min(a.settings.findings, t.findingsMax), 3) : Math.min(a.settings.findings, t.findingsMax)
  const system = [
    t.role,
    t.brief,
    `The reader sells to: ${registerLine(a.settings)}.${a.reader ? ` Written for: ${a.reader}.` : ''} Write for that reader.`,
    'House style:',
    '- A research report, not a memo: the analytical third person ("the conversation shows", "buyers describe", "owners report"), developed paragraphs, plain English. Never "we", "our" or "you"; never address the reader; no headings, no bullet points inside a field, no exclamation marks, no greeting, no sign-off.',
    '- A headline is a claim about the market or the buyer ("The sale is decided at the clinic, not on the knee"), never a topic ("Clinic relationships") and never an instruction ("Answer with use cases").',
    `- Weight: what the conversation shows carries the finding; what it means ${t.lens.short} interprets it; in practice is at most two short lines and may be empty. Do not turn a finding into advice.`,
    '- Name competitors, products and themes plainly. Never name a person. Do not name the tool, the model, or "AI"; do not say "this brief" or "this report".',
    '- You have NO numbers. Where a count or a share belongs, write its placeholder exactly as listed, e.g. "[[g3_conversations]] conversations". Never type a digit. Never invent a figure not in the list. A placeholder means exactly what its label says. Cite at most two counts in a paragraph and none in a headline; a paragraph is a reading, not a tally.',
    a.allow?.length ? `- Product names that carry digits may be written exactly as they appear here: ${a.allow.slice(0, 30).join(', ')}.` : '',
    noDashes(CALIBRATED_PROSE_RULE),
    '- No dashes between clauses (no em dash, no en dash, no spaced hyphen); use a comma, a colon or a full stop.',
    '- Every finding rests on grounded points: cite them in based_on. Never claim a product fact the grounded points do not carry; if a natural claim has no support, leave it out and put the open question in not_sure_yet instead.',
    `- Write at most ${findingsMax} findings, and fewer when the evidence is thin. Order does not matter; the product orders them by evidence.`,
    a.previous
      ? '- Continuity: the previous brief\'s headlines are listed. When a finding still holds, keep its headline (put it in continued_from) and say what is still true and what moved since last time. Mark only what is new as new.'
      : '- This is the first brief: say so in one clause of the summary, without apology.',
    a.thin ? '- The update was thin (see the summary note). Say so plainly in the summary and write fewer findings rather than stretch the evidence.' : '',
    has('standing') ? '- The standing page: the shares and what moved are printed beside your paragraphs as a table. Read them together and say what position they describe; do not list them back.' : '',
    has('say_hear') ? `- The claims page: one entry per claim listed in the inputs, the claim copied exactly as given. Say what the audience does with it. Where the company and the audience are not talking about the same thing, name the difference; where the conversation says nothing about a claim, leave that claim out rather than guess.` : '',
    has('asked') ? '- The questions page: real questions the conversation puts and nobody settles, in the audience\'s own framing. Not topics, not headings, not things it would be nice to cover.' : '',
    'Example of the register (a different company, do not reuse its content): headline "Comfort is the criterion long-term users apply, and the adjustable socket is where interest turns concrete"; saw "Long-term users judge a device by whether it can be worn through a whole day. [[g7_conversations]] conversations describe fit changing by evening, sweat and sores, and sock changes as the routine that decides whether a device stays on.\n\nThe adjustable socket shown on the brand\'s videos drew direct requests by name, the one component the audience asked for rather than about."; means "Comfort is not a feature in this market but the test every claim is put to; a buyer who has lived with a poor socket hears a performance claim as a promise about the afternoon."; practice ["Fit through the day is the buyer\'s own measure; it is the question to ask before naming a component."].',
  ].filter(Boolean).join('\n')

  const s = a.signals
  const figureLines = Object.entries(a.figures).map(([k, f]) =>
    f.kind === 'count' ? `- [[${k}]]: a count of ${f.label}; write it as "[[${k}]] ${f.label}"`
    : f.kind === 'pct' ? `- [[${k}]]: a share, written with its % sign: ${f.label}; put it after a verb ("stood at [[${k}]]")`
    : `- [[${k}]]: a name: ${f.label}`)

  const countKey = (id: string) => (a.figures[`${id.toLowerCase()}_conversations`] ? `count key [[${id.toLowerCase()}_conversations]]` : 'a few conversations, do not cite a count')
  const points = a.answers.flatMap((ans) => ans.grounded.map((p) =>
    `${p.id} (from question "${ans.question.id}"; ${countKey(p.id)}; themes: ${p.themeLabels.slice(0, 3).join(', ') || 'none'}): ${p.text}`))
  const judgements = a.answers.flatMap((ans) => ans.judgement.map((j, i) => `J${i + 1} from "${ans.question.id}" (the researcher's own read, not evidence): ${j.text}`))
  const silentQuestions = a.answers.filter((ans) => ans.silent || ans.outcome === 'failed' || ans.outcome === 'unasked').map((ans) => `- ${ans.question.text}`)
  const answersSummary = a.answers.filter((ans) => ans.answer).map((ans) => `- ${ans.question.id}: ${ans.answer}`)

  const concerns = s.concerns.map((c) =>
    `${c.id} (${countKey(c.id)}; heard from ${c.buckets.map((b) => bucketWord(b.bucket, s.company)).join(', ')}; ${c.trajectory || 'history unknown'}): ${c.label}. ${c.description}`)

  const deltaWords = deltaInWords(s)

  const competitors = s.competitors.map((c) => [
    `${c.name}${c.thin ? ' (thin this update: few videos, read with care)' : ''}; share key [[${slug(c.name)}_share_pct]]`,
    c.claims.length ? `  What they say in their own videos:\n${c.claims.map((cl) => `  - ${cl.claim}`).join('\n')}` : '  What they say in their own videos: nothing captured this update.',
    c.praise.length ? `  What their users praise:\n${c.praise.map((t) => `  - ${t.label}: ${t.description}`).join('\n')}` : '  What their users praise: nothing captured this update.',
    c.hurt.length ? `  Where their users hurt:\n${c.hurt.map((t) => `  - ${t.label}: ${t.description}`).join('\n')}` : '  Where their users hurt: nothing captured this update.',
    c.asks.length ? `  What their users ask:\n${c.asks.map((t) => `  - ${t.label}: ${t.description}`).join('\n')}` : '',
  ].filter(Boolean).join('\n'))

  // The claims list is the say_hear page's own input when the template has
  // that page: the claim must come back verbatim, so it is numbered here and
  // the writer is told to copy it.
  const sayHear = s.sayVsHear.map((e, i) =>
    `${has('say_hear') ? `A${i + 1}. ` : '- '}${s.company} says "${e.you_say}". The audience ${e.audience}${e.they_say ? `: ${e.they_say}` : ''}. ${e.gap}`)
  const ci = s.ciSummary
  const ciLines = ci ? [
    ci.top_buying_triggers?.length ? `Buying triggers: ${ci.top_buying_triggers.join(' · ')}` : '',
    ci.top_differentiators?.length ? `Differentiators: ${ci.top_differentiators.join(' · ')}` : '',
    ci.threats?.length ? `Threats: ${ci.threats.join(' · ')}` : '',
    ci.top_unmet_needs?.length ? `Unmet needs: ${ci.top_unmet_needs.join(' · ')}` : '',
  ].filter(Boolean) : []
  const personas = s.personas.map((p) => `- ${p.name} (${p.scope === 'client' ? `${possessive(s.company)} audience` : 'the category'}; ${p.prevalence || 'prevalence unknown'}): ${p.oneLiner} Wants: ${p.wants} Stuck on: ${p.blockers} Moves when: ${p.triggers}`)

  const user = [
    `Company: ${a.company}`,
    `Period: ${a.period}`,
    a.thin ? `Note: this update was thin (${s.runStatus === 'partial' ? 'the update finished partially' : 'few conversations in the period'}).` : '',
    a.previous ? `Previous brief, in short: ${a.previous.summary}\nPrevious brief's headlines:\n${a.previous.headlines.map((h) => `- ${h}`).join('\n')}` : 'Previous brief: none, this is the first.',
    `Figures available (cite by placeholder; you do not know their values):\n${figureLines.join('\n')}`,
    `What moved since the previous update:\n${deltaWords.map((d) => `- ${d}`).join('\n')}`,
    `The researcher's questions and what the conversation answered, in short:\n${answersSummary.join('\n') || '- nothing answered'}`,
    `Grounded points (evidence; cite by index):\n${points.join('\n') || '- none'}`,
    judgements.length ? `The researcher's own reads (not evidence; may inform "what it means", never "what we saw"):\n${judgements.join('\n')}` : '',
    silentQuestions.length ? `Questions the conversation could not answer:\n${silentQuestions.join('\n')}` : '',
    `Concerns across audiences (cite by index):\n${concerns.join('\n') || '- none'}`,
    competitors.length ? `Competitors:\n${competitors.join('\n')}` : 'Competitors: none tracked.',
    sayHear.length ? `What ${a.company} claims against what its audience says:\n${sayHear.join('\n')}` : '',
    ciLines.length ? `The update's market read:\n${ciLines.join('\n')}` : '',
    personas.length ? `Who is in the conversation (personas):\n${personas.join('\n')}` : '',
  ].filter(Boolean).join('\n\n')
  return { system, user }
}

export const slug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/(^_|_$)/g, '')

export function bucketWord(bucket: string, company: string): string {
  if (bucket === 'client') return `${possessive(company)} audience`
  if (bucket === 'industry-other') return 'the category'
  if (bucket.startsWith('competitor:')) return `${possessive(bucket.slice('competitor:'.length))} audience`
  return bucket
}

/** The delta as words for the writer: verdicts and directions, never the
 *  numbers (those are figure keys). */
export function deltaInWords(s: Pick<Signals, 'delta' | 'updatesCount' | 'trackedCompetitors'>): string[] {
  const d = s.delta
  if (!d) return [s.updatesCount <= 1 ? 'This is the first update; nothing to compare with yet.' : 'No earlier update to compare with.']
  const out: string[] = []
  if (d.sentiment) {
    const dir = d.sentiment.now > d.sentiment.prev ? 'up' : d.sentiment.now < d.sentiment.prev ? 'down' : 'level'
    const v = d.sentiment.verdict.state
    out.push(v === 'moved' ? `Positive sentiment moved ${dir} since the previous update (key [[positive_pct]] now, [[prev_positive_pct]] before).` : v === 'too_little_data' ? 'Too few judged conversations to say whether sentiment moved.' : `Positive sentiment is about where it was (key [[positive_pct]]).`)
  }
  if (d.share) {
    const dir = d.share.now.client > d.share.prev.client ? 'up' : d.share.now.client < d.share.prev.client ? 'down' : 'level'
    const v = d.share.verdict.state
    out.push(v === 'moved' ? `The company's share of tracked conversation moved ${dir} (key [[client_share_pct]]).` : v === 'too_little_data' ? 'Too few videos to say whether the company\'s share of tracked conversation moved.' : `The company's share of tracked conversation is about where it was (key [[client_share_pct]]).`)
  }
  if (d.newThemes) out.push(d.newThemes.count ? `Themes new this update (key [[new_themes]]): ${d.newThemes.labels.slice(0, 6).join(', ')}.` : 'No confirmed theme is new this update.')
  if (d.conversations) out.push(`Conversations this update (key [[conversations]]) against the previous update (key [[prev_conversations]]).`)
  return out.length ? out : ['Nothing measurable moved.']
}
