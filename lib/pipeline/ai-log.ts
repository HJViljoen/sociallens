import type { createAdminClient } from '../supabase-admin'
import { ANALYSIS_MODEL, estimateCost } from '../config'

// Shared ai_call_log writer for the single-call passes (B/C/D). One row per GPT
// call (invariant 4): request, response, tokens, cost, duration, validation
// status. Pass A keeps its own inline logger; this avoids duplicating it across
// the synthesis passes.

export interface AiLogArgs {
  clientId: string
  /** null for calls outside a pipeline run (a report cover). */
  runId: string | null
  pass: string
  callIndex: number
  /** Model the call ran on. Defaults to ANALYSIS_MODEL for older callers. */
  model?: string
  promptVersion: string
  systemPrompt: string
  userPrompt: string
  response: unknown
  error: string | null
  usage: { prompt_tokens: number; completion_tokens: number }
  durationMs: number
  validationStatus: string
}

export async function logAiCall(admin: ReturnType<typeof createAdminClient>, a: AiLogArgs): Promise<void> {
  const model = a.model ?? ANALYSIS_MODEL
  await admin.from('ai_call_log').insert({
    client_id: a.clientId,
    run_id: a.runId,
    pass: a.pass,
    call_index: a.callIndex,
    model,
    prompt_version: a.promptVersion,
    request: { system: a.systemPrompt, user: a.userPrompt },
    response: a.response,
    error_message: a.error,
    prompt_tokens: a.usage.prompt_tokens,
    completion_tokens: a.usage.completion_tokens,
    cost_usd: estimateCost(model, a.usage.prompt_tokens, a.usage.completion_tokens),
    duration_ms: a.durationMs,
    validation_status: a.validationStatus,
  })
}
