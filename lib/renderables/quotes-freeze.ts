import type { Quote } from './types'

/**
 * Freeze and thaw the quotes inside tile-ready page data.
 *
 * A snapshot stores numbers and ids, never a third party's words. `freezeQuotes`
 * walks any data structure, empties the `text` of every Quote it finds and
 * collects their refs (report_snapshots.evidence_ids — the column erase-commenter
 * searches). `resolveQuotes` walks the same structure with the texts fetched
 * live and puts the words back; a quote whose ref no longer resolves is DROPPED
 * from its array (or nulled where it stood alone), which is how an erased
 * comment disappears from an export rendered after the erasure.
 *
 * A Quote is recognised structurally: an object whose `ref` is a string of the
 * form `e:…`, `c:…`, `v:…` or `h:<table>:…` and whose `text` is a string.
 * Nothing else in the pages uses that shape, and the prefix is what keeps this
 * from being a guess. `h:` is a HERO quote — the pipeline's copy of a voice on
 * a recommendations / market_insights / competitive_insights / account_events
 * row (`hero_quote`), which erase-commenter nulls by string match, so resolving
 * through the row is as erasure-safe as resolving through insight_evidence.
 * `b:<run_id>:<n>` is a "said about you" claim quoted from a VIDEO
 * (run_summary.brand_voice.about[n].quote — a creator's words, not a
 * commenter's; kept as a ref all the same so no stored export carries them).
 * `m:<comments.id>` is a comment AS POSTED (the reply inbox shows the whole
 * comment, not the evidence excerpt); it resolves only while an evidence row
 * still cites it, so erasure and redaction reach it the same way.
 */

const REF_RE = /^([ecvm]:.+|h:[a-z_]+:.+|b:[^:]+:\d+)$/

export function isQuote(v: unknown): v is Quote {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false
  const o = v as Record<string, unknown>
  return typeof o.ref === 'string' && REF_RE.test(o.ref) && typeof o.text === 'string'
}

export type HeroTable = 'recommendations' | 'market_insights' | 'competitive_insights' | 'account_events'

export const quoteRef = {
  evidence: (id: string) => `e:${id}`,
  comment: (id: string) => `c:${id}`,
  video: (id: string) => `v:${id}`,
  message: (commentId: string) => `m:${commentId}`,
  hero: (table: HeroTable, id: string) => `h:${table}:${id}`,
  brandVoice: (runId: string, index: number) => `b:${runId}:${index}`,
}

/** Split a ref into its kind, bare id and (for heroes) table. */
export function parseRef(ref: string): { kind: 'e' | 'c' | 'v' | 'm'; id: string } | { kind: 'h'; table: string; id: string } | { kind: 'b'; runId: string; index: number } | null {
  const h = /^h:([a-z_]+):(.+)$/.exec(ref)
  if (h) return { kind: 'h', table: h[1], id: h[2] }
  const b = /^b:([^:]+):(\d+)$/.exec(ref)
  if (b) return { kind: 'b', runId: b[1], index: Number(b[2]) }
  const m = /^([ecvm]):(.+)$/.exec(ref)
  return m ? { kind: m[1] as 'e' | 'c' | 'v' | 'm', id: m[2] } : null
}

function walk(node: unknown, fn: (q: Quote) => Quote | null): unknown {
  if (isQuote(node)) return fn(node)
  if (Array.isArray(node)) {
    const out: unknown[] = []
    for (const item of node) {
      const next = walk(item, fn)
      // A quote that did not survive leaves no hole in its list.
      if (next === null && isQuote(item)) continue
      out.push(next)
    }
    return out
  }
  if (node && typeof node === 'object') {
    const src = node as Record<string, unknown>
    const out: Record<string, unknown> = {}
    for (const k of Object.keys(src)) out[k] = walk(src[k], fn)
    return out
  }
  return node
}

/** Empty every quote's text; return the frozen copy and the refs it carries. */
export function freezeQuotes<T>(data: T): { data: T; refs: string[] } {
  const refs = new Set<string>()
  const frozen = walk(data, (q) => {
    refs.add(q.ref)
    return { ...q, text: '' }
  }) as T
  return { data: frozen, refs: [...refs] }
}

/** Every distinct quote ref in the data (frozen or not). */
export function collectQuoteRefs(data: unknown): string[] {
  const refs = new Set<string>()
  walk(data, (q) => {
    refs.add(q.ref)
    return q
  })
  return [...refs]
}

/** Put the words back from a ref → text map. Unresolvable quotes are removed. */
export function resolveQuotes<T>(data: T, texts: Map<string, string>): T {
  return walk(data, (q) => {
    const text = texts.get(q.ref)
    if (!text) return null
    return { ...q, text }
  }) as T
}
