/**
 * First sentence of a recommendation's reasoning, for the email (T0-10, kept
 * from the retired weekly email). The app shows the full rationale; the email
 * leads with the action and needs one line of why, or the quote falls below
 * the fold on a 390px phone. Abbreviations that end in a period are not
 * sentence ends; a reasoning with no terminator at all is returned whole.
 */
export function firstSentence(text: string, maxChars = 240): string {
  const trimmed = text.trim()
  if (!trimmed) return ''
  const match = trimmed.match(/^[\s\S]*?[.!?](?=\s|$)/)
  let out = match ? match[0].trim() : trimmed
  if (match && out.length < 40 && trimmed.length > out.length) {
    const second = trimmed.slice(out.length).match(/^\s*[\s\S]*?[.!?](?=\s|$)/)
    if (second) out = (out + second[0]).trim()
  }
  if (out.length > maxChars) out = `${out.slice(0, maxChars).trimEnd()}…`
  return out
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }

/** The plain-text alternative, read off the same HTML: block ends become line
 *  breaks, cells become spaces, links keep their address. No dependency. */
export function htmlToText(html: string): string {
  let s = html
    .replace(/<head[\s\S]*?<\/head>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<img[^>]*alt="([^"]*)"[^>]*>/gi, (_, alt) => (alt ? `[${alt}]` : ''))
    .replace(/<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, (_, href, inner) => `${inner.replace(/<[^>]+>/g, '').trim()} (${href})`)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/?(p|div|tr|h[1-6]|li|blockquote|table)\b[^>]*>/gi, '\n')
    .replace(/<\/t[dh]>/gi, '  ')
    .replace(/<[^>]+>/g, '')
    .replace(/&(#\d+|[a-z]+);/gi, (m, e: string) => (e.startsWith('#') ? String.fromCharCode(Number(e.slice(1))) : (ENTITIES[e.toLowerCase()] ?? m)))
  s = s
    .split('\n')
    .map((l) => l.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{2,}/g, '\n')
  return s.trim()
}
