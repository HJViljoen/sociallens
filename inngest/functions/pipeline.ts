import { randomUUID } from 'crypto'
import { inngest } from '@/inngest/client'
import { createAdminClient, selectAll } from '@/lib/supabase-admin'
import { planGatherSearches, searchOne, gatePlatform, scrapeCommentsBatch, transcribeBatch, resolveGatherWindow, inWindow, type SearchResult } from '@/lib/gather/gather'
import { runPassA } from '@/lib/pipeline/pass-a'
import { runStepA2 } from '@/lib/pipeline/step-a2'
import { runPassB } from '@/lib/pipeline/pass-b'
import { runPassC } from '@/lib/pipeline/pass-c'
import { runPassD } from '@/lib/pipeline/pass-d'
import { runCrossReference } from '@/lib/pipeline/cross-reference'
import { loadBrandClaims } from '@/lib/pipeline/claims'
import { persistThemes, loadThemes } from '@/lib/pipeline/themes'
import { writeRunSummary } from '@/lib/pipeline/run-summary'
import { computeMetrics } from '@/lib/pipeline/metrics'
import { CLUSTER_SIMILARITY_THRESHOLD, EVIDENCE_FLOOR, transcriptsEnabled } from '@/lib/config'
import type { Platform } from '@/lib/gather/types'
import type { VideoRow, CommentRow } from '@/lib/pipeline/types'

// The full Verbatim pipeline as one durable Inngest function — the port of the
// scripts/run-*.ts CLI sequence the orchestrator was always meant to own
// (see the notes in run-gather.ts / run-cd.ts). One run_id flows through every
// stage; each stage is a retryable step decoupled via the DB, so a failure
// resumes from the last completed step rather than re-scraping.
//
// Trigger: `pipeline/run.requested` { clientId, options? }. The cron dispatcher
// (scheduler.ts) and the "Run now" button both emit this event.
//
// Timeout note: every stage is sized to fit the route's duration cap. Gather is
// fanned out per keyword search + per comment batch (a whole platform in one
// step timed out at 300s on the first cloud run — the per-video Apify comment
// scrape dominates); Pass A runs in batches of PASS_A_BATCH videos (the whole
// corpus in one step was ~264 eligible videos ≈ 15-20 min of GPT calls); the
// back half is two steps (themes, then synthesis) decoupled via the themes table.

export interface PipelineRunOptions {
  platforms?: Platform[]
  maxVideos?: number
  videoLimit?: number
  period?: string
  // When set, emit a `report/send.requested` after the run completes so the
  // periodic report goes out. The scheduler sets this; manual "Run now" doesn't.
  sendReport?: boolean
  // Analysis-only resume: reuse an existing run row (reset to 'running') and
  // skip the gather fan-out entirely — the corpus is already in the DB. The
  // operator lever for finishing a run whose analysis half died, without
  // re-paying a 1-2h Apify gather.
  runId?: string
  skipGather?: boolean
}

