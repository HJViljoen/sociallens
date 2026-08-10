// Pipeline configuration constants. Centralised so the model and thresholds
// are a one-line change — see Analysis-Passes invariants 8–9 and Step A2.

/**
 * OpenAI model for Pass A (per-video extraction — the bulk of call volume).
 * v4.1 chose gpt-4.1-mini (2026-04); still current (no shutdown announced as
 * of 2026-07-03, though the 4.1 family is sunsetting — nano dies 2026-10-23).
 * Extraction doesn't need a reasoning model, and the verbatim-quote validation
 * catches hallucination; re-evaluate alongside the next prompt change.
 */
export const ANALYSIS_MODEL = 'gpt-4.1-mini'

/**
 * OpenAI model for the synthesis passes (B labels, C competitive, D-a insights
 * + CI summary, D-b recommendations) — 4 calls/run that ARE the product the
 * client reads. Upgraded 2026-07-03 from gpt-4.1-mini to gpt-5.4 (reasoning
 * model) to attack the generic-recommendations problem; adds well under $1/run.
 * Downgrade path if quality doesn't earn the cost: 'gpt-5.4-mini'.
 */
export const SYNTHESIS_MODEL = 'gpt-5.4'

/**
 * Reasoning effort for SYNTHESIS_MODEL calls (gpt-5.x rejects `temperature`;
 * this replaces it). 'medium' = quality-first for the strategic output; drop to
 * 'low' if cost/latency ever matters more than depth.
 */
export const SYNTHESIS_REASONING_EFFORT = 'medium' as const

/**
 * Minimum distinct source videos for a theme to survive Step A2 aggregation.
 * Configurable because the floor collides with thin corpora — a demo/thin-data
 * run may drop this to 1 and badge single-source themes rather than ship empty.
 */
export const EVIDENCE_FLOOR = 2

/**
 * Mega-cluster tripwire (Step A2): a single theme spanning more than
 * max(MIN, SHARE x the run's distinct insight-bearing videos) is flagged as
 * suspected clustering chaining. Calibrated 2026-08-09 on the two known cases:
 * the Sealand run-1 chaining blob (119 videos, well over 25% of any plausible
 * denominator of that era) must warn; Ossur run 2's legitimate 64-video theme
 * (64 of 385 distinct insight videos = 17%) must not. MIN keeps small corpora
 * on the original absolute rule.
 */
export const MEGA_CLUSTER_MIN = 40
export const MEGA_CLUSTER_SHARE = 0.25

/** Sampling temperature for analysis calls. 0 for reproducible iteration. */
export const ANALYSIS_TEMPERATURE = 0

// --- Video transcripts (Step 1 capture 2026-07-23, Step 2 analysis 2026-08-08) --
// Gather stores the raw item + resolves one transcript per kept video (caption
// when present, else Whisper). Pass A reads them behind the same flag (v4:
// classification grounding on every bucket; industry-other transcripts as
// evidence; client/competitor claims). See _Claude/Projects/SaaS/Architecture/Video-Transcripts.

/** Master switch. Off by default — when unset, gather is byte-identical to
 *  before (no raw capture, no transcription). Set TRANSCRIPTS_ENABLED=1 to bank
 *  transcripts on real runs. Read at call-time so it works in serverless. */
export function transcriptsEnabled(): boolean {
  const v = process.env.TRANSCRIPTS_ENABLED
  return v === '1' || v === 'true'
}

/** OpenAI transcription model for videos without a usable caption track. */
export const TRANSCRIBE_MODEL = 'whisper-1'

/** Below this many LETTERS a resolved transcript is treated as no-speech —
 *  music-only reels (Whisper renders those as "♪♪", captions as "[Music]"; the
 *  2026-07-23 lift experiment saw such videos add nothing). Speech-gate. */
export const MIN_TRANSCRIPT_CHARS = 15

/**
 * Model for the content gate — the second gate, after the letter-count one.
 * Measured on the 2026-08-08 backfill: of 43 transcripts that PASSED the
 * letter-count gate, only 67% were speech; 16% were song lyrics ("Have a holly
 * jolly Christmas") and 16% noise ("Transcribed by https://otter.ai"). Lyrics
 * have plenty of letters, so only a semantic check catches them. ~$0.04 per
 * 600-video run.
 */
export const CONTENT_GATE_MODEL = 'gpt-4.1-mini'

/** Runaway BACKSTOP, not a budget (Heinrich 2026-08-08: transcribe everything
 *  analysed — whole-run Whisper ≈ $2.50–3.50 at run-1 scale). A real run's
 *  biggest platform was ~460 candidates; 1000 exists so a pathological gather
 *  can't spend unbounded time/money. */
export const TRANSCRIBE_CAP = 1000

