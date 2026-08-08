import { createAdminClient, selectAll } from '../supabase-admin'
import { periodWindowDays, RECHECK_MIN_GROWTH, RECHECK_CAP, RECHECK_WINDOW_DAYS, TRANSCRIBE_CAP, TRANSCRIBE_BATCH, TRANSCRIBE_MODEL, CONTENT_GATE_MODEL, WHISPER_PER_MINUTE, estimateCost, transcriptsEnabled } from '../config'
import { runActor } from './apify'
import { adapters } from './platforms'
import { resolveTranscript } from './transcript'
import { dedupeBy, round2 } from './util'
import { classifyRelevance, type RelevanceMethod } from './relevance'
import { attributeVideos, type AttributionMethod } from './attribution'
import { splitDelta, pickRechecks, scrapeBaseline, type KnownVideoState, type RecheckCandidate } from './delta'
import type {
  GatherConfig,
  Platform,
  NormaliseCtx,
  VideoInsert,
  CommentInsert,
  VideoRef,
  RawItem,
} from './types'

// Gather orchestrator. For each platform: search → normalise → upsert videos →
// scrape comments for eligible videos → upsert comments. Platform-agnostic — all
// the per-platform knowledge is in the adapter. Pure data: no GPT, no analysis.
//
// Split into step-sized pieces (2026-07-03, after the first cloud run proved a
// whole platform never fits one 300s function call — dominated by the per-video
// Apify comment scrape): planGatherSearches → searchOne (per keyword) →
// gatePlatform (merge + relevance/attribution + video upsert) →
// scrapeCommentsBatch. The Inngest pipeline runs each piece as its own
// retryable step; the CLI runGather composes the same pieces sequentially.
//
// Idempotent: upserts on the natural keys (client_id, platform, video_id) and
// (client_id, platform, comment_id), so a re-run merges rather than duplicates.
// The videos upsert deliberately omits Pass A's classification columns, so a
// re-gather refreshes metrics without clobbering existing analysis.
//
// Delta-scraping (2026-07-16, delta.ts): known videos skip the gate and only
// re-scrape comments when their count grew — unchanged re-finds stop costing a
// paid actor run, and still-active videos keep contributing their new comments
// after they age out of the search window (~27% of lifetime comments arrive
// after a video's first week, measured on the stored corpus).

type Admin = ReturnType<typeof createAdminClient>

export type KeywordBucket = 'brand' | 'competitor' | 'industry'
interface SearchGroup { label: string; bucket: KeywordBucket; keyword: string; terms: string[]; limit: number }

// Per-KEYWORD search plan: every keyword gets its own search with an equal quota
// (max_videos). Two reasons:
//   (1) Removes the cross-platform volume skew. The IG actor applies its limit
//       per-hashtag, but TT/YT applied `maxItems` to a whole combined group, so
//       combined brand/industry searches returned ~Nx more IG videos than TT/YT
//       (live corpus: 496 IG vs 138 TT / 103 YT). One keyword per search levels
//       TT/YT up to the same per-keyword multiplier IG always had.
//   (2) Makes every video attributable to the keyword(s) that surfaced it, so each
//       keyword's value can be scored and low-value terms pruned (v5-Ideas: Keyword
//       Value Tracking). Equal quotas keep the scores comparable across keywords.
// (Supersedes the 2026-06-28 per-bucket plan — brand/industry were still combined.)
function buildSearchPlan(config: GatherConfig): SearchGroup[] {
  const clean = (xs: string[] | undefined) => (xs ?? []).map((s) => `${s}`.trim()).filter(Boolean)
  const buckets: [KeywordBucket, string[]][] = [
    ['brand', clean(config.brand_keywords)],
    ['competitor', clean(config.competitor_keywords)],
    ['industry', clean(config.industry_keywords)],
  ]
  const plan: SearchGroup[] = []
  const seen = new Set<string>()
  for (const [bucket, keywords] of buckets) {
    for (const kw of keywords) {
      if (seen.has(kw)) continue // a keyword listed in two buckets searches only once
      seen.add(kw)
      plan.push({ label: `${bucket}:${kw}`, bucket, keyword: kw, terms: [kw], limit: config.max_videos })
    }
  }
  return plan
}

// Provisional keyword value: reward keywords that find RELEVANT, comment-rich
// videos, not just high raw volume (broad terms inflate volume but get gate-dropped).
// value = gate-survival rate × eligible videos. Refined later with insights_contributed.
function keywordValueScore(found: number, survived: number, eligible: number): number {
  const rate = found > 0 ? survived / found : 0
  return round2(rate * eligible)
}

