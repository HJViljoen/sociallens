import { zodResponseFormat } from 'openai/helpers/zod'
import { createAdminClient } from '../supabase-admin'
import { openai, samplingParams } from '../openai'
import { SYNTHESIS_MODEL, estimateCost, PASS_B_CHUNK, PASS_B_PARALLEL } from '../config'
import { PassBSchema, type PassBOutput } from './schemas'
import { logAiCall } from './ai-log'
import { indexThemes } from './pass-c'
import { CALIBRATED_PROSE_RULE } from './prose-rules'
import type { AggregatedTheme } from './types'

// Pass B — canonical theme labels + descriptions (Redesign Spec 2026-07-03 §8).
// One cheap GPT call over ALL of Step A2's themes (floor-passing + early
// signals): each T# gets a clean, client-facing label + one-sentence
// description. Labels become page headlines, so polish is front-of-house.
// A theme the model skips (or references wrongly) falls back to its humanised
// slug — the pipeline never stalls on labelling.

// v2 (2026-07-04): calibrated-language prose rule — descriptions must not carry
// intensity/frequency words; prevalence badges next to the label say how much.
const PROMPT_VERSION = 'pass_b_v2'

export interface RunPassBOptions {
  clientId: string
  runId: string
  /** Mutated in place: label/description set on each theme. */
  themes: AggregatedTheme[]
  /** The client's display name — labels may name it, never "the client". */
  brandName?: string
  persist?: boolean
  dryRun?: boolean
}

export interface RunPassBResult {
  labelled: number
  fallbacks: number
  rejectedRefs: number
  promptTokens: number
  completionTokens: number
  costUsd: number
  dryRun: boolean
}