/** Videos per transcribe Inngest step. Download-dominated (~10s/video after
 *  the IG audio-first fix) — 8 ≈ 80s/step, wide margin under the 300s cap. */
export const TRANSCRIBE_BATCH = 8

/** Transcribe steps dispatched per parallel wave (Pass A wave pattern). */
export const TRANSCRIBE_PARALLEL = 4

/** Whisper is priced per audio MINUTE, not per token — MODEL_PRICING can't
 *  represent it and estimateCost('whisper-1', …) returns 0. */
export const WHISPER_PER_MINUTE = 0.006

/** Skip Whisper for media larger than this (bytes) — the API's own file cap. */
export const TRANSCRIBE_MAX_BYTES = 25 * 1024 * 1024

/** Max transcript characters injected into a Pass A prompt (~600 tokens),
 *  clipped code-point-safe (clipText). Short reels rarely reach this. */
export const TRANSCRIPT_PROMPT_CHARS = 2400

/** Max length of a video-sourced (transcript) evidence quote. Keeps transcript
 *  quotes sentence-scale so everything downstream that assumes comment-sized
 *  quotes (D-b pools, cards) holds. */
export const PASS_A_VIDEO_QUOTE_MAX = 200

/**
 * Embedding model for Step A2 theme clustering (Analysis-Passes §Step A2 — the
 * pre-approved fallback when string-match clustering fails, which the first real
 * run confirmed it does: free-text slugs almost never collide exactly).
 */
export const EMBEDDING_MODEL = 'text-embedding-3-small'

/**
 * Cosine-similarity threshold for merging two insights into one theme cluster.
 * Higher = stricter (more, smaller clusters); lower = looser (fewer, broader).
 *
 * Retuned 2026-07-11 for AVERAGE-LINKAGE clustering (cluster.ts swapped off
 * single-linkage union-find, whose transitive chaining built a 119-video
 * grab-bag on the Sealand run-1 corpus). Under average linkage the threshold
 * compares cluster-average similarity, so it sits lower than the old
 * single-linkage 0.62. Calibrated on the regenerated Sealand run-1 insights
 * (435): 0.50 re-grows 46–65-video grab-bags; 0.55 blurs seams (durability
 * slugs in the gift cluster); 0.58 = coherent multi-video themes (price,
 * design-praise, purchase-intent), no tripwire hits, residual duplicates left
 * for the theme-merge pass; 0.62 over-fragments. (Historical single-linkage
 * tuning 2026-06-28: 0.62 on the Ossur corpus — superseded with the linkage.)
 */
export const CLUSTER_SIMILARITY_THRESHOLD = 0.58

/**
 * Cosine threshold for mini theme-matching (Redesign Spec §8): a latest-run
 * theme whose label+description embedding matches any previous-run theme at or
 * above this is the SAME theme (first_seen = false); below it, it's new ("New"
 * badge + email delta). Deliberately looser than the intra-run merge threshold —
 * Pass B rephrases labels run to run. PROVISIONAL until tuned on the first real
 * consecutive-run pair.
 */
export const THEME_MATCH_THRESHOLD = 0.7

/**
 * Cosine floor a Pass D-a supporting_themes ref must clear against its market
 * insight's text to survive (the existence-vs-relevance gap, teardown
 * 2026-07-09 §Run 1: refs were checked to exist, never to relate, so padding
 * inflated "Grounded in N conversations"). Calibrated on Sealand run 1 via
 * scripts/citation-floor.ts: genuine citations sat at median 0.594 / min 0.364,
 * uncited theme pairs at median 0.240 / p75 0.312 — 0.35 keeps every genuine
 * run-1 citation while cutting the padding space. Deliberately a floor, not a
 * classifier: a related-but-uncited theme surviving is fine; an unrelated
 * cited one is the defect.
 */
export const CITATION_RELEVANCE_FLOOR = 0.35

/**
 * USD per 1M tokens, per model. APPROXIMATE — verify against OpenAI's current
 * pricing page and your usage dashboard; used only to estimate ai_call_log.cost_usd
 * and the live burn log. Actual billing is the source of truth.
 */
export const MODEL_PRICING: Record<string, { inputPer1M: number; outputPer1M: number }> = {
  'gpt-4.1-mini': { inputPer1M: 0.4, outputPer1M: 1.6 },
  'gpt-4.1-nano': { inputPer1M: 0.1, outputPer1M: 0.4 },
  'gpt-4.1': { inputPer1M: 2.0, outputPer1M: 8.0 },
  // gpt-5.4 family (verified against the OpenAI pricing page 2026-07-03).
  // Reasoning tokens bill as output tokens.
  'gpt-5.4': { inputPer1M: 2.5, outputPer1M: 15.0 },
  'gpt-5.4-mini': { inputPer1M: 0.75, outputPer1M: 4.5 },
  'gpt-5.4-nano': { inputPer1M: 0.2, outputPer1M: 1.25 },
  'text-embedding-3-small': { inputPer1M: 0.02, outputPer1M: 0 },
}

