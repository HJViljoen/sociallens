import { randomUUID } from 'crypto'
import { inngest } from '@/inngest/client'
import { createAdminClient, selectAll } from '@/lib/supabase-admin'
import { planGatherSearches, searchOne, gatePlatform, scrapeCommentsBatch, transcribeBatch, planTranscribeBatches, resolveGatherWindow, inWindow, loadGatherConfig, type SearchResult } from '@/lib/gather/gather'
import { runPassA, passALane } from '@/lib/pipeline/pass-a'
import { loadGroupedInsights, runStepA2Bucket, type StepA2BucketResult } from '@/lib/pipeline/step-a2'
import { runPassB } from '@/lib/pipeline/pass-b'
import { runPassC } from '@/lib/pipeline/pass-c'
import { runPassD } from '@/lib/pipeline/pass-d'
import { runCrossReference } from '@/lib/pipeline/cross-reference'
import { loadBrandClaims } from '@/lib/pipeline/claims'
import { attributeRunKeywords } from '@/lib/pipeline/keyword-attribution'
import { planClassifyMetaBatches, runClassifyMetaBatch } from '@/lib/pipeline/classify-meta'
import { ingestOwnedPosts, supportsOwnedProfile } from '@/lib/gather/owned'
import { discoverSubreddits } from '@/lib/gather/subreddit-discovery'
import { activeSubreddits } from '@/lib/gather/subreddits'
import { runStep2c } from '@/lib/pipeline/owned-events'
import { summariseRunErrors, partialRunAlert, RUN_ERROR_CAP } from '@/lib/pipeline/run-errors'
import { persistRunNews } from '@/lib/news/persist'
import { persistThemes, loadThemes } from '@/lib/pipeline/themes'
import { writeRunSummary } from '@/lib/pipeline/run-summary'
import { computeMetrics } from '@/lib/pipeline/metrics'
import { sendAlertEmail } from '@/lib/email'
import { CLUSTER_SIMILARITY_THRESHOLD, EVIDENCE_FLOOR, TRANSCRIBE_PARALLEL, redditDiscoveryEnabled, transcriptsEnabled } from '@/lib/config'
import type { Platform } from '@/lib/gather/types'
import type { VideoRow, CommentRow } from '@/lib/pipeline/types'

