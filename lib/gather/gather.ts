import { createAdminClient, selectAll } from '../supabase-admin'
import { ANALYSIS_MODEL, REDDIT_COMMENT_SCRAPE_CAP, redditDiscoveryEnabled, periodWindowDays, RECHECK_MIN_GROWTH, RECHECK_CAP, RECHECK_WINDOW_DAYS, TRANSCRIBE_CAP, TRANSCRIBE_BATCH, TRANSCRIBE_MODEL, CONTENT_GATE_MODEL, WHISPER_PER_MINUTE, YT_TRANSCRIPT_PER_ITEM_USD, estimateCost, transcriptsEnabled, GATHER_MAX_SEARCHES_PER_RUN, GATHER_MAX_VIDEOS_PER_SEARCH, GATHER_MAX_COMMENT_DEPTH } from '../config'
import { runActor, isActorRunFailedError } from './apify'
import { adapters } from './platforms'
import { parseSubreddits, activeSubreddits, subredditLabel } from './subreddits'
import { logAiCall } from '../pipeline/ai-log'
import { resolveTranscript, gateTranscript, normaliseLang } from './transcript'
import { dedupeBy, round2 } from './util'
import { classifyRelevance, type RelevanceMethod } from './relevance'
import { buildGateVerdictRows, recordGateVerdicts } from './gate-verdicts'
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
  PlatformAdapter,
  FetchedTranscript,
  TranscriptResult,
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
  own_handles: {},
  subreddits: [],
}

/** The tenant's gather config. Exported for the discovery step, which needs the
 *  same view of tracking_configs (including subreddits) before gather planning. */
export async function loadGatherConfig(clientId: string): Promise<GatherConfig> {
  return loadConfig(createAdminClient(), clientId)
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
    // Clamped, not trusted (T0-2). The CHECK constraints bound what a tenant
    // can write; this bounds what a run will act on whatever the row says.
    max_videos: Math.min(data.max_videos ?? DEFAULT_CONFIG.max_videos, GATHER_MAX_VIDEOS_PER_SEARCH),
    comment_depth: Math.min(data.comment_depth ?? DEFAULT_CONFIG.comment_depth, GATHER_MAX_COMMENT_DEPTH),
    report_period: data.report_period ?? DEFAULT_CONFIG.report_period,
    own_handles: data.own_handles ?? {},
    subreddits: parseSubreddits(data.subreddits),
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
  /** Reddit community harvest: pull this whole community rather than running
   *  `keyword` as a search term. `keyword` is then the display label ('r/x'),
   *  which keeps source_keywords and keyword_performance meaningful. */
  community?: string
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
    // Reddit additionally harvests each discovered community WHOLESALE — the
    // conversation people have when they aren't using our keywords is the only
    // thing Reddit offers that TikTok/Instagram don't. One extra search per
    // active community, so the plan grows by N+M, never N*M.
    // Gated by the same flag as discovery. Without this the flag is a one-way
    // switch: once communities are promoted, turning it OFF would stop proposing
    // but keep fanning out M harvest searches and their comment scrapes every
    // run, and the only rollback would be hand-editing jsonb.
    if (platform === 'reddit' && redditDiscoveryEnabled()) {
      for (const name of activeSubreddits(config.subreddits)) {
        tasks.push({ platform, keyword: subredditLabel(name), bucket: 'industry', community: name })
      }
    }
  }
  return capSearchPlan(tasks)
}

/**
 * Run-level ceiling on paid searches (T0-2). Each task is an Apify actor run,
 * and nothing bounded their number: keywords x platforms, with no cap on
 * either.
 *
 * The cap is applied PER PLATFORM, not as a flat slice of the list. Tasks come
 * out of the planner grouped by platform, so slicing the tail would drop the
 * last platform entirely and silently — a tenant would lose all of Reddit and
 * read it as a quiet week. Within a platform the planner already orders brand,
 * then competitors, then category, so trimming a platform's tail drops the
 * least valuable searches first.
 */
