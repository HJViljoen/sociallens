// News layer types. The news/web-scraping layer ingests real-world articles as a
// SEPARATE data type from videos/comments (an article is not a comment), fused
// downstream with the grounded consumer conversation — never a standalone feed.
// These shapes cover ingestion (fetch → normalise → ring); persistence + the
// correlate/explain step live alongside the pipeline.

/**
 * Relevance rings — how closely a news item relates to a client, widening out:
 *  0 Direct      — the brand is named
 *  1 Competitive — a competitor is named
 *  2 Category    — about the niche/product class
 *  3 Thematic    — about a THEME the brand owns (product unmentioned; e.g. an
 *                  ocean-plastic study for a sustainability brand). Matched
 *                  against the client's OWN themes — needs embeddings + a
 *                  confirm gate, so it's assigned in the persistence step, not here.
 *  4 Macro       — broad currents that move the whole category
 */
export type Ring = 0 | 1 | 2 | 3 | 4

/** A normalised news item as a source produces it — before ring/relevance/embed
 *  (added downstream) and before persistence. Deliberately unlike VideoInsert:
 *  no account/engagement/comment-thread model. */
export interface NewsItem {
  /** Ingestion source: 'google-news' | 'gdelt' | 'rss'. */
  source: string
  /** Publisher / feed name / domain. */
  source_ref: string
  url: string
  /** Stable dedupe key (sha1 of the item's guid || url). */
  url_hash: string
  title: string
  summary: string
  /** ISO timestamp, or null when the source gives no parseable date. */
  published_at: string | null
  author: string
  /** Orgs/people the source extracted (GDELT); [] for headline-only sources. */
  entities: string[]
  /** Provider tone/sentiment (GDELT); null when the source gives none. */
  raw_sentiment: number | null
}

/** The tracking_configs subset the news layer needs (mirrors gather's GatherConfig). */
export interface NewsConfig {
  brand_keywords: string[]
  competitor_keywords: string[]
  competitor_names: string[]
  industry_keywords: string[]
  news_rss_feeds?: string[]
  report_period: string // 'daily' | 'weekly' | 'monthly'
}

/**
 * A news source — knows how to query ONE place for a term's recent items. Mirrors
 * gather's PlatformAdapter.fetchVideos: the source only fetches + normalises; the
 * orchestrator (fetch.ts) plans queries, dedupes, and assigns rings.
 */
export interface NewsSource {
  source: string
  /** Fetch recent items for one query term (windowed to the report period). No writes. */
  fetchItems(config: NewsConfig, term: string, limit: number): Promise<NewsItem[]>
}
