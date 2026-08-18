import { zodResponseFormat } from 'openai/helpers/zod'
import { createAdminClient, selectAll } from '../supabase-admin'
import { openai } from '../openai'
import { ANALYSIS_MODEL, ANALYSIS_TEMPERATURE, PASS_A_VIDEO_QUOTE_MAX, estimateCost, passAMinComments, transcriptsEnabled } from '../config'
import { PassAVideoSchema, PassAVideoSchemaV4, type PassAVideoOutput, type PassAInsight, type PassAClaim } from './schemas'
import { filterComments } from './spam-filter'
import { computeQualityScore } from './metrics'
import { usableTranscript } from './transcript-input'
import type { VideoRow, CommentRow } from './types'
import { normForMatch } from './quote-match'

// Pass A — per-video analysis (Architecture/Analysis-Passes §Pass A), built in
// code per Architecture/Migration-to-Code. One GPT call per video that clears
// the platform's kept-comment floor (config.passAMinComments): classification + audience insights, each insight carrying verbatim
// evidence tied to a real comment. Validated post-parse and persisted to
// videos / audience_insights / insight_evidence, with one ai_call_log row.
//
// v4 (transcripts on): the video's transcript grounds classification on every
// bucket; industry-other transcripts are quotable evidence (label "t", stored
// source='video'); client/competitor transcripts yield brand claims →
// video_claims. Brand-voice vs customer-voice — design 2026-08-08.
//
// Budget note: $2.40 OpenAI ceiling — iterate with `dryRun` (free) and small
// `limit`/`videoIds` samples; only run the full corpus once the prompt is dialed.

// v3.1 / v4.1 (2026-08-22): demographic_signal is counted, not quoted — the
// category definition drops "age" and a rule keeps identity disclosures out of
// every other quote. A version bump re-reads the corpus on the next run when
// INCREMENTAL_PASS_A is on; that is the cost of a prompt change (AGENTS.md).
const PROMPT_VERSION = 'pass_a_v3.1'
const PROMPT_VERSION_V4 = 'pass_a_v4.1'
const MAX_CLAIMS_PER_VIDEO = 3

/** The Pass A prompt version a run writes — v4 with transcripts, v3 without.
 *  Also the value plan-pass-a compares against videos.analyzed_prompt_version:
 *  a bump here (or flipping TRANSCRIPTS_ENABLED) re-reads every eligible video
 *  once on the next run (incremental Pass A, 2026-08-17). */
export function passAPromptVersion(useTranscripts: boolean): string {
  return useTranscripts ? PROMPT_VERSION_V4 : PROMPT_VERSION
}

/** Parsed model output — v3 shape, with v4's claims present when the v4 schema ran. */
type ParsedPassA = PassAVideoOutput & { claims?: PassAClaim[] }

export interface RunPassAOptions {
  clientId: string
  platform?: string
  /** Analysis run id. Created (status 'analyzing') if omitted; returned in the summary. */
  runId?: string
  /** Process only these videos.id values. */
  videoIds?: string[]
  /** Cap number of videos processed (most-commented first). */
  limit?: number
  /** Min kept comments for a per-video call. Omit to use the platform floor
   *  (config.passAMinComments: 5, Reddit 3). Below it, skipped — the metadata
   *  classification batch is what picks those videos up. */
  minComments?: number
  /** Assemble prompts + estimate tokens, no API calls, no writes. */
  dryRun?: boolean
  /** Write results to DB. Defaults to !dryRun. */
  persist?: boolean
  /** Move the per-video analysis pointer (videos.analyzed_*). Default true.
   *  A/B harnesses pass FALSE: their arms write real rows under a throwaway run,
   *  and moving the pointer would make an experiment the corpus's current
   *  analysis (and prune the real rows at the next close-run). */
  trackAnalysis?: boolean
  /** Read transcripts (Pass A v4). Defaults to TRANSCRIPTS_ENABLED — explicit
   *  override exists for the A/B measurement harness. */
  transcripts?: boolean
}

export interface PerVideoResult {
  videoId: string
  videoUrl: string
  keptComments: number
  droppedLowSignal: number
  status: 'analyzed' | 'skipped_too_few' | 'dry_run' | 'refused' | 'error' | 'already_analyzed'
  /** Wave 4 claims lane: analysed with no comments in the prompt (claims + classification only). */
  claimsOnly?: boolean
  insightsKept?: number
  insightsDropped?: number
  evidenceDropped?: number
  claimsKept?: number
  claimsDropped?: number
  promptTokens?: number
  completionTokens?: number
  costUsd?: number
  estInputTokens?: number
  error?: string
}

export interface RunPassASummary {
  runId: string
  model: string
  dryRun: boolean
  videosProcessed: number
  videosAnalyzed: number
  /** Subset of videosAnalyzed that went through the claims lane. */
  videosClaimsOnly: number
  videosSkipped: number
  /** Videos whose OpenAI call failed after the SDK's own retries (429/5xx/
   *  network). Until 2026-08-18 these were absorbed silently: not counted, not
   *  stamped, and a run whose every call failed still closed 'completed'. */
  videosErrored: number
  /** Videos the model refused / returned no parseable output for. */
  videosRefused: number
  /** Videos already stamped with this run's id — a retried batch step skips
   *  them instead of re-spending the whole batch. */
  videosAlreadyAnalyzed: number
  /** True when at least one failed call was a 429 (rate limit or quota). */
  rateLimited: boolean
  /** First few distinct error messages, for the run's error record. */
  errors: string[]
  insightsKept: number
  insightsDropped: number
  evidenceDropped: number
  claimsKept: number
  claimsDropped: number
  languageSamples: number
  promptTokens: number
  completionTokens: number
  costUsd: number
  estInputTokens: number
  perVideo: PerVideoResult[]
}