export const runPipeline = inngest.createFunction(
  {
    id: 'run-pipeline',
    triggers: [{ event: 'pipeline/run.requested' }],
    // One run at a time per client — a new request waits rather than racing an
    // in-flight run on the same corpus.
    concurrency: { limit: 1, key: 'event.data.clientId' },
    retries: 2,
    // A function-level failure (a step out of retries) would otherwise strand
    // the run row at 'running' forever — pages and monitors need a terminal
    // state (found live: the first cloud run's gather timeouts did exactly this).
    onFailure: async ({ event }) => {
      const original = (event.data as { event?: { data?: { clientId?: string } } }).event
      const clientId = original?.data?.clientId
      if (!clientId) return
      const message = (event.data as { error?: { message?: string } }).error?.message ?? 'pipeline function failed'
      const admin = createAdminClient()
      await admin.from('pipeline_runs')
        .update({ status: 'failed', error_message: message, completed_at: new Date().toISOString() })
        .eq('client_id', clientId).eq('status', 'running')
    },
  },
  async ({ event, step }) => {
    const clientId = (event.data as { clientId?: string }).clientId
    if (!clientId) throw new Error('pipeline/run.requested missing clientId')
    const options = ((event.data as { options?: PipelineRunOptions }).options) ?? {}

    // 1. Open the run row (the orchestrator owns the lifecycle the CLI used to).
    //    An analysis-only resume reuses the existing row instead.
    const runId = await step.run('open-run', async () => {
      const admin = createAdminClient()
      if (options.runId) {
        const { error } = await admin
          .from('pipeline_runs')
          .update({ status: 'running', error_message: null, completed_at: null })
          .eq('id', options.runId).eq('client_id', clientId)
        if (error) throw new Error(`reopen run: ${error.message}`)
        return options.runId
      }
      const id = randomUUID()
      const { error } = await admin
        .from('pipeline_runs')
        .insert({ id, client_id: clientId, status: 'running' })
      if (error) throw new Error(`open run: ${error.message}`)
      return id
    })

    // 2. Plan the gather fan-out: one task per platform × keyword. An
    //    analysis-only resume skips gather — the corpus is already in the DB.
    const plan = options.skipGather
      ? []
      : await step.run('plan-gather', () =>
          planGatherSearches(clientId, options.platforms?.length ? options.platforms : undefined),
        )
    const gatherPlatforms = [...new Set(plan.map((t) => t.platform))]

    // 3. Gather, fanned out: per-keyword search steps → one gate step per
    //    platform (merge + relevance/attribution + video upsert) → comment
    //    scrapes in batches of COMMENT_BATCH (each video is its own Apify actor
    //    run — the single-step-per-platform version timed out at 300s on the
    //    first attempt, 2026-07-03). One platform failing must not stop the
    //    others; one search failing must not stop its platform.
    let totalVideos = 0
    let totalErrors = 0
    for (const platform of gatherPlatforms) {
      try {
        const searches: SearchResult[] = []
        for (const task of plan.filter((t) => t.platform === platform)) {
          try {
            searches.push(
              await step.run(`search:${platform}:${task.keyword}`, () =>
                searchOne({
                  clientId, runId, platform, keyword: task.keyword, bucket: task.bucket,
                  maxVideos: options.maxVideos, period: options.period,
                }),
              ),
            )
          } catch {
            totalErrors++
            searches.push({ keyword: task.keyword, bucket: task.bucket, videos: [] })
          }
        }
        const gate = await step.run(`gate:${platform}`, () =>
          gatePlatform({ clientId, runId, platform, searches, videoLimit: options.videoLimit, period: options.period }),
        )
        totalVideos += gate.videosKept
        totalErrors += gate.errors.length
        for (let i = 0; i < gate.eligible.length; i += COMMENT_BATCH) {
          const refs = gate.eligible.slice(i, i + COMMENT_BATCH)
          const batchNo = i / COMMENT_BATCH + 1
          try {
            const r = await step.run(`comments:${platform}:${batchNo}`, () =>
              scrapeCommentsBatch({ clientId, runId, platform, refs }),
            )
            totalErrors += r.errors.length
          } catch {
            totalErrors++
          }
        }
        // Step 1 (capture only, flag-gated): resolve one transcript per kept
        // video from the raw items gatePlatform stored. Own step for the
        // download+Whisper duration; the analysis passes don't read the output.
        if (transcriptsEnabled()) {
          try {
            const t = await step.run(`transcribe:${platform}`, () =>
              transcribeBatch({ clientId, runId, platform }),
            )
            totalErrors += t.errors.length
          } catch {
            totalErrors++
          }
        }
      } catch {
        totalErrors++
      }
    }

    // Analysis-only resume: the corpus check runs against what's already in the DB.
    if (options.skipGather) {
      totalVideos = await step.run('count-corpus', async () => {
        const admin = createAdminClient()
        const { count } = await admin
          .from('videos').select('id', { head: true, count: 'exact' })
          .eq('client_id', clientId)
        return count ?? 0
      })
    }

    // No corpus → close as failed, stop (nothing for the analysis passes to chew on).
    if (totalVideos === 0) {
      await step.run('mark-failed', async () => {
        const admin = createAdminClient()
        await admin.from('pipeline_runs').update({
          status: 'failed', videos_scraped: 0,
          error_message: 'gather produced no videos', completed_at: new Date().toISOString(),
        }).eq('id', runId)
      })
      return { runId, status: 'failed', totalVideos: 0 }
    }

    // 4. Pass A — per-video GPT analysis, fanned out so no batch outlives the
    //    step cap. The plan step pre-filters on RAW comment count (the spam
    //    filter only shrinks a video's count, so raw < min are guaranteed
    //    skips) and chunks richest-first, mirroring runPassA's own ordering.
    const batches = await step.run('plan-pass-a', () => planPassABatches(clientId))
    const passA = { analyzed: 0, skipped: 0, insights: 0, languageSamples: 0, cost: 0 }
    // Batches dispatch in parallel waves — batches are disjoint video sets, so
    // ordering is irrelevant to output; this is purely wall-time (a serial
    // pass over a depth-100 corpus measured ~3 videos/min). Wave size stays
    // modest for OpenAI/Inngest concurrency headroom.
    for (let w = 0; w < batches.length; w += PASS_A_PARALLEL) {
      const wave = await Promise.all(
        batches.slice(w, w + PASS_A_PARALLEL).map((videoIds, j) =>
          step.run(`pass-a:${w + j + 1}-of-${batches.length}`, async () => {
            const s = await runPassA({ clientId, runId, videoIds, persist: true })
            return { analyzed: s.videosAnalyzed, skipped: s.videosSkipped, insights: s.insightsKept, languageSamples: s.languageSamples, cost: s.costUsd }
          }),
        ),
      )
      for (const r of wave) {
        passA.analyzed += r.analyzed
        passA.skipped += r.skipped
        passA.insights += r.insights
        passA.languageSamples += r.languageSamples
        passA.cost += r.cost
      }
    }

    // 5. Cross-reference detection — client-brand mentions under competitor /
    //    industry videos (deterministic regex, no GPT).
    const crossRef = await step.run('cross-reference', () => runCrossReference(clientId))

    // 6. Back half, two steps decoupled via the themes table: Step A2 → Pass B
    //    → persist themes, then Pass C → Pass D (a+b) → run_summary.
    const themed = await step.run('themes', () => runThemesHalf(clientId, runId))
    const synth = await step.run('synthesize', () => runSynthesisHalf(clientId, runId))

    // 7. Close the run.
    await step.run('close-run', async () => {
      const admin = createAdminClient()
      await admin.from('pipeline_runs').update({
        status: totalErrors > 0 ? 'partial' : 'completed',
        videos_scraped: totalVideos,
        completed_at: new Date().toISOString(),
      }).eq('id', runId)
    })

    // 8. Periodic report — only when requested (the scheduler sets this), so a
    //    manual "Run now" refreshes data without emailing the client.
    if (options.sendReport) {
      await step.sendEvent('request-report', {
        name: 'report/send.requested',
        data: { clientId, runId },
      })
    }

    return { runId, status: totalErrors > 0 ? 'partial' : 'completed', totalVideos, ...passA, brandMentions: crossRef.mentionsFlagged, ...themed, ...synth }
  },
)

