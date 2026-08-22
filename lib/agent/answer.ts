import { zodResponseFormat } from 'openai/helpers/zod'
import { z } from 'zod'
import { openai, samplingParams } from '../openai'
import { SYNTHESIS_MODEL, estimateCost, AGENT_HISTORY_TURNS } from '../config'
import { logAiCall } from '../pipeline/ai-log'
import { CALIBRATED_PROSE_RULE, stripThemeRefs } from '../pipeline/prose-rules'
import { enforceRegisters, type RawAnswer } from './enforce'
import { interpretQuestion } from './interpret'
import { retrieveForQueries, latestRunId, type RetrievedInsight } from './retrieve'
import { loadTrendContext, type TrendContext } from './trend'
import type { AgentAnswer, QuestionPlan } from './types'

// The answering half. Retrieval has already put real insights and real quotes
// on the table; this asks the model to answer the client's question FROM them,
// and then lib/agent/enforce.ts decides what the client is allowed to see as
// evidence.
//
// One call, not two. The Ask engine splits verdict and judgement across two
// calls so a proposal cannot drift into the evidence field — here the same
// guarantee comes from enforcement instead: a point is grounded because its ids
// resolve, not because the model put it under the right heading. One call keeps
// a conversational turn inside a sane latency budget, which two 165-237s
// synthesis calls would not.

export const PROMPT_VERSION_ANSWER = 'agent_answer_v1'

const AnswerSchema = z.object({
  answer: z.string(),
  grounded: z.array(z.object({ text: z.string(), insight_ids: z.array(z.string()) })),
  judgement: z.array(z.object({ text: z.string(), based_on: z.array(z.string()) })),
  nearest: z.array(z.object({ text: z.string(), insight_ids: z.array(z.string()) })),
})

export function buildAnswerPrompt(companyName: string, allowNearest: boolean): string {
  return [
    `You are Verbatim, answering a question for someone at ${companyName} from public consumer conversation their category has already been mined for.`,
    'You are an analyst speaking in your own voice. You are NOT a persona and you never speak as a consumer.',
    '',
    'ANSWER FIRST. `answer` is 1-3 sentences that actually answer what was asked. Not a preamble, not a description of what you found.',
    '',
    'THREE REGISTERS, and the difference is the whole product:',
    '- `grounded[]`: points the evidence below supports. EVERY entry must list the insight ids it rests on, copied exactly from the numbered evidence. A point you cannot tie to an id does not belong here.',
    '- `judgement[]`: your own reading — what you would do, what connects, what it implies. Propose freely here. Each entry cites the grounded points it reasons from by their [G#] label. This register is welcome and expected; an answer that is only description is less useful than one that says what it means.',
    allowNearest
      ? '- `nearest[]`: ONLY when the evidence does not address the question but does address something adjacent worth knowing. Say plainly that it is not what was asked. Leave empty otherwise.'
      : '- `nearest[]`: always empty. Leave it as an empty array.',
    '',
    'RULES:',
    '- Never invent an insight id. Use only ids present in the evidence.',
    '- Never quote a comment yourself — the product attaches the real quotes to your grounded points. Describe what people express; do not reproduce their words.',
    '- If the evidence genuinely does not speak to the question, return an empty `grounded` array rather than stretching. Saying nothing is a real answer here and it is not a failure.',
    "- Do not describe the company's own metrics, spend or results. You cannot see them.",
    CALIBRATED_PROSE_RULE,
  ].join('\n')
}

function renderEvidence(insights: RetrievedInsight[]): string {
  return insights
    .map((i) => {
      const bits = [
        `id: ${i.id}`,
        `topic: ${i.theme.replace(/_/g, ' ')}`,
        i.emotion ? `mood: ${i.emotion}` : null,
        i.journeyStage ? `stage: ${i.journeyStage}` : null,
      ].filter(Boolean).join(' | ')
      // Up to two real comments per insight so the model reasons from what
      // people said and not from the pipeline's label — the measured
      // under-recall behind say_vs_hear, which sees labels only.
      const voices = i.quotes.slice(0, 2).map((q) => `      "${q.quote}"`).join('\n')
      return `- ${bits}\n    ${i.description}${voices ? `\n${voices}` : ''}`
    })
    .join('\n')
}

function renderTrend(trend: TrendContext): string {
  const themes = trend.themes
    .filter((t) => t.points.length > 0)
    .map((t) => `- ${t.canonicalLabel}: ${t.movement} (${t.points.map((p) => `${p.runDate}:${p.evidenceCount}`).join(', ')})`)
    .join('\n')
  const summaries = trend.summaries
    .map((s) => `- ${s.runDate}: ${s.totalComments ?? '?'} conversations analysed`)
    .join('\n')
  return [
    'MOVEMENT OVER TIME (counts per reading, not remembered words).',
    'These are evidence counts across past readings. You may describe direction from them.',
    'You may NOT claim to know what anyone said in an earlier reading — that text is not retained.',
    themes || '- no per-topic history for these topics yet',
    summaries,
  ].join('\n')
}