/** How many distinct error messages a summary keeps (the rest are counted). */
const PASS_A_ERROR_MESSAGES_KEPT = 5

/** 429 from OpenAI — rate limit or exhausted credits. The SDK has already
 *  retried with backoff by the time this is seen, so it is a real failure. */
function isRateLimitError(e: unknown): boolean {
  const status = (e as { status?: unknown })?.status
  if (status === 429) return true
  const msg = e instanceof Error ? e.message : String(e)
  return /\b429\b|rate limit|insufficient_quota|no credits/i.test(msg)
}

interface TrackingConfig {
  brand_keywords: string[] | null
  competitor_names: string[] | null
  industry_keywords: string[] | null
}

// ---- prompt building -------------------------------------------------------

function ownerLabel(v: VideoRow): string {
  if (v.is_client) return 'the CLIENT brand'
  if (v.is_competitor) return `a COMPETITOR (${v.competitor_name ?? 'unknown'})`
  return 'an industry/other account'
}

export type PassALane = 'full' | 'claims_only' | 'skip'

/**
 * Which lane a video enters Pass A through — used by BOTH gates (the plan
 * step on raw counts, runPassA on kept counts) so they cannot drift.
 *   full        — comments ≥ the platform floor: the normal analysis.
 *   claims_only — below the floor, but a brand-side (client/competitor) video
 *                 with a usable transcript (Wave 4). It enters with NO comments
 *                 in the prompt, so it can only yield claims + classification:
 *                 no audience insights, sentiment column untouched. The comment
 *                 floor keeps governing audience evidence; the transcript
 *                 governs brand claims. Why: 0 of Össur's 22 client YouTube
 *                 videos in run 147899d3 had even 3 comments — the captions
 *                 are where brand claims live, and the floor hid every one.
 *   skip        — everything else.
 * Pass `transcript_status: null` when transcripts are off to disable the lane.
 */
export function passALane(
  v: { platform: string; is_client: boolean | null; is_competitor: boolean | null; transcript_status: string | null; source?: string | null },
  comments: number,
  floor: number = passAMinComments(v.platform),
): PassALane {
  // The client's OWN posts (Brand Voice, 2026-08-16): claims lane or nothing.
  // Never the full lane — their fans' comments would contaminate audience
  // themes (Owned-Data-Plan guardrail: segment, never blend). Their words
  // are the purest "say" side there is; their comments stay Step 2c's.
  if (v.source === 'owned') return v.transcript_status === 'ok' ? 'claims_only' : 'skip'
  if (comments >= floor) return 'full'
  if ((v.is_client || v.is_competitor) && v.transcript_status === 'ok') return 'claims_only'
  return 'skip'
}

/** Exported for tests — the v4 line rewrites are exact-string-matched against
 *  the base prompt, so a test pins them against silent reversion. */