export interface GatherOptions {
  clientId: string
  runId: string
  /** Override the client's configured platforms. */
  platforms?: Platform[]
  /** Override tracking_configs.max_videos (handy for cheap test runs). */
  maxVideos?: number
  /** Cap how many eligible videos get comment-scraped per platform (cost control). */
  videoLimit?: number
  /** Override the client's configured report_period (scrape window), e.g. 'monthly'. */
  period?: string
  /** Relevance gate before comment-scraping: 'gpt' (default), 'heuristic', or 'off'. */
  relevance?: RelevanceMethod
  /** Content attribution of brand/competitor tags: 'gpt' (default) or 'substring'. */
  attribution?: AttributionMethod
  /** Run Apify + normalise but write nothing. */
  dryRun?: boolean
}

export interface PlatformResult {
  platform: Platform
  videos: number
  comments: number
  /** Transcripts resolved this run (Step 1). Present only when enabled. */
  transcripts?: number
  errors: string[]
}

const DEFAULT_CONFIG: Omit<GatherConfig, 'platforms'> = {
  brand_keywords: [],
  competitor_keywords: [],
  competitor_names: [],
  industry_keywords: [],
  max_videos: 25,
  comment_depth: 50,
  report_period: 'weekly',
}

async function loadConfig(admin: Admin, clientId: string): Promise<GatherConfig> {
  const { data, error } = await admin
    .from('tracking_configs')
    .select('*')
    .eq('client_id', clientId)
    .maybeSingle()
  if (error) throw new Error(`load tracking_config: ${error.message}`)
  if (!data) throw new Error(`no tracking_config for client ${clientId}`)
  return {
    brand_keywords: data.brand_keywords ?? [],
    competitor_keywords: data.competitor_keywords ?? [],
    competitor_names: data.competitor_names ?? [],
    industry_keywords: data.industry_keywords ?? [],
    platforms: data.platforms ?? ['tiktok', 'youtube', 'instagram'],
    max_videos: data.max_videos ?? DEFAULT_CONFIG.max_videos,
    comment_depth: data.comment_depth ?? DEFAULT_CONFIG.comment_depth,
    report_period: data.report_period ?? DEFAULT_CONFIG.report_period,
  }
}

// ---- baseline vs flow (teardown 2026-07-09 §Run 1, defect 6) ------------------

/** The run's gather window. `since` is inclusive, 'YYYY-MM-DD', UTC-day granular. */
export interface GatherWindow {
  /** True on a client's first data-producing run — deep, unwindowed. */
  baseline: boolean
  /** Flow runs: content older than this is out of the period. Null on baseline. */
  since: string | null
}

const sinceDateFor = (period: string): string =>
  new Date(Date.now() - periodWindowDays(period) * 86_400_000).toISOString().slice(0, 10)

/** True when a row belongs to the window. Null/unknown dates STAY — only
 *  content KNOWN older than the window is excluded, so a platform with patchy
 *  dates can never be blanked. Shared by the gather filter and the
 *  period-metrics slice (one source of truth for "in this period"). */
export const inWindow = (date: string | null | undefined, since: string | null): boolean =>
  !since || !date || date >= since

/**
 * Baseline-vs-flow: a client's first MAP-BUILDING run is the baseline — deep
 * and unwindowed. Every later run is a flow run and only this period's content
 * counts: TikTok/YouTube already window at the source, but Instagram's hashtag
 * actor has no date input, so the window is enforced post-search (gatePlatform)
 * — which also stops old-viral IG videos from burning a paid comment-scrape
 * actor run each week. The same window drives the period-metrics slice in the
 * synthesis half.
 *
 * "The map exists" = an earlier run produced a run_summary (synthesis closed),
 * NOT merely an earlier completed pipeline_runs row — Sealand's June runs on
 * the old pipeline are status 'completed' with zero analysis, and a failed or
 * empty run must not cost the client their one deep baseline.
 */
export async function resolveGatherWindow(clientId: string, runId: string, period: string): Promise<GatherWindow> {
  const admin = createAdminClient()
  const { data, error } = await admin
    .from('run_summary')
    .select('run_id')
    .eq('client_id', clientId)
    .neq('run_id', runId)
    .limit(1)
    .maybeSingle()
  if (error) throw new Error(`resolve gather window: ${error.message}`)
  return data ? { baseline: false, since: sinceDateFor(period) } : { baseline: true, since: null }
}

// ---- step-sized pieces -------------------------------------------------------

/** One planned keyword search — the unit of the Inngest search fan-out. */
export interface SearchTask {
  platform: Platform
  keyword: string
  bucket: KeywordBucket
}

