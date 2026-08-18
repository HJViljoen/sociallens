import type { SupabaseClient } from '@supabase/supabase-js'
import { normForMatch } from './quote-match'

// hero_quote copies (Tier 1.5, 2026-08-22). Four tables carry a verbatim comment
// excerpt with NO foreign key back to `comments`: recommendations,
// market_insights, competitive_insights (Pass D-b picks them) and account_events
// (owned-events). Deleting or erasing a comment therefore leaves its words
// standing in those columns. Both the retention refresh (a YouTube comment the
// API no longer serves) and scripts/erase-commenter.ts sweep them with the
// same containment rule the pipeline uses for grounding.

export const HERO_QUOTE_TABLES = ['recommendations', 'market_insights', 'competitive_insights', 'account_events'] as const
export type HeroQuoteTable = (typeof HERO_QUOTE_TABLES)[number]

export interface HeroQuoteRow { table: HeroQuoteTable; id: string; hero_quote: string | null }

/** Rows whose hero_quote appears (normalised) inside any of the given texts. */
export function matchHeroQuotes(rows: HeroQuoteRow[], texts: string[]): { table: HeroQuoteTable; id: string }[] {
  const hays = texts.map((t) => normForMatch(t)).filter((t) => t.length > 0)
  if (!hays.length) return []
  const out: { table: HeroQuoteTable; id: string }[] = []
  for (const r of rows) {
    if (!r.hero_quote) continue
    const needle = normForMatch(r.hero_quote)
    if (!needle.length) continue
    if (hays.some((h) => h.includes(needle))) out.push({ table: r.table, id: r.id })
  }
  return out
}

// ---- I/O glue ---------------------------------------------------------------

/** Non-null hero quotes for a set of clients across the four tables. */
export async function loadHeroQuotes(admin: SupabaseClient, clientIds: string[]): Promise<HeroQuoteRow[]> {
  if (!clientIds.length) return []
  const out: HeroQuoteRow[] = []
  for (const table of HERO_QUOTE_TABLES) {
    const { data, error } = await admin.from(table).select('id, hero_quote').in('client_id', clientIds).not('hero_quote', 'is', null)
    if (error) throw new Error(`load hero_quote ${table}: ${error.message}`)
    for (const r of (data ?? []) as { id: string; hero_quote: string | null }[]) out.push({ table, id: r.id, hero_quote: r.hero_quote })
  }
  return out
}

/** Null the matched hero quotes. Returns the count. */
export async function nullHeroQuotes(admin: SupabaseClient, matches: { table: HeroQuoteTable; id: string }[]): Promise<number> {
  let n = 0
  for (const table of HERO_QUOTE_TABLES) {
    const ids = matches.filter((m) => m.table === table).map((m) => m.id)
    for (let i = 0; i < ids.length; i += 200) {
      const chunk = ids.slice(i, i + 200)
      const { error } = await admin.from(table).update({ hero_quote: null }).in('id', chunk)
      if (error) throw new Error(`null hero_quote ${table}: ${error.message}`)
      n += chunk.length
    }
  }
  return n
}
