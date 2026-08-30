import type { SupabaseClient } from '@supabase/supabase-js'
import { zodResponseFormat } from 'openai/helpers/zod'
import { openai } from '../../openai'
import { SYNTHESIS_MODEL, SYNTHESIS_REASONING_EFFORT, estimateCost } from '../../config'
import { logAiCall } from '../../pipeline/ai-log'
import { DOCUMENT_PROMPT_VERSION, WriterSchema, buildWriterPrompts, type WriterArgs, type WriterOutput } from './write'

/**
 * The writing call. The reasoning model, one structured call over the
 * skeleton, logged as pass 'document_write'. There is no code fallback for a
 * whole document the way there is for a cover: a build without words is a
 * failed build, said plainly. One retry on a parse failure or an API error.
 */

export const DOCUMENT_WRITER_MODEL = SYNTHESIS_MODEL

export class WriteFailedError extends Error {}

export async function generateDocument(
  admin: SupabaseClient,
  args: WriterArgs & { clientId: string; runId: string | null },
): Promise<{ written: WriterOutput; costUsd: number; ms: number; promptTokens: number; completionTokens: number }> {
  if (!process.env.OPENAI_API_KEY) throw new WriteFailedError('OPENAI_API_KEY is not set')
  const { system, user } = buildWriterPrompts(args)
  let lastError = ''
  for (let attempt = 1; attempt <= 2; attempt++) {
    const startedAt = Date.now()
    try {
      const completion = await openai.chat.completions.parse({
        model: DOCUMENT_WRITER_MODEL,
        reasoning_effort: SYNTHESIS_REASONING_EFFORT,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        response_format: zodResponseFormat(WriterSchema, 'document'),
      })
      const usage = completion.usage
        ? { prompt_tokens: completion.usage.prompt_tokens, completion_tokens: completion.usage.completion_tokens }
        : { prompt_tokens: 0, completion_tokens: 0 }
      const parsed = completion.choices[0]?.message?.parsed ?? null
      const ms = Date.now() - startedAt
      await logAiCall(admin, {
        clientId: args.clientId, runId: args.runId, pass: 'document_write', callIndex: attempt, model: DOCUMENT_WRITER_MODEL,
        promptVersion: DOCUMENT_PROMPT_VERSION, systemPrompt: system, userPrompt: user,
        response: parsed ? { findings: parsed.findings.length, competitors: parsed.competitors.length, personaLines: parsed.persona_lines.length, notSure: parsed.not_sure_yet.length } : null,
        error: parsed ? null : 'no parsed output', usage, durationMs: ms,
        validationStatus: parsed ? 'ok' : 'parse_error',
      }).catch((e) => console.warn('[document_write] log failed:', e))
      if (!parsed) { lastError = 'no parsed output'; continue }
      const costUsd = estimateCost(DOCUMENT_WRITER_MODEL, usage.prompt_tokens, usage.completion_tokens)
      return { written: parsed, costUsd, ms, promptTokens: usage.prompt_tokens, completionTokens: usage.completion_tokens }
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e)
      console.warn(`[document_write] attempt ${attempt} failed:`, lastError)
      await logAiCall(admin, {
        clientId: args.clientId, runId: args.runId, pass: 'document_write', callIndex: attempt, model: DOCUMENT_WRITER_MODEL,
        promptVersion: DOCUMENT_PROMPT_VERSION, systemPrompt: system, userPrompt: user, response: null,
        error: lastError, usage: { prompt_tokens: 0, completion_tokens: 0 }, durationMs: Date.now() - startedAt, validationStatus: 'parse_error',
      }).catch(() => {})
    }
  }
  throw new WriteFailedError(`The writing pass failed twice: ${lastError}`)
}
