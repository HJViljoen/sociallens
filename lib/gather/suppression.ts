import type { SupabaseClient } from '@supabase/supabase-js'

// Commenter suppression (Tier 1.5, 2026-08-22). Erasure has to be durable:
// comments upsert on (client_id, platform, comment_id), so a handle erased on
// request would be re-inserted the next time its video is re-scraped (a delta
// re-check, or a fresh gather that surfaces the same video). The privacy notice
// promises "we will remove the comments tied to it" — this is what keeps them
// removed. Rows in suppressed_commenters are written by scripts/erase-commenter.ts
// and checked here at the single ingest choke point (gather.ts
// scrapeCommentsBatch, which every discovered and owned comment passes through).
//
// The pure half (authorKey, filterSuppressed) is unit-tested; the DB read is
// glue, like the rest of gather.

/** Normalised identity for a stored `author` value. Platforms store bare
 *  usernames (TikTok, Instagram, Reddit) or a display name that is usually
 *  '@handle' (YouTube's authorDisplayName); requesters write whatever they
 *  write. Lower-case, trim, collapse whitespace, strip ONE leading '@' and a
 *  Reddit 'u/' or '/u/' prefix. null/'' → null (never matches). */
export function authorKey(platform: string, author: string | null | undefined): string | null {
  if (author == null) return null
  let s = String(author).trim().toLowerCase().replace(/\s+/g, ' ')
  if (s.startsWith('@')) s = s.slice(1)
  if (platform === 'reddit') s = s.replace(/^\/?u\//, '')
  s = s.trim()
  return s.length ? s : null
}

/** The variants a requester's handle could be stored as, for exact-match
 *  lookups that must not depend on the normalisation above (e.g. the demo
 *  tenant's deterministic pseudonym is sha256 of the EXACT stored string). */
export function handleVariants(handle: string): string[] {
  const raw = handle.trim()
  const bare = raw.startsWith('@') ? raw.slice(1) : raw
  const out = new Set<string>([raw, bare, `@${bare}`, bare.toLowerCase(), `@${bare.toLowerCase()}`])
  return [...out].filter((v) => v.length > 0)
}

export function filterSuppressed<T extends { author: string | null }>(
  rows: T[],
  keys: ReadonlySet<string>,
  platform: string,
): { kept: T[]; suppressed: number } {
  if (keys.size === 0) return { kept: rows, suppressed: 0 }
  const kept: T[] = []
  let suppressed = 0
  for (const r of rows) {
    const k = authorKey(platform, r.author)
    if (k && keys.has(k)) suppressed++
    else kept.push(r)
  }
  return { kept, suppressed }
}

// ---- I/O glue ---------------------------------------------------------------

/** All suppressed keys for one platform. Best-effort: a read failure logs and
 *  suppresses nothing rather than failing the gather — the erasure script's
 *  own delete already removed the rows that existed. */
export async function loadSuppressedKeys(admin: SupabaseClient, platform: string): Promise<Set<string>> {
  const { data, error } = await admin.from('suppressed_commenters').select('author_key').eq('platform', platform)
  if (error) {
    console.warn(`[suppression] could not load keys for ${platform}: ${error.message}`)
    return new Set()
  }
  const rows = (data ?? []) as { author_key: string }[]
  return new Set(rows.map((r) => r.author_key))
}