/** One keyword search's normalised output (videos tagged with the keyword). */
export interface SearchResult {
  keyword: string
  bucket: KeywordBucket
  videos: VideoInsert[]
  /** Raw actor item per video_id, for transcript capture (Step 1). Only
   *  populated when TRANSCRIPTS_ENABLED — otherwise the default path is
   *  unchanged and nothing extra is serialised between Inngest steps. */
  raws?: Record<string, RawItem>
}

/** What a platform's gate hands the comment-scrape steps. */
export interface GateResult {
  platform: Platform
  videosKept: number
  eligible: VideoRef[]
  errors: string[]
}

/** The full run's search plan: platform × keyword. Platforms without an adapter
 *  are skipped (the orchestrator has nothing to run for them). */
export async function planGatherSearches(clientId: string, platforms?: Platform[]): Promise<SearchTask[]> {
  const admin = createAdminClient()
  const config = await loadConfig(admin, clientId)
  const wanted = platforms ?? (config.platforms as Platform[])
  const tasks: SearchTask[] = []
  for (const platform of wanted) {
    if (!adapters[platform]) continue
    for (const group of buildSearchPlan(config)) {
      tasks.push({ platform, keyword: group.keyword, bucket: group.bucket })
    }
  }
  return tasks
}

/** Run ONE keyword search on one platform: Apify actor → normalise → tag with
 *  the surfacing keyword. No writes — the gate merges and upserts. */
export async function searchOne(opts: {
  clientId: string
  runId: string
  platform: Platform
  keyword: string
  bucket: KeywordBucket
  maxVideos?: number
  period?: string
}): Promise<SearchResult> {
  const admin = createAdminClient()
  const config = await loadConfig(admin, opts.clientId)
  if (opts.maxVideos) config.max_videos = opts.maxVideos
  if (opts.period) config.report_period = opts.period
  const adapter = adapters[opts.platform]
  if (!adapter) throw new Error(`no adapter for ${opts.platform}`)
  const ctx: NormaliseCtx = { clientId: opts.clientId, runId: opts.runId, config }

  // Native-API platforms (YouTube) fetch their own items; Apify platforms build
  // an actor+input the orchestrator runs. Exactly one path exists per adapter.
  let raw: RawItem[]
  if (adapter.fetchVideos) {
    raw = await adapter.fetchVideos(config, [opts.keyword], config.max_videos)
  } else if (adapter.videoSearch) {
    const { actor, input } = adapter.videoSearch(config, [opts.keyword], config.max_videos)
    raw = await runActor(actor, input)
  } else {
    throw new Error(`adapter ${opts.platform} has no video source`)
  }
  // Keep each raw item paired with its normalised video so the transcript step
  // can reach the media/caption URLs (discarded otherwise). Cheap; only surfaced
  // in the return value when transcripts are enabled.
  const paired = raw
    .map((r) => ({ raw: r, video: adapter.normaliseVideo(r, ctx) }))
    .filter((p): p is { raw: RawItem; video: VideoInsert } => p.video !== null)
  const videos = dedupeBy(paired.map((p) => p.video), (v) => v.video_id)
  for (const v of videos) v.source_keywords = [opts.keyword]

  let raws: Record<string, RawItem> | undefined
  if (transcriptsEnabled()) {
    raws = {}
    for (const p of paired) raws[p.video.video_id] = p.raw
  }
  return { keyword: opts.keyword, bucket: opts.bucket, videos, raws }
}

/** Merge a platform's keyword searches (unioning source_keywords), run the
 *  relevance gate + entity attribution, upsert kept videos, persist per-keyword
 *  performance, and return the comment-eligible refs (videoLimit applied). */
