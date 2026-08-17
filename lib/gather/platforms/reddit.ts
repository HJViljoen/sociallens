import type { PlatformAdapter } from '../types'
import { APIFY_ACTORS, REDDIT_COMMENT_DEPTH_CAP, REDDIT_HARVEST_POSTS, REDDIT_KEYWORD_SEARCH_POSTS, passAMinComments } from '../../config'
import { num, str, first, toDateOnly } from '../util'
import { tagVideo } from '../tagging'

// Reddit adapter (Wave 3). A subreddit post maps onto a "video" and its comment
// tree onto `comments`, so the whole gather → gate → Pass A–D spine works
// unchanged (Reddit has no views/shares — both 0 like Instagram; the videos.views column is NOT NULL).
//
// FETCH LAYER: Apify, not Reddit's own API. Reddit closed self-service API keys
// under the Nov-2025 Responsible Builder Policy, and unauthenticated public JSON
// 403s from datacenter IPs — verified dead again 2026-08-13, so do NOT re-attempt
// the free path. The actor is env-swappable (APIFY_ACTORS.reddit) because every
// Reddit actor is ToS-grey and may break: Reddit is a DEGRADABLE platform and its
// failure must never kill a run.
//
// FIELD PATHS: the actor renames raw Reddit JSON to camelCase, so nothing here
// matches Reddit's own field names. Confirmed against a live run 2026-08-13
// (harshmaur/reddit-scraper): `parsedId` is the bare post id ('1vln07j') while
// `id` carries the 't3_' fullname; `communityName` arrives already prefixed
// ('r/Prosthetics'); dates are ISO strings, not epochs; posts and comments share
// ONE dataset and are told apart by `dataType`.
//
// COST: the actor bills $0.02 per run START plus $0.002 per saved result, and the
// spine calls commentScrape once per video — so per-video init dominates on thin
// threads and depth dominates on fat ones. Comment depth is capped (see
// REDDIT_COMMENT_DEPTH_CAP) so one viral thread can't run up the bill.

/** Below this, a selftext is a stub (or absent — a link/image post) rather than
 *  the OP actually saying something. Same spirit as the Whisper letter gate. */
const SELFTEXT_MIN_CHARS = 40

/** How much selftext rides along in `caption`.
 *
 *  The body is ALSO stored as the transcript, and Pass A prints caption and
 *  transcript separately — so every char here is paid twice per video. The
 *  transcript copy is already clipped (TRANSCRIPT_PROMPT_CHARS); captions are
 *  not clipped anywhere, and Reddit selftexts reach tens of thousands of chars
 *  where a TikTok caption is one line.
 *
 *  It can't drop out of the caption entirely: tagVideo and the relevance gate
 *  both read caption, and a brand mention often sits in the body ("i have an
 *  ossur foot cover"), so removing it would silently stop tagging those posts. */
const CAPTION_SELFTEXT_MAX_CHARS = 600

/** report_period → the actor's searchTime enum. */
function periodToTimeFilter(period: string): string {
  return period === 'daily' ? 'day' : period === 'monthly' ? 'month' : 'week'
}