export function buildSystemPrompt(tc: TrackingConfig, withTranscripts = false): string {
  const brand = (tc.brand_keywords ?? []).join(', ') || '(none provided)'
  const competitors = (tc.competitor_names ?? []).join(', ') || '(none provided)'
  const industry = (tc.industry_keywords ?? []).join(', ') || '(none provided)'
  // competitor_keywords intentionally excluded (invariant 2 — search-only).
  const base = [
    'You are a media-based consumer intelligence analyst working for a brand.',
    '',
    'Given ONE social video and its comments, return:',
    '1. A classification of the video (type, hook style, hook text, topics, sentiment).',
    '2. Audience insights distilled STRICTLY from the comments — and ONLY insights that carry consumer-intelligence value for the brand.',
    '',
    'Client context:',
    `- Brand: ${brand}`,
    `- Competitors: ${competitors}`,
    `- Industry: ${industry}`,
    '',
    'Insight categories (apply these definitions strictly):',
    '- pain_point: a problem, frustration, or unmet need with a product, the category, or the lived experience. NOT general sadness or sympathy.',
    '- question: a genuine question about the product, the category, or how something works.',
    '- purchase_intent: a signal of wanting to buy, try, own, or where to get something.',
    '- feature_request: a suggested improvement or a desired capability.',
    '- praise: positive feedback about a product, brand, or result. NOT generic "so beautiful / inspiring" on human-interest content.',
    '- objection: a concern, criticism, or reason not to buy.',
    '- misinformation: a false or misleading claim worth flagging.',
    '- demographic_signal: who the audience is — condition, use-case, or location revealed in the comments (never age). Evidence in this category is verified and then COUNTED, never displayed: quote the shortest fragment that verifies the signal, and put a comment whose point is the writer\'s own diagnosis or disability status here rather than quoting it under another category.',
    '- switching_signal: someone weighing, comparing, or moving between brands/providers — "I switched from X", "is Y better than Z", dissatisfaction paired with an alternative.',
    '- buying_trigger: the concrete event or circumstance that pushes someone toward a purchase — something broke, a life change, a recommendation, insurance approval. The WHY-NOW, distinct from purchase_intent (the wanting itself).',
    '',
    'For each insight also set journey_stage — where these commenters sit in the customer journey:',
    '- awareness: discovering the category/product exists.',
    '- consideration: actively researching, comparing, asking pre-purchase questions.',
    '- purchase: at the point of buying — price, availability, where-to-get.',
    '- ownership: already using the product; experiences, problems, praise from use.',
    '- advocacy: recommending or defending a brand to others.',
    'Use null when the comments do not reveal a stage. Do not guess.',
    '',
    'Also return language_samples: verbatim customer phrasings from the comments worth reusing in marketing copy — vivid, specific ways real people describe the problem, the product, or the result (e.g. how they phrase the pain, the moment it mattered, what they call things). Short phrases or one sentence, quoted VERBATIM, at most 3 per video and only if genuinely quotable. Generic reactions ("love this", "so cool") are not language samples. Return an empty array when nothing qualifies.',
    '',
    'Rules:',
    '- Quote every piece of evidence AND every language sample VERBATIM from a comment. Never paraphrase.',
    '- For each quote, set comment_id to the bracket label of the source comment (e.g. "c3"), exactly as shown in the input. Use ONLY labels present in the input.',
    '- If a claim cannot be supported by a verbatim quote, do not make it.',
    '- Only extract insights with genuine consumer-intelligence value. IGNORE generic emotional reactions (sympathy, prayers, "so beautiful"), jokes, off-topic chatter, and subject-identity corrections. If the comments contain no such signal, return an empty "insights" array — do NOT manufacture insights.',
    '- strength_score: 1-3 = weak/incidental (one or two off-hand comments); 4-6 = clear signal from a few comments; 7-10 = strong, recurring signal across many comments. Base it on consumer-intelligence value and how many comments support it, NOT on emotional intensity.',
    '- Video sentiment must reflect how commenters received the video, not the title/caption. Use null only if the comments give no sentiment signal.',
    '- theme is a short snake_case slug, 2-4 words (e.g. stairs_difficulty). Reuse the same slug for the same underlying idea.',
    '- Do not invent counts or percentages.',
    '- Insights must come from the comments, not the metadata.',
    '- Quotes in every other category, and every language_sample, must not reproduce a sentence whose point is the writer\'s own diagnosis, disability status, or that they are under 18 (e.g. "I\'m a BK amputee since 2019", "I\'m 14"). The product experience they describe can still be quoted; the identity statement belongs under demographic_signal.',
  ]
  if (!withTranscripts) return base.join('\n')
  // v4: the comments-only framing must yield where the transcript is evidence —
  // stated up front, not only in the addendum (measured 2026-08-08: with the
  // addendum alone, 33 industry videos produced ONE transcript citation).
  const v4Base = base.map((line) => {
    if (line === 'Given ONE social video and its comments, return:')
      return 'Given ONE social video, its transcript when present, and its comments, return:'
    if (line.startsWith('2. Audience insights distilled STRICTLY from the comments'))
      return '2. Audience insights distilled STRICTLY from the comments and — on industry/other videos — the video transcript. ONLY insights that carry consumer-intelligence value for the brand.'
    if (line === '- Insights must come from the comments, not the metadata.')
      return '- Insights must come from the comments or (on industry/other videos) the transcript — never from the caption/hashtags alone.'
    return line
  })
  return [
    ...v4Base,
    '',
    'TRANSCRIPT rules — a TRANSCRIPT block, labelled "t", may be present: the words actually spoken in the video.',
    '- Ground the classification (type, hook style, hook_text, topics) in what the video says. When the transcript shows the video\'s opening words, hook_text should be those words.',
    '- The audio may be unrelated background/trending sound. Judge the transcript against the caption and account first; if it clearly is not this video\'s own content, ignore it.',
    '- The transcript may be in any language; read it as-is.',
    '- Industry/other videos: the creator IS a customer — a produced video is a deliberate, costly act of opinion, a STRONGER signal than a passing comment. Their spoken words are first-class evidence: cite the transcript with the label "t", quoted VERBATIM, one short sentence or phrase per quote (never a long passage). When the transcript expresses an opinion, experience, complaint, or claim with consumer-intelligence value, report it as an insight (or fold it into a matching comment insight as extra evidence) — do not ignore transcript signal just because comments exist.',
    '- CLIENT or COMPETITOR videos: the transcript is brand messaging, NEVER insight evidence — never cite "t" on these. Instead return claims: up to 3 assertions the brand makes about itself, its products, or the market — {claim: the assertion in your words, quote: the VERBATIM transcript line making it}.',
    '- claims come ONLY from CLIENT/COMPETITOR transcripts. Return an empty claims array in every other case.',
    '- Audience insights still come from the comments first; transcript evidence supplements them. Video sentiment stays comment-derived.',
  ].join('\n')
}

interface CommentRef {
  label: string
  realId: string
  text: string
}

function buildUserPrompt(v: VideoRow, refs: CommentRef[], transcript: string | null = null): string {
  const lines: string[] = [
    'VIDEO',
    `- platform: ${v.platform}`,
    `- account: ${v.account_name}`,
    `- owner: ${ownerLabel(v)}`,
    `- caption: ${v.caption ?? '(none)'}`,
    `- hashtags: ${(v.hashtags ?? []).join(' ') || '(none)'}`,
    `- format: ${v.content_format ?? '(unknown)'}`,
  ]
  if (transcript) {
    lines.push('', `TRANSCRIPT [t] (lang: ${v.transcript_lang ?? 'unknown'})`, transcript)
  }
  lines.push('', `COMMENTS (${refs.length})`)
  for (const r of refs) {
    const oneLine = r.text.replace(/\s+/g, ' ').trim()
    lines.push(`[${r.label}] ${oneLine}`)
  }
  return lines.join('\n')
}

// ---- validation ------------------------------------------------------------

