import { describe, it, expect } from 'vitest'
import { parseRssItems } from './rss'
import { cleanTitle } from './sources/google-news'
import { assignRing } from './rings'
import { planNewsQueries } from './fetch'
import type { NewsItem, NewsConfig } from './types'

const SAMPLE_RSS = `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel>
<item><title>Sealand Partners With Kaizer Chiefs For Planet-Friendly Travel Gear - Soccer Laduma</title><link>https://news.google.com/rss/articles/ABC123?oc=5</link><guid isPermaLink="false">ABC123</guid><pubDate>Wed, 10 Dec 2025 08:00:00 GMT</pubDate><description>&lt;a href="x"&gt;Sealand Partners With Kaizer Chiefs&lt;/a&gt; &amp; more</description><source url="https://www.soccerladuma.co.za">Soccer Laduma</source></item>
<item><title>Patagonia launches recycled line - Vogue</title><link>https://news.google.com/rss/articles/XYZ?oc=5</link><guid isPermaLink="false">XYZ</guid><pubDate>Tue, 09 Dec 2025 10:00:00 GMT</pubDate><source url="https://www.vogue.com">Vogue</source></item>
</channel></rss>`

describe('parseRssItems', () => {
  const items = parseRssItems(SAMPLE_RSS)

  it('extracts every item', () => {
    expect(items).toHaveLength(2)
  })

  it('pulls title, link, guid, pubDate and source', () => {
    const a = items[0]
    expect(a.title).toBe('Sealand Partners With Kaizer Chiefs For Planet-Friendly Travel Gear - Soccer Laduma')
    expect(a.link).toBe('https://news.google.com/rss/articles/ABC123?oc=5')
    expect(a.guid).toBe('ABC123')
    expect(a.pubDate).toBe('Wed, 10 Dec 2025 08:00:00 GMT')
    expect(a.sourceName).toBe('Soccer Laduma')
    expect(a.sourceUrl).toBe('https://www.soccerladuma.co.za')
  })

  it('strips CDATA/HTML and unescapes entities in description (& last)', () => {
    expect(items[0].description).toBe('Sealand Partners With Kaizer Chiefs & more')
  })
})

describe('cleanTitle', () => {
  it('drops the trailing " - Publisher" suffix', () => {
    expect(cleanTitle('Sealand Partners With Kaizer Chiefs - Soccer Laduma', 'Soccer Laduma')).toBe(
      'Sealand Partners With Kaizer Chiefs',
    )
  })
  it('falls back to the last " - " when the source name is absent', () => {
    expect(cleanTitle('Patagonia launches recycled line - Vogue', '')).toBe('Patagonia launches recycled line')
  })
  it('leaves a hyphen-free title untouched', () => {
    expect(cleanTitle('No publisher suffix here', '')).toBe('No publisher suffix here')
  })
})

describe('assignRing', () => {
  const config: NewsConfig = {
    brand_keywords: ['sealand'],
    competitor_keywords: [],
    competitor_names: ['Patagonia'],
    industry_keywords: ['sustainable bag'],
    report_period: 'weekly',
  }
  const item = (title: string): NewsItem => ({
    source: 'google-news', source_ref: 'x', url: 'u', url_hash: 'h',
    title, summary: '', published_at: null, author: '', entities: [], raw_sentiment: null,
  })

  it('Ring 0 when the brand is named', () => {
    expect(assignRing(item('Sealand partners with Kaizer Chiefs'), config)).toBe(0)
  })
  it('Ring 1 when a competitor is named (and the brand is not)', () => {
    expect(assignRing(item('Patagonia launches recycled line'), config)).toBe(1)
  })
  it('Ring 2 on a category match', () => {
    expect(assignRing(item('The rise of the sustainable bag market'), config)).toBe(2)
  })
  it('Ring 4 when nothing matches (macro)', () => {
    expect(assignRing(item('Global shipping costs climb in 2026'), config)).toBe(4)
  })
  it('brand beats competitor when both appear (priority)', () => {
    expect(assignRing(item('Sealand vs Patagonia: who is greener?'), config)).toBe(0)
  })
})

describe('planNewsQueries', () => {
  it('one query per term across buckets, deduped', () => {
    const q = planNewsQueries({
      brand_keywords: ['Sealand', 'sealand'], // dupe (case-insensitive)
      competitor_keywords: [],
      competitor_names: ['Patagonia'],
      industry_keywords: ['sustainable bag'],
      report_period: 'weekly',
    })
    expect(q.map((x) => x.term)).toEqual(['Sealand', 'Patagonia', 'sustainable bag'])
    expect(q[0].bucket).toBe('brand')
    expect(q[1].bucket).toBe('competitor')
  })
})
