/**
 * The email's palette and type (Reports & Exports Stage 3, 2026-08-30).
 *
 * Email clients read no stylesheet and no CSS variable, so the app tokens
 * (app/globals.css :root, identity of 2026-08-28) are mirrored here as literal
 * hex — the same constants the interim weekly email carried. Chrome is
 * grey-scale; one green does its four jobs (you, the button, links as
 * actions, "good"); competitor orange and category grey mean what they mean
 * on the dashboard. Web-safe stacks behind Plex: most clients never load a
 * web font, and the fallback has to read as the same page.
 */

export const EMAIL = {
  green: '#0E8A5F',
  greenTint: '#DDF3E9',
  link: '#0B6E4C',
  canvas: '#F6F7F8',
  card: '#FFFFFF',
  inner: '#F6F7F8',
  ink: '#26292C',
  ink2: '#45494D',
  muted: '#6E7378',
  faint: '#9AA0A6',
  border: '#DCDFE3',
  hairline: '#EBEDF0',
  up: '#0E8A5F',
  down: '#DB3B2E',
  downTint: '#FBE3E1',
  comp: '#F0742B',
  cat: '#9AA1A9',
  mixed: '#E6B03C',
  neutralSeg: '#CDD2D7',
} as const

export type EmailTheme = typeof EMAIL

export const FONT = {
  sans: "'IBM Plex Sans',-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif",
  serif: "'IBM Plex Serif',Georgia,'Times New Roman',serif",
  mono: "'IBM Plex Mono',SFMono-Regular,Menlo,Consolas,monospace",
} as const

/** The tiles hand their charts token strings (`var(--you)`, a Tailwind class,
 *  a color-mix); the email needs the hex. Unknown → the muted grey, so a new
 *  token can never paint an email black. */
const TOKEN_HEX: Record<string, string> = {
  'var(--you)': EMAIL.green,
  'var(--primary)': EMAIL.green,
  'var(--positive)': EMAIL.green,
  'var(--comp)': EMAIL.comp,
  'var(--cat)': EMAIL.cat,
  'var(--mixed)': EMAIL.mixed,
  'var(--warning)': EMAIL.mixed,
  'var(--negative)': EMAIL.down,
  'var(--neutral-seg)': EMAIL.neutralSeg,
  'var(--muted-foreground)': EMAIL.muted,
  'var(--foreground)': EMAIL.ink,
  'color-mix(in srgb, var(--comp) 70%, var(--tile))': '#F59E6B',
  'color-mix(in srgb, var(--comp) 48%, var(--tile))': '#F8BC99',
  'bg-positive': EMAIL.green,
  'bg-you': EMAIL.green,
  'bg-comp': EMAIL.comp,
  'bg-cat': EMAIL.cat,
  'bg-negative': EMAIL.down,
  'bg-mixed': EMAIL.mixed,
  'bg-warning': EMAIL.mixed,
  'bg-neutral-seg': EMAIL.neutralSeg,
  'bg-chart-1': EMAIL.ink,
  'bg-chart-2': EMAIL.green,
  'bg-chart-3': EMAIL.muted,
  'bg-chart-4': EMAIL.cat,
  'bg-chart-5': EMAIL.neutralSeg,
}

export function tokenHex(color: string | null | undefined): string {
  if (!color) return EMAIL.muted
  if (/^#[0-9a-f]{3,8}$/i.test(color)) return color
  return TOKEN_HEX[color.trim()] ?? EMAIL.muted
}
