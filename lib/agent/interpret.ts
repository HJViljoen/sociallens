import { zodResponseFormat } from 'openai/helpers/zod'
import { z } from 'zod'
import { openai } from '../openai'
import { ANALYSIS_MODEL, estimateCost, AGENT_MAX_QUERIES } from '../config'
import { logAiCall } from '../pipeline/ai-log'
import type { QuestionPlan } from './types'

// Turning a client's question into something the corpus can be searched with.
//
// This exists because of a measured mismatch: clients ask "should we run a
// Black Friday promo", and nothing in the corpus is labelled that. The themes
// are called things like "price_sensitivity" and "waiting_for_sale". Embedding
// the question as typed matches on surface wording and misses the substance —
// the same under-recall that made the Ask engine shortlist by embedding rather
// than by label in the first place.
//
// So: one cheap call that restates the question in the vocabulary of consumer
// conversation, from several angles. It decides NOTHING about the answer. It
// does not see the corpus, it cannot ground anything, and nothing it returns
// reaches the client. Its whole job is to widen recall before retrieval.

export const PROMPT_VERSION_INTERPRET = 'agent_interpret_v1'

const PlanSchema = z.object({
  intent: z.enum(['about_customers', 'about_our_metrics', 'out_of_scope']),
  retrieval_queries: z.array(z.string()),
  timeframe: z.enum(['current', 'trend']),
})

export function buildInterpretPrompt(companyName: string): string {
  return [
    `You prepare searches over a corpus of public consumer conversation (social comments and video transcripts) relevant to ${companyName}'s category.`,
    'You are given a question someone at the company typed. You do NOT answer it. You turn it into search queries.',
    '',
    'Return:',
    '- intent:',
    '  - "about_customers" — answerable from what consumers say in public. Default to this when unsure.',
    '  - "about_our_metrics" — about the company\'s OWN internal numbers (ad spend, revenue, conversion rate, email lists, campaign results). The corpus cannot see these.',
    '  - "out_of_scope" — not a question about the category or its consumers at all (small talk, questions about this tool).',
    '- retrieval_queries: 2-5 short queries describing CONSUMER BEHAVIOUR OR OPINION, in the words consumers would use, from genuinely different angles.',
    '  A question about a discount promotion becomes things like: "price is too expensive", "waiting for a sale before buying", "comparing cost against alternatives".',
    '  Write what a PERSON would say, not a topic label. Never reuse the question\'s marketing vocabulary ("campaign", "positioning", "funnel", "segment") — consumers do not talk like that.',
    '  Different angles, not restatements of one angle. If the question contains several distinct assumptions, cover them.',
    '- timeframe: "trend" only if the question explicitly asks about change over time ("has this shifted", "compared to last quarter", "are people warming to"). Otherwise "current".',
    '',
    'When intent is not "about_customers", still return your best queries — retrieval is cheap and a wrong intent call should not silence a good question.',
  ].join('\n')
}

export async function interpretQuestion(
  admin: ReturnType<typeof import('../supabase-admin').createAdminClient>,
  args: { clientId: string; runId: string; companyName: string; question: string; persist?: boolean },
): Promise<{ plan: QuestionPlan; costUsd: number }> {
  const persist = args.persist !== false
  const system = buildInterpretPrompt(args.companyName)
  const started = Date.now()
  let usage = { prompt_tokens: 0, completion_tokens: 0 }
  let parsed: z.infer<typeof PlanSchema> | null = null

  try {
    const completion = await openai.chat.completions.parse({
      model: ANALYSIS_MODEL,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: args.question },
      ],
      response_format: zodResponseFormat(PlanSchema, 'agent_question_plan'),
    })
    parsed = completion.choices[0]?.message?.parsed ?? null
    if (completion.usage) {
      usage = { prompt_tokens: completion.usage.prompt_tokens, completion_tokens: completion.usage.completion_tokens }
    }
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e)
    if (persist) {
      await logAiCall(admin, {
        clientId: args.clientId, runId: args.runId, pass: 'agent_interpret', callIndex: 1,
        model: ANALYSIS_MODEL, promptVersion: PROMPT_VERSION_INTERPRET,
        systemPrompt: system, userPrompt: args.question, response: null, error,
        usage, durationMs: Date.now() - started, validationStatus: 'parse_error',
      })
    }
    // Deliberately NOT fatal. If the query-writer fails, searching the question
    // as typed is worse than the expansion but far better than telling a client
    // their question could not be processed.
    return { plan: fallbackPlan(args.question), costUsd: 0 }
  }

  const costUsd = estimateCost(ANALYSIS_MODEL, usage.prompt_tokens, usage.completion_tokens)
  if (persist) {
    await logAiCall(admin, {
      clientId: args.clientId, runId: args.runId, pass: 'agent_interpret', callIndex: 1,
      model: ANALYSIS_MODEL, promptVersion: PROMPT_VERSION_INTERPRET,
      systemPrompt: system, userPrompt: args.question, response: parsed, error: null,
      usage, durationMs: Date.now() - started, validationStatus: parsed ? 'ok' : 'parse_error',
    })
  }

  return { plan: normalisePlan(parsed, args.question), costUsd }
}

/** The question as typed, searched directly. Recall is worse; silence is worse
 *  still. */
export function fallbackPlan(question: string): QuestionPlan {
  return { intent: 'about_customers', retrievalQueries: [question.trim()].filter(Boolean), timeframe: 'current' }
}

export function normalisePlan(raw: z.infer<typeof PlanSchema> | null, question: string): QuestionPlan {
  if (!raw) return fallbackPlan(question)
  const queries = [...new Set((raw.retrieval_queries ?? []).map((q) => q.trim()).filter(Boolean))]
    .slice(0, AGENT_MAX_QUERIES)
  // A plan with no queries cannot retrieve, and an empty retrieval reads to the
  // client as "we have nothing on this" — the false silence we are trying not
  // to ship. Fall back to the question itself.
  if (queries.length === 0) return { ...fallbackPlan(question), intent: raw.intent, timeframe: raw.timeframe }
  return { intent: raw.intent, retrievalQueries: queries, timeframe: raw.timeframe }
}
