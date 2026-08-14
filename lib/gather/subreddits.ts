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
  // A user profile ('u/someone') is not a community — the search returns those
  // too, and counting them as subreddits would corrupt per-subreddit ROI.
  if (!bare || /^u\//i.test(s.replace(/^\//, ''))) return ''
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
    })
  }
  return out
}