export const reddit: PlatformAdapter = {
  platform: 'reddit',

  videoSearch(config, terms, limit, opts) {
    // COMMUNITY HARVEST. The point of Reddit is the conversation people have
    // when they are NOT using our keywords — insurance denials, frayed socks,
    // "new leg day". A keyword search cannot see any of that, so a discovered
    // community is pulled wholesale and the relevance gate does the filtering.
    if (opts?.community) {
      return {
        actor: APIFY_ACTORS.reddit.video,
        input: {
          subredditUrls: [opts.community],
          // Its own cap, not max_videos: a harvest ignores keywords, so the
          // tenant's per-keyword quota would apply to EVERY active community.
          maxPostsCount: Math.min(limit, REDDIT_HARVEST_POSTS),
          crawlCommentsPerPost: false, // gate first; comments are bought later
          includeNSFW: false,
        },
      }
    }
    return {
      actor: APIFY_ACTORS.reddit.video,
      input: {
        searchTerms: terms,
        searchPosts: true,
        searchComments: false, // comments come later, and only for gate survivors
        searchCommunities: false,
        searchSort: 'relevance',
        searchTime: periodToTimeFilter(config.report_period),
        // Its own cap, well under max_videos: keyword search is the WEAKER of
        // Reddit's two sources now that harvest exists (a keyword search cannot
        // see the ~75% of relevant posts that never mention a tracked term), and
        // at full volume it was this platform's largest single cost.
        maxPostsCount: Math.min(limit, REDDIT_KEYWORD_SEARCH_POSTS),
        // Comments are NOT crawled here on purpose: the relevance gate sits
        // between search and comment scrape, so paying for comments now would
        // buy them for junk posts too.
        crawlCommentsPerPost: false,
        includeNSFW: false,
      },
    }
  },

  normaliseVideo(raw, ctx) {
    const v = raw as Record<string, unknown>
    if (str(v.dataType) === 'comment') return null // one dataset carries both

    // `parsedId` is the bare id; `id` is the 't3_…' fullname. Store the bare form
    // — it's what appears in post URLs, and stripping 't3_' off a comment's
    // postId joins comments → videos on the same value.
    const video_id = str(first(v.parsedId, str(v.id).replace(/^t3_/, '')))
    if (!video_id) return null
    const video_url = str(first(v.postUrl, v.url))
    if (!video_url) return null

    // The subreddit is the useful "account" for consumer intelligence — it says
    // WHERE the conversation lives (r/amputee vs r/prosthetics) — more than the
    // individual poster does. Its subscriber count is the reach proxy.
    const community = str(first(v.communityName, v.parsedCommunityName))
    const account_name = community || str(v.authorName)
    const title = str(v.title)
    const selftext = str(v.body).slice(0, CAPTION_SELFTEXT_MAX_CHARS)
    const caption = [title, selftext].filter(Boolean).join('\n\n')
    const hashtags: string[] = [] // Reddit has no hashtags

    return {
      client_id: ctx.clientId,
      run_id: ctx.runId,
      platform: 'reddit',
      video_id,
      video_url,
      account_name,
      account_followers: num(v.subredditSubscribers),
      caption,
      hashtags,
      content_format: str(first(v.postType, v.mediaType)) || 'link',
      views: 0, // Reddit doesn't expose per-post views; 0 per the schema's NOT NULL count convention (same as Instagram) — null failed the whole gate:reddit upsert on the first live run
      likes: num(first(v.score, v.upVotes)), // net upvotes
      shares: 0, // no share metric
      comments_count: num(v.commentsCount),
      engagement_rate: null, // no views → no blended engagement (same as Instagram)
      upload_date: toDateOnly(v.createdAt),
      audio_name: '',
      is_sponsored: false, // actor exposes no promoted flag
      duration_seconds: 0, // text-first medium; video posts are rare and not our signal
      ...tagVideo({ account_name, caption, hashtags }, ctx.config),
    }
  },

  // A Reddit post's selftext IS the OP's own words — the same thing a transcript
  // is on the video platforms. Routing it through `transcript` rather than
  // leaving it in `caption` means an OP who is a customer flows through the
  // existing claims/evidence machinery with zero Pass A changes.
  //
  // Free: no fetch, no Whisper. So Reddit contributes 0 to the transcribe cost
  // log, and TRANSCRIBE_CAP never binds on it in practice.
  extractTranscript(raw) {
    const r = raw as Record<string, unknown>
    if (str(r.dataType) === 'comment') return null
    const text = str(r.body)
    // Link/image posts carry no OP words. 'no_speech' is the honest status —
    // marking them 'ok' would put empty transcripts in front of Pass A, and
    // usableTranscript() would wave them through.
    if (text.length < SELFTEXT_MIN_CHARS) {
      return { text: '', lang: null, source: null, status: 'no_speech' }
    }
    return { text, lang: null, source: 'reddit_selftext', status: 'ok' }
  },

  commentScrape(video, config) {
    return {
      actor: APIFY_ACTORS.reddit.comment,
      input: {
        startUrls: [{ url: video.video_url }],
        crawlCommentsPerPost: true,
        maxPostsCount: 1,
        maxCommentsPerPost: Math.min(config.comment_depth, REDDIT_COMMENT_DEPTH_CAP),
      },
    }
  },

  normaliseComment(raw, video, ctx) {
    const c = raw as Record<string, unknown>
    if (str(c.dataType) !== 'comment') return null // the post itself rides along

    const comment_id = str(c.id)
    const text = str(c.body)
    if (!comment_id || !text) return null
    if (text === '[deleted]' || text === '[removed]') return null // tombstones carry no signal

    return {
      client_id: ctx.clientId,
      run_id: ctx.runId,
      platform: 'reddit',
      video_id: video.video_id,
      comment_id,
      author: str(c.authorName),
      text,
      likes: num(first(c.score, c.commentUpVotes)),
      // The actor flattens the tree, so a comment carries no reply list and its
      // reply count is not recoverable per-item. 0 is a placeholder, not a
      // measurement — nothing downstream reads reply_count today.
      reply_count: 0,
      is_reply: num(c.depth) > 0, // depth 0 = top-level reply to the post
      comment_date: toDateOnly(first(c.commentCreatedAt, c.createdAt)),
    }
  },

  // Reddit reports commentsCount reliably (unlike YouTube), so it gates like
  // TikTok/IG — but at the PASS A FLOOR, not the global scrape threshold.
  //
  // These two have to agree or the lower floor is dead letter: comments that are
  // never scraped can't be counted, so with the default threshold of 5 a 3-4
  // comment thread would be skipped at gather and never reach the Pass A gate
  // that was lowered to admit it. Deriving it from passAMinComments keeps them
  // from drifting apart. Cost of the extra threads is init-dominated (~$0.026 for
  // a 3-comment scrape) and accepted: on Reddit three real comments are three
  // paragraphs, which is the whole reason the platform is worth having.
  //
  // NOTE: no fetchCommentCounts. The free /api/info route died with the rest of
  // the public JSON API, and on an Apify platform a count check costs the same
  // as the scrape it would save — so Reddit gets no delta re-check, by design.
  commentThreshold: passAMinComments('reddit'),
}