export function capSearchPlan(
  tasks: SearchTask[],
  cap: number = GATHER_MAX_SEARCHES_PER_RUN,
): SearchTask[] {
  if (tasks.length <= cap) return tasks

  const platforms = [...new Set(tasks.map((t) => t.platform))]
  const budget = Math.max(1, Math.floor(cap / platforms.length))
  const kept: SearchTask[] = []
  const dropped: SearchTask[] = []
  for (const platform of platforms) {
    const mine = tasks.filter((t) => t.platform === platform)
    kept.push(...mine.slice(0, budget))
    dropped.push(...mine.slice(budget))
  }
  // Spend any remainder (integer division, or a platform under budget) on the
  // searches that were about to be dropped, in planner order.
  for (const t of dropped) {
    if (kept.length >= cap) break
    kept.push(t)
  }
  const finalDropped = dropped.filter((t) => !kept.includes(t))
  // Loud: a silently shortened plan reads as a quiet week.
  console.warn(
    `[plan-gather] ${tasks.length} searches planned, capping at ${cap}. ` +
    `Dropped ${finalDropped.length}: ${finalDropped.map((t) => `${t.platform}:${t.keyword}`).join(', ')}`,
  )
  return kept
}

/** Run ONE keyword search on one platform: Apify actor → normalise → tag with
 *  the surfacing keyword. No writes — the gate merges and upserts. */