// The full Verbatim pipeline as one durable Inngest function — the port of the
// scripts/run-*.ts CLI sequence the orchestrator was always meant to own
// (see the notes in run-gather.ts / run-cd.ts). One run_id flows through every
// stage; each stage is a retryable step decoupled via the DB, so a failure
// resumes from the last completed step rather than re-scraping.
//
// Trigger: `pipeline/run.requested` { clientId, options? }. The cron dispatcher
// (scheduler.ts) and the admin trigger-run route both emit this event.
//
// Timeout note: every stage is sized to fit the route's duration cap. Gather is
// fanned out per keyword search + per comment batch (a whole platform in one
// step timed out at 300s on the first cloud run — the per-video Apify comment
// scrape dominates); Pass A runs in batches of PASS_A_BATCH videos (the whole
// corpus in one step was ~264 eligible videos ≈ 15-20 min of GPT calls); the
// back half is a per-bucket themes fan-out + pass-b + persist-themes (split
// 2026-08-09 — the single 'themes' step survived run 2's 300s cap only via
// retry), then one synthesis step decoupled via the themes table.

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
      // Operator alert — before this, a dead run was only ever a DB row
      // nobody was looking at (scheduled runs are unattended).
      const { data: client } = await admin.from('clients')
        .select('company_name').eq('id', clientId).maybeSingle()
      await sendAlertEmail(
        `Verbatim run FAILED — ${client?.company_name ?? clientId}`,
        `Pipeline run failed after retries.\n\nClient: ${client?.company_name ?? '?'} (${clientId})\nError: ${message}\n\nResume lever: POST /api/admin/trigger-run with options {runId, skipGather:true}.`,
      )
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

    // News context layer (Wave 2): free RSS fetch + ring-assign + store for
    // the Trends panel. Zero corpus dependency, so it runs right after
    // open-run. Non-fatal AND uncounted: a context-feed hiccup neither fails
    // the run nor marks the intelligence 'partial' — the panel just stays on
    // last week's items.
    await step
      .run('gather-news', () => persistRunNews(clientId, runId))
      .catch((e) => {
        console.error(`[gather-news] out of retries: ${e instanceof Error ? e.message : String(e)}`)
        return { fetched: 0, stored: 0 }
      })

    // Declared HERE, not with the gather counters below: the discovery step's
    // .catch() increments it while this function is still suspended at that
    // await, so a later `let` would be in the temporal dead zone and the catch
    // would throw a ReferenceError — turning a non-fatal step into a run-killer.
    // noteError/runErrors ride along for exactly the same reason.
    let totalErrors = 0
    // WHY a run ends 'partial'. Before this, a degraded run wrote the status and
    // nothing else: the reason lived only in a console line that ages out of the
    // platform's log retention within the hour. The first scheduled run
    // (2026-08-16) closed 'partial' and its cause had to be reconstructed from
    // third-party billing history. close-run persists this list so the next one
    // explains itself.
    const runErrors: string[] = []
    const noteError = (where: string, detail?: unknown) => {
      totalErrors++
      if (runErrors.length >= RUN_ERROR_CAP) return
      const message = detail instanceof Error ? detail.message : detail == null ? '' : String(detail)
      runErrors.push(message ? `${where}: ${message.slice(0, 300)}` : where)
    }

    // Reddit subreddit discovery (Wave 3): propose communities, probe each
    // against the live relevance gate, persist the survivors. Runs before
    // plan-gather so a newly-promoted community is available to this run.
    //
    // Non-fatal but COUNTED. Unlike gather-news (a free RSS fetch), this step
    // spends real Apify and OpenAI money BEFORE it can fail, and its most likely
    // failure is a timeout after several completed paid probes. A run that
    // quietly burned money and produced nothing is exactly what 'partial' is
    // for. Skipped entirely on an analysis-only resume.
    if (!options.skipGather && redditDiscoveryEnabled()) {
      await step
        .run('discover-subreddits', async () => {
          const config = await loadGatherConfig(clientId)
          if (!config.platforms.includes('reddit')) return { skipped: 'reddit not enabled for tenant' }
          const merged = await discoverSubreddits({
            clientId,
            runId,
            config,
            today: new Date().toISOString().slice(0, 10),
          })
          return { subreddits: merged.length, active: activeSubreddits(merged).length }
        })
        .catch((e) => {
          console.error(`[discover-subreddits] out of retries: ${e instanceof Error ? e.message : String(e)}`)
          noteError('discover-subreddits', e)
          return { skipped: 'failed' }
        })
    }

    // 2. Plan the gather fan-out: one task per platform × keyword. An
    //    analysis-only resume skips gather — the corpus is already in the DB.
    const plan = options.skipGather
      ? []
      : await step.run('plan-gather', () =>
          planGatherSearches(clientId, options.platforms?.length ? options.platforms : undefined),
        )
    const gatherPlatforms = [...new Set(plan.map((t) => t.platform))]

    // Owned layer inputs (Wave 2): the client's own handles + the report
    // window start for scoping which own posts earn a comment scrape.
    // Analysis-only resumes skip gather AND owned ingestion together.
    const ownedPlan = plan.length
      ? await step
          .run('plan-owned', async () => {
            const admin = createAdminClient()
            const { data } = await admin
              .from('tracking_configs')
              .select('own_handles, report_period')
              .eq('client_id', clientId)
              .maybeSingle()
            const period = (data?.report_period as string | null) ?? 'weekly'
            const window = await resolveGatherWindow(clientId, runId, period)
            return {
              handles: (data?.own_handles ?? {}) as Record<string, string>,
              windowStart: window.since,
            }
          })
          .catch(() => ({ handles: {} as Record<string, string>, windowStart: null as string | null }))
      : { handles: {} as Record<string, string>, windowStart: null as string | null }
    const ownedHandles = ownedPlan.handles

    // 3. Gather, fanned out: per-keyword search steps → one gate step per
    //    platform (merge + relevance/attribution + video upsert) → comment
    //    scrapes in batches of COMMENT_BATCH (each video is its own Apify actor
    //    run — the single-step-per-platform version timed out at 300s on the
    //    first attempt, 2026-07-03). One platform failing must not stop the
    //    others; one search failing must not stop its platform.
    let totalVideos = 0 // totalErrors/noteError are declared above — the discovery catch uses them first
    for (const platform of gatherPlatforms) {
      try {
        // Searches dispatch in parallel waves (transcribe-fan-out precedent):
        // searchOne is self-contained per keyword (own config load, one actor
        // run, no cross-keyword writes) and the gate consumes the full set
        // after the barrier, so only determinism needs the original order —
        // Promise.all preserves it. Step IDs unchanged (search:P:keyword).
        const tasks = plan.filter((t) => t.platform === platform)
        const searches: SearchResult[] = []
        for (let w = 0; w < tasks.length; w += SEARCH_PARALLEL) {
          const wave = await Promise.all(
            tasks.slice(w, w + SEARCH_PARALLEL).map(async (task): Promise<SearchResult> => {
              try {
                return await step.run(`search:${platform}:${task.keyword}`, () =>
                  searchOne({
                    clientId, runId, platform, keyword: task.keyword, bucket: task.bucket,
                    community: task.community,
                    maxVideos: options.maxVideos, period: options.period,
                  }),
                )
              } catch (e) {
                noteError(`search:${platform}:${task.keyword}`, e)
                return { keyword: task.keyword, bucket: task.bucket, videos: [] }
              }
            }),
          )
          searches.push(...wave)
        }
        const gate = await step.run(`gate:${platform}`, () =>
          gatePlatform({ clientId, runId, platform, searches, videoLimit: options.videoLimit, period: options.period }),
        )
        totalVideos += gate.videosKept
        for (const err of gate.errors) noteError(`gate:${platform}`, err)
        // Comment batches dispatch in parallel waves — this loop is the run's
        // wall-clock dominator (each video is its own Apify actor run, and the
        // sequential version drove run 1's ~2.5h). Batches are disjoint video
        // sets and scrapeCommentsBatch writes only its own refs' rows, so
        // waves are safe. Step IDs unchanged (comments:P:N over the same
        // batch numbering), so a mid-run replay skips completed batches.
        const commentBatches = Array.from(
          { length: Math.ceil(gate.eligible.length / COMMENT_BATCH) },
          (_, i) => gate.eligible.slice(i * COMMENT_BATCH, (i + 1) * COMMENT_BATCH),
        )
        for (let w = 0; w < commentBatches.length; w += COMMENT_PARALLEL) {
          await Promise.all(
            commentBatches.slice(w, w + COMMENT_PARALLEL).map(async (refs, j) => {
              try {
                const r = await step.run(`comments:${platform}:${w + j + 1}`, () =>
                  scrapeCommentsBatch({ clientId, runId, platform, refs }),
                )
                for (const err of r.errors) noteError(`comments:${platform}:${w + j + 1}`, err)
              } catch (e) {
                noteError(`comments:${platform}:${w + j + 1}`, e)
              }
            }),
          )
        }
        // Owned layer (Wave 2): the client's own recent posts + their comments,
        // stamped source:'owned' — feeds Step 2c, never the discovered-corpus
        // metrics (SoV guard). Non-fatal: catch on the step promise.
        // Runs BEFORE the transcribe steps (moved 2026-08-16, Brand Voice) so
        // the own posts' video_raw rows are in this run's transcribe plan —
        // step IDs unchanged, order only.
        // supportsOwnedProfile: Reddit has no owned-account concept, so an
        // own_handles.reddit entry is skipped rather than thrown (Wave 3).
        if (ownedHandles[platform] && supportsOwnedProfile(platform)) {
          const ownedRefs = await step
            .run(`owned-posts:${platform}`, () =>
              ingestOwnedPosts({ clientId, runId, platform, handle: ownedHandles[platform], windowStart: ownedPlan.windowStart }),
            )
            .catch((e) => {
              console.error(`[owned-posts:${platform}] out of retries: ${e instanceof Error ? e.message : String(e)}`)
              noteError(`owned-posts:${platform}`, e)
              return [] as { video_id: string; video_url: string; comments_count: number }[]
            })
          for (let w = 0; w < ownedRefs.length; w += COMMENT_BATCH) {
            await step
              .run(`owned-comments:${platform}:${Math.floor(w / COMMENT_BATCH) + 1}`, () =>
                scrapeCommentsBatch({ clientId, runId, platform: platform as Platform, refs: ownedRefs.slice(w, w + COMMENT_BATCH), source: 'owned' }),
              )
              .catch((e) => {
                noteError(`owned-comments:${platform}`, e)
                return { comments: 0, errors: ['owned comment scrape failed'] }
              })
          }
        }
        // Transcripts (flag-gated), fanned out like Pass A: a plan step chunks
        // this run's pending candidates signal-first (TRANSCRIBE_BATCH per
        // step), then batches dispatch in parallel waves. One sequential
        // whole-platform step measured out at ~10s/video — 60 videos would
        // blow the 300s cap, and a real run has hundreds (readiness 2026-08-08).
        // Step retries are free: the in-batch status re-check skips done videos.
        if (transcriptsEnabled()) {
          try {
            const txBatches = await step.run(`plan-transcribe:${platform}`, () =>
              planTranscribeBatches(clientId, runId, platform),
            )
            for (let w = 0; w < txBatches.length; w += TRANSCRIBE_PARALLEL) {
              const wave = await Promise.all(
                txBatches.slice(w, w + TRANSCRIBE_PARALLEL).map((videoIds, j) =>
                  step
                    .run(`transcribe:${platform}:${w + j + 1}-of-${txBatches.length}`, () =>
                      transcribeBatch({ clientId, runId, platform, videoIds, batchNo: w + j + 1 }),
                    )
                    // Per-step catch (comments-fan-out precedent): one batch
                    // exhausting its retries must not abandon the remaining
                    // waves — hundreds of this run's videos would silently
                    // stay untranscribed and are never re-planned.
                    .catch(() => ({ transcribed: 0, skipped: 0, errors: ['transcribe step failed'] })),
                ),
              )
              for (const t of wave) {
                for (const err of t.errors) noteError(`transcribe:${platform}`, err)
              }
            }
          } catch (e) {
            noteError(`plan-transcribe:${platform}`, e)
          }
        }

      } catch (e) {
        noteError(`platform:${platform}`, e)
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
        await sendAlertEmail(
          `Verbatim run FAILED — gather produced no videos`,
          `Run ${runId} (client ${clientId}) closed as failed: gather produced no videos.`,
        )
      })
      return { runId, status: 'failed', totalVideos: 0 }
    }

    // 4. Pass A — per-video GPT analysis, fanned out so no batch outlives the
    //    step cap. The plan step pre-filters on RAW comment count (the spam
    //    filter only shrinks a video's count, so raw < min are guaranteed
    //    skips) and chunks richest-first, mirroring runPassA's own ordering.
    const batches = await step.run('plan-pass-a', () => planPassABatches(clientId))
    const passA = { analyzed: 0, claimsOnly: 0, skipped: 0, insights: 0, languageSamples: 0, cost: 0 }
    // Batches dispatch in parallel waves — batches are disjoint video sets, so
    // ordering is irrelevant to output; this is purely wall-time (a serial
    // pass over a depth-100 corpus measured ~3 videos/min). Wave size stays
    // modest for OpenAI/Inngest concurrency headroom.
    for (let w = 0; w < batches.length; w += PASS_A_PARALLEL) {
      const wave = await Promise.all(
        batches.slice(w, w + PASS_A_PARALLEL).map((videoIds, j) =>
          step.run(`pass-a:${w + j + 1}-of-${batches.length}`, async () => {
            const s = await runPassA({ clientId, runId, videoIds, persist: true })
            return { analyzed: s.videosAnalyzed, claimsOnly: s.videosClaimsOnly, skipped: s.videosSkipped, insights: s.insightsKept, languageSamples: s.languageSamples, cost: s.costUsd }
          }),
        ),
      )
      for (const r of wave) {
        passA.analyzed += r.analyzed
        passA.claimsOnly += r.claimsOnly ?? 0
        passA.skipped += r.skipped
        passA.insights += r.insights
        passA.languageSamples += r.languageSamples
        passA.cost += r.cost
      }
    }

    // 4b. Metadata classification — the videos Pass A skipped (<5 kept
    //     comments, ~75% of a corpus) get format/hook/topics from caption +
    //     transcript so the Content page's per-entity stats rest on the whole
    //     gather. Non-fatal per batch: a failed batch leaves its rows
    //     unclassified and the page reports coverage honestly; it must never
    //     take down a run (unlike theme buckets, nothing downstream consumes
    //     this silently — themes/synthesis never read these columns).
    const classifyBatches = await step
      .run('plan-classify', () => planClassifyMetaBatches(clientId, runId))
      // Plan failure out of retries → skip classification, never the run
      // (the ship-live decision rests on this contract).
      .catch((e) => {
        console.error(`[classify-meta] plan failed, skipping: ${e instanceof Error ? e.message : String(e)}`)
        noteError('plan-classify', e)
        return [] as string[][]
      })
    const classify = { classified: 0, nulls: 0, cost: 0, errors: 0 }
    for (let w = 0; w < classifyBatches.length; w += CLASSIFY_PARALLEL) {
      const wave = await Promise.all(
        classifyBatches.slice(w, w + CLASSIFY_PARALLEL).map((videoIds, j) =>
          step
            .run(`classify:${w + j + 1}-of-${classifyBatches.length}`, () =>
              runClassifyMetaBatch(clientId, runId, videoIds, w + j + 1),
            )
            // Catch on the step promise (transcribe precedent): Inngest's
            // retries run first; only an out-of-retries batch goes non-fatal,
            // leaving its rows unclassified and the run status 'partial'.
            .catch((e) => {
              const message = e instanceof Error ? e.message : String(e)
              console.error(`[classify-meta] batch out of retries: ${message}`)
              return { requested: videoIds.length, classified: 0, nulls: 0, costUsd: 0, error: message }
            }),
        ),
      )
      for (const r of wave) {
        classify.classified += r.classified
        classify.nulls += r.nulls
        classify.cost += r.costUsd
        if (r.error) {
          classify.errors++
          noteError('classify-meta', r.error)
        }
      }
    }

    // 5. Cross-reference detection — client-brand mentions under competitor /
    //    industry videos (deterministic regex, no GPT).
    const crossRef = await step.run('cross-reference', () => runCrossReference(clientId))

    // 6. Back half. The themes stage fans out per entity bucket (the single
    //    'themes' step — A2 + per-bucket gpt-5.4 merge + Pass B + persist —
    //    measured ~112s for A2+merge alone at run-1 scale and survived run 2's
    //    300s cap only via retry). Each bucket step reloads its own slice from
    //    the DB; only aggregated theme rollups travel as step output. A bucket
    //    step exhausting its retries fails the run (no per-step catch, unlike
    //    transcribe): synthesis over a silently missing bucket would present
    //    partial intelligence as complete — the analysis-only resume lever is
    //    the recovery path, exactly as with the old single step.
    const themePlan = await step.run('plan-themes', async () => {
      const { groups, distinctVideoCount } = await loadGroupedInsights(clientId, runId)
      return { buckets: groups.map((g) => g.bucket), distinctVideoCount }
    })
    const bucketResults: StepA2BucketResult[] = []
    for (let w = 0; w < themePlan.buckets.length; w += THEMES_PARALLEL) {
      const wave = await Promise.all(
        themePlan.buckets.slice(w, w + THEMES_PARALLEL).map((bucket, j) =>
          step.run(`themes:${bucket}`, () =>
            runStepA2Bucket({
              clientId, runId, bucket, callIndex: w + j + 1,
              method: 'embedding', threshold: CLUSTER_SIMILARITY_THRESHOLD,
              evidenceFloor: EVIDENCE_FLOOR, logCalls: true,
            }),
          ),
        ),
      )
      bucketResults.push(...wave)
    }

    // Pass B labels BOTH tiers (early signals surface on the pages too); the
    // cross-bucket strength sort happens here, where the buckets recombine.
    const themed = await step.run('pass-b', async () => {
      const admin = createAdminClient()
      const { data: client } = await admin.from('clients')
        .select('company_name').eq('id', clientId).maybeSingle()
      const allThemes = bucketResults.flatMap((r) => r.themes)
      allThemes.sort((a, b) => b.strengthScore - a.strengthScore)
      console.log(`[themes] ${allThemes.length} themes from ${bucketResults.length} buckets, step payload ${JSON.stringify(allThemes).length} bytes`)
      const b = await runPassB({ clientId, runId, themes: allThemes, brandName: client?.company_name ?? undefined, persist: true })
      const mergeCostUsd = bucketResults.reduce((s, r) => s + r.mergeCostUsd, 0)
      return {
        allThemes,
        summary: {
          themes: allThemes.filter((t) => !t.singleSource).length,
          earlySignals: allThemes.filter((t) => t.singleSource).length,
          themeMerges: bucketResults.reduce((s, r) => s + r.mergesApplied.length, 0),
          labelCost: b.costUsd + mergeCostUsd,
        },
      }
    })

    // Persist with first_seen from mini theme-matching — the themes table is
    // the boundary the synthesis step reads back across.
    const persisted = await step.run('persist-themes', () =>
      persistThemes(clientId, runId, themed.allThemes),
    )
    const themedSummary = {
      ...themed.summary,
      newThemes: persisted.hadPreviousRun ? persisted.firstSeen : 0,
    }

    // Step 2c — account-event detection + explanation on the owned layer
    // (Wave 2: first pipeline wiring; previously script-only). After themes so
    // explanations can ground in this run's theme set. Non-fatal.
    await step
      .run('owned-events', () => runStep2c({ clientId, runId }))
      .catch((e) => {
        console.error(`[owned-events] out of retries: ${e instanceof Error ? e.message : String(e)}`)
        noteError('owned-events', e)
        return null
      })

    const synth = await step.run('synthesize', () => runSynthesisHalf(clientId, runId))

    // Keyword ROI bookkeeping — fills keyword_performance.insights_contributed
    // for this run. Catch on the step promise (transcribe precedent): retries
    // first, then non-fatal — a bookkeeping failure marks the run 'partial'
    // and is repairable via scripts/backfill-keyword-insights.ts.
    await step
      .run('keyword-attribution', () => attributeRunKeywords(createAdminClient(), clientId, runId))
      .catch((e) => {
        console.error(`[keyword-attribution] out of retries: ${e instanceof Error ? e.message : String(e)}`)
        noteError('keyword-attribution', e)
        return null
      })

    // 7. Close the run.
    await step.run('close-run', async () => {
      const admin = createAdminClient()
      await admin.from('pipeline_runs').update({
        status: totalErrors > 0 ? 'partial' : 'completed',
        videos_scraped: totalVideos,
        completed_at: new Date().toISOString(),
        errors: runErrors,
        error_message: summariseRunErrors(totalErrors, runErrors),
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

    // 9. Operator alert for a degraded run. Only 'failed' and zero-video runs
    //    alerted before 2026-08-16, so a 'partial' run — report delivered,
    //    side-layer silently dead — was indistinguishable from a clean one in
    //    the inbox. Non-fatal: an alert hiccup must never demote a completed
    //    run to 'failed' via onFailure.
    if (totalErrors > 0) {
      await step
        .run('alert-partial', async () => {
          const admin = createAdminClient()
          const { data: client } = await admin.from('clients')
            .select('company_name').eq('id', clientId).maybeSingle()
          const { subject, text } = partialRunAlert({
            runId,
            clientName: client?.company_name ?? clientId,
            total: totalErrors,
            recorded: runErrors,
            reportSent: Boolean(options.sendReport),
          })
          return sendAlertEmail(subject, text)
        })
        .catch((e) => {
          console.error(`[alert-partial] out of retries: ${e instanceof Error ? e.message : String(e)}`)
          return { sent: false }
        })
    }

    return { runId, status: totalErrors > 0 ? 'partial' : 'completed', totalVideos, ...passA, classifyMeta: classify, brandMentions: crossRef.mentionsFlagged, ...themedSummary, ...synth }
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

/** Keyword-search steps dispatched concurrently per wave. Search actors are
 *  heavier than comment actors (a full hashtag/keyword crawl each), so the
 *  wave stays small; a platform's whole keyword set is 5-10 tasks. */
const SEARCH_PARALLEL = 3

/** Comment-scrape steps dispatched concurrently per wave. Each step runs its
 *  COMMENT_BATCH videos sequentially (one actor at a time), so a wave holds at
 *  most COMMENT_PARALLEL concurrent Apify jobs — far under the Starter plan's
 *  32-concurrent-jobs cap even stacked on a search or transcribe wave. */
const COMMENT_PARALLEL = 4

/** Pass A batches dispatched concurrently per wave. Step IDs are unchanged by
 *  this (still pass-a:N-of-M over the same memoized plan), so a mid-run deploy
 *  replays completed batches instantly and fans out only the remainder. */
const PASS_A_PARALLEL = 5

/** Classify-meta batches per wave — 25-video metadata-only calls run ~10-30s,
 *  so 4 abreast stays far under the step cap. */
const CLASSIFY_PARALLEL = 4

/** Bucket theme steps dispatched concurrently per wave. Each step carries one
 *  gpt-5.4 reasoning=medium merge call (the heavy part, ~95s total across
 *  buckets at run-1 scale) plus a cheap embeddings call, so the wave stays
 *  small for OpenAI headroom; a run has ~3-6 entity buckets. */
const THEMES_PARALLEL = 2

// Eligible video ids (raw comment count >= 5, richest first), chunked into
// batches. Comments are scanned once and joined in memory — same URL-overflow
// avoidance as everywhere else.
async function planPassABatches(clientId: string): Promise<string[][]> {
  const admin = createAdminClient()
  // Discovered corpus + the client's OWN posts. Owned posts never take the
  // full lane (their fans' comments would contaminate audience themes; Step 2c
  // is their consumer) — passALane admits them to the claims lane only, when
  // they carry a usable transcript (Brand Voice, 2026-08-16).
  const videos = await selectAll<{ id: string; platform: string; video_id: string; is_client: boolean | null; is_competitor: boolean | null; transcript_status: string | null; source: string | null }>(() =>
    admin.from('videos').select('id, platform, video_id, is_client, is_competitor, transcript_status, source').eq('client_id', clientId).in('source', ['discovered', 'owned']).order('id', { ascending: true }),
  )
  const counts = new Map<string, number>()
  const comments = await selectAll<{ platform: string; video_id: string }>(() =>
    admin.from('comments').select('platform, video_id').eq('client_id', clientId).order('id', { ascending: true }),
  )
  for (const c of comments) {
    const key = `${c.platform}::${c.video_id}`
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  // Per-platform floor: Reddit threads run short but dense, so a single global
  // 5 would skip most of the platform (lib/config.ts passAMinComments). Below
  // the floor, brand-side videos with a usable transcript still enter via the
  // claims lane (Wave 4) — same rule as runPassA's second gate, via passALane.
  const withTranscripts = transcriptsEnabled()
  const eligible = videos
    .map((v) => ({ id: v.id, n: counts.get(`${v.platform}::${v.video_id}`) ?? 0,
      lane: passALane({ ...v, transcript_status: withTranscripts ? v.transcript_status : null }, counts.get(`${v.platform}::${v.video_id}`) ?? 0) }))
    .filter((v) => v.lane !== 'skip')
    .sort((a, b) => b.n - a.n)
  const batches: string[][] = []
  for (let i = 0; i < eligible.length; i += PASS_A_BATCH) {
    batches.push(eligible.slice(i, i + PASS_A_BATCH).map((v) => v.id))
  }
  return batches
}

// Back half, synthesis step: metrics → Pass C → Pass D (a+b) → run_summary,
// over the themes persisted by the persist-themes step. Mirrors scripts/run-cd.ts.
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

  // Brand claims (Step 2b) — all-time accumulation, newest-run-per-video,
  // tracked competitors only; empty for tenants that never ran Pass A v4.
  // Client claims split by voice: `client` = the brand speaking (own posts +
  // own accounts) → say-vs-hear; `about` = third parties → the About-you block.
  const claims = await loadBrandClaims(admin, clientId, tc?.competitor_names ?? [], tc?.brand_keywords ?? [])

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