export interface AnswerArgs {
  clientId: string
  companyName: string
  question: string
  runId?: string
  /** Prior turns, oldest first. Trimmed to AGENT_HISTORY_TURNS. */
  history?: { role: 'user' | 'agent'; content: string }[]
  /** Document mode passes false — a silent claim in an annotated document gets
   *  clean space, never a tangent. */
  allowNearest?: boolean
  persist?: boolean
}

export async function answerQuestion(
  admin: ReturnType<typeof import('../supabase-admin').createAdminClient>,
  args: AnswerArgs,
): Promise<AgentAnswer & { plan: QuestionPlan; retrievedCount: number }> {
  const persist = args.persist !== false
  const allowNearest = args.allowNearest !== false
  let costUsd = 0

  const runId = args.runId ?? (await latestRunId(admin, args.clientId))
  if (!runId) {
    // No corpus at all is not silence about the question — it is silence about
    // everything, and the page says so differently.
    throw new Error('No completed run for this workspace yet.')
  }

  const { plan, costUsd: interpretCost } = await interpretQuestion(admin, {
    clientId: args.clientId, runId, companyName: args.companyName, question: args.question, persist,
  })
  costUsd += interpretCost

  const context = await retrieveForQueries(admin, {
    clientId: args.clientId, runId, queries: plan.retrievalQueries,
  })

  if (context.insights.length === 0) {
    // Nothing cleared the floor. Enforcement produces the fixed silence
    // sentence; no synthesis call is made, so silence is also the cheap path.
    const empty = enforceRegisters({}, [], { allowNearest, runId, costUsd })
    return { ...empty, plan, retrievedCount: 0 }
  }

  const trend = plan.timeframe === 'trend'
    ? await loadTrendContext(admin, {
        clientId: args.clientId,
        registryIds: context.insights.map((i) => i.themeRef?.registryId).filter((r): r is string => Boolean(r)),
      })
    : null

  const system = buildAnswerPrompt(args.companyName, allowNearest)
  const historyBlock = (args.history ?? [])
    .slice(-AGENT_HISTORY_TURNS)
    .map((h) => `${h.role === 'user' ? 'They asked' : 'You answered'}: ${h.content}`)
    .join('\n')

  const user = [
    historyBlock ? `EARLIER IN THIS CONVERSATION:\n${historyBlock}\n` : '',
    `QUESTION: ${args.question}`,
    '',
    `EVIDENCE — ${context.insights.length} findings drawn from ${context.conversationCount} conversations:`,
    renderEvidence(context.insights),
    trend ? `\n${renderTrend(trend)}` : '',
  ].filter(Boolean).join('\n')

  const started = Date.now()
  let usage = { prompt_tokens: 0, completion_tokens: 0 }
  let parsed: z.infer<typeof AnswerSchema> | null = null
  try {
    const completion = await openai.chat.completions.parse({
      model: SYNTHESIS_MODEL,
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      response_format: zodResponseFormat(AnswerSchema, 'agent_answer'),
      ...samplingParams(SYNTHESIS_MODEL),
    })
    parsed = completion.choices[0]?.message?.parsed ?? null
    if (completion.usage) {
      usage = { prompt_tokens: completion.usage.prompt_tokens, completion_tokens: completion.usage.completion_tokens }
    }
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e)
    if (persist) {
      await logAiCall(admin, {
        clientId: args.clientId, runId, pass: 'agent_answer', callIndex: 1, model: SYNTHESIS_MODEL,
        promptVersion: PROMPT_VERSION_ANSWER, systemPrompt: system, userPrompt: user,
        response: null, error, usage, durationMs: Date.now() - started, validationStatus: 'parse_error',
      })
    }
    // Fatal, and deliberately so: a failed answer must not be dressed up as
    // silence. "We have nothing on this" is a claim about the CORPUS, and it
    // must never be how a broken call looks to a client.
    throw new Error(`The agent could not answer: ${error}`)
  }

  costUsd += estimateCost(SYNTHESIS_MODEL, usage.prompt_tokens, usage.completion_tokens)
  if (persist) {
    await logAiCall(admin, {
      clientId: args.clientId, runId, pass: 'agent_answer', callIndex: 1, model: SYNTHESIS_MODEL,
      promptVersion: PROMPT_VERSION_ANSWER, systemPrompt: system, userPrompt: user,
      response: parsed, error: null, usage, durationMs: Date.now() - started,
      validationStatus: parsed ? 'ok' : 'parse_error',
    })
  }

  const raw: RawAnswer = {
    answer: stripThemeRefs(parsed?.answer ?? ''),
    grounded: (parsed?.grounded ?? []).map((g) => ({ text: stripThemeRefs(g.text), insightIds: g.insight_ids })),
    judgement: (parsed?.judgement ?? []).map((j) => ({ text: stripThemeRefs(j.text), basedOn: j.based_on })),
    nearest: (parsed?.nearest ?? []).map((n) => ({ text: stripThemeRefs(n.text), insightIds: n.insight_ids })),
  }

  const answer = enforceRegisters(raw, context.insights, { allowNearest, runId, costUsd })
  return { ...answer, plan, retrievedCount: context.insights.length }
}
