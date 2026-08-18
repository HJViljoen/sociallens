import { zodResponseFormat } from 'openai/helpers/zod'
import { openai } from '../openai'
import { createAdminClient, selectAll } from '../supabase-admin'
import { ANALYSIS_MODEL, ANALYSIS_TEMPERATURE, estimateCost } from '../config'
import { logAiCall } from './ai-log'
import { usableTranscript } from './transcript-input'
import {
  CLASSIFIED_TYPES,
  ClassifyMetaSchema,
  HOOK_STYLES,
  VIDEO_SENTIMENTS,
  type ClassifyMetaItem,
  type ClassifyMetaOutput,
} from './schemas'

// Metadata-classification batch ("the later step" promised at pass-a.ts:42,
// built 2026-08-10). Pass A only classifies videos with ≥5 kept comments —
// ~25% of a run's corpus — so per-entity format/hook stats were fiction
// (n=4 for Ottobock on run ef1e28a3). This pass classifies the REMAINDER from
// caption + hashtags + transcript alone, in batches of many videos per
// gpt-4.1-mini call (~$0.20/run). It writes ONLY rows Pass A left null and
// never touches comment-derived fields (comment_quality_score, insights,
// claims — claims coverage is Wave 3 scope).
//
// Pure planning/prompt/validation logic up top (tested in
// classify-meta.test.ts); the I/O runner for the Inngest step below.

export const CLASSIFY_META_PROMPT_VERSION = 'classify_meta_v1'
export const CLASSIFY_META_BATCH = 25

export interface ClassifyInput {
  id: string
  platform: string
  account_name: string
  caption: string | null
  hashtags: string[] | null
  transcript: string | null
  transcript_status: string | null
}

/** Ids of videos still unclassified, chunked into call-sized batches. */
export function planClassifyBatches(
  videos: { id: string; classified_type: string | null }[],
  batchSize = CLASSIFY_META_BATCH,
): string[][] {
  const pending = videos.filter((v) => v.classified_type == null).map((v) => v.id)
  const batches: string[][] = []
  for (let i = 0; i < pending.length; i += batchSize) batches.push(pending.slice(i, i + batchSize))
  return batches
}

export function buildClassifySystemPrompt(): string {
  return [
    'You classify social videos for a consumer-intelligence platform, from METADATA ONLY (caption, hashtags, and a speech transcript when one exists). You never see the footage.',
    '',
    'For each numbered video block, return one entry with its "ref" (e.g. "v1") and:',
    `- classified_type: one of ${CLASSIFIED_TYPES.join(', ')} — or null if the metadata is too thin to tell.`,
    `- hook_style: one of ${HOOK_STYLES.join(', ')} — how the video OPENS. Null if you cannot tell.`,
    '- hook_text: the verbatim opening hook, copied from the start of the transcript or the caption. Never invent or paraphrase; null if neither shows a real hook.',
    '- topics: 1-4 short lowercase topics the video is about. Empty array if unknowable.',
    `- sentiment: one of ${VIDEO_SENTIMENTS.join(', ')} for the video's own framing — or null.`,
    '',
    'Honesty over coverage: a null is correct whenever the metadata does not support a judgment. Return one entry per block, no extras.',
  ].join('\n')
}

export function buildClassifyUserPrompt(videos: ClassifyInput[]): string {
  return videos
    .map((v, i) => {
      const lines = [
        `[v${i + 1}] platform: ${v.platform} · account: @${v.account_name}`,
        `caption: ${v.caption?.trim() || '(none)'}`,
      ]
      if (v.hashtags?.length) lines.push(`hashtags: ${v.hashtags.join(' ')}`)
      const transcript = usableTranscript(v)
      if (transcript) lines.push(`transcript: ${transcript}`)
      return lines.join('\n')
    })
    .join('\n\n')
}

/**
 * Map validated model output back onto video ids by block ref. Bad refs
 * (unknown, out of range, duplicate) are dropped, never guessed — the
 * T#/S# ref-validation invariant.
 */
export function validateClassifyResponse(
  parsed: ClassifyMetaOutput,
  batchIds: string[],
): Map<string, ClassifyMetaItem> {
  const out = new Map<string, ClassifyMetaItem>()
  for (const item of parsed.videos) {
    const m = /^v(\d+)$/.exec(item.ref.trim())
    if (!m) continue
    const idx = Number(m[1]) - 1
    if (idx < 0 || idx >= batchIds.length) continue
    const id = batchIds[idx]
    if (out.has(id)) continue
    out.set(id, {
      ...item,
      hook_text: item.hook_text?.trim() || null,
      topics: item.topics.map((t) => t.trim().toLowerCase()).filter(Boolean).slice(0, 4),
    })
  }
  return out
}