export async function gatePlatform(opts: {
  clientId: string
  runId: string
  platform: Platform
  searches: SearchResult[]
  videoLimit?: number
  /** Override the client's configured report_period (matches searchOne). */
  period?: string
  relevance?: RelevanceMethod
  attribution?: AttributionMethod
  dryRun?: boolean
}): Promise<GateResult> {
  const admin = createAdminClient()
  const config = await loadConfig(admin, opts.clientId)
  const adapter = adapters[opts.platform]
  if (!adapter) throw new Error(`no adapter for ${opts.platform}`)
  const errors: string[] = []

  // Per-keyword value tracking: found (pre-gate) per surfacing keyword, then
  // credit gate-survival + comment-eligibility below.
  const stats = new Map<string, { bucket: KeywordBucket; found: Set<string>; survived: number; eligible: number }>()
  const byId = new Map<string, VideoInsert>()
  for (const search of opts.searches) {
    const s = stats.get(search.keyword) ?? { bucket: search.bucket, found: new Set<string>(), survived: 0, eligible: 0 }
    stats.set(search.keyword, s)
    for (const v of search.videos) {
      s.found.add(v.video_id)
      const existing = byId.get(v.video_id)
      if (existing) {
        if (!existing.source_keywords?.includes(search.keyword)) existing.source_keywords?.push(search.keyword)
      } else {
        v.source_keywords = [search.keyword]
        byId.set(v.video_id, v)
      }
    }
  }
  const merged = [...byId.values()]

  // Delta layer (delta.ts): split this run's results against what's already
  // stored. Fresh videos take the full path below; resurfaced ones skip the
  // gate + attribution (they passed once — re-gated content gets deleted, so
  // presence in the DB means kept) and instead feed the growth comparison that
  // decides which comment scrapes are worth re-paying for. Whole-platform scan
  // + in-memory map, same URL-overflow avoidance as everywhere else.
  const knownRows = await selectAll<KnownVideoState>(() =>
    admin
      .from('videos')
      .select('video_id, video_url, comments_count, comments_count_at_scrape, upload_date, is_client, is_competitor, competitor_name')
      .eq('client_id', opts.clientId)
      .eq('platform', adapter.platform)
      .order('id', { ascending: true }),
  )
  const known = new Map(knownRows.map((r) => [r.video_id, r]))
  const { fresh, resurfaced } = splitDelta(merged, known)

  // Flow-run window: drop FRESH content older than the report period BEFORE the
  // relevance gate (saves its GPT call) and before the upsert. Baseline runs
  // pass everything — the first run builds the map. Only content KNOWN to be
  // old is dropped: a null upload_date stays, so a platform with patchy dates
  // can't be blanked by the window. (Resurfaced videos are windowed separately
  // below — old-but-active ones stay out of the corpus refresh but may still
  // earn a comment re-check.)
  const window = await resolveGatherWindow(opts.clientId, opts.runId, opts.period ?? config.report_period)
  const videos = fresh.filter((v) => inWindow(v.upload_date, window.since))
  if (videos.length < fresh.length) {
    console.log(`[${adapter.platform}] flow window dropped ${fresh.length - videos.length}/${fresh.length} fresh videos older than ${window.since}`)
  }

  // Relevance gate (BEFORE the expensive comment scrape). Judge market
  // relevance from cheap metadata so off-market noise (SFX/movie "prosthetics",
  // viral human-interest, news) never enters the corpus or burns a comment
  // scrape. Fails open — kept videos are everything not explicitly dropped.
  const method = opts.relevance ?? 'gpt'
  const { verdicts } = await classifyRelevance(videos, { method, config })
  const kept = videos.filter((v) => verdicts.get(v.video_id)?.relevant !== false)
  const dropped = videos.length - kept.length
  if (dropped > 0) {
    const reasons = videos
      .filter((v) => verdicts.get(v.video_id)?.relevant === false)
      .map((v) => `    - ${v.account_name}: ${verdicts.get(v.video_id)?.reason}`)
    console.log(`[${adapter.platform}] relevance gate (${method}) dropped ${dropped}/${videos.length}:\n${reasons.join('\n')}`)
  }
  for (const v of kept) for (const kw of v.source_keywords ?? []) { const s = stats.get(kw); if (s) s.survived++ }

  // Attribute brand/competitor tags by CONTENT. Adapters set naive substring
  // tags during normalise; this overwrites them with the GPT-confirmed entity so
  // homonym hits ("Freitag"=Friday, "Patagonia"=a region) don't pollute the
  // competitor buckets. Industry videos skip GPT internally, so the call is small.
  const attribution = opts.attribution ?? 'gpt'
  const { tags: entityTags } = await attributeVideos(kept, { method: attribution, config })
  for (const v of kept) {
    const t = entityTags.get(v.video_id)
    if (t) {
      v.is_client = t.is_client
      v.is_competitor = t.is_competitor
      v.competitor_name = t.competitor_name
    }
  }

  // Resurfaced-in-window videos re-upsert too (metrics refresh + run_id
  // restamp, so the period slice still sees a video found by an earlier run in
  // the same window — e.g. a manual midweek run before the scheduled one). The
  // stored GPT entity tags are grafted over normalise's naive substring tags so
  // the re-upsert can't clobber attribution. Survived-credit matches: they're
  // proven corpus members, so keywords keep their ROI credit across re-runs.
  const resurfacedInWindow = resurfaced.filter((r) => inWindow(r.video.upload_date, window.since))
  for (const r of resurfacedInWindow) {
    r.video.is_client = r.state.is_client
    r.video.is_competitor = r.state.is_competitor
    r.video.competitor_name = r.state.competitor_name
    for (const kw of r.video.source_keywords ?? []) { const s = stats.get(kw); if (s) s.survived++ }
  }
  const toUpsert = [...kept, ...resurfacedInWindow.map((r) => r.video)]

  // Upsert kept videos (merge on natural key — preserves Pass A columns).
  if (!opts.dryRun && toUpsert.length) {
    const { error } = await admin
      .from('videos')
      .upsert(toUpsert, { onConflict: 'client_id,platform,video_id' })
    if (error) errors.push(`videos upsert: ${error.message}`)
  }

  // Step 1 capture: persist the raw actor item for each kept video, so the
  // transcript step can reach the media + caption URLs (discarded at normalise).
  // Kept-only — gate-dropped noise isn't stored. The analysis passes ignore it.
  if (transcriptsEnabled() && !opts.dryRun && toUpsert.length) {
    const rawById = new Map<string, RawItem>()
    for (const s of opts.searches) for (const [id, r] of Object.entries(s.raws ?? {})) if (!rawById.has(id)) rawById.set(id, r)
    const rawRows = toUpsert
      .filter((v) => rawById.has(v.video_id))
      .map((v) => ({
        client_id: opts.clientId,
        run_id: opts.runId,
        platform: adapter.platform,
        video_id: v.video_id,
        raw: rawById.get(v.video_id),
      }))
    if (rawRows.length) {
      const { error } = await admin
        .from('video_raw')
        .upsert(rawRows, { onConflict: 'client_id,platform,video_id,run_id' })
      if (error) errors.push(`video_raw upsert: ${error.message}`)
    }
  }

  // Eligible-for-comments (stats credit spans fresh + resurfaced so keyword ROI
  // stays comparable across re-runs) + optional cost cap. Only FRESH videos
  // scrape unconditionally — known videos go through the growth rule below.
  const eligibleVideos = toUpsert.filter(
    (v) => adapter.commentThreshold == null || v.comments_count >= adapter.commentThreshold,
  )
  for (const v of eligibleVideos) for (const kw of v.source_keywords ?? []) { const s = stats.get(kw); if (s) s.eligible++ }
  const freshEligible = kept.filter(
    (v) => adapter.commentThreshold == null || v.comments_count >= adapter.commentThreshold,
  )
  const toScrape = opts.videoLimit ? freshEligible.slice(0, opts.videoLimit) : freshEligible

  // Delta re-checks: known videos whose comment count grew earn a re-scrape —
  // even outside the window (their NEW comments are this period's conversation;
  // comment_date keeps the period slice honest). Candidates come free from the
  // search results; platforms with a free count API (YouTube) also check stored
  // recent videos the search didn't resurface. Unchanged videos are the Part-1
  // saving: no growth → no paid scrape.
  const candidates: RecheckCandidate[] = resurfaced.map((r) => ({
    video_id: r.video.video_id,
    video_url: r.video.video_url || r.state.video_url,
    freshCount: r.video.comments_count,
    baseline: scrapeBaseline(r.state),
  }))
  if (adapter.fetchCommentCounts) {
    const resurfacedIds = new Set(resurfaced.map((r) => r.video.video_id))
    const cutoff = new Date(Date.now() - RECHECK_WINDOW_DAYS * 86_400_000).toISOString().slice(0, 10)
    const dormant = knownRows.filter(
      (r) => !resurfacedIds.has(r.video_id) && r.upload_date != null && r.upload_date >= cutoff,
    )
    if (dormant.length) {
      try {
        const counts = await adapter.fetchCommentCounts(dormant.map((d) => d.video_id))
        for (const d of dormant) {
          const freshCount = counts.get(d.video_id)
          if (freshCount != null) {
            candidates.push({ video_id: d.video_id, video_url: d.video_url, freshCount, baseline: scrapeBaseline(d) })
          }
        }
      } catch (e) {
        // Best-effort: a count-API hiccup must never fail the gather.
        errors.push(`recheck counts: ${(e as Error).message}`)
      }
    }
  }
  const rechecks = pickRechecks(candidates, {
    minGrowth: RECHECK_MIN_GROWTH,
    threshold: adapter.commentThreshold,
    cap: RECHECK_CAP,
  })
  if (candidates.length) {
    console.log(`[${adapter.platform}] delta: ${candidates.length} known videos checked → ${rechecks.length} re-scrapes, ${candidates.length - rechecks.length} skipped (no growth)`)
  }

  // Persist per-keyword performance for this run — the raw signal for keyword value
  // scoring + add/remove suggestions (v5-Ideas). Service-role write, bypasses RLS.
  if (!opts.dryRun && stats.size) {
    const kpRows = [...stats.entries()].map(([keyword, s]) => ({
      client_id: opts.clientId,
      run_id: opts.runId,
      platform: adapter.platform,
      keyword,
      bucket: s.bucket,
      videos_found: s.found.size,
      gate_survived: s.survived,
      eligible_videos: s.eligible,
      value_score: keywordValueScore(s.found.size, s.survived, s.eligible),
    }))
    const { error } = await admin
      .from('keyword_performance')
      .upsert(kpRows, { onConflict: 'client_id,run_id,platform,keyword' })
    if (error) errors.push(`keyword_performance upsert: ${error.message}`)
  }

  return {
    platform: adapter.platform,
    videosKept: toUpsert.length,
    // Fresh first-time scrapes + growth re-checks. Disjoint by construction:
    // toScrape is fresh-only, rechecks are known-only.
    eligible: [
      ...toScrape.map((v) => ({ video_id: v.video_id, video_url: v.video_url, comments_count: v.comments_count })),
      ...rechecks,
    ],
    errors,
  }
}

