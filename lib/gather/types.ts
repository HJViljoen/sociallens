// Gather (Branch 1) types. Gather is a pure data pipeline: search → normalise →
// store videos + comments. No GPT — classification/insights are the separate
// analysis pipeline (lib/pipeline). These shapes narrow only the columns gather
// writes; the live schema source of truth is Architecture/Schema-Actual.

export type Platform = 'tiktok' | 'youtube' | 'instagram' | 'reddit'

/** One row of tracking_configs.subreddits (Wave 3). `name` is bare and
 *  lowercase — no 'r/' prefix; the display layer adds it. */
export interface SubredditEntry {
  name: string
  /** candidate = proposed, unprobed · active = probe passed · rejected = probe failed. */
  status: 'candidate' | 'active' | 'rejected'
  discovered_at: string
  /** What the relevance probe saw, when it ran. Absent on unprobed candidates. */
  probe?: { sampled: number; kept: number; at: string }
}

/** The tracking_configs subset gather needs. */
export interface GatherConfig {
  brand_keywords: string[]
  competitor_keywords: string[]
  competitor_names: string[]
  industry_keywords: string[]
  platforms: string[]
  max_videos: number
  comment_depth: number
  report_period: string // 'daily' | 'weekly' | 'monthly'
  /** Client's own public profiles per platform (YouTube value = channel ID).
   *  Empty = owned layer off for this tenant. */
  own_handles: Record<string, string>
  /** Reddit communities this tenant searches, with how each earned its place.
   *  Empty = discovery has never run. See lib/gather/subreddits.ts. */
  subreddits: SubredditEntry[]
}

/** A row ready to upsert into `videos`. Only gather-owned columns — Pass A
 *  later PATCHes classified_type / hook_style / sentiment / topics in place, so
 *  those are deliberately absent here (a re-gather merge must not clobber them). */
export interface VideoInsert {
  client_id: string
  run_id: string
  platform: Platform
  video_id: string
  video_url: string
  account_name: string
  account_followers: number
  caption: string
  hashtags: string[]
  content_format: string
  views: number | null
  likes: number
  shares: number
  comments_count: number
  engagement_rate: number | null
  upload_date: string | null // DATE column → 'YYYY-MM-DD'
  audio_name: string
  is_sponsored: boolean
  duration_seconds: number
  is_client: boolean
  is_competitor: boolean
  competitor_name: string | null
  /** Keyword(s) whose search surfaced this video. Set by the gather orchestrator
   *  (unioned across a run's per-keyword searches), not by the normalisers. */
  source_keywords?: string[]
}

/** A row ready to upsert into `comments`. `video_id` is the platform id (text),
 *  matching how analysis joins comments → videos by (platform, video_id). */
export interface CommentInsert {
  client_id: string
  run_id: string
  platform: Platform
  video_id: string
  comment_id: string
  author: string
  text: string
  likes: number
  reply_count: number
  is_reply: boolean
  comment_date: string | null
}

/** Raw Apify dataset item. Actor output is loosely and inconsistently shaped, so
 *  it's an unknown record and the adapters extract defensively. */
export type RawItem = Record<string, unknown>

// ---- Transcripts (Step 1 — capture only) ------------------------------------

/** A caption/subtitle track a platform's raw item exposes. */
export interface SubtitleTrack {
  url: string
  lang: string | null
  isAuto: boolean
}

/** Direct media + caption handles for transcript resolution, pulled from a raw
 *  item by the adapter. URLs are signed and EXPIRING — use them during the run. */
export interface MediaRef {
  mediaUrl: string | null
  subtitleTracks: SubtitleTrack[] | null
}

/**
 * One resolved transcript. Only `ok` is ever usable by the analysis passes.
 *   ok        — a person is actually talking
 *   no_speech — silent or music-only (the letter-count gate)
 *   lyrics    — Whisper transcribed a song, not narration (the content gate)
 *   garbled   — noise, watermarks, transcription artefacts (the content gate)
 *   no_media  — the item carried no media handle
 *   failed    — fetch or transcription errored
 */
export interface TranscriptResult {
  text: string
  lang: string | null
  source: 'tiktok_caption' | 'whisper' | 'reddit_selftext' | null
  status: 'ok' | 'no_speech' | 'lyrics' | 'garbled' | 'no_media' | 'failed'
  /** Whisper audio minutes billed for this video (absent: caption/no-media path). */
  whisperMinutes?: number
  /** Content-gate token usage (absent when the letter gate short-circuited). */
  gateTokens?: { prompt: number; completion: number }
}

