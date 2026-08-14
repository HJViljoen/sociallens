import { runActor } from './apify'
import { createAdminClient } from '../supabase-admin'
import {
  APIFY_ACTORS,
  ANALYSIS_MODEL,
  SUBREDDIT_PROBE_SAMPLE,
  SUBREDDIT_PROBE_MIN_RATIO,
  SUBREDDIT_PROBE_MIN_KEPT,
} from '../config'
import { logAiCall } from '../pipeline/ai-log'
import { classifyRelevance, type RelevanceMethod } from './relevance'
import { reddit } from './platforms/reddit'
import { subredditLabel } from './subreddits'
import type { GatherConfig, RawItem, SubredditEntry } from './types'

// Subreddit auto-discovery, step 2 of 2: PROBE.
//
// A proposed subreddit is a guess. This samples the community's actual recent
// posts and runs them through the SAME relevance gate the real gather uses, then
// aggregates per-community. That aggregation is the piece the gate does not
// provide: classifyRelevance returns per-post verdicts only, and "is this
// community worth searching" is a question about the source, not a post.
//
// Sampling the subreddit's own recent posts (rather than searching keywords
// inside it) is deliberate: keyword-scoped sampling would only ever confirm that
// a community mentioning our keywords mentions our keywords. What we need to
// know is whether the community is ON-CATEGORY generally.

/** Actor input for one probe: the candidate's recent posts, no comments. */
export function buildProbeInput(name: string, sample = SUBREDDIT_PROBE_SAMPLE): RawItem {
  return {
    subredditUrls: [name],
    maxPostsCount: sample,
    crawlCommentsPerPost: false, // a probe never pays for comments
    includeNSFW: false,
  }
}

export interface ProbeOutcome {
  status: 'active' | 'rejected'
  reason: string
}

/**
 * Pure: does a sampled community clear the bar?
 *
 * Both a ratio and an absolute floor, because either alone is gameable — a
 * half-empty sample passes on ratio (2 of 4), and a huge noisy community passes
 * on count. An empty sample is a rejection, not a pass: a community we could not
 * read is not a community we should search.
 */
export function probeVerdict(
  sampled: number,
  kept: number,
  opts: { minRatio?: number; minKept?: number } = {},
): ProbeOutcome {
  const minRatio = opts.minRatio ?? SUBREDDIT_PROBE_MIN_RATIO
  const minKept = opts.minKept ?? SUBREDDIT_PROBE_MIN_KEPT
  if (sampled === 0) return { status: 'rejected', reason: 'no posts returned' }
  const ratio = kept / sampled
  if (kept < minKept) {
    return { status: 'rejected', reason: `only ${kept}/${sampled} on-category (floor ${minKept})` }
  }
  if (ratio < minRatio) {
    return { status: 'rejected', reason: `${kept}/${sampled} on-category = ${Math.round(ratio * 100)}% (floor ${Math.round(minRatio * 100)}%)` }
  }
  return { status: 'active', reason: `${kept}/${sampled} on-category = ${Math.round(ratio * 100)}%` }
}

/**
 * Probe candidates and return them resolved to active/rejected.
 *
 * Every candidate is probed independently and a failure rejects only that one —
 * Reddit is a degradable platform and a flaky actor must never take down
 * discovery, let alone a run.
 */
export async function probeSubreddits(opts: {
  clientId: string
  runId: string
  config: GatherConfig
  candidates: SubredditEntry[]
  today: string
  method?: RelevanceMethod
  sample?: number
}): Promise<SubredditEntry[]> {
  const admin = createAdminClient()
  const method = opts.method ?? 'gpt'
  const sample = opts.sample ?? SUBREDDIT_PROBE_SAMPLE
  const resolved: SubredditEntry[] = []

  for (const [i, candidate] of opts.candidates.entries()) {
    try {
      const raw = await runActor(APIFY_ACTORS.reddit.video, buildProbeInput(candidate.name, sample), {
        timeoutSecs: 120,
      })
      const ctx = { clientId: opts.clientId, runId: opts.runId, config: opts.config }
      const posts = raw
        .map((r) => reddit.normaliseVideo(r, ctx))
        .filter((v): v is NonNullable<typeof v> => v !== null)

      const startedAt = Date.now()
      const gate = await classifyRelevance(posts, { method, config: opts.config })
      const kept = posts.filter((p) => gate.verdicts.get(p.video_id)?.relevant !== false).length
      const outcome = probeVerdict(posts.length, kept)

      // The gate's spend is invisible everywhere else (gatePlatform discards
      // costUsd), and discovery would otherwise be a silently paid loop.
      await logAiCall(admin, {
        clientId: opts.clientId,
        runId: opts.runId,
        pass: 'subreddit_probe',
        callIndex: i + 1,
        model: ANALYSIS_MODEL,
        promptVersion: 'subreddit_probe_v1',
        systemPrompt: `relevance gate (${method})`,
        userPrompt: `${subredditLabel(candidate.name)} — ${posts.length} sampled posts`,
        response: { subreddit: candidate.name, sampled: posts.length, kept, ...outcome },
        error: null,
        usage: { prompt_tokens: gate.promptTokens, completion_tokens: gate.completionTokens },
        durationMs: Date.now() - startedAt,
        validationStatus: 'ok',
      })

      console.log(
        `[reddit] probe ${subredditLabel(candidate.name)}: ${outcome.status} — ${outcome.reason}`,
      )
      resolved.push({
        ...candidate,
        status: outcome.status,
        probe: { sampled: posts.length, kept, at: opts.today },
      })
    } catch (e) {
      // A probe that could not run is NOT a rejection — the community was never
      // judged. It stays a candidate so a later run can try again.
      console.error(
        `[reddit] probe ${subredditLabel(candidate.name)} failed: ${e instanceof Error ? e.message : String(e)}`,
      )
      resolved.push(candidate)
    }
  }
  return resolved
}