export async function searchOne(opts: {
  clientId: string
  runId: string
  platform: Platform
  keyword: string
  bucket: KeywordBucket
  /** Reddit community harvest — see SearchTask.community. */
  community?: string
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
    const { actor, input } = adapter.videoSearch(config, [opts.keyword], config.max_videos, {
      community: opts.community,
    })
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
  // Read live rather than from the run snapshot: this sits INSIDE one step, so
  // a mid-run flip can skip a step's worth of raw capture but cannot split a
  // step in half. The snapshot is threaded only where a flip would corrupt
  // bookkeeping (Pass A's prompt version) — see lib/config RunFlags.
  if (transcriptsEnabled()) {
    raws = {}
    for (const p of paired) raws[p.video.video_id] = p.raw
  }
  return { keyword: opts.keyword, bucket: opts.bucket, videos, raws }
}

/**
 * How many FRESH comment scrapes a platform may run this gather.
 *
 * `videoLimit` is a cost-CONTROL lever, so where a platform carries its own
 * ceiling an explicit limit may only tighten it — passing videoLimit:60 to keep
 * a TikTok test cheap must not silently double Reddit's guard, the one platform
 * that has one. Null = uncapped. An explicit 0 means "scrape nothing" and must
 * not fall through to uncapped. Exported pure for tests.
 */
export function resolveScrapeCap(platform: Platform, videoLimit?: number): number | null {
  const platformCap = platform === 'reddit' ? REDDIT_COMMENT_SCRAPE_CAP : null
  if (videoLimit == null) return platformCap
  return platformCap == null ? videoLimit : Math.min(videoLimit, platformCap)
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
  const gateStartedAt = Date.now()
  const gateResult = await classifyRelevance(videos, { method, config })
  const { verdicts } = gateResult
  const kept = videos.filter((v) => verdicts.get(v.video_id)?.relevant !== false)
  const dropped = videos.length - kept.length

  // The gate's GPT spend used to be discarded here — it ran on every platform of
  // every run and appeared in no cost report, so per-keyword ROI understated
  // what a keyword actually cost. Logging failure must never sink a gather.
  if (!opts.dryRun && gateResult.promptTokens + gateResult.completionTokens > 0) {
    try {
      await logAiCall(admin, {
        clientId: opts.clientId,
        runId: opts.runId,
        pass: 'relevance_gate',
        callIndex: 1,
        model: ANALYSIS_MODEL,
        promptVersion: `relevance_${method}`,
        systemPrompt: `relevance gate (${method})`,
        userPrompt: `${adapter.platform} — ${videos.length} candidates`,
        response: { platform: adapter.platform, judged: videos.length, kept: kept.length, dropped },
        error: null,
        usage: { prompt_tokens: gateResult.promptTokens, completion_tokens: gateResult.completionTokens },
        durationMs: Date.now() - gateStartedAt,
        validationStatus: 'ok',
      })
    } catch (e) {
      console.warn(`[${adapter.platform}] relevance gate cost log failed: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  if (dropped > 0) {
    const reasons = videos
      .filter((v) => verdicts.get(v.video_id)?.relevant === false)
      .map((v) => `    - ${v.account_name}: ${verdicts.get(v.video_id)?.reason}`)
    console.log(`[${adapter.platform}] relevance gate (${method}) dropped ${dropped}/${videos.length}:\n${reasons.join('\n')}`)
  }

  // Keep the record of what we threw away (Tier 1). Dropped videos are filtered
  // out below and never reach `videos`, so without this the 38-61% of a gather
  // that dies here leaves nothing behind but a console line. Non-fatal: losing
  // the record must never lose the gather.
  if (!opts.dryRun) {
    try {
      // The candidate already carries its keywords; a find() over the same
      // array would be O(n^2) across ~460 candidates.
      const keywordById = new Map(videos.map((v) => [v.video_id, v.source_keywords?.[0] ?? null]))
      const written = await recordGateVerdicts(
        admin,
        buildGateVerdictRows(opts.clientId, opts.runId ?? null, adapter.platform, videos, verdicts, (id) => keywordById.get(id) ?? null),
      )
      console.log(`[${adapter.platform}] recorded ${written} gate verdicts (${kept.length} kept, ${dropped} dropped)`)
    } catch (e) {
      console.warn(`[${adapter.platform}] gate verdict recording failed: ${e instanceof Error ? e.message : String(e)}`)
    }
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
  // Reddit carries a default scrape cap the other platforms don't need: its
  // actor bills per RUN START and the spine scrapes one post per run (~$0.06 a
  // post), so a two-community harvest would otherwise run ~$8/run.
  const scrapeCap = resolveScrapeCap(adapter.platform, opts.videoLimit)
  let toScrape = freshEligible
  if (scrapeCap != null && freshEligible.length > scrapeCap) {
    // Spend the cap on the densest threads — same richest-first rule Pass A
    // batching and delta re-checks already use. Only the capped path sorts, so
    // an uncapped platform's ordering is untouched.
    toScrape = [...freshEligible].sort((a, b) => b.comments_count - a.comments_count).slice(0, scrapeCap)
    console.log(`[${adapter.platform}] comment-scrape cap: ${freshEligible.length} eligible → ${scrapeCap} scraped (richest first)`)
  }

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
  /** Stamp rows as the client's own-post comments (owned layer). Default
   *  omits the column → DB default 'discovered'. */
  source?: 'owned'
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
      ).map((c) => (opts.source ? { ...c, source: opts.source } : c))
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

/** A platform can transcribe when its adapter implements exactly one of the
 *  three routes: media+Whisper (TT/IG), text-in-raw (Reddit), or a paid text
 *  fetch by id (YouTube, Wave 4). */
export function canTranscribe(a: PlatformAdapter | undefined): boolean {
  return !!(a?.extractMedia || a?.extractTranscript || a?.fetchTranscripts)
}

/** Resolve one fetched transcript through the shared gate. null = the platform
 *  has no caption for it → 'no_media', same as an item with no media handle.
 *  (An id the fetch dropped never reaches here — see transcribeBatch.) */
async function gateFetched(f: FetchedTranscript | null): Promise<TranscriptResult> {
  if (!f) return { text: '', lang: null, source: null, status: 'no_media' }
  return gateTranscript(f.text, normaliseLang(f.lang), f.source)
}

/** Batch plan for the transcribe fan-out: this run's video_raw candidates,
 *  minus already-transcribed videos, signal-first, chunked. The status check is
 *  scoped to exactly these candidates (chunked .in) — never a platform-wide
 *  unbounded read. */
export async function planTranscribeBatches(clientId: string, runId: string, platform: Platform): Promise<string[][]> {
  const admin = createAdminClient()
  if (!canTranscribe(adapters[platform])) return []
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

/** Wall-clock budget for one chunk's fetch (batch attempt + isolation pass,
 *  measured from before the batch attempt). A transcribe step also carries the
 *  gate calls; 200s leaves room under the 300s Vercel step cap. */
const ISOLATION_DEADLINE_MS = 200_000

/** Batch caption fetch with per-id isolation. One actor run per batch is the
 *  cheap path; but when the actor's run FAILS on a batch (Apify 400
 *  run-failed — e.g. the 11-hour livestream that crashed the caption actor on
 *  Sealand run f4c5d868), retrying the same 8 ids just fails the same way on
 *  every Inngest retry and leaves all 8 NULL — re-planned and re-failed every
 *  run. So: on a run-failed batch, refetch id-by-id. An id is returned in
 *  `failed` ONLY when it failed alone AND at least one batch-mate resolved in
 *  the same pass — the mates resolving is the evidence that the actor is
 *  healthy and the failure is this input's. If nothing in the chunk resolves
 *  (actor globally broken, YouTube change, proxy exhaustion), or the chunk is
 *  a single id (no evidence possible), the ORIGINAL batch error is rethrown:
 *  ids stay NULL, the step retries with backoff, and they re-plan next run
 *  with mates. Any non-run-failed error (401/402/403/404/408, 5xx, 429,
 *  network) propagates untouched — isolating during an outage would only
 *  multiply the failures. `deadlineMs` bounds the isolation pass so a slow
 *  actor can't walk a step past the 300s cap; past it the original error is
 *  rethrown too. Pure over the injected `fetch`; unit-tested with a fake. */
export async function fetchTranscriptsIsolating(
  fetch: (ids: string[]) => Promise<Map<string, FetchedTranscript | null>>,
  ids: string[],
  batchSize: number,
  opts: { deadlineMs?: number; now?: () => number } = {},
): Promise<{ fetched: Map<string, FetchedTranscript | null>; failed: Map<string, string> }> {
  const fetched = new Map<string, FetchedTranscript | null>()
  const failed = new Map<string, string>()
  const now = opts.now ?? Date.now
  const deadline = now() + (opts.deadlineMs ?? ISOLATION_DEADLINE_MS)
  for (let i = 0; i < ids.length; i += batchSize) {
    const chunk = ids.slice(i, i + batchSize)
    let batchErr: unknown
    try {
      for (const [k, v] of await fetch(chunk)) fetched.set(k, v)
      continue
    } catch (e) {
      if (!isActorRunFailedError(e) || chunk.length === 1) throw e
      batchErr = e
    }
    console.warn(`[transcript] batch of ${chunk.length} run-failed, isolating per id: ${(batchErr as Error).message.slice(0, 160)}`)
    const chunkFetched = new Map<string, FetchedTranscript | null>()
    const chunkFailed = new Map<string, string>()
    for (const id of chunk) {
      if (now() > deadline) throw batchErr // out of budget: leave the whole chunk NULL for the retry
      try {
        for (const [k, v] of await fetch([id])) chunkFetched.set(k, v)
      } catch (e) {
        if (!isActorRunFailedError(e)) throw e
        chunkFailed.set(id, (e as Error).message.slice(0, 200))
      }
    }
    // No mate resolved → no evidence the actor is healthy → not a verdict.
    if (chunkFetched.size === 0) throw batchErr
    for (const [k, v] of chunkFetched) fetched.set(k, v)
    for (const [k, v] of chunkFailed) failed.set(k, v)
  }
  return { fetched, failed }
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
  if (!canTranscribe(adapter)) return { transcribed: 0, skipped: 0, errors }
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
  // Paid text platforms (YouTube captions): ONE actor call for the whole batch,
  // before the loop. Deliberately outside the per-video try — if the actor
  // itself fails, the step throws and retries; the ids stay NULL and re-plan
  // next run. Per-id absence/null is handled inside the loop. Runs in dryRun
  // too: dry-run here means "resolve, don't write", same as the Whisper path.
  // Chunked by TRANSCRIBE_BATCH regardless of how the caller sized `pending`
  // (fan-out passes 8; the CLI/backfill path could pass up to TRANSCRIBE_CAP)
  // so one actor call never carries hundreds of ids into a 60s timeout.
  let fetched: Map<string, FetchedTranscript | null> | null = null
  let fetchFailed = new Map<string, string>()
  if (adapter.fetchTranscripts && pending.length) {
    const r = await fetchTranscriptsIsolating(
      (ids) => adapter.fetchTranscripts!(ids),
      pending.map((p) => p.video_id),
      TRANSCRIBE_BATCH,
    )
    fetched = r.fetched
    fetchFailed = r.failed
  }
  let transcribed = 0
  let skipped = 0
  let whisperMinutes = 0
  const gate = { prompt: 0, completion: 0 }
  const statusCounts: Record<string, number> = {}
  for (const row of pending) {
    if (fetched && fetchFailed.has(row.video_id)) {
      // The actor's run failed on this id ALONE while its batch-mates resolved
      // in the same pass (fetchTranscriptsIsolating enforces that) — a
      // per-video verdict, same as the Whisper path's 'failed'. Stamp it so it
      // stops poisoning a batch on every future run; counted as skipped (Whisper
      // parity), not a run error.
      console.warn(`[transcript] ${opts.platform} ${row.video_id} run-failed in isolation: ${fetchFailed.get(row.video_id)}`)
      statusCounts.failed = (statusCounts.failed ?? 0) + 1
      skipped++
      if (!opts.dryRun) {
        const { error } = await admin
          .from('videos')
          .update({ transcript: null, transcript_lang: null, transcript_source: null, transcript_status: 'failed' })
          .eq('client_id', opts.clientId)
          .eq('platform', opts.platform)
          .eq('video_id', row.video_id)
        if (error) errors.push(`transcript update (${row.video_id}): ${error.message}`)
      }
      continue
    }
    // An id the fetch did not return (actor dropped it, or a 200 with an
    // empty/non-array body — runActor maps that to []) is an ERROR, not a
    // verdict: count it so the run closes partial, and write nothing so the
    // NULL status re-plans it next run. Stamping 'failed' here would silently
    // and permanently drop the whole batch on a bad actor day.
    if (fetched && !fetched.has(row.video_id)) {
      errors.push(`transcript fetch dropped (${row.video_id})`)
      continue
    }
    try {
      // Text-native platforms (Reddit) resolve straight from the stored item —
      // no fetch, no Whisper, no cost. Fetched text (YouTube) goes through the
      // shared gate. Everything else goes via media/captions + Whisper.
      const t = fetched
        ? await gateFetched(fetched.get(row.video_id) ?? null)
        : adapter.extractTranscript
          ? (adapter.extractTranscript(row.raw) ?? { text: '', lang: null, source: null, status: 'no_media' as const })
          : await resolveTranscript(adapter.extractMedia!(row.raw))
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
      response: {
        ok: transcribed, statuses: statusCounts, failed: errors.length,
        whisper_minutes: Math.round(whisperMinutes * 100) / 100,
        gate_prompt_tokens: gate.prompt, gate_completion_tokens: gate.completion,
        // The caption actor bills per item, empties included — an estimate, not
        // a bill; the DB records no other Apify spend for any platform.
        ...(fetched ? { apify_est_usd: Math.round(pending.length * YT_TRANSCRIPT_PER_ITEM_USD * 1e4) / 1e4 } : {}),
      },
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
      // Same task list the Inngest path plans — keyword searches plus, on
      // Reddit, one community harvest per active subreddit. Kept identical on
      // purpose: this is the only path with --dry-run, and a spend-bearing
      // feature the CLI can't exercise is one that can only be tested in prod.
      const tasks = [
        ...buildSearchPlan(config).map((g) => ({ keyword: g.keyword, bucket: g.bucket, community: undefined as string | undefined })),
        ...(platform === 'reddit' && redditDiscoveryEnabled()
          ? activeSubreddits(config.subreddits).map((name) => ({ keyword: subredditLabel(name), bucket: 'industry' as KeywordBucket, community: name }))
          : []),
      ]
      const searches: SearchResult[] = []
      for (const task of tasks) {
        try {
          searches.push(await searchOne({
            clientId: opts.clientId, runId: opts.runId, platform,
            keyword: task.keyword, bucket: task.bucket, community: task.community,
            maxVideos: opts.maxVideos, period: opts.period,
          }))
        } catch (e) {
          errors.push(`search ${task.bucket}:${task.keyword}: ${(e as Error).message}`)
          searches.push({ keyword: task.keyword, bucket: task.bucket, videos: [] })
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