/** Client/run ids + config threaded into the normalisers. */
export interface NormaliseCtx {
  clientId: string
  runId: string
  config: GatherConfig
}

/** The minimum a video needs for its comment scrape. */
export interface VideoRef {
  video_id: string
  video_url: string
  comments_count: number
}

/**
 * A platform's gather knowledge — the ONLY thing that differs across TT/YT/IG.
 * Everything else (search → normalise → upsert → comment loop) is
 * platform-agnostic in gather.ts. This is the clean replacement for n8n's three
 * near-duplicate workflows.
 */
export interface PlatformAdapter {
  platform: Platform
  /**
   * Apify actor slug + input for ONE video search over the given `terms`, capped
   * at `limit` results. The orchestrator calls this once per KEYWORD (so `terms`
   * is normally a single-element array) — every keyword gets its own equal-quota
   * search. This (a) levels the cross-platform volume skew (the IG actor applies
   * its limit per-hashtag while TT/YT applied it per combined group) and (b) makes
   * every video attributable to the keyword that found it, for keyword value scoring.
   *
   * Apify-sourced platforms (TikTok, Instagram) implement this; a platform on a
   * native API (YouTube) provides `fetchVideos` instead — see below.
   */
  videoSearch?(config: GatherConfig, terms: string[], limit: number): { actor: string; input: RawItem }
  /** Apify actor slug + input for scraping one video's comments. */
  commentScrape?(video: VideoRef, config: GatherConfig): { actor: string; input: RawItem }
  /**
   * Native (non-Apify) source: fetch a keyword's raw video items directly. When
   * present, the orchestrator uses this instead of `videoSearch` + Apify. YouTube
   * uses it to call the official Data API; the returned items feed `normaliseVideo`
   * exactly like Apify dataset items would.
   */
  fetchVideos?(config: GatherConfig, terms: string[], limit: number): Promise<RawItem[]>
  /** Native (non-Apify) source: fetch one video's raw comment items directly. */
  fetchComments?(video: VideoRef, config: GatherConfig): Promise<RawItem[]>
  /**
   * Native (non-Apify) source: current comment counts for stored videos, for the
   * delta-scraping re-check of videos a search didn't resurface (delta.ts). Only
   * platforms with a FREE count lookup implement this (YouTube: videos.list) —
   * on Apify platforms a count check costs as much as the scrape it would save.
   */
  fetchCommentCounts?(videoIds: string[]): Promise<Map<string, number>>
  /**
   * Apify actor slug + input to re-fetch SPECIFIC videos by URL rather than by
   * search. Media and caption URLs are signed and expiring, so a video stored by
   * an earlier run has no live handle to transcribe — this refreshes it without
   * gathering anything new. Used by the transcript backfill; not part of a run.
   * Absent on YouTube (transcripts deferred — see Architecture/Video-Transcripts).
   */
  refetchByUrl?(videoUrls: string[]): { actor: string; input: RawItem }
  /**
   * Extract the direct media URL + any caption tracks from a raw item, for
   * transcript resolution (Step 1). Absent on platforms with no usable route:
   * YouTube is deferred (its transcript text is pot-gated — see
   * Architecture/Video-Transcripts), so it simply doesn't implement this and the
   * transcribe step skips it.
   */
  extractMedia?(raw: RawItem): MediaRef
  /**
   * Transcript resolvable from the raw item ALONE — no media fetch, no Whisper,
   * no cost. Reddit uses it: a post's selftext is the OP's own words, which is
   * exactly what a transcript is on the video platforms, so it flows through the
   * existing claims/evidence machinery with no Pass A changes.
   *
   * Tried BEFORE `extractMedia` in the transcribe step. A platform implements one
   * or the other, never both. `null` = this item carries no usable text.
   */
  extractTranscript?(raw: RawItem): TranscriptResult | null
  /** Raw actor item → VideoInsert. null = skip (unparseable / no url). */
  normaliseVideo(raw: RawItem, ctx: NormaliseCtx): VideoInsert | null
  /** Raw actor item → CommentInsert. null = skip. */
  normaliseComment(raw: RawItem, video: VideoRef, ctx: NormaliseCtx): CommentInsert | null
  /**
   * Min comments_count before a video is worth a comment scrape. `null` = scrape
   * all of them (YouTube — its actor doesn't reliably report a comment count).
   */
  commentThreshold: number | null
}
