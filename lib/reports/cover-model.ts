import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { zodResponseFormat } from 'openai/helpers/zod'
import { openai } from '../openai'
import { COVER_MODEL } from '../config'
import { logAiCall } from '../pipeline/ai-log'
import { FIGURE_RE, MAGNITUDE_RE, tidy } from '../pipeline/narrative'
import { CALIBRATED_PROSE_RULE } from '../pipeline/prose-rules'
import { composeFallbackCover, dedupeTitles, scrubCover, splitSentences } from './cover'
import type { Audience, CoverText, FigureTable } from './types'

/**
 * The cover's model half (Stage 2, D4). A small model writes three to five
 * sentences in the reader's register over a figure TABLE — keys and labels,
 * never values — and the executive brief's already-validated prose. It may
 * only cite a figure by `[[key]]`; the code writes the number in at render.
 * What reaches the model: the audience, the title, the section titles, the
 * brief's headline and beats, the figure labels. No quote, no comment, no
 * name of a person — so a cover is not something erasure has to chase.
 *
 * Logged to ai_call_log as pass 'report_cover' with the model named
 * explicitly (logAiCall defaults to ANALYSIS_MODEL). Any failure — API, parse,
 * everything scrubbed — falls back to the code cover; a build never waits on
 * or fails for this call.
 */

export interface CoverArgs {
  admin: SupabaseClient
  clientId: string
  runId: string | null
  register: Audience
  title: string
  company: string
  period: string
  sectionTitles: string[]
  brief: { headline: string; beats: string[] } | null
  figures: FigureTable
  /** A reader typed by the operator ("the board", "the Nordic sales team"); overrides the register's description. */
  reader?: string | null
}

// v2 (Stage 3): a share figure gets a sentence template like a count does —
// "Sentiment is 87.2%" read as a bare equation because the % sign is already in
// the substituted value and the model was only told where it stands.
export const COVER_PROMPT_VERSION = 'report_cover_v2'

const CoverSchema = z.object({
  sentences: z.array(z.string()),
})

const REGISTER: Record<Audience, string> = {
  leadership: 'Leadership: they decide and carry the exposure. Lead with what changed and what it means for the company; one sentence on what is being asked of them. No process, no method.',
  marketing: 'Marketing: they act on this. Say what the market is saying and what that suggests doing next; name the theme and the competitor where the figures allow.',
  sales: 'Sales: they talk to customers every day. Say what customers push back on and how competitors are talked about, so they know what they will hear and what to say.',
  content: 'Content: they make the next video. Say what is working, what people respond to, and how customers phrase things: the material, not the strategy.',
  general: 'Anyone in the company: plain and short; what this is, where it comes from, what stood out.',
}

export function buildCoverPrompts(a: Omit<CoverArgs, 'admin' | 'clientId' | 'runId'>): { system: string; user: string } {
  const figureLines = Object.entries(a.figures).map(([k, f]) =>
    f.kind === 'count' ? `- [[${k}]]: a count of ${f.label}; write it as "[[${k}]] ${f.label}"`
    : f.kind === 'pct' ? `- [[${k}]]: a share, already written with its % sign: ${f.label}; put it after a verb, as in "${f.label} stood at [[${k}]]" or "reached [[${k}]]"; the placeholder ends the clause. Never "is [[${k}]]", never "[[${k}]] of the …"`
    : `- [[${k}]]: a name: ${f.label}; the placeholder stands where the name is read`)
  const system = [
    'You write the cover paragraph of a research report built from what a brand\'s audience says in public comments. The report is prepared BY the client company for people inside it; you write as the company, never as a vendor.',
    a.reader?.trim() ? `Reader: ${a.reader.trim()}. Write for them, in plain English, about what matters to them.` : `Reader: ${REGISTER[a.register]}`,
    'Rules:',
    '- Three to five sentences, one paragraph, plain English, no headings, no bullet points, no exclamation marks, no greeting.',
    '- You have NO numbers. Where a number belongs, write the figure\'s placeholder exactly as given, e.g. "[[videos]] conversations". The product substitutes the real value. Never type a digit. Never invent a figure that is not in the list.',
    '- Cite at most four figures; at least one. A placeholder is read aloud as its value: a count is followed by what it counts ("[[comments]] comments read"), never used as a noun ("the findings in [[competitive_findings]]" is wrong).',
    '- A figure means exactly what its label says. Do not attach it to a narrower claim: "[[videos]] conversations analysed" is true; "the theme appears in [[videos]] conversations" is not.',
    CALIBRATED_PROSE_RULE,
    '- Do not name the tool, the model or "AI". Do not say "this report"; say what was found.',
    '- No dashes between clauses (no em dash, no en dash, no spaced hyphen); use a comma, a colon or a full stop.',
    '- Do not promise, recommend beyond the brief\'s own recommendation, or address the reader as "you" more than once.',
  ].join('\n')
  const user = [
    `Company: ${a.company}`,
    `Report title: ${a.title}`,
    `Period: ${a.period}`,
    `Pages in the report, in order: ${dedupeTitles(a.sectionTitles).join(' · ') || '(none)'}`,
    a.brief ? `Executive brief headline: ${a.brief.headline}` : 'Executive brief: not included in this report.',
    a.brief?.beats.length ? `Executive brief beats:\n${a.brief.beats.map((b) => `- ${b}`).join('\n')}` : '',
    figureLines.length ? `Figures available (cite by placeholder; you do not know their values):\n${figureLines.join('\n')}` : 'Figures available: none, write without numbers.',
  ].filter(Boolean).join('\n\n')
  return { system, user }
}