/** Scrape + upsert comments for a batch of eligible videos. One video failing
 *  keeps the loop going. Batch size is the orchestrator's concern — size it to
 *  the function-duration cap (each video is its own Apify actor run). */
export async function scrapeCommentsBatch(opts: {
  clientId: string
  runId: string
  platform: Platform
  refs: VideoRef[]
  dryRun?: boolean
}): Promise<{ comments: number; errors: string[] }> {
  const admin = createAdminClient()
  const config = await loadConfig(admin, opts.clientId)
  const adapter = adapters[opts.platform]
  if (!adapter) throw new Error(`no adapter for ${opts.platform}`)
  const ctx: NormaliseCtx = { clientId: opts.clientId, runId: opts.runId, config }
  const errors: string[] = []

  let commentCount = 0
  for (const ref of opts.refs) {
    try {
      let rawComments: RawItem[]
      if (adapter.fetchComments) {
        rawComments = await adapter.fetchComments(ref, config)
      } else if (adapter.commentScrape) {
        const { actor: cActor, input: cInput } = adapter.commentScrape(ref, config)
        rawComments = await runActor(cActor, cInput)
      } else {
        throw new Error(`adapter ${opts.platform} has no comment source`)
      }
      const comments = dedupeBy(
        rawComments
          .map((r) => adapter.normaliseComment(r, ref, ctx))
          .filter((c): c is CommentInsert => c !== null),
        (c) => c.comment_id,
      )
      if (!opts.dryRun && comments.length) {
        const { error } = await admin
          .from('comments')
          .upsert(comments, { onConflict: 'client_id,platform,comment_id' })
        if (error) errors.push(`comments upsert (${ref.video_id}): ${error.message}`)
      }
      // Stamp the delta-scraping baseline: this video's comments were captured
      // at this observed count (even if the scrape returned few/none — checked
      // is checked). Later runs compare their fresh count against it to decide
      // whether a re-scrape is worth paying for (delta.ts).
      if (!opts.dryRun) {
        const { error } = await admin
          .from('videos')
          .update({ comments_count: ref.comments_count, comments_count_at_scrape: ref.comments_count })
          .eq('client_id', opts.clientId)
          .eq('platform', opts.platform)
          .eq('video_id', ref.video_id)
        if (error) errors.push(`scrape baseline stamp (${ref.video_id}): ${error.message}`)
      }
      commentCount += comments.length
    } catch (e) {
      errors.push(`comment scrape (${ref.video_id}): ${(e as Error).message}`)
    }
  }
  return { comments: commentCount, errors }
}

