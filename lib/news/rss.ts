// Minimal RSS 2.0 item extractor — dependency-free. Google News RSS is
// well-formed and consistent, so a scoped regex parse beats adding an XML
// dependency for the handful of tags we read. If we ever ingest arbitrary,
// messy feeds this should graduate to a real parser.

export interface RssItem {
  title: string
  link: string
  guid: string
  pubDate: string
  /** Publisher name from <source>, or '' if absent. */
  sourceName: string
  /** Publisher domain from <source url="…">, or '' if absent. */
  sourceUrl: string
  /** <description> with tags stripped. Often just the headline for Google News. */
  description: string
}

const stripCdata = (s: string): string =>
  s.replace(/^\s*<!\[CDATA\[/, '').replace(/\]\]>\s*$/, '').trim()

// Unescape the five XML entities (+ &nbsp;). &amp; MUST come last so "&amp;lt;"
// decodes to "&lt;", not "<".
const unescapeXml = (s: string): string =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')

const stripTags = (s: string): string => s.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()

/** Inner text of the first <name>…</name> in `block`, CDATA-stripped + unescaped. */
function tagText(block: string, name: string): string {
  const m = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i').exec(block)
  return m ? unescapeXml(stripCdata(m[1])) : ''
}

/** Parse the <item> elements of an RSS feed. */
export function parseRssItems(xml: string): RssItem[] {
  const items: RssItem[] = []
  for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)) {
    const block = m[1]
    const sourceMatch = /<source(?:\s[^>]*?url="([^"]*)")?[^>]*>([\s\S]*?)<\/source>/i.exec(block)
    items.push({
      title: tagText(block, 'title'),
      link: tagText(block, 'link'),
      guid: tagText(block, 'guid'),
      pubDate: tagText(block, 'pubDate'),
      sourceUrl: sourceMatch?.[1] ?? '',
      sourceName: sourceMatch ? unescapeXml(stripCdata(sourceMatch[2])) : '',
      description: stripTags(tagText(block, 'description')),
    })
  }
  return items
}
