/**
 * Tenant config derivation (Tier 0 T0-7, 2026-08-18).
 *
 * Onboarding wrote brand_keywords, competitor_names, industry_keywords and
 * platforms, and never competitor_keywords. But gather searches from
 * competitor_KEYWORDS (lib/gather/gather.ts) while tagging matches on
 * competitor_NAMES (lib/gather/tagging.ts), so a self-serve tenant would gather
 * nothing about its competitors, forever, silently. Every real tenant was
 * hand-seeded, which is why nobody noticed.
 *
 * Pure so the same rule runs at signup and at every settings save.
 */

/** Names too generic to search on their own: a one-word brand that is also an
 *  ordinary noun drags in the whole internet (the Poler → pole dancing and
 *  Patagonia → the region lesson, which cost 331 of 602 videos on Sealand's
 *  first run). They stay in competitor_names for tagging; they just do not
 *  become search terms until an operator says so. */
const MIN_KEYWORD_CHARS = 4

export function deriveCompetitorKeywords(competitorNames: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of competitorNames) {
    const name = raw.trim().replace(/\s+/g, ' ')
    if (name.length < MIN_KEYWORD_CHARS) continue
    const key = name.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(name)
  }
  return out.slice(0, 15) // matches the tracking_configs cardinality ceiling
}

/** Videos per keyword search for a new tenant. The column default is 10, which
 *  is a demo-sized corpus: the analysis floors (>= 5 comments per video, >= 2
 *  videos per theme) leave almost nothing standing. Real tenants run 50-70. */
export const ONBOARDING_MAX_VIDEOS = 30