/**
 * Resolve + store one transcript per kept video for a run+platform (Step 1 —
 * CAPTURE ONLY; the analysis passes do NOT read these columns). Reads the raw
 * items gatePlatform persisted, extracts each platform's media/caption handles,
 * and resolves a transcript (free caption when present, else Whisper) — speech-
 * gated and capped at TRANSCRIBE_CAP. Idempotent: videos already carrying a
 * transcript_status are skipped, so re-runs are cheap. Platforms without an
 * `extractMedia` (YouTube — deferred) are skipped entirely. Its own step so the
 * per-video download+Whisper loop stays under the function-duration cap.
 */
/** Pure: order pending-transcript candidates highest-comment-first (the best
 *  signal proxy under any cap), drop already-attempted videos, cap, and chunk
 *  into Inngest-step-sized batches. Exported for tests. */
export function orderAndChunkPending(
  rows: { video_id: string; comments_count: number | null; transcript_status: string | null }[],
  batchSize: number,
  cap: number,
): string[][] {
  const ids = rows
    .filter((r) => r.transcript_status == null)
    .sort((a, b) => (b.comments_count ?? 0) - (a.comments_count ?? 0) || a.video_id.localeCompare(b.video_id))
    .slice(0, cap)
    .map((r) => r.video_id)
  const batches: string[][] = []
  for (let i = 0; i < ids.length; i += batchSize) batches.push(ids.slice(i, i + batchSize))
  return batches
}