/** Fallback label when Pass B misses a theme: the slug as words. */
export function humaniseSlug(slug: string): string {
  const words = slug.replace(/_/g, ' ').trim()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

function buildSystemPrompt(brandName?: string): string {
  const name = brandName?.trim() || 'the brand'
  return [
    `You are naming consumer-intelligence themes for a client-facing report read by ${name}.`,
    '',
    'Each input theme is a cluster of audience insights distilled from real social-media comments.',
    'For every theme index, return:',
    '- label: a specific, plain-English headline for the theme, 3–7 words, sentence case. It must say what customers are actually talking about (e.g. "Cost and insurance frustration", not "Feedback" or "cost_concerns").',
    '- description: ONE clear sentence a marketer skims — what these commenters are saying and the feeling behind it.',
    '',
    'Rules:',
    '- Cover EVERY index in the input exactly once, using only indices present in the input.',
    '- No counts, percentages, or scores. No slugs, snake_case, or internal jargon.',
    CALIBRATED_PROSE_RULE,
    `- When the brand matters to the theme, call it "${name}" — never "the client".`,
    '- Labels must be distinct from each other — if two themes are close, sharpen the difference.',
  ].join('\n')
}

function buildUserPrompt(themeIndex: { label: string; theme: AggregatedTheme }[]): string {
  const lines: string[] = [`THEMES (${themeIndex.length})`]
  for (const { label, theme } of themeIndex) {
    lines.push(
      `[${label}] bucket=${theme.bucket} category=${theme.category} slugs: ${theme.memberThemes.join(', ')}`,
    )
    for (const d of theme.sampleDescriptions) lines.push(`    e.g. ${d}`)
  }
  return lines.join('\n')
}

/**
 * Cut the indexed themes into labelling calls (T0-5). Buckets first, so the
 * themes a call is asked to keep distinct from each other are the ones that
 * actually compete (same entity); then by size, because bucket sizes are wildly
 * uneven — industry-other alone can carry most of a run's themes, so splitting
 * only by bucket would leave the longest call almost as long as before.
 * Indices stay globally unique (T1..Tn), so one lookup map serves every chunk.
 */
export function chunkThemesForLabelling(
  indexed: { label: string; theme: AggregatedTheme }[],
  chunkSize: number = PASS_B_CHUNK,
): { label: string; theme: AggregatedTheme }[][] {
  const byBucket = new Map<string, { label: string; theme: AggregatedTheme }[]>()
  for (const entry of indexed) {
    const arr = byBucket.get(entry.theme.bucket)
    if (arr) arr.push(entry)
    else byBucket.set(entry.theme.bucket, [entry])
  }
  const chunks: { label: string; theme: AggregatedTheme }[][] = []
  for (const group of byBucket.values()) {
    for (let i = 0; i < group.length; i += chunkSize) {
      chunks.push(group.slice(i, i + chunkSize))
    }
  }
  return chunks
}

export async function runPassB(opts: RunPassBOptions): Promise<RunPassBResult> {
  const { clientId, runId, themes } = opts
  const dryRun = opts.dryRun ?? false
  const persist = opts.persist ?? !dryRun
  const admin = createAdminClient()

  const result: RunPassBResult = {
    labelled: 0, fallbacks: 0, rejectedRefs: 0,
    promptTokens: 0, completionTokens: 0, costUsd: 0, dryRun,
  }

  // Fallbacks up front — every theme leaves this pass with a usable label.
  for (const t of themes) {
    t.label = humaniseSlug(t.theme)
    t.description = t.description ?? t.sampleDescriptions[0]
  }
  if (themes.length === 0 || dryRun) return result

  const themeIndex = indexThemes(themes)
  const systemPrompt = buildSystemPrompt(opts.brandName)
  const chunks = chunkThemesForLabelling(themeIndex)

  /** One labelling call. Returns what it labelled; a failure returns null and
   *  those themes simply keep their slug fallback — labelling must never sink
   *  the run, and now one bad chunk no longer costs the whole run its labels. */
  const labelChunk = async (
    chunk: { label: string; theme: AggregatedTheme }[],
    callIndex: number,
  ): Promise<{ parsed: PassBOutput | null; usage: { prompt_tokens: number; completion_tokens: number }; durationMs: number; userPrompt: string }> => {
    const userPrompt = buildUserPrompt(chunk)
    const startedAt = Date.now()
    let usage = { prompt_tokens: 0, completion_tokens: 0 }
    try {
      const completion = await openai.chat.completions.parse({
        model: SYNTHESIS_MODEL,
        ...samplingParams(SYNTHESIS_MODEL),
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        response_format: zodResponseFormat(PassBSchema, 'pass_b'),
      })
      if (completion.usage) {
        usage = { prompt_tokens: completion.usage.prompt_tokens, completion_tokens: completion.usage.completion_tokens }
      }
      return { parsed: completion.choices[0]?.message?.parsed ?? null, usage, durationMs: Date.now() - startedAt, userPrompt }
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e)
      console.error(`[pass-b] chunk ${callIndex}/${chunks.length} failed: ${error}`)
      if (persist) {
        await logAiCall(admin, { clientId, runId, pass: 'pass_b', callIndex, model: SYNTHESIS_MODEL, promptVersion: PROMPT_VERSION, systemPrompt, userPrompt, response: null, error, usage, durationMs: Date.now() - startedAt, validationStatus: 'parse_error' })
      }
      return { parsed: null, usage, durationMs: Date.now() - startedAt, userPrompt }
    }
  }

  const seen = new Set<string>()
  for (let w = 0; w < chunks.length; w += PASS_B_PARALLEL) {
    const wave = await Promise.all(
      chunks.slice(w, w + PASS_B_PARALLEL).map((chunk, j) => labelChunk(chunk, w + j + 1)),
    )
    for (let j = 0; j < wave.length; j++) {
      const { parsed, usage, durationMs, userPrompt } = wave[j]
      result.promptTokens += usage.prompt_tokens
      result.completionTokens += usage.completion_tokens
      result.costUsd += estimateCost(SYNTHESIS_MODEL, usage.prompt_tokens, usage.completion_tokens)
      if (!parsed) continue

      // The lookup is scoped to THIS chunk. Indices are globally unique and
      // non-contiguous within a chunk (themes are strength-sorted before being
      // grouped by bucket), which is exactly the shape a model "helpfully"
      // renumbers from T1. A global map would resolve that renumbering to some
      // other chunk's theme and silently overwrite its label, with
      // rejectedRefs 0 and validation 'ok'. Scoped, it is rejected.
      const byLabel = new Map(chunks[w + j].map((t) => [t.label.toLowerCase(), t.theme]))
      let labelledHere = 0
      let rejectedHere = 0
      for (const tl of parsed.theme_labels ?? []) {
        const key = tl.index.toLowerCase().trim()
        const theme = byLabel.get(key)
        if (!theme || seen.has(key) || !tl.label.trim()) {
          rejectedHere++
          continue
        }
        seen.add(key)
        theme.label = tl.label.trim()
        theme.description = tl.description.trim() || theme.description
        labelledHere++
      }
      result.labelled += labelledHere
      result.rejectedRefs += rejectedHere

      if (persist) {
        await logAiCall(admin, {
          clientId, runId, pass: 'pass_b', callIndex: w + j + 1, model: SYNTHESIS_MODEL, promptVersion: PROMPT_VERSION, systemPrompt, userPrompt,
          response: { labelled: labelledHere, rejected_refs: rejectedHere, chunk: `${w + j + 1}/${chunks.length}` },
          error: null, usage, durationMs,
          validationStatus: rejectedHere > 0 ? 'ref_rejected' : 'ok',
        })
      }
    }
  }
  result.fallbacks = themes.length - result.labelled
  return result
}
