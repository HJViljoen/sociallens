import type { NewsItem, NewsConfig, NewsSource, Ring } from './types'
import { googleNews } from './sources/google-news'
import { assignRing } from './rings'
import { dedupeBy } from '../gather/util'

// News ingestion orchestrator — the analog of gather's planGatherSearches +
// searchOne. Plans per-term queries from the client's config, fetches across
// sources, dedupes, and assigns the deterministic ring. Pure ingestion: no
// relevance gate, no embeddings, no DB (those are the persistence step).

/** Active news sources. Google News RSS is the verified free primary; GDELT and
 *  targeted RSS/scrapers register here as they're added. */
export const sources: NewsSource[] = [googleNews]

/** A news item with its (deterministic) ring assigned. */
export interface RankedNewsItem extends NewsItem {
  ring: Ring
}

/** One planned query — a term to search across sources. */
export interface NewsQuery {
  term: string
  bucket: 'brand' | 'competitor' | 'industry'
}

/** Plan per-term queries from a client's config (deduped; a term searches once). */
export function planNewsQueries(config: NewsConfig): NewsQuery[] {
  const out: NewsQuery[] = []
  const seen = new Set<string>()
  const add = (terms: string[] | undefined, bucket: NewsQuery['bucket']) => {
    for (const t of terms ?? []) {
      const term = t.trim()
      const key = term.toLowerCase()
      if (!term || seen.has(key)) continue
      seen.add(key)
      out.push({ term, bucket })
    }
  }
  add(config.brand_keywords, 'brand')
  add(config.competitor_names, 'competitor')
  add(config.industry_keywords, 'industry')
  return out
}

/**
 * Fetch + normalise + dedupe + ring-assign a client's news for this period. One
 * source (or one query) failing never sinks the rest — it's logged and skipped.
 */
export async function gatherNewsItems(
  config: NewsConfig,
  opts: { perQuery?: number } = {},
): Promise<RankedNewsItem[]> {
  const perQuery = opts.perQuery ?? 20
  const queries = planNewsQueries(config)
  const collected: NewsItem[] = []
  for (const q of queries) {
    for (const src of sources) {
      try {
        collected.push(...(await src.fetchItems(config, q.term, perQuery)))
      } catch (e) {
        console.log(`[news] ${src.source} "${q.term}" failed: ${(e as Error).message}`)
      }
    }
  }
  const deduped = dedupeBy(collected, (n) => n.url_hash)
  return deduped.map((n) => ({ ...n, ring: assignRing(n, config) }))
}
