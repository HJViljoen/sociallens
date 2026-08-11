import type { NewsItem, NewsConfig, Ring } from './types'
import { fold } from '../gather/util'

/**
 * Deterministic ring for a news item from its CONTENT (title + summary + entities),
 * priority Direct(0) > Competitive(1) > Category(2), else Macro(4). Ring 3
 * (thematic — matched against the client's OWN themes) is NOT assigned here: it
 * needs embeddings + an LLM confirm gate and is applied in the persistence step.
 *
 * Same naive-substring recall as gather's matchEntities. The homonym risk (a name
 * that's also a common word) is real but low-stakes for news: ring is a surfacing
 * hint, not a metric, and the relevance gate filters off-topic items.
 */
export function assignRing(item: NewsItem, config: NewsConfig): Ring {
  const hay = fold([item.title, item.summary, ...item.entities].join(' '))
  const has = (kw: string): boolean => {
    const k = fold(kw)
    return k !== '' && hay.includes(k)
  }
  if ((config.brand_keywords ?? []).some(has)) return 0
  if ((config.competitor_names ?? []).some(has)) return 1
  if ((config.industry_keywords ?? []).some(has)) return 2
  return 4
}