export async function generateCover(args: CoverArgs): Promise<CoverText> {
  const fallback = () => composeFallbackCover(args)
  if (!process.env.OPENAI_API_KEY) return fallback()
  const { system, user } = buildCoverPrompts(args)
  const startedAt = Date.now()
  try {
    const completion = await openai.chat.completions.parse({
      model: COVER_MODEL,
      reasoning_effort: 'low',
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      response_format: zodResponseFormat(CoverSchema, 'report_cover'),
    })
    const usage = completion.usage
      ? { prompt_tokens: completion.usage.prompt_tokens, completion_tokens: completion.usage.completion_tokens }
      : { prompt_tokens: 0, completion_tokens: 0 }
    const parsed = completion.choices[0]?.message?.parsed ?? null
    const raw = (parsed?.sentences ?? []).map((s) => s.trim()).filter(Boolean).flatMap(splitSentences).slice(0, 6).join(' ')
    const scrubbed = scrubCover(raw, args.figures, { magnitude: MAGNITUDE_RE, figure: FIGURE_RE, tidy })
    const usable = splitSentences(scrubbed.body).length >= 2
    await logAiCall(args.admin, {
      clientId: args.clientId, runId: args.runId, pass: 'report_cover', callIndex: 1, model: COVER_MODEL,
      promptVersion: COVER_PROMPT_VERSION, systemPrompt: system, userPrompt: user,
      response: { sentences: parsed?.sentences?.length ?? 0, kept: splitSentences(scrubbed.body).length, dropped: scrubbed.dropped, leaked: scrubbed.leaked, usable, register: args.register },
      error: parsed ? null : 'no parsed output', usage, durationMs: Date.now() - startedAt,
      validationStatus: !parsed ? 'parse_error' : usable ? (scrubbed.leaked ? 'scrubbed' : 'ok') : 'empty',
    }).catch((e) => console.warn('[report_cover] log failed:', e))
    if (!usable) return fallback()
    return { title: args.title, body: scrubbed.body, register: args.register, fallback: false, generatedAt: new Date().toISOString(), model: COVER_MODEL }
  } catch (e) {
    console.warn('[report_cover] model call failed, using the code cover:', e instanceof Error ? e.message : e)
    await logAiCall(args.admin, {
      clientId: args.clientId, runId: args.runId, pass: 'report_cover', callIndex: 1, model: COVER_MODEL,
      promptVersion: COVER_PROMPT_VERSION, systemPrompt: system, userPrompt: user, response: null,
      error: e instanceof Error ? e.message : String(e), usage: { prompt_tokens: 0, completion_tokens: 0 },
      durationMs: Date.now() - startedAt, validationStatus: 'parse_error',
    }).catch(() => {})
    return fallback()
  }
}
