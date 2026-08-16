import type { SubredditEntry } from './types'

// Subreddit bookkeeping — pure helpers over tracking_configs.subreddits.
//
// Reddit names arrive in four shapes depending on where they came from: the
// actor returns `communityName` already prefixed ('r/Prosthetics'), GPT proposes
// bare names in whatever case it likes, humans paste full URLs, and Reddit
// itself is case-insensitive. Everything is keyed on ONE canonical form so the
// ROI join (videos.account_name → subreddit) can't silently miss.

/** Canonical key for a subreddit: bare, lowercase, no prefix, no URL.
 *  'https://www.reddit.com/r/Prosthetics/' · 'r/Prosthetics' · 'Prosthetics'
 *  all collapse to 'prosthetics'. Returns '' for anything unusable. */
export function subredditKey(raw: string): string {
  const s = (raw ?? '').trim()
  if (!s) return ''
  // Pull the name out of a URL if that's what we were handed.
  const fromUrl = s.match(/reddit\.com\/r\/([^/?#\s]+)/i)?.[1]
  const bare = (fromUrl ?? s).replace(/^\/?r\//i, '').replace(/\/+$/, '').trim()
  // A user profile is not a community — the search returns those too, and
  // counting them as subreddits would corrupt per-subreddit ROI. Reddit exposes
  // them in TWO forms: 'u/spez' in URLs and display, and 'u_spez' as the actual
  // subreddit name in API/actor output. The underscore form is the one that
  // reaches us, so matching only 'u/' would miss every real case.
  if (!bare || /^u\//i.test(s.replace(/^\//, '')) || /^u_/i.test(bare)) return ''
  return /^[A-Za-z0-9_]{2,21}$/.test(bare) ? bare.toLowerCase() : ''
}

/** Display form for copy and operator output. */
export const subredditLabel = (name: string): string => `r/${name}`

/** The subreddits a run should actually search. */
export function activeSubreddits(entries: SubredditEntry[]): string[] {
  return entries.filter((e) => e.status === 'active').map((e) => e.name)
}

/** Names already known to the tenant in ANY state — including rejected ones, so
 *  a proposal step doesn't keep re-suggesting a community the probe already
 *  threw out. */
export function knownSubreddits(entries: SubredditEntry[]): Set<string> {
  return new Set(entries.map((e) => subredditKey(e.name)).filter(Boolean))
}

/** Parse whatever is in the jsonb column into typed entries, dropping anything
 *  malformed. The column is schemaless, so this is the one place that decides
 *  what a valid entry is. */
export function parseSubreddits(raw: unknown): SubredditEntry[] {
  if (!Array.isArray(raw)) return []
  const out: SubredditEntry[] = []
  const seen = new Set<string>()
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const r = item as Record<string, unknown>
    const name = subredditKey(String(r.name ?? ''))
    if (!name || seen.has(name)) continue
    const status = r.status === 'active' || r.status === 'rejected' ? r.status : 'candidate'
    seen.add(name)
    out.push({
      name,
      status,
      discovered_at: typeof r.discovered_at === 'string' ? r.discovered_at : '',
      ...(r.probe && typeof r.probe === 'object' ? { probe: r.probe as SubredditEntry['probe'] } : {}),
      ...(typeof r.strikes === 'number' && r.strikes > 0 ? { strikes: r.strikes } : {}),
    })
  }
  return out
}

// ---- Dead-community detection (Wave 3) --------------------------------------
//
// An active community stays active forever unless something demotes it. Real
// subreddits go private, get banned, or drift off-topic — and when one does, its
// harvest yields nothing EVERY run: the run closes 'partial' every week, no
// replacement is ever proposed (discovery has converged), and there is no
// operator surface to fix it.
//
// The hard part is that "this community died" and "our scraper broke" look
// identical from here. If the Apify actor breaks or Reddit changes, every
// community returns nothing at once — and a naive rule would demote all of them
// in a single run and wipe the tenant's config. So a community is only ever
// struck when its failure is COMMUNITY-SPECIFIC: some other Reddit source (a
// keyword search or another community) produced results in the same run, which
// is the evidence that our side of the pipe works.

/** Per-source gate survivors for one run, keyed exactly as keyword_performance
 *  stores them — a community harvest appears as 'r/amputee', a keyword as
 *  'ossur'. Null when the tenant has no Reddit gather history yet. */
export type RedditYields = Map<string, number>

export interface StrikeOutcome {
  entries: SubredditEntry[]
  /** Communities demoted to 'candidate' this pass, for logging. */
  demoted: string[]
  /** Communities that earned a strike but survived it. */
  struck: string[]
}

/**
 * Apply one run's yields to a tenant's communities.
 *
 * A demoted community becomes a CANDIDATE, not a rejection. Candidates are
 * re-probed first by discoverSubreddits, so the same judgment that promoted it
 * decides its real fate: genuinely dead means an empty sample and a proper
 * rejection, while a community that was merely having a bad month goes straight
 * back to active. Marking it 'rejected' here would be permanent — rejects are
 * never re-proposed — so one bad patch would lose a good community for good.
 *
 * Demotion also drops the active count, which un-converges discovery, so a
 * replacement gets proposed on the next run with no extra machinery.
 *
 * Pure.
 */
export function applyStrikes(
  entries: SubredditEntry[],
  yields: RedditYields | null,
  limit: number,
): StrikeOutcome {
  const demoted: string[] = []
  const struck: string[] = []
  if (!yields || yields.size === 0) return { entries, demoted, struck }

  const next = entries.map((e) => {
    if (e.status !== 'active') return e
    const own = yields.get(subredditLabel(e.name))
    if ((own ?? 0) > 0) {
      // Productive run — clear any history. A community must fail CONSECUTIVELY.
      return e.strikes ? { ...e, strikes: 0 } : e
    }
    // Barren. Only meaningful if something else on Reddit worked this run;
    // otherwise this is our infrastructure and nobody deserves a strike.
    const siblingWorked = [...yields.entries()].some(
      ([key, survived]) => key !== subredditLabel(e.name) && survived > 0,
    )
    if (!siblingWorked) return e

    const strikes = (e.strikes ?? 0) + 1
    if (strikes >= limit) {
      demoted.push(e.name)
      return { ...e, status: 'candidate' as const, strikes: 0 }
    }
    struck.push(e.name)
    return { ...e, strikes }
  })

  return { entries: next, demoted, struck }
}