/** Batch plan for the transcribe fan-out: this run's video_raw candidates,
 *  minus already-transcribed videos, signal-first, chunked. The status check is
 *  scoped to exactly these candidates (chunked .in) — never a platform-wide
 *  unbounded read. */
export async function planTranscribeBatches(clientId: string, runId: string, platform: Platform): Promise<string[][]> {
  const admin = createAdminClient()
  if (!adapters[platform]?.extractMedia) return [] // YouTube: deferred
  const rawIds = (
    await selectAll<{ video_id: string }>(() =>
      admin
        .from('video_raw')
        .select('video_id')
        .eq('client_id', clientId)
        .eq('run_id', runId)
        .eq('platform', platform)
        .order('id', { ascending: true }),
    )
  ).map((r) => r.video_id)
  if (!rawIds.length) return []

  const rows: { video_id: string; comments_count: number | null; transcript_status: string | null }[] = []
  for (let i = 0; i < rawIds.length; i += 100) {
    const { data, error } = await admin
      .from('videos')
      .select('video_id, comments_count, transcript_status')
      .eq('client_id', clientId)
      .eq('platform', platform)
      .in('video_id', rawIds.slice(i, i + 100))
    if (error) throw new Error(`plan transcribe: ${error.message}`)
    rows.push(...((data ?? []) as typeof rows))
  }
  return orderAndChunkPending(rows, TRANSCRIBE_BATCH, TRANSCRIBE_CAP)
}

export async function transcribeBatch(opts: {
  clientId: string
  runId: string
  platform: Platform
  /** Fan-out mode: exactly these videos (a planTranscribeBatches chunk). The
   *  plan already excluded done videos and applied the cap; the in-batch
   *  status re-check still runs (cheap, makes Inngest step retries free). */
  videoIds?: string[]
  /** 1-based batch number for the ai_call_log call_index (fan-out mode). */
  batchNo?: number
  dryRun?: boolean
}): Promise<{ transcribed: number; skipped: number; errors: string[] }> {
  const admin = createAdminClient()
  const adapter = adapters[opts.platform]
  const errors: string[] = []
  if (!adapter?.extractMedia) return { transcribed: 0, skipped: 0, errors } // YouTube: deferred
  const startedAt = Date.now()

  const rawRows = await selectAll<{ video_id: string; raw: RawItem }>(() => {
    let q = admin
      .from('video_raw')
      .select('video_id, raw')
      .eq('client_id', opts.clientId)
      .eq('run_id', opts.runId)
      .eq('platform', opts.platform)
    if (opts.videoIds?.length) q = q.in('video_id', opts.videoIds)
    return q.order('id', { ascending: true })
  })
  if (!rawRows.length) return { transcribed: 0, skipped: 0, errors }

  // Skip videos already transcribed (idempotent re-runs / step retries).
  // Scoped to exactly the candidate ids, chunked — bounded however large the
  // client's history grows.
  const candidateIds = rawRows.map((r) => r.video_id)
  const done = new Set<string>()
  for (let i = 0; i < candidateIds.length; i += 100) {
    const { data, error } = await admin
      .from('videos')
      .select('video_id')
      .eq('client_id', opts.clientId)
      .eq('platform', opts.platform)
      .in('video_id', candidateIds.slice(i, i + 100))
      .not('transcript_status', 'is', null)
    if (error) {
      errors.push(`transcribe done-check: ${error.message}`)
      return { transcribed: 0, skipped: 0, errors }
    }
    for (const r of data ?? []) done.add(r.video_id as string)
  }

  const filtered = rawRows.filter((r) => !done.has(r.video_id))
  const pending = opts.videoIds?.length ? filtered : filtered.slice(0, TRANSCRIBE_CAP)
  let transcribed = 0
  let skipped = 0
  let whisperMinutes = 0
  const gate = { prompt: 0, completion: 0 }
  const statusCounts: Record<string, number> = {}
  for (const row of pending) {
    try {
      const t = await resolveTranscript(adapter.extractMedia!(row.raw))
      // Spend happened the moment Whisper/the gate ran — accumulate BEFORE the
      // persist attempt so a failed update can't under-log real cost.
      whisperMinutes += t.whisperMinutes ?? 0
      gate.prompt += t.gateTokens?.prompt ?? 0
      gate.completion += t.gateTokens?.completion ?? 0
      statusCounts[t.status] = (statusCounts[t.status] ?? 0) + 1
      if (!opts.dryRun) {
        const { error } = await admin
          .from('videos')
          .update({
            transcript: t.text || null,
            transcript_lang: t.lang,
            transcript_source: t.source,
            transcript_status: t.status,
          })
          .eq('client_id', opts.clientId)
          .eq('platform', opts.platform)
          .eq('video_id', row.video_id)
        if (error) {
          errors.push(`transcript update (${row.video_id}): ${error.message}`)
          continue
        }
      }
      if (t.status === 'ok') transcribed++
      else skipped++
    } catch (e) {
      errors.push(`transcribe (${row.video_id}): ${(e as Error).message}`)
    }
  }

  // Cost observability (Step 2 readiness): Whisper bills per audio minute —
  // invisible to estimateCost — so this is the one place the spend is recorded.
  // A logging failure must never sink capture.
  if (!opts.dryRun && pending.length) {
    const costUsd = whisperMinutes * WHISPER_PER_MINUTE + estimateCost(CONTENT_GATE_MODEL, gate.prompt, gate.completion)
    const { error: logErr } = await admin.from('ai_call_log').insert({
      client_id: opts.clientId,
      run_id: opts.runId,
      pass: 'transcribe',
      call_index: opts.batchNo ?? 1,
      model: TRANSCRIBE_MODEL,
      prompt_version: 'transcribe_v1',
      request: { platform: opts.platform, videos: pending.length },
      response: { ok: transcribed, statuses: statusCounts, failed: errors.length, whisper_minutes: Math.round(whisperMinutes * 100) / 100, gate_prompt_tokens: gate.prompt, gate_completion_tokens: gate.completion },
      error_message: null,
      prompt_tokens: gate.prompt,
      completion_tokens: gate.completion,
      cost_usd: costUsd,
      duration_ms: Date.now() - startedAt,
      validation_status: 'ok',
    })
    if (logErr) console.warn(`[${opts.platform}] transcribe cost log failed: ${logErr.message}`)
  }

  console.log(
    `[${opts.platform}] transcripts${opts.batchNo ? ` (batch ${opts.batchNo})` : ''}: ${transcribed} ok, ${skipped} empty/no-speech, ${rawRows.length - pending.length} already-done · ${Math.round(whisperMinutes * 10) / 10} whisper-min`,
  )
  return { transcribed, skipped, errors }
}