/** The one definition of "this quote appears in that text" lives in
 *  lib/pipeline/quote-match.ts (moved 2026-08-22 so the retention refresh and
 *  the erasure script can share it without importing this module). Re-exported
 *  here so existing importers keep working. */
export { normForMatch }

export interface ValidatedEvidence {
  /** Real comment id for source 'comment'; null for source 'video'. */
  realId: string | null
  quote: string
  source: 'comment' | 'video'
}

interface ValidatedInsight {
  insight: PassAInsight
  evidence: ValidatedEvidence[]
}

interface ValidationResult {
  kept: ValidatedInsight[]
  insightsDropped: number
  evidenceDropped: number
  samples: { realId: string; phrase: string }[]
  samplesDropped: number
}

/** v4 transcript context for validation: the exact clipped text the model saw,
 *  and whether this video's transcript may be cited as evidence (industry-other
 *  only — brand-voice vs customer-voice, design 2026-08-08). */
export interface TranscriptCtx {
  text: string
  evidenceAllowed: boolean
}

/** Map evidence refs -> real comment ids, drop unknown refs and quotes that
 *  don't appear (normalisation-tolerant) in the referenced comment. Drop any
 *  insight left with no valid evidence (invariant 3). Language samples get the
 *  same verbatim check — a sample that isn't really in its comment is dropped.
 *  v4: the label "t" cites the transcript — validated against the same clipped
 *  text the model saw, dropped when the owner bucket may not cite it or the
 *  quote exceeds sentence scale (PASS_A_VIDEO_QUOTE_MAX). Exported for tests. */
export function validateInsights(parsed: PassAVideoOutput, refs: CommentRef[], transcript?: TranscriptCtx): ValidationResult {
  const byLabel = new Map(refs.map((r) => [r.label.toLowerCase(), r]))
  const transcriptNorm = transcript ? normForMatch(transcript.text) : ''
  const kept: ValidatedInsight[] = []
  let evidenceDropped = 0
  let insightsDropped = 0

  for (const insight of parsed.insights) {
    const validEvidence: ValidatedEvidence[] = []
    for (const ev of insight.evidence) {
      const label = (ev.comment_id ?? '').toLowerCase().trim()
      if (label === 't') {
        const needle = normForMatch(ev.quote)
        if (
          !transcript?.evidenceAllowed ||
          transcriptNorm.length === 0 ||
          needle.length === 0 ||
          ev.quote.length > PASS_A_VIDEO_QUOTE_MAX ||
          !transcriptNorm.includes(needle)
        ) {
          evidenceDropped++
          continue
        }
        validEvidence.push({ realId: null, quote: ev.quote, source: 'video' })
        continue
      }
      const ref = byLabel.get(label)
      if (!ref) {
        evidenceDropped++
        continue
      }
      const haystack = normForMatch(ref.text)
      const needle = normForMatch(ev.quote)
      if (needle.length === 0 || !haystack.includes(needle)) {
        evidenceDropped++
        continue
      }
      validEvidence.push({ realId: ref.realId, quote: ev.quote, source: 'comment' })
    }
    if (validEvidence.length === 0) {
      insightsDropped++
      continue
    }
    kept.push({ insight, evidence: validEvidence })
  }

  const samples: { realId: string; phrase: string }[] = []
  let samplesDropped = 0
  const seenPhrases = new Set<string>()
  for (const s of parsed.language_samples ?? []) {
    const ref = byLabel.get((s.comment_id ?? '').toLowerCase().trim())
    const phraseNorm = normForMatch(s.phrase)
    if (!ref || phraseNorm.length === 0 || !normForMatch(ref.text).includes(phraseNorm) || seenPhrases.has(phraseNorm)) {
      samplesDropped++
      continue
    }
    seenPhrases.add(phraseNorm)
    samples.push({ realId: ref.realId, phrase: s.phrase })
  }

  return { kept, insightsDropped, evidenceDropped, samples, samplesDropped }
}

/** Keep only brand claims whose quote appears verbatim (normalisation-tolerant)
 *  in the transcript, capped at MAX_CLAIMS_PER_VIDEO. Owner gating is the
 *  caller's: claims are only computed for client/competitor videos. Exported
 *  for tests. */
export function validateClaims(claims: PassAClaim[] | undefined, transcript: string | null): { kept: PassAClaim[]; dropped: number } {
  if (!claims?.length) return { kept: [], dropped: 0 }
  if (!transcript) return { kept: [], dropped: claims.length }
  const hay = normForMatch(transcript)
  const kept: PassAClaim[] = []
  let dropped = 0
  for (const c of claims) {
    const needle = normForMatch(c.quote)
    if (kept.length >= MAX_CLAIMS_PER_VIDEO || !c.claim.trim() || needle.length === 0 || !hay.includes(needle)) {
      dropped++
      continue
    }
    kept.push(c)
  }
  return { kept, dropped }
}

const clampScore = (n: number) => Math.max(1, Math.min(10, Math.round(n)))

// ---- main ------------------------------------------------------------------

/** Video ids per `in.()` filter. Platform video ids are shorter than uuids, so
 *  100 sits well inside the PostgREST URL cap that the whole-table fallback
 *  exists to avoid. */
const COMMENT_ID_FILTER_CHUNK = 100

/** Above this many videos, one paginated table scan beats many id filters. The
 *  pipeline always lands far below it (PASS_A_BATCH is 12); the CLI paths that
 *  analyse a whole corpus land far above. */
const COMMENT_ID_FILTER_MAX_VIDEOS = 300