// ---- I/O runner (one Inngest step = one batch) ------------------------------

/** Plan step: this run's discovered corpus, still-unclassified only. Run-scoped
 *  (unlike Pass A's whole-client plan) — the batch exists for the Content
 *  page's per-entity stats, which read the current gather. */
export async function planClassifyMetaBatches(clientId: string, runId: string): Promise<string[][]> {
  const admin = createAdminClient()
  const videos = await selectAll<{ id: string; classified_type: string | null }>(() =>
    admin
      .from('videos')
      .select('id, classified_type')
      .eq('client_id', clientId)
      .eq('run_id', runId)
      .eq('source', 'discovered')
      .order('id'),
  )
  return planClassifyBatches(videos)
}

export interface ClassifyMetaResult {
  requested: number
  classified: number
  nulls: number
  costUsd: number
  error?: string
}

/** Classify one batch of videos and persist. Only rows still unclassified are
 *  written (Pass A's comment-informed output always wins). */
export async function runClassifyMetaBatch(
  clientId: string,
  runId: string,
  videoIds: string[],
  callIndex: number,
): Promise<ClassifyMetaResult> {
  const admin = createAdminClient()
  const videos = await selectAll<ClassifyInput & { classified_type: string | null }>(() =>
    admin
      .from('videos')
      .select('id, platform, account_name, caption, hashtags, transcript, transcript_status, classified_type')
      .eq('client_id', clientId)
      .in('id', videoIds)
      .order('id'),
  )
  // Re-check the null guard at write-distance: a resumed run may have
  // classified some of these since the plan step.
  const pending = videos.filter((v) => v.classified_type == null)
  if (pending.length === 0) return { requested: videoIds.length, classified: 0, nulls: 0, costUsd: 0 }

  const batchIds = pending.map((v) => v.id)
  const systemPrompt = buildClassifySystemPrompt()
  const userPrompt = buildClassifyUserPrompt(pending)
  const startedAt = Date.now()

  const completion = await openai.chat.completions.parse({
    model: ANALYSIS_MODEL,
    temperature: ANALYSIS_TEMPERATURE,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    response_format: zodResponseFormat(ClassifyMetaSchema, 'classify_meta'),
  })
  const msg = completion.choices[0]?.message
  const parsed = (msg?.parsed ?? null) as ClassifyMetaOutput | null
  const usage = completion.usage ?? { prompt_tokens: 0, completion_tokens: 0 }
  const costUsd = estimateCost(ANALYSIS_MODEL, usage.prompt_tokens, usage.completion_tokens)

  await logAiCall(admin, {
    clientId,
    runId,
    pass: 'classify_meta',
    callIndex,
    model: ANALYSIS_MODEL,
    promptVersion: CLASSIFY_META_PROMPT_VERSION,
    systemPrompt,
    userPrompt,
    response: parsed,
    error: msg?.refusal ?? (parsed ? null : 'no parsed output'),
    usage: { prompt_tokens: usage.prompt_tokens, completion_tokens: usage.completion_tokens },
    durationMs: Date.now() - startedAt,
    validationStatus: parsed ? 'valid' : 'parse_error',
  })
  if (!parsed) return { requested: videoIds.length, classified: 0, nulls: 0, costUsd, error: msg?.refusal ?? 'no parsed output' }

  const byId = validateClassifyResponse(parsed, batchIds)
  let classified = 0
  let nulls = 0
  for (const [id, item] of byId) {
    if (item.classified_type == null && item.hook_style == null && item.topics.length === 0) {
      nulls++
      continue
    }
    const { error } = await admin
      .from('videos')
      .update({
        classified_type: item.classified_type,
        hook_style: item.hook_style,
        hook_text: item.hook_text,
        topics: item.topics.length ? item.topics : null,
        // Framing sentiment (caption + transcript, no comments). Provenance is
        // stamped so run_summary never blends it with Pass A's audience read
        // (T0-8): the two families are different measurements.
        sentiment: item.sentiment,
        sentiment_source: item.sentiment == null ? null : 'framing',
      })
      .eq('id', id)
      .is('classified_type', null)
    if (error) throw new Error(`classify-meta persist: ${error.message}`)
    classified++
  }
  return { requested: videoIds.length, classified, nulls, costUsd }
}