// ---- CLI composition ---------------------------------------------------------

/** Sequential composition of the step pieces — the CLI path (run-gather.ts).
 *  Behaviour matches the pre-split orchestrator: one platform failing must not
 *  stop the others; one search failing must not stop the platform. */
export async function runGather(opts: GatherOptions): Promise<PlatformResult[]> {
  const admin = createAdminClient()
  const config = await loadConfig(admin, opts.clientId)
  const platforms = opts.platforms ?? (config.platforms as Platform[])

  const results: PlatformResult[] = []
  for (const platform of platforms) {
    if (!adapters[platform]) {
      results.push({ platform, videos: 0, comments: 0, errors: [`no adapter for ${platform}`] })
      continue
    }
    const errors: string[] = []
    try {
      const searches: SearchResult[] = []
      for (const group of buildSearchPlan(config)) {
        try {
          searches.push(await searchOne({
            clientId: opts.clientId, runId: opts.runId, platform,
            keyword: group.keyword, bucket: group.bucket,
            maxVideos: opts.maxVideos, period: opts.period,
          }))
        } catch (e) {
          errors.push(`search ${group.bucket}:${group.keyword}: ${(e as Error).message}`)
          searches.push({ keyword: group.keyword, bucket: group.bucket, videos: [] })
        }
      }
      const gate = await gatePlatform({
        clientId: opts.clientId, runId: opts.runId, platform, searches,
        videoLimit: opts.videoLimit, period: opts.period, relevance: opts.relevance,
        attribution: opts.attribution, dryRun: opts.dryRun,
      })
      errors.push(...gate.errors)
      const scraped = await scrapeCommentsBatch({
        clientId: opts.clientId, runId: opts.runId, platform,
        refs: gate.eligible, dryRun: opts.dryRun,
      })
      errors.push(...scraped.errors)
      let transcripts: number | undefined
      if (transcriptsEnabled()) {
        // Same plan + batch units as the Inngest fan-out, run sequentially
        // (the CLI has no step cap to duck under).
        const batches = await planTranscribeBatches(opts.clientId, opts.runId, platform)
        transcripts = 0
        for (let b = 0; b < batches.length; b++) {
          const tx = await transcribeBatch({ clientId: opts.clientId, runId: opts.runId, platform, videoIds: batches[b], batchNo: b + 1, dryRun: opts.dryRun })
          transcripts += tx.transcribed
          errors.push(...tx.errors)
        }
      }
      results.push({ platform, videos: gate.videosKept, comments: scraped.comments, transcripts, errors })
    } catch (e) {
      errors.push((e as Error).message)
      results.push({ platform, videos: 0, comments: 0, errors })
    }
  }
  return results
}