/**
 * Comments for the videos being analysed (Tier 1, 2026-08-18).
 *
 * This used to be an unconditional scan of the tenant's ENTIRE comments table,
 * filtered in memory, because a single `in.()` over a whole corpus blows the
 * PostgREST URL cap ("fetch failed"). True for the corpus, false for a batch:
 * the pipeline calls this with 12 video ids and then re-read all ~19k of
 * Össur's comments to find their share, once per batch step — and since T0-1
 * those steps genuinely run five-abreast.
 *
 * So: filter server-side in chunks when the set is small, keep the scan when it
 * is not. Both paths return the same rows; the caller filters by
 * platform::video_id either way, so a video id colliding across platforms is
 * still handled.
 */
async function loadCommentsFor(
  admin: ReturnType<typeof createAdminClient>,
  clientId: string,
  videoRows: VideoRow[],
  platform?: string,
): Promise<CommentRow[]> {
  const COLS = 'id, client_id, run_id, platform, video_id, comment_id, author, text, likes'
  if (videoRows.length > COMMENT_ID_FILTER_MAX_VIDEOS) {
    return selectAll<CommentRow>(() => {
      let q = admin.from('comments').select(COLS).eq('client_id', clientId).order('id', { ascending: true })
      if (platform) q = q.eq('platform', platform)
      return q
    })
  }
  const ids = [...new Set(videoRows.map((v) => v.video_id))]
  const out: CommentRow[] = []
  for (let i = 0; i < ids.length; i += COMMENT_ID_FILTER_CHUNK) {
    const chunk = ids.slice(i, i + COMMENT_ID_FILTER_CHUNK)
    const rows = await selectAll<CommentRow>(() => {
      let q = admin.from('comments').select(COLS)
        .eq('client_id', clientId).in('video_id', chunk).order('id', { ascending: true })
      if (platform) q = q.eq('platform', platform)
      return q
    })
    out.push(...rows)
  }
  return out
}