/** Batch size for the Pass A fan-out. Sized from the 2026-07-03 live failure:
 *  at comment_depth 100 a call runs ~10-20s (batches of 40 timed out at ~15-29
 *  calls, three attempts straight), so 12 ≈ 2-4 min under the 300s cap. */
const PASS_A_BATCH = 12

/** Videos per comment-scrape step. Each video is its own Apify actor run
 *  (~20-90s incl. actor startup — slower since comment_depth went 25→100), so
 *  3 stays inside the 300s Hobby cap even when every actor runs slow. */
const COMMENT_BATCH = 3

/** Pass A batches dispatched concurrently per wave. Step IDs are unchanged by
 *  this (still pass-a:N-of-M over the same memoized plan), so a mid-run deploy
 *  replays completed batches instantly and fans out only the remainder. */
const PASS_A_PARALLEL = 5

// Eligible video ids (raw comment count >= 5, richest first), chunked into
// batches. Comments are scanned once and joined in memory — same URL-overflow
// avoidance as everywhere else.
async function planPassABatches(clientId: string): Promise<string[][]> {
  const admin = createAdminClient()
  const videos = await selectAll<{ id: string; platform: string; video_id: string }>(() =>
    admin.from('videos').select('id, platform, video_id').eq('client_id', clientId).order('id', { ascending: true }),
  )
  const counts = new Map<string, number>()
  const comments = await selectAll<{ platform: string; video_id: string }>(() =>
    admin.from('comments').select('platform, video_id').eq('client_id', clientId).order('id', { ascending: true }),
  )
  for (const c of comments) {
    const key = `${c.platform}::${c.video_id}`
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  const eligible = videos
    .map((v) => ({ id: v.id, n: counts.get(`${v.platform}::${v.video_id}`) ?? 0 }))
    .filter((v) => v.n >= 5)
    .sort((a, b) => b.n - a.n)
  const batches: string[][] = []
  for (let i = 0; i < eligible.length; i += PASS_A_BATCH) {
    batches.push(eligible.slice(i, i + PASS_A_BATCH).map((v) => v.id))
  }
  return batches
}

// Back half, first step: Step A2 → Pass B labels → persist themes (with
// first_seen matching). Output lands in the themes table, which the synthesis
// step reads back — the step boundary sits exactly on the DB persistence.
async function runThemesHalf(clientId: string, runId: string) {
  const admin = createAdminClient()
  const { data: client } = await admin.from('clients')
    .select('company_name').eq('id', clientId).maybeSingle()

  const a2 = await runStepA2({
    clientId, runId, method: 'embedding',
    threshold: CLUSTER_SIMILARITY_THRESHOLD, evidenceFloor: EVIDENCE_FLOOR,
    logCalls: true,
  })
  // Pass B labels BOTH tiers (early signals surface on the pages too), then the
  // labelled set is persisted with first_seen from mini theme-matching.
  const allThemes = [...a2.themes, ...a2.earlySignals]
  const b = await runPassB({ clientId, runId, themes: allThemes, brandName: client?.company_name ?? undefined, persist: true })
  const persisted = await persistThemes(clientId, runId, allThemes)

  return {
    themes: a2.themes.length,
    earlySignals: a2.earlySignals.length,
    themeMerges: a2.mergesApplied.length,
    newThemes: persisted.hadPreviousRun ? persisted.firstSeen : 0,
    labelCost: b.costUsd + a2.mergeCostUsd,
  }
}

// Back half, second step: metrics → Pass C → Pass D (a+b) → run_summary, over
// the themes persisted by runThemesHalf. Mirrors scripts/run-cd.ts.
async function runSynthesisHalf(clientId: string, runId: string) {
  const admin = createAdminClient()

  // SoV guard (Owned-Data-Plan): owned-account posts never count toward the
  // discovered-corpus metrics — a client's own posting must not inflate their
  // share of conversation. Filtering videos also drops their comments below.
  const videos = (await selectAll<VideoRow>(() =>
    admin.from('videos').select('*').eq('client_id', clientId).order('id', { ascending: true }),
  )).filter((v) => v.source !== 'owned')
  // Load the client's comments in one paginated scan and filter to the corpus
  // videos IN MEMORY — a `.in('video_id', [all ids])` filter blows the URL length
  // limit once the corpus grows to ~1k+ videos ("fetch failed"). Mirrors run-cd.ts.
  const wantedVideos = new Set(videos.map((v) => `${v.platform}::${v.video_id}`))
  const allComments = await selectAll<CommentRow>(() =>
    admin.from('comments')
      .select('id, client_id, run_id, platform, video_id, comment_id, author, text, likes, comment_date')
      .eq('client_id', clientId)
      .order('id', { ascending: true }),
  )
  const comments = allComments.filter((c) => wantedVideos.has(`${c.platform}::${c.video_id}`))
  const metrics = computeMetrics(videos, comments)

  const { data: tc } = await admin.from('tracking_configs')
    .select('brand_keywords, competitor_names, industry_keywords, report_period')
    .eq('client_id', clientId).maybeSingle()

  // Period slice — only what THIS run gathered, minus rows KNOWN to be older
  // than the report window (upserts re-stamp re-found videos/comments with the
  // current run_id, so run_id alone lets an old-viral re-scrape pollute the
  // week's numbers; comment_date/upload_date is the honest cut). Null dates
  // stay — only content known old is dropped. Baseline runs (window.since =
  // null) keep the full run slice: the first run IS the map, not a period.
  // Feeds run_summary's period_* columns; the full-corpus metrics above stay
  // the market-map state. (Teardown 2026-07-09 — cumulative-metrics fix.)
  const window = await resolveGatherWindow(clientId, runId, tc?.report_period ?? 'weekly')
  const periodVideos = videos.filter((v) => v.run_id === runId && inWindow(v.upload_date, window.since))
  const periodComments = comments.filter((c) => c.run_id === runId && inWindow(c.comment_date, window.since))
  const periodMetrics = computeMetrics(periodVideos, periodComments)
  const { data: client } = await admin.from('clients')
    .select('company_name').eq('id', clientId).maybeSingle()
  const brandName = client?.company_name ?? undefined

  // Brand claims (Step 2b) — all-time accumulation, deduped/capped; empty for
  // tenants that never ran Pass A v4.
  const claims = await loadBrandClaims(admin, clientId)

  // Floor-passing themes only — early signals surface on pages, not in C/D.
  const themes = (await loadThemes(clientId, runId)).filter((t) => !t.singleSource)

  const c = await runPassC({
    clientId, runId, themes,
    trackingConfig: tc ?? undefined, brandName, sov: metrics.share_of_voice,
    competitorClaims: claims.competitors, persist: true,
  })
  const d = await runPassD({
    clientId, runId, themes,
    competitiveInsights: c.competitiveInsights, brandName, sov: metrics.share_of_voice,
    clientClaims: claims.client, persist: true,
  })

  await writeRunSummary({
    clientId, runId, metrics, videos,
    periodMetrics, periodVideos,
    ciSummary: d.ciSummary, executiveBrief: d.executiveBrief, sayVsHear: d.sayVsHear, period: tc?.report_period ?? null,
  })

  return {
    competitiveInsights: c.inserted,
    marketInsights: d.marketInsights.length,
    recommendations: d.recommendations.length,
    synthesisCost: c.costUsd + d.costUsd,
  }
}
