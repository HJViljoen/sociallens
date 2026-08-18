// Minimal DB row shapes for the analysis pipeline. Supabase admin queries
// return untyped rows; these narrow to the columns the passes actually read.
// Source of truth for the schema: Architecture/Schema-Actual.

export interface VideoRow {
  id: string
  client_id: string
  run_id: string | null
  platform: string
  video_id: string
  video_url: string
  account_name: string
  is_client: boolean
  is_competitor: boolean
  competitor_name: string | null
  caption: string | null
  hashtags: string[] | null
  content_format: string | null
  views: number | null
  likes: number | null
  shares: number | null
  comments_count: number | null
  engagement_rate: number | null
  account_followers: number | null
  /** 'YYYY-MM-DD' post date; null when the platform gave nothing parseable. */
  upload_date: string | null
  /** Video sentiment; null until analysed. Two writers, two meanings — see
   *  sentiment_source. */
  sentiment: string | null
  /** 'audience' = Pass A full lane (how commenters received the video) ·
   *  'framing' = classify-meta (the video's own caption/transcript framing).
   *  run_summary keeps the families apart (T0-8, 2026-08-18). */
  sentiment_source?: 'audience' | 'framing' | string | null
  /** 'discovered' (keyword search) or 'owned' (the client's own accounts).
   *  The SoV guard keeps owned rows out of discovered-corpus metrics. */
  source?: string | null
  /** Step 1 transcript capture. Only status 'ok' text is ever readable — go
   *  through lib/pipeline/transcript-input.usableTranscript, never directly. */
  transcript?: string | null
  transcript_lang?: string | null
  transcript_status?: string | null
  /** Incremental Pass A pointer: the run whose rows are this video's current
   *  analysis (see AGENTS.md). Read by runPassA for step-retry idempotency. */
  analyzed_run_id?: string | null
  /** 'full' | 'claims_only' | 'skip' — Pass A's lane at its last read. Used as
   *  the fallback provenance for `sentiment` on rows written before
   *  sentiment_source existed: only the full lane reads comments. */
  analyzed_lane?: string | null
}

export interface CommentRow {
  id: string
  client_id: string
  run_id: string | null
  platform: string
  video_id: string
  comment_id: string | null
  author: string | null
  text: string | null
  likes: number | null
  /** 'YYYY-MM-DD' posted date; null when the platform gave nothing parseable.
   *  Optional: only the period-metrics readers select it. */
  comment_date?: string | null
}

/** One bucket of the share-of-voice breakdown. */
export interface SovEntry {
  videos: number
  views: number
  pct_videos: number
}

/** Per-platform sub-metrics. `avg_engagement_rate` is null for view-less
 *  platforms (Instagram) — its likes-per-follower rate lives in `eng_note`. */
export interface PlatformSummary {
  videos: number
  comments: number
  views: number
  avg_engagement_rate: number | null
}

/** A Pass A insight joined to its source video's entity flags, as Step A2 reads
 *  it. The entity (client / competitor / industry-other) is derived here from
 *  the video, never stored on the insight (invariant 7). */
export interface InsightRow {
  id: string
  category: string
  theme: string
  description: string
  strength_score: number
  emotion: string
  sentiment_impact: string
  source_video_id: string
  platform: string
  is_client: boolean
  is_competitor: boolean
  competitor_name: string | null
}

/** One clustered theme produced by Step A2, labelled by Pass B, persisted via
 *  lib/pipeline/themes.ts, and consumed by Pass C/D. `theme` is the working
 *  slug (highest-strength member's); `label`/`description` are the client-facing
 *  Pass B output. `evidenceCount` = distinct supporting videos — the value the
 *  evidence floor tiers on (`singleSource` = below floor, "Early signal"). */
export interface AggregatedTheme {
  bucket: string
  category: string
  theme: string
  memberThemes: string[]
  supportingVideoIds: string[]
  supportingInsightIds: string[]
  evidenceCount: number
  /** Strongest single member insight. Says how sharp the best evidence is, and
   *  NOTHING about how widely the theme was heard — so it must never be the
   *  ordering key (Tier 1, 2026-08-18). Kept for display and tie-breaks. */
  strengthScore: number
  /** Mean member strength. The honest "how strong is this theme" number. */
  meanStrength: number
  /** Ordering key: evidence x share of its entity bucket. This order is the
   *  ONLY salience cue Pass C and Pass D-a ever receive — they read one line
   *  per theme, so whatever sorts first is what the model treats as the
   *  market's loudest signal. Ranking by strongest-member put a 3-video theme
   *  above a 47-video one. */
  rankScore: number
  dominantEmotion: string
  dominantSentimentImpact: string
  singleSource: boolean
  /** Strongest members' insight descriptions — raw material for Pass B labelling. Not persisted. */
  sampleDescriptions: string[]
  label?: string
  description?: string
}

/** Output of Step 2a (metrics). Held in memory for Pass A / Step 2b. */
export interface Step2aMetrics {
  total_videos: number
  total_comments: number
  client_videos: number
  competitor_videos: number
  platforms_covered: string[]
  avg_engagement_rate: number
  top_video_id: string | null
  top_video_views: number
  top_video_platform: string | null
  share_of_voice: Record<string, SovEntry>
  platforms_summary: Record<string, PlatformSummary>
  /** Per video.id quality score (1–5, or null when <5 comments). */
  comment_quality_scores: Record<string, number | null>
}
