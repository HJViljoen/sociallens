// Semantic colour helpers for the data pages.
// The class strings are written out in full (never interpolated) so Tailwind v4
// detects them and generates the utilities. Tokens live in app/globals.css.
//
// 2026-08-28 (MASTER.md §Visual identity rule 2): chrome is grey-scale and colour
// means something. Category chips therefore carry NO hue — they are grey text
// labels; hue is reserved for buckets (you / competitor / category) and valence.

/** Category chip — one grey style for every category (was a hashed multi-hue set). */
export const ACCENT_TINTS = ['bg-inner text-muted-foreground'] as const

const wrap = (i: number, len: number) => ((i % len) + len) % len

/** Stable index for a named category — kept so callers' signatures don't change. */
function hashIndex(key: string, len: number): number {
  let h = 0
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0
  return wrap(h, len)
}

/** Chip classes for a named category — grey, identical for every label. */
export const categoryTint = (key: string) => ACCENT_TINTS[hashIndex(key, ACCENT_TINTS.length)]

/** Semantic status → soft badge (positive / neutral / mixed / negative). Data only. */
export const SENTIMENT_BADGE: Record<string, string> = {
  positive: 'bg-accent text-accent-foreground',
  neutral: 'bg-inner text-muted-foreground',
  mixed: 'bg-warning/15 text-warning',
  negative: 'bg-negative/12 text-negative',
}

/** Prevalence tier → soft badge (tier assigned by lib/calibration.ts, never the model). */
export const PREVALENCE_BADGE: Record<string, string> = {
  dominant: 'bg-accent text-accent-foreground',
  widespread: 'bg-accent text-accent-foreground',
  recurring: 'bg-inner text-muted-foreground',
  early_signal: 'bg-warning/15 text-warning',
}
