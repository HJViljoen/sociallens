// Evidence-led quote selection, shared by the data pages (Market, Competitive,
// Dashboard). A card leads with the real customer voices; the claim beneath is
// the annotation (Redesign Spec §1 — "in their own words"). The durable source
// of a card's lead quote is the pipeline's `hero_quote` (chosen by the model that
// read every comment); this heuristic picker is the fallback that fills the rest
// and covers rows/runs that predate hero_quote.

export interface QuoteRow {
  quote: string
  rank: number
  /** insight_evidence.id — the ref a snapshot keeps in place of the words
   *  (Reports & Exports, 2026-08-29). */
  evidenceId: string
}

/** A quote plus what it can be traced back to. The agent's grounded register
 *  may only carry quotes of this shape — "a quote carries a comment id" is the
 *  citation half of the access-is-not-authority rule. */
export interface QuoteCitation extends QuoteRow {
  commentId: string | null
  videoId: string | null
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
type Rows = PromiseLike<{ data: unknown[] | null; error: unknown }>
interface EvidenceClient {
  from(table: string): {
    select(cols: string): {
      in(col: string, vals: string[]): Rows & { eq(col: string, val: boolean): Rows }
    }
  }
}

/** Split an id list into PostgREST-URL-sized chunks and fetch them ALL AT
 *  ONCE. These helpers used to await one chunk at a time; Market and Voice
 *  pass hundreds to thousands of ids, so a page paid 5–30 serial round trips
 *  here — each one, after an idle spell, at the DB's wake-up price. Chunks
 *  are disjoint by id, so processing the results in chunk order gives the
 *  same per-id ordering the serial loop did. */
async function fetchChunks<R>(ids: string[], fetch: (chunk: string[]) => Rows, size = 120): Promise<R[]> {
  const chunks: string[][] = []
  for (let i = 0; i < ids.length; i += size) chunks.push(ids.slice(i, i + size))
  const results = await Promise.all(chunks.map((chunk) => fetch(chunk)))
  return results.flatMap((r) => (r.data ?? []) as R[])
}

/** Fetch evidence quotes for a set of audience-insight ids (chunked to stay under
 *  the PostgREST URL cap), keyed by audience-insight id. */
export async function fetchQuotesByAudience(
  client: unknown,
  audienceIds: string[],
): Promise<Map<string, QuoteRow[]>> {
  const c = client as EvidenceClient
  const byAudience = new Map<string, QuoteRow[]>()
  // redacted = false: demographic_signal evidence cites but never quotes
  // (counts-not-quotes, 2026-08-22); its rows carry quote '' and must never
  // reach a picker.
  const rows = await fetchChunks<{ id: string; audience_insight_id: string; quote: string | null; relevance_rank: number | null }>(
    audienceIds,
    (chunk) => c.from('insight_evidence').select('id, audience_insight_id, quote, relevance_rank').in('audience_insight_id', chunk).eq('redacted', false),
  )
  for (const r of rows) {
    if (!r.quote) continue
    const arr = byAudience.get(r.audience_insight_id) ?? []
    arr.push({ quote: r.quote, rank: r.relevance_rank ?? 99, evidenceId: r.id })
    byAudience.set(r.audience_insight_id, arr)
  }
  return byAudience
}

/** As fetchQuotesByAudience, but carrying the CITATION ids the Verbatim Agent
 *  needs: a quote it shows must be traceable to a real comment on a real video.
 *
 *  A separate function rather than widening the one above, because the pages
 *  that call that one want a bare string to render and nothing else — but it
 *  lives here, beside it, so the `redacted = false` rule stays in one file. If
 *  that filter is ever changed, it must be changed in both. */
export async function fetchQuoteCitationsByAudience(
  client: unknown,
  audienceIds: string[],
): Promise<Map<string, QuoteCitation[]>> {
  const c = client as EvidenceClient
  const byAudience = new Map<string, QuoteCitation[]>()
  // redacted = false: demographic_signal evidence cites but never quotes
  // (counts-not-quotes, 2026-08-22). Same rule as fetchQuotesByAudience.
  const rows = await fetchChunks<{
    id: string
    audience_insight_id: string
    quote: string | null
    relevance_rank: number | null
    comment_id: string | null
    source_video_id: string | null
  }>(
    audienceIds,
    (chunk) => c.from('insight_evidence').select('id, audience_insight_id, quote, relevance_rank, comment_id, source_video_id').in('audience_insight_id', chunk).eq('redacted', false),
  )
  for (const r of rows) {
    if (!r.quote) continue
    // A quote with neither a comment nor a video behind it cannot be cited,
    // and an uncitable quote is exactly what the grounded register must not
    // carry. Drop it here rather than let it reach the enforcement step.
    if (!r.comment_id && !r.source_video_id) continue
    const arr = byAudience.get(r.audience_insight_id) ?? []
    arr.push({
      quote: r.quote,
      rank: r.relevance_rank ?? 99,
      evidenceId: r.id,
      commentId: r.comment_id,
      videoId: r.source_video_id,
    })
    byAudience.set(r.audience_insight_id, arr)
  }
  return byAudience
}

/** Resolve quote TEXT for a set of comment ids, through insight_evidence.
 *
 *  Deliberately NOT through `comments`: insight_evidence is where the
 *  redacted=false rule lives, and it is what erase-commenter deletes. Reading
 *  the words back through it means an erased comment stops resolving
 *  everywhere at once — which is the property that lets a stored answer carry
 *  ids instead of words. Reading `comments` directly would resolve text the
 *  erasure sweep had already dealt with.
 *
 *  Unresolvable ids are simply absent from the map; the caller drops them. */
export async function fetchQuoteTextsByCommentId(
  client: unknown,
  commentIds: string[],
): Promise<Map<string, string>> {
  const c = client as EvidenceClient
  const out = new Map<string, string>()
  const unique = [...new Set(commentIds.filter(Boolean))]
  const rows = await fetchChunks<{ comment_id: string | null; quote: string | null }>(
    unique,
    (chunk) => c.from('insight_evidence').select('comment_id, quote').in('comment_id', chunk).eq('redacted', false),
  )
  for (const r of rows) {
    if (r.comment_id && r.quote && !out.has(r.comment_id)) out.set(r.comment_id, r.quote)
  }
  return out
}

const HERO_TABLES = new Set(['recommendations', 'market_insights', 'competitive_insights', 'account_events'])

/** Resolve quote TEXT for snapshot refs — 'e:<insight_evidence.id>',
 *  'c:<comments.id>', 'v:<videos.id>', 'h:<table>:<row id>'
 *  (lib/renderables/quotes-freeze.ts). Same rule and same reason as
 *  fetchQuoteTextsByCommentId: through insight_evidence, redacted = false, so
 *  a stored export re-renders without any voice the erasure sweep has removed.
 *  Hero refs read the row's hero_quote, which that sweep nulls by string
 *  match. Refs that do not resolve are absent from the map and the resolver
 *  drops them. */
export async function fetchQuoteTextsByRefs(
  client: unknown,
  refs: string[],
): Promise<Map<string, string>> {
  const c = client as EvidenceClient
  const out = new Map<string, string>()
  const by = { e: [] as string[], c: [] as string[], v: [] as string[], m: [] as string[], p: [] as string[] }
  const heroes = new Map<string, string[]>()
  const brandVoice = new Map<string, number[]>()
  for (const ref of new Set(refs)) {
    const h = /^h:([a-z_]+):(.+)$/.exec(ref)
    if (h) {
      if (HERO_TABLES.has(h[1])) heroes.set(h[1], [...(heroes.get(h[1]) ?? []), h[2]])
      continue
    }
    const b = /^b:([^:]+):(\d+)$/.exec(ref)
    if (b) {
      brandVoice.set(b[1], [...(brandVoice.get(b[1]) ?? []), Number(b[2])])
      continue
    }
    const m = /^([ecvmp]):(.+)$/.exec(ref)
    if (m) by[m[1] as 'e' | 'c' | 'v' | 'm' | 'p'].push(m[2])
  }
  const heroReads = [...heroes.entries()].map(async ([table, ids]) => {
    const rows = await fetchChunks<{ id: string; hero_quote: string | null }>(
      ids,
      (chunk) => c.from(table).select('id, hero_quote').in('id', chunk) as unknown as Rows,
    )
    for (const r of rows) if (r.hero_quote) out.set(`h:${table}:${r.id}`, cleanQuote(r.hero_quote))
  })
  // "Said about you" claims quoted from videos: run_summary.brand_voice.about[n].
  const brandVoiceRead = brandVoice.size
    ? (async () => {
        const rows = await fetchChunks<{ run_id: string; brand_voice: { about?: { quote?: string | null }[] } | null }>(
          [...brandVoice.keys()],
          (chunk) => c.from('run_summary').select('run_id, brand_voice').in('run_id', chunk) as unknown as Rows,
        )
        for (const r of rows) {
          for (const n of brandVoice.get(r.run_id) ?? []) {
            const q = r.brand_voice?.about?.[n]?.quote
            if (q) out.set(`b:${r.run_id}:${n}`, cleanQuote(q))
          }
        }
      })()
    : Promise.resolve()
  // m: the comment as posted — read from `comments`, but only for ids an
  // evidence row still cites (redacted = false), so the sweep's deletion and
  // the counts-not-quotes rule reach it exactly as they reach the excerpt.
  const messageRead = by.m.length
    ? (async () => {
        const cited = await fetchChunks<{ comment_id: string | null }>(
          by.m,
          (chunk) => c.from('insight_evidence').select('comment_id').in('comment_id', chunk).eq('redacted', false),
        )
        const ok = new Set(cited.map((r) => r.comment_id).filter((id): id is string => !!id))
        const rows = await fetchChunks<{ id: string; text: string | null }>(
          [...ok],
          (chunk) => c.from('comments').select('id, text').in('id', chunk) as unknown as Rows,
        )
        for (const r of rows) if (r.text) out.set(`m:${r.id}`, cleanQuote(r.text))
      })()
    : Promise.resolve()
  // p: a customer phrase — language_samples by id (cascade-deleted with its comment).
  const phraseRead = by.p.length
    ? (async () => {
        const rows = await fetchChunks<{ id: string; phrase: string | null }>(
          by.p,
          (chunk) => c.from('language_samples').select('id, phrase').in('id', chunk) as unknown as Rows,
        )
        for (const r of rows) if (r.phrase) out.set(`p:${r.id}`, r.phrase)
      })()
    : Promise.resolve()
  const [byId, byComment, byVideo] = await Promise.all([
    fetchChunks<{ id: string; quote: string | null }>(
      by.e,
      (chunk) => c.from('insight_evidence').select('id, quote').in('id', chunk).eq('redacted', false),
    ),
    fetchChunks<{ comment_id: string | null; quote: string | null }>(
      by.c,
      (chunk) => c.from('insight_evidence').select('comment_id, quote').in('comment_id', chunk).eq('redacted', false),
    ),
    fetchChunks<{ source_video_id: string | null; quote: string | null }>(
      by.v,
      (chunk) => c.from('insight_evidence').select('source_video_id, quote').in('source_video_id', chunk).eq('redacted', false),
    ),
  ])
  await Promise.all([...heroReads, brandVoiceRead, messageRead, phraseRead])
  for (const r of byId) if (r.quote && !out.has(`e:${r.id}`)) out.set(`e:${r.id}`, r.quote)
  for (const r of byComment) if (r.comment_id && r.quote && !out.has(`c:${r.comment_id}`)) out.set(`c:${r.comment_id}`, r.quote)
  for (const r of byVideo) if (r.source_video_id && r.quote && !out.has(`v:${r.source_video_id}`)) out.set(`v:${r.source_video_id}`, r.quote)
  return out
}

/** Insight fields for a SET OF IDS, chunked to stay under the PostgREST URL cap.
 *  Reads the BASE table, never `audience_insights_current`: ids stored by the
 *  run a page is displaying must still resolve while a NEWER run has superseded
 *  those videos' rows but not yet pruned them, and after a failed run whose
 *  Pass A moved pointers its themes never used (incremental Pass A, 2026-08-17).
 *  Population reads ("all current insights") use the view instead. */
export async function fetchInsightsByIds<T>(client: unknown, ids: string[], select: string): Promise<T[]> {
  const c = client as EvidenceClient
  const unique = [...new Set(ids)]
  return fetchChunks<T>(unique, (chunk) => c.from('audience_insights').select(select).in('id', chunk))
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

/** A quote the spine can freeze: the words plus the ref they resolve through. */
export interface CitedQuote {
  ref: string
  text: string
}

/** As createQuotePicker, returning CITED quotes — { ref: 'e:<evidence id>',
 *  text } — so a page loader's output can be frozen into a snapshot with the
 *  words stripped and resolved live at render. Same scoring, same cross-card
 *  de-duplication, same hero-quote lead; a hero quote carries no evidence id
 *  (it is a copy in the parent row), so it is cited by the parent row —
 *  `heroRef` — which the caller supplies (e.g. 'e:' + the evidence row that
 *  matched it, or nothing, in which case the hero quote is skipped here and
 *  the caller renders it from the row itself). */
export function createCitedQuotePicker(
  quotesByAudience: Map<string, QuoteRow[]>,
  themeSlugById: Map<string, string>,
) {
  const used = new Set<string>()

  return function pick(audienceIds: string[], n: number, claimText: string, heroQuote?: string | null): CitedQuote[] {
    const chosen: CitedQuote[] = []
    const localKeys = new Set<string>()
    const take = (raw: string, ref: string) => {
      const q = cleanQuote(raw)
      const key = q.toLowerCase()
      if (!q || used.has(key) || localKeys.has(key)) return
      localKeys.add(key)
      used.add(key)
      chosen.push({ ref, text: q })
    }

    // The model's hero quote leads when the pool can vouch for it — i.e. an
    // evidence row carries the same words. A hero quote with no evidence row
    // behind it cannot be frozen honestly, so it is left to the caller.
    if (heroQuote) {
      const want = cleanQuote(heroQuote).toLowerCase()
      let ref: string | null = null
      outer: for (const aid of audienceIds) {
        for (const row of quotesByAudience.get(aid) ?? []) {
          if (cleanQuote(row.quote).toLowerCase() === want) { ref = `e:${row.evidenceId}`; break outer }
        }
      }
      if (ref) take(heroQuote, ref)
    }
    if (chosen.length >= n) return chosen

    const keywords = keywordsOf(claimText)
    const cand: { q: string; ref: string; score: number; rank: number }[] = []
    for (const aid of audienceIds) {
      const themeBonus = themeRelevance(aid, keywords, themeSlugById) * 2
      for (const { quote, rank, evidenceId } of quotesByAudience.get(aid) ?? []) {
        const q = cleanQuote(quote)
        const key = q.toLowerCase()
        if (used.has(key) || localKeys.has(key)) continue
        const base = quoteScore(q, keywords)
        if (base <= 0) continue
        cand.push({ q, ref: `e:${evidenceId}`, score: base + themeBonus, rank })
      }
    }
    cand.sort((a, b) => b.score - a.score || a.rank - b.rank)
    for (const c of cand) {
      if (chosen.length >= n) break
      take(c.q, c.ref)
    }
    return chosen
  }
}