export async function runPassA(opts: RunPassAOptions): Promise<RunPassASummary> {
  const {
    clientId,
    platform,
    videoIds,
    limit,
    // Undefined = resolve per-video from the platform floor (below). An explicit
    // value still overrides everywhere, which is what the operator scripts pass.
    minComments,
    dryRun = false,
  } = opts
  const persist = opts.persist ?? !dryRun
  const trackAnalysis = opts.trackAnalysis ?? true
  const useTranscripts = opts.transcripts ?? transcriptsEnabled()
  const promptVersion = passAPromptVersion(useTranscripts)
  const responseSchema = useTranscripts ? PassAVideoSchemaV4 : PassAVideoSchema
  const admin = createAdminClient()

  // 1. Client context.
  const { data: tc } = await admin
    .from('tracking_configs')
    .select('brand_keywords, competitor_names, industry_keywords')
    .eq('client_id', clientId)
    .maybeSingle()
  const trackingConfig: TrackingConfig = tc ?? { brand_keywords: null, competitor_names: null, industry_keywords: null }
  const systemPrompt = buildSystemPrompt(trackingConfig, useTranscripts)

  // 2. Videos (most-commented first so samples hit the richest content).
  //    Paginated past the 1000-row cap unless an explicit --limit caps the run.
  const buildVideos = () => {
    let q = admin.from('videos').select('*').eq('client_id', clientId)
    if (platform) q = q.eq('platform', platform)
    if (videoIds && videoIds.length) q = q.in('id', videoIds)
    return q
      .order('comments_count', { ascending: false, nullsFirst: false })
      .order('id', { ascending: true })
  }
  let videoRows: VideoRow[]
  if (limit) {
    const { data, error: vErr } = await buildVideos().limit(limit)
    if (vErr) throw new Error(`load videos: ${vErr.message}`)
    videoRows = (data ?? []) as VideoRow[]
  } else {
    videoRows = await selectAll<VideoRow>(buildVideos)
  }

  // 3. Comments for those videos, grouped by (platform, video_id). Paginated —
  //    a busy client easily has >1000 comments, and a silent truncation here
  //    starves the per-video comment counts (the analysable-corpus bug).
  //    Load the client's comments in one scan (optionally platform-scoped) and
  //    filter to the wanted videos IN MEMORY — a `.in('video_id', [all ids])`
  //    filter blows the URL length limit once the corpus grows to ~1k+ videos
  //    ("fetch failed"), so we never send the giant IN clause.
  const wanted = new Set(videoRows.map((v) => `${v.platform}::${v.video_id}`))
  const commentsByVideo = new Map<string, CommentRow[]>()
  if (wanted.size) {
    const comments = await loadCommentsFor(admin, clientId, videoRows, platform)
    for (const c of comments) {
      const key = `${c.platform}::${c.video_id}`
      if (!wanted.has(key)) continue
      const arr = commentsByVideo.get(key)
      if (arr) arr.push(c)
      else commentsByVideo.set(key, [c])
    }
  }

  // 4. Resolve analysis run id (create one if not supplied).
  let runId = opts.runId
  if (!runId && persist) {
    const { data: run, error: rErr } = await admin
      .from('pipeline_runs')
      .insert({ client_id: clientId, status: 'analyzing' })
      .select('id')
      .single()
    if (rErr) throw new Error(`create run: ${rErr.message}`)
    runId = run.id as string
  }
  runId = runId ?? '(dry-run, no run created)'

  const summary: RunPassASummary = {
    runId,
    model: ANALYSIS_MODEL,
    dryRun,
    videosProcessed: 0,
    videosAnalyzed: 0,
    videosClaimsOnly: 0,
    videosSkipped: 0,
    videosErrored: 0,
    videosRefused: 0,
    videosAlreadyAnalyzed: 0,
    rateLimited: false,
    errors: [],
    insightsKept: 0,
    insightsDropped: 0,
    evidenceDropped: 0,
    claimsKept: 0,
    claimsDropped: 0,
    languageSamples: 0,
    promptTokens: 0,
    completionTokens: 0,
    costUsd: 0,
    estInputTokens: 0,
    perVideo: [],
  }

  let callIndex = 0
  for (const v of videoRows) {
    summary.videosProcessed++
    // Step-retry idempotency (2026-08-18): the pointer is stamped per video on
    // success, so a batch step that timed out or died mid-way re-spends only
    // the videos it had not finished. Skips are stamped too, so they are
    // covered by the same check.
    if (persist && trackAnalysis && opts.runId && v.analyzed_run_id === opts.runId) {
      summary.videosAlreadyAnalyzed++
      summary.perVideo.push({ videoId: v.id, videoUrl: v.video_url, keptComments: 0, droppedLowSignal: 0, status: 'already_analyzed' })
      continue
    }
    const all = commentsByVideo.get(`${v.platform}::${v.video_id}`) ?? []
    const { kept, lowSignal } = filterComments(all)

    // Flag low-signal comments (don't delete) — invariant: still visible in drill-down.
    if (persist && lowSignal.length) {
      await admin.from('comments').update({ is_low_signal: true }).in('id', lowSignal.map((l) => l.id))
    }

    const res: PerVideoResult = {
      videoId: v.id,
      videoUrl: v.video_url,
      keptComments: kept.length,
      droppedLowSignal: lowSignal.length,
      status: 'skipped_too_few',
    }

    // Second gate, on KEPT comments (post-spam-filter). The plan step already
    // applied the same lane rule to RAW counts; a video can still fall out here.
    const lane = passALane(
      { ...v, transcript_status: useTranscripts ? (v.transcript_status ?? null) : null },
      kept.length,
      minComments ?? passAMinComments(v.platform),
    )
    if (lane === 'skip') {
      summary.videosSkipped++
      summary.perVideo.push(res)
      // Incremental Pass A: bookkeep the skip (no rows) so plan-pass-a does not
      // re-load this video every run until its comments actually grow — the
      // pointer moves to this run, so any older rows become stale and prune.
      if (persist && trackAnalysis && runId) {
        await admin.from('videos').update({
          analyzed_at: new Date().toISOString(),
          analyzed_run_id: runId,
          analyzed_comment_count: all.length,
          analyzed_prompt_version: promptVersion,
          analyzed_lane: 'skip',
          analyzed_with_transcript: useTranscripts && usableTranscript(v) !== null,
        }).eq('id', v.id)
      }
      continue
    }
    const claimsOnly = lane === 'claims_only'
    res.claimsOnly = claimsOnly || undefined

    // Claims lane: the comments never reach the prompt — below the floor they
    // are too thin to be evidence, and showing them would let the model mint
    // insights the floor exists to prevent.
    const refs: CommentRef[] = claimsOnly ? [] : kept.map((c, i) => ({ label: `c${i + 1}`, realId: c.id, text: c.text ?? '' }))
    const transcript = useTranscripts ? usableTranscript(v) : null
    const userPrompt = buildUserPrompt(v, refs, transcript)

    if (dryRun) {
      const estInputTokens = Math.ceil((systemPrompt.length + userPrompt.length) / 4)
      summary.estInputTokens += estInputTokens
      res.status = 'dry_run'
      res.estInputTokens = estInputTokens
      // Preview the first assembled prompt so it can be eyeballed for free.
      if (summary.perVideo.filter((r) => r.status === 'dry_run').length === 0) {
        console.log('\n--- PROMPT PREVIEW (first video) ---')
        console.log('[system]\n' + systemPrompt)
        console.log('\n[user]\n' + userPrompt)
        console.log('--- end preview ---\n')
      }
      summary.perVideo.push(res)
      continue
    }

    // ---- live GPT call ----
    callIndex++
    const startedAt = Date.now()
    let parsed: ParsedPassA | null = null
    let refusal: string | null = null
    let usage = { prompt_tokens: 0, completion_tokens: 0 }
    try {
      const completion = await openai.chat.completions.parse({
        model: ANALYSIS_MODEL,
        temperature: ANALYSIS_TEMPERATURE,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        response_format: zodResponseFormat(responseSchema, 'pass_a'),
      })
      const msg = completion.choices[0]?.message
      parsed = (msg?.parsed ?? null) as ParsedPassA | null
      refusal = msg?.refusal ?? null
      if (completion.usage) {
        usage = { prompt_tokens: completion.usage.prompt_tokens, completion_tokens: completion.usage.completion_tokens }
      }
    } catch (e) {
      res.status = 'error'
      res.error = e instanceof Error ? e.message : String(e)
      summary.perVideo.push(res)
      // Count it. The video keeps its old analyzed_run_id (no stamp on the
      // error path), so the next run's plan re-selects it — that is the retry.
      summary.videosErrored++
      if (isRateLimitError(e)) summary.rateLimited = true
      const short = res.error.slice(0, 200)
      if (summary.errors.length < PASS_A_ERROR_MESSAGES_KEPT && !summary.errors.includes(short)) summary.errors.push(short)
      if (persist) await logCall(admin, { clientId, runId, callIndex, promptVersion, systemPrompt, userPrompt, response: null, error: res.error, usage, durationMs: Date.now() - startedAt, validationStatus: 'parse_error' })
      continue
    }

    const durationMs = Date.now() - startedAt
    const costUsd = estimateCost(ANALYSIS_MODEL, usage.prompt_tokens, usage.completion_tokens)
    summary.promptTokens += usage.prompt_tokens
    summary.completionTokens += usage.completion_tokens
    summary.costUsd += costUsd
    res.promptTokens = usage.prompt_tokens
    res.completionTokens = usage.completion_tokens
    res.costUsd = costUsd

    if (!parsed) {
      res.status = 'refused'
      res.error = refusal ?? 'no parsed output'
      summary.videosRefused++
      summary.perVideo.push(res)
      if (persist) await logCall(admin, { clientId, runId, callIndex, promptVersion, systemPrompt, userPrompt, response: { refusal }, error: res.error, usage, durationMs, validationStatus: 'parse_error' })
      continue
    }

    // Brand-voice vs customer-voice: only industry-other videos may cite the
    // transcript as evidence; client/competitor transcripts yield claims.
    const ownerIndustry = !v.is_client && !v.is_competitor
    const validation = validateInsights(parsed, refs, transcript ? { text: transcript, evidenceAllowed: ownerIndustry } : undefined)
    const claims = !useTranscripts
      ? null
      : ownerIndustry
        ? { kept: [], dropped: parsed.claims?.length ?? 0 }
        : validateClaims(parsed.claims, transcript)
    // Claims lane: no comments were shown, so nothing can be audience evidence —
    // enforce it in code rather than trust the prompt (brand-side transcripts
    // are never evidence anyway, so validation should already be empty).
    if (claimsOnly) {
      validation.kept = []
      validation.samples = []
    }
    summary.insightsKept += validation.kept.length
    summary.insightsDropped += validation.insightsDropped
    summary.evidenceDropped += validation.evidenceDropped
    summary.claimsKept += claims?.kept.length ?? 0
    summary.claimsDropped += claims?.dropped ?? 0
    summary.languageSamples += validation.samples.length
    res.status = 'analyzed'
    res.insightsKept = validation.kept.length
    res.insightsDropped = validation.insightsDropped
    res.evidenceDropped = validation.evidenceDropped
    if (claims) {
      res.claimsKept = claims.kept.length
      res.claimsDropped = claims.dropped
    }
    summary.videosAnalyzed++
    if (claimsOnly) summary.videosClaimsOnly++

    if (persist) {
      await persistVideo(admin, {
        video: v,
        runId,
        parsed,
        validated: validation.kept,
        samples: validation.samples,
        qualityScore: computeQualityScore(all),
        claims: claims?.kept ?? null,
        claimsOnly,
        bookkeeping: trackAnalysis
          ? { storedComments: all.length, promptVersion, lane: claimsOnly ? 'claims_only' : 'full', withTranscript: transcript !== null }
          : null,
      })
      await logCall(admin, {
        clientId,
        runId,
        callIndex,
        promptVersion,
        systemPrompt,
        userPrompt,
        response: { classification: parsed.classification, insights_kept: validation.kept.length, insights_dropped: validation.insightsDropped, evidence_dropped: validation.evidenceDropped, ...(claims ? { claims_kept: claims.kept.length, claims_dropped: claims.dropped } : {}) },
        error: null,
        usage,
        durationMs,
        validationStatus: validation.insightsDropped > 0 || validation.evidenceDropped > 0 ? 'quote_not_found' : 'ok',
      })
    }

    // Live burn log.
    console.log(
      `  [c${callIndex}] ${v.video_url} — ${validation.kept.length} insights ` +
        `(${validation.insightsDropped} dropped, ${validation.evidenceDropped} evidence dropped) · ` +
        `${usage.prompt_tokens}+${usage.completion_tokens} tok · $${costUsd.toFixed(5)}`,
    )

    summary.perVideo.push(res)
  }

  return summary
}

