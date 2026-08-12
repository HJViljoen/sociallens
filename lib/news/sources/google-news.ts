import type { NewsSource, NewsItem, NewsConfig } from '../types'
import { parseRssItems, type RssItem } from '../rss'
import { hashKey, toIso, periodToWhen } from '../util'

// Google News RSS — the verified-working free per-keyword news source (returns
// 200 + valid RSS from server IPs, where Reddit's public JSON 403s). Query
// `q={term} when:{window}` searches all of Google News windowed to the period.
// Links are Google redirect URLs (stable per article); the real article body is
// left for a later targeted-scrape pass — Phase 1 correlates on headline + source
// + date, which RSS gives directly.

const UA = 'Mozilla/5.0 (compatible; verbatim-consumer-intel/1.0; +https://verbatimintel.com)'

/** Google News titles are "Headline - Publisher" — drop the trailing publisher. */
export function cleanTitle(title: string, sourceName: string): string {
  if (sourceName && title.endsWith(` - ${sourceName}`)) return title.slice(0, -(sourceName.length + 3)).trim()
  const i = title.lastIndexOf(' - ')
  return i > 0 ? title.slice(0, i).trim() : title
}

function normalise(it: RssItem): NewsItem | null {
  if (!it.link || !it.title) return null
  return {
    source: 'google-news',
    source_ref: it.sourceName || it.sourceUrl,
    url: it.link,
    url_hash: hashKey(it.guid || it.link),
    title: cleanTitle(it.title, it.sourceName),
    // Google News descriptions are usually just the headline again — keep only a
    // genuinely distinct one.
    summary: it.description && it.description !== it.title ? it.description : '',
    published_at: toIso(it.pubDate),
    author: '',
    entities: [],
    raw_sentiment: null,
  }
}

export const googleNews: NewsSource = {
  source: 'google-news',

  async fetchItems(config: NewsConfig, term: string, limit: number): Promise<NewsItem[]> {
    if (!term) return []
    const q = `${term} when:${periodToWhen(config.report_period)}`
    const url = `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-US&gl=US&ceid=US:en`
    const res = await fetch(url, { headers: { 'User-Agent': UA } })
    if (!res.ok) throw new Error(`google-news ${res.status}`)
    const xml = await res.text()
    return parseRssItems(xml)
      .slice(0, limit)
      .map(normalise)
      .filter((n): n is NewsItem => n !== null)
  },
}