/** Estimate USD cost from token usage for a given model. Returns 0 if unknown. */
export function estimateCost(model: string, promptTokens: number, completionTokens: number): number {
  const p = MODEL_PRICING[model]
  if (!p) return 0
  return (promptTokens / 1e6) * p.inputPer1M + (completionTokens / 1e6) * p.outputPer1M
}

// --- Gather (Apify) configuration -------------------------------------------
// The n8n gather called Apify *tasks* (actor + input saved in the console). In
// code we call the underlying store actors directly by their Apify actor id (the
// API accepts the id form as well as the username~name slug). These ids were
// confirmed from Heinrich's Apify account on 2026-06-28; env-overridable per
// deployment. Set APIFY_TOKEN before the first live run.
export const APIFY_ACTORS = {
  tiktok: {
    video: process.env.APIFY_TT_VIDEO_ACTOR ?? '5K30i8aFccKNF5ICs',
    comment: process.env.APIFY_TT_COMMENT_ACTOR ?? 'XomSRf7d0qf3mVj1y',
  },
  // YouTube moved to the official Data API v3 (2026-07-05) — see
  // lib/gather/platforms/youtube.ts. It uses YOUTUBE_API_KEY, no Apify actor.
  instagram: {
    video: process.env.APIFY_IG_VIDEO_ACTOR ?? 'reGe1ST3OBgYZSsZJ', // apify/instagram-hashtag-scraper
    // apify/instagram-scraper (flagship) in `comments` mode — replaced
    // apify/instagram-comment-scraper (SbK00X0JYCPblD2wp), which returned 0.
    comment: process.env.APIFY_IG_COMMENT_ACTOR ?? 'shu8hvrXbJbY3Eb9W',
    // Same flagship actor as `comment`, driven in `posts` mode: the hashtag
    // scraper can only search, so re-fetching ONE known post (to refresh its
    // expiring media url for transcription) has to go through this one.
    post: process.env.APIFY_IG_POST_ACTOR ?? 'shu8hvrXbJbY3Eb9W',
  },
} as const

/** Default min comments before a video is worth a comment scrape (TikTok/Instagram). */
export const COMMENT_THRESHOLD = 5

// Order-of-magnitude Apify spend per platform, for RANKING keywords in
// scripts/keyword-roi.ts — never invoicing. Apify doesn't land per-actor cost
// in our DB (runActor returns items only), so these are coarse constants
// anchored to run ef1e28a3 (2026-08-09, $4.35 total; IG historically ~85% of
// spend). Recalibrate against the Apify console when actors or depths change.
export const APIFY_COST_ESTIMATES: Record<string, { search: number; perVideoComments: number }> = {
  tiktok: { search: 0.03, perVideoComments: 0.02 },
  instagram: { search: 0.02, perVideoComments: 0.12 },
  youtube: { search: 0, perVideoComments: 0 }, // official Data API — free
}

// --- Delta-scraping (2026-07-16) ---------------------------------------------
// Corpus measurement behind the re-check layer: ~73% of an IG video's lifetime
// comments arrive within 7 days of upload, ~27% after — signal the one-shot
// scrape design permanently missed. See lib/gather/delta.ts.

/** Min NEW comments (fresh count − count at last scrape) before a known video
 *  earns a paid re-scrape. A scrape is a whole actor run; 1-2 stragglers don't
 *  cover it. */
export const RECHECK_MIN_GROWTH = 3

/** Max re-check scrapes per platform per run — cost guardrail so a viral spike
 *  across many old videos can't blow up a weekly run's Apify bill. */
export const RECHECK_CAP = 25

/** How far back (days) the native-API re-check looks for still-active stored
 *  videos (YouTube — free counts via videos.list). Days 8-30 hold ~11% of
 *  lifetime comments; past 30 days the tail (~16%) is mostly old-viral noise
 *  the weekly product shouldn't chase. */
export const RECHECK_WINDOW_DAYS = 30

/** report_period → TikTok actor `dateRange` (Technical.md scrape-window mapping). */
export function periodToTikTokRange(period: string): string {
  return period === 'daily' ? 'TODAY' : period === 'monthly' ? 'THIS_MONTH' : 'THIS_WEEK'
}

/** report_period → window length in days. The shared mapping behind the flow-run
 *  gather window and the period-metrics slice (YouTube's publishedAfter uses the
 *  same numbers). */
export function periodWindowDays(period: string): number {
  return period === 'daily' ? 1 : period === 'monthly' ? 30 : 7
}