// ---- persistence helpers ---------------------------------------------------

interface PersistArgs {
  video: VideoRow
  runId: string
  parsed: PassAVideoOutput
  validated: ValidatedInsight[]
  samples: { realId: string; phrase: string }[]
  qualityScore: number | null
  /** v4 brand claims for this video; null = v3 (video_claims never touched —
   *  the table may not exist pre-migration). */
  claims: PassAClaim[] | null
  /** Wave 4 claims lane: the model saw no comments, so its sentiment is a guess
   *  about the video, not a read of its audience. The column is left untouched
   *  (classify-meta's framing sentiment stays; run_summary's shares read it). */
  claimsOnly?: boolean
  /** Incremental Pass A (2026-08-17): what this read saw, written onto the
   *  video LAST so the pointer only moves once every row is in. Null = harness
   *  run (trackAnalysis:false): rows are written, the pointer is not moved. */
  bookkeeping: { storedComments: number; promptVersion: string; lane: 'full' | 'claims_only'; withTranscript: boolean } | null
}

async function persistVideo(admin: ReturnType<typeof createAdminClient>, args: PersistArgs): Promise<void> {
  const { video, runId, parsed, validated, samples, qualityScore, claims, claimsOnly, bookkeeping } = args
  const c = parsed.classification

  // Idempotent at the step level (invariant 6): clear this video's prior insights
  // for THIS run (a retried batch step). Rows from earlier runs are left alone —
  // they stay resolvable for the dashboard's displayed run until the pointer
  // below moves and the next successful close-run prunes them (incremental
  // Pass A: videos.analyzed_run_id names the current rows; see pass-a-plan.ts).
  await admin.from('audience_insights').delete().eq('client_id', video.client_id).eq('run_id', runId).eq('source_video_id', video.id)
  await admin.from('language_samples').delete().eq('client_id', video.client_id).eq('run_id', runId).eq('source_video_id', video.id)

  // Classification onto the video row.
  await admin
    .from('videos')
    .update({
      classified_type: c.classified_type,
      hook_style: c.hook_style,
      hook_text: c.hook_text,
      topics: c.topics,
      // Claims lane: LEAVE the column alone rather than null it — classify-meta
      // owns framing sentiment for below-floor videos (it can't revisit once
      // classified_type is set) and run_summary's shares read this column.
      ...(claimsOnly ? {} : { sentiment: c.sentiment, sentiment_source: 'audience' }),
      comment_quality_score: qualityScore,
    })
    .eq('id', video.id)

  // Insights + evidence.
  for (const { insight, evidence } of validated) {
    const { data: row, error } = await admin
      .from('audience_insights')
      .insert({
        client_id: video.client_id,
        run_id: runId,
        platform: video.platform,
        source_video_id: video.id,
        category: insight.category,
        theme: insight.theme,
        description: insight.description,
        strength_score: clampScore(insight.strength_score),
        emotion: insight.emotion,
        sentiment_impact: insight.sentiment_impact,
        journey_stage: insight.journey_stage,
      })
      .select('id')
      .single()
    if (error || !row) continue
    const insightId = row.id as string
    // v4 (claims !== null) writes the source discriminator on every row —
    // uniform keys for the bulk insert. v3 keeps the legacy shape and its
    // legacy error behavior exactly (flag-off path byte-identical); the v4
    // shape throws on failure — a swallowed error here would persist insights
    // with zero evidence against a mis-migrated DB (review finding).
    // Counts, not quotes (2026-08-22): demographic_signal evidence keeps its
    // citation — the FK is what the evidence floor counts and the quote WAS
    // verified against the comment in validateInsights — but not the words.
    // Every reader filters redacted = false.
    const redact = insight.category === 'demographic_signal'
    const { error: evErr } = await admin.from('insight_evidence').insert(
      evidence.map((e, i) =>
        claims !== null
          ? {
              audience_insight_id: insightId,
              comment_id: e.source === 'video' ? null : e.realId,
              source: e.source,
              source_video_id: e.source === 'video' ? video.id : null,
              quote: redact ? '' : e.quote,
              redacted: redact,
              relevance_rank: i + 1,
            }
          : {
              audience_insight_id: insightId,
              comment_id: e.realId,
              quote: redact ? '' : e.quote,
              redacted: redact,
              relevance_rank: i + 1,
            },
      ),
    )
    if (claims !== null && evErr) throw new Error(`insert insight_evidence: ${evErr.message}`)
  }

  // Brand claims (v4 only) — idempotent per video+run, like insights above.
  if (claims !== null) {
    const { error: delErr } = await admin.from('video_claims').delete().eq('run_id', runId).eq('source_video_id', video.id)
    if (delErr) throw new Error(`clear video_claims: ${delErr.message}`)
    if (claims.length) {
      const { error: insErr } = await admin.from('video_claims').insert(
        claims.map((cl) => ({
          client_id: video.client_id,
          run_id: runId,
          platform: video.platform,
          source_video_id: video.id,
          entity: video.is_client ? 'client' : 'competitor',
          competitor_name: video.is_client ? null : (video.competitor_name ?? 'unknown'),
          claim: cl.claim,
          quote: cl.quote,
        })),
      )
      if (insErr) throw new Error(`insert video_claims: ${insErr.message}`)
    }
  }

  if (samples.length) {
    await admin.from('language_samples').insert(
      samples.map((s) => ({
        client_id: video.client_id,
        run_id: runId,
        platform: video.platform,
        source_video_id: video.id,
        comment_id: s.realId,
        phrase: s.phrase,
      })),
    )
  }

  // Move the pointer LAST: from here this run's rows are the video's current
  // analysis. If this update fails the old pointer stands, this run's rows are
  // stale-but-newer, and the retried step redoes the video — never a half state.
  if (!bookkeeping) return
  const { error: bkErr } = await admin.from('videos').update({
    analyzed_at: new Date().toISOString(),
    analyzed_run_id: runId,
    analyzed_comment_count: bookkeeping.storedComments,
    analyzed_prompt_version: bookkeeping.promptVersion,
    analyzed_lane: bookkeeping.lane,
    analyzed_with_transcript: bookkeeping.withTranscript,
  }).eq('id', video.id)
  if (bkErr) throw new Error(`update video analysis bookkeeping: ${bkErr.message}`)
}

interface LogArgs {
  clientId: string
  runId: string
  callIndex: number
  promptVersion: string
  systemPrompt: string
  userPrompt: string
  response: unknown
  error: string | null
  usage: { prompt_tokens: number; completion_tokens: number }
  durationMs: number
  validationStatus: string
}

async function logCall(admin: ReturnType<typeof createAdminClient>, a: LogArgs): Promise<void> {
  await admin.from('ai_call_log').insert({
    client_id: a.clientId,
    run_id: a.runId,
    pass: 'pass_a',
    call_index: a.callIndex,
    model: ANALYSIS_MODEL,
    prompt_version: a.promptVersion,
    request: { system: a.systemPrompt, user: a.userPrompt },
    response: a.response,
    error_message: a.error,
    prompt_tokens: a.usage.prompt_tokens,
    completion_tokens: a.usage.completion_tokens,
    cost_usd: estimateCost(ANALYSIS_MODEL, a.usage.prompt_tokens, a.usage.completion_tokens),
    duration_ms: a.durationMs,
    validation_status: a.validationStatus,
  })
}
