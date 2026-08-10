// Evidence-led quote selection, shared by the data pages (Market, Competitive,
// Dashboard). A card leads with the real customer voices; the claim beneath is
// the annotation (Redesign Spec §1 — "in their own words"). The durable source
// of a card's lead quote is the pipeline's `hero_quote` (chosen by the model that
// read every comment); this heuristic picker is the fallback that fills the rest
// and covers rows/runs that predate hero_quote.

export interface QuoteRow {
  quote: string
  rank: number
}

export const cleanQuote = (q: string) => q.replace(/\s+/g, ' ').trim()

// Common English function words. The corpus is heavily multilingual and full of
// Latin-script transliterations that aren't English, so a latin-character ratio
// isn't enough — a real English sentence carries several of these.
const ENGLISH_WORDS = new Set([
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'to', 'of', 'for', 'and', 'or', 'but',
  'my', 'your', 'his', 'her', 'their', 'our', 'it', 'its', 'this', 'that', 'these', 'those',
  'i', 'you', 'he', 'she', 'we', 'they', 'me', 'him', 'them', 'us', 'who', 'how', 'what', 'when', 'where', 'why',
  'with', 'have', 'has', 'had', 'do', 'does', 'did', 'get', 'got', 'can', 'could', 'will', 'would',
  'need', 'want', 'so', 'not', 'no', 'on', 'in', 'at', 'as', 'if', 'just', 'really', 'still', 'more', 'than', 'about',
])
const wordsOf = (s: string) => s.toLowerCase().match(/[a-z']+/g) ?? []
export const englishHits = (q: string) => wordsOf(q).reduce((n, w) => n + (ENGLISH_WORDS.has(w) ? 1 : 0), 0)

/** Whether a verbatim can carry a card as its lead quote — in card-length range
 *  and reads as English (the corpus is heavily multilingual; "Yo quiero 🙌🙌"
 *  led a run-1 card). Used by the pipeline to order the hero-quote pool —
 *  a preference, not a hard gate: thin quotes still ground, they just stop
 *  being offered first. */
export const readsAsHeroQuote = (q: string): boolean => {
  const c = cleanQuote(q)
  return c.length >= 18 && c.length <= 170 && englishHits(c) >= 2
}

/** Content keywords of a claim, for scoring how on-topic a quote is. */
export const keywordsOf = (text: string) =>
  new Set((text.toLowerCase().match(/[a-z]{4,}/g) ?? []).filter((w) => !ENGLISH_WORDS.has(w)))

// A quote earns its place by reading as English AND speaking to the claim it sits
// under — generic praise that merely scans well must not outrank an on-topic voice.
function quoteScore(q: string, keywords: Set<string>): number {
  const len = q.length
  if (len < 18 || len > 170) return -1
  const eng = englishHits(q)
  if (eng < 2) return -1 // reject non-English / transliteration fragments
  let s = Math.min(eng, 5)
  if (len >= 30 && len <= 140) s += 2
  const content = new Set(q.toLowerCase().match(/[a-z']{4,}/g) ?? [])
  let rel = 0
  for (const w of content) if (keywords.has(w)) rel++
  s += rel * 3 // strongly prefer quotes that touch the claim's own words
  return s
}

/** Theme-slug overlap with a claim — surfaces the on-topic audience insights
 *  before the generic, high-volume ones (an "access" claim reaches insurance/cost). */
function themeRelevance(id: string, kw: Set<string>, themeSlugById: Map<string, string>): number {
  const theme = themeSlugById.get(id) ?? ''
  let r = 0
  for (const w of theme.split('_')) if (kw.has(w)) r++
  return r
}

/** Order audience-insight ids by how well their theme matches a claim (used to
 *  build a focused quote-fetch pool before the generic voices crowd it out). */
export function rankByTheme(ids: string[], claimText: string, themeSlugById: Map<string, string>): string[] {
  const kw = keywordsOf(claimText)
  return [...ids].sort((a, b) => themeRelevance(b, kw, themeSlugById) - themeRelevance(a, kw, themeSlugById))
}

// ---- entity-bucket scoping (teardown 2026-07-09 §Run 1, defect 1) -----------
// A quote's entity bucket is its source video's — 'client', 'competitor:<name>',
// or 'industry-other' — derived in Step A2 and persisted per theme. Quote pools
// used to fan out across buckets, so a claim about the client could lead with
// another brand's customers. The rule: client-facing claims (Dashboard, Market)
// quote client + category-audience voices; a competitive card quotes that
// competitor's audience.

export interface ThemeBucketRow {
  bucket: string
  supporting_insight_ids: string[] | null
}

/** audience_insight id → entity bucket, from the run's persisted themes. */
export function bucketByAudienceId(themes: ThemeBucketRow[]): Map<string, string> {
  const map = new Map<string, string>()
  for (const t of themes) for (const id of t.supporting_insight_ids ?? []) map.set(id, t.bucket)
  return map
}

/** Keep the client's own + category-audience voices — never a competitor's
 *  customers under a claim about the client. Unmapped ids pass through: the map
 *  is built from the same themes the evidence came from, so a miss means legacy
 *  data (or no themes rows at all), not a competitor voice. */
export function scopeToClientVoices(ids: string[], bucketById: Map<string, string>): string[] {
  if (bucketById.size === 0) return ids
  return ids.filter((id) => !bucketById.get(id)?.startsWith('competitor:'))
}

/** Keep the named competitor's audience. Pass C's competitor_name is model
 *  prose (unvalidated against video.competitor_name), so the bucket match is
 *  case-insensitive; when nothing matches — or the card names no competitor —
 *  fall back to every non-client bucket: a cross-bucket finding may quote the
 *  category, but the client's own customers must never appear as a
 *  competitor's. Unmapped ids are dropped here for the same reason. */
export function scopeToCompetitor(ids: string[], bucketById: Map<string, string>, competitorName: string | null): string[] {
  if (bucketById.size === 0) return ids
  const want = competitorName ? `competitor:${competitorName.trim().toLowerCase()}` : null
  const haveNamed = want != null && [...bucketById.values()].some((b) => b.toLowerCase() === want)
  return ids.filter((id) => {
    const b = bucketById.get(id)
    if (!b) return false
    return haveNamed ? b.toLowerCase() === want : b !== 'client'
  })
}

/** Minimal shape of a Supabase-style client for the evidence read. Kept as a
 *  local cast target so callers can pass their fully-typed client without TS
 *  trying to reconcile Postgrest's deeply-recursive builder type ("excessively
 *  deep") against this structural interface. */
interface EvidenceClient {
  from(table: string): {
    select(cols: string): {
      in(col: string, vals: string[]): PromiseLike<{ data: unknown[] | null; error: unknown }>
    }
  }
}

/** Fetch evidence quotes for a set of audience-insight ids (chunked to stay under
 *  the PostgREST URL cap), keyed by audience-insight id. */
export async function fetchQuotesByAudience(
  client: unknown,
  audienceIds: string[],
): Promise<Map<string, QuoteRow[]>> {
  const c = client as EvidenceClient
  const byAudience = new Map<string, QuoteRow[]>()
  for (let i = 0; i < audienceIds.length; i += 120) {
    const { data } = await c
      .from('insight_evidence')
      .select('audience_insight_id, quote, relevance_rank')
      .in('audience_insight_id', audienceIds.slice(i, i + 120))
    for (const r of (data ?? []) as { audience_insight_id: string; quote: string | null; relevance_rank: number | null }[]) {
      if (!r.quote) continue
      const arr = byAudience.get(r.audience_insight_id) ?? []
      arr.push({ quote: r.quote, rank: r.relevance_rank ?? 99 })
      byAudience.set(r.audience_insight_id, arr)
    }
  }
  return byAudience
}

/** A per-page quote picker with cross-card de-duplication (no voice repeats on a
 *  page). Lead with the pipeline's `heroQuote` when present, then fill from the
 *  heuristic pool. */
export function createQuotePicker(
  quotesByAudience: Map<string, QuoteRow[]>,
  themeSlugById: Map<string, string>,
) {
  const used = new Set<string>()

  return function pick(audienceIds: string[], n: number, claimText: string, heroQuote?: string | null): string[] {
    const chosen: string[] = []
    const localKeys = new Set<string>()
    const take = (raw: string) => {
      const q = cleanQuote(raw)
      const key = q.toLowerCase()
      if (!q || used.has(key) || localKeys.has(key)) return
      localKeys.add(key)
      used.add(key)
      chosen.push(q)
    }

    // The model's pick leads and bypasses the English/relevance gate — it was
    // chosen by the pass that read every comment.
    if (heroQuote) take(heroQuote)
    if (chosen.length >= n) return chosen

    const keywords = keywordsOf(claimText)
    const cand: { q: string; score: number; rank: number }[] = []
    for (const aid of audienceIds) {
      const themeBonus = themeRelevance(aid, keywords, themeSlugById) * 2
      for (const { quote, rank } of quotesByAudience.get(aid) ?? []) {
        const q = cleanQuote(quote)
        const key = q.toLowerCase()
        if (used.has(key) || localKeys.has(key)) continue
        const base = quoteScore(q, keywords)
        if (base <= 0) continue
        cand.push({ q, score: base + themeBonus, rank })
      }
    }
    cand.sort((a, b) => b.score - a.score || a.rank - b.rank)
    for (const c of cand) {
      if (chosen.length >= n) break
      take(c.q)
    }
    return chosen
  }
}
