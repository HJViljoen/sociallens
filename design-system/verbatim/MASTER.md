# Design System Master File

> **LOGIC:** When building a specific page, first check `design-system/verbatim/pages/[page-name].md`.
> If that file exists, its rules **override** this Master file.
> If not, strictly follow the rules below.

---

**Project:** Verbatim
**System:** the "green refresh" (live since June 2026)
**Updated:** 2026-07-03 — replaces the stale April blue/amber system, which was never what shipped.
**Source of truth:** `app/globals.css` (tokens) + `lib/ui-colors.ts` (accent/status helpers). This file describes them; if they disagree, the code wins.

---

## Character

Warm editorial intelligence, not SaaS-dashboard chrome. Cream paper canvas, deep-green ink,
glass cards floating over a faint crowd illustration (the voices behind the data). No neon,
no pure white, no pure black. The product expresses judgment — chips and prose, never raw
scores (Redesign Spec §1).

**Primary viewport: laptop/desktop.** Clients read this on laptops; design desktop-first.
Mobile must work but is the secondary pass.

## Color Palette

All tokens are CSS variables in `app/globals.css`, mapped to Tailwind utilities via `@theme inline`
(e.g. `--accent-pine` → `bg-pine`, `text-pine`). Light theme:

| Role | Hex | Token / utility |
|------|-----|-----------------|
| Canvas | `#F6F1E7` warm cream | `--background` |
| Ink | `#14291F` deep green-black | `--foreground` |
| Card | `rgba(253,250,244,0.78)` glass | `--card` + `backdrop-blur-xl` |
| Primary | `#14503A` pine | `--primary`, links/CTAs |
| Primary text on green | `#F7F3EA` cream | `--primary-foreground` |
| Muted surface | `#ECE7DA` | `--muted` |
| Border | `#E4DCCC` warm sand | `--border` |

**Semantic status** (warm, no neon): positive `#1B6144` · warning/amber `#B9822B` · negative/destructive `#B4472F`.

**Category accents** — muted & earthy, for category identity only (chips, dots), cycled/hashed via
`lib/ui-colors.ts` (`categoryTint`, `categorySolid`): pine `#2E7D6F` · clay `#C4633F` · ochre `#C99A3B`
· plum `#8A5A7A` · slate `#4E6E9E`.

**Chart greens** — deep → pale, for data viz: `#0F3B2B` · `#2E8B5E` · `#7C9A6B` · `#A8B98C` · `#4B6B4A`
(`--chart-1…5`; `greenForPct()` maps 0–100 values onto them).

A full dark theme exists (`.dark` block); every new surface must read in both.

## Typography

- **Sans + headings:** Plus Jakarta Sans (`--font-jakarta`, loaded via next/font)
- **Mono:** JetBrains Mono (`--font-jetbrains`) — data/ids only
- Page title: `text-2xl font-bold`. Section headings: `text-sm font-semibold uppercase tracking-wide text-muted-foreground`, optionally with a normal-case hint suffix.

## Shape & Elevation

- Radius base `--radius: 0.3rem` (the value in `app/globals.css`, which is the
  source of truth); chips/pills `rounded-full`. This doc drifted to `1rem` and
  was corrected 2026-08-18 — when the two disagree, the stylesheet wins.
- Card shadow (shared with the floating sidebar): `0 2px 6px -2px rgba(18,42,31,0.10), 0 18px 40px -16px rgba(18,42,31,0.32)` + `ring-1 ring-border/70`.

## Signature components

- **`.stat-hero`** — filled deep-green hero card: diagonal gradient `#1A5C43 → #113E2C` with a soft
  top-right radial sheen, cream text `#F5F1E6`. The page's single strongest element — use sparingly.
- **`.crowd-bg`** — ambient crowd illustration behind the app shell, opacity 0.16, masked to fade up.
  Position `absolute` inside the shell, never `fixed` (mobile toolbar drift).
- **Chips** — `px-2 py-0.5 rounded-full text-xs font-medium`; category chips use `categoryTint(key)`,
  levels use `levelBadge()` (high = amber, rest muted), sentiment uses `SENTIMENT_BADGE`,
  evidence tiers show "Strong evidence" (positive tint) / "Early signal" (warning tint) — never numeric scores.
- **Voice links** — pill outline in primary: `text-primary ring-1 ring-primary/25 hover:bg-primary/5`.

## One-screen grid pages (2026-08-22 redesign — Dashboard first)

The redesign spec is `docs/redesign-2026-08/README.md` (+ the approved canvas linked there). Grid pages are
built from `components/shell/` and `components/charts/`, not from `Card`:

- **Density tokens:** body `13px / 1.45` (rem stays 16px, so spacing utilities are unchanged). Tile surface
  `--tile: #FDFAF3` → `bg-tile` (solid; no backdrop-blur behind a dense grid). `Card` keeps the glass look on
  pages that haven't moved yet.
- **Frame:** `PageFrame` (flex column, `h = max(100dvh − 6rem, 776px)` on ≥xl) → `PageBar` (title · context ·
  right controls · How-to-read) → `PageGrid` (12 cols × 6 equal rows on ≥xl, one screen at 1440×900; single
  stacked column below xl). A 1280×800 laptop scrolls ~70px by design rather than crushing tiles.
- **Tile** (`col`, `row` spans; `variant` default | hero (`.stat-hero`) | warm (clay ring, for the top
  recommendation) | strip): eyebrow 10.5px caps + meta 11px · body · footer (link deeper, left; quiet note,
  right). Tiles clamp their own content (`overflow-hidden`, `min-h-0`); long lists scroll or truncate inside.
  `StripCell` = one counted receipt; `TileEmpty` = the honest one-line empty state — a tile keeps its size.
- **Drawer:** `DetailDrawer` (client, on `ui/sheet`, right, ~480px) is the universal one-click-deeper surface,
  URL-driven like `DetailOverlay` (`?detail=<id>`; closing navigates to `closeHref`). Pages stay server
  components; only the drawer shell is client code.
- **Charts** (server SVG, no libraries): `Sparkline`, `StatValue` (mono 24/30/18, tabular) + `Delta`
  (favourability-coloured, `good: up|down|neutral`), `RankedBar` (dot · label · bar · count; bar colour follows
  the entity, never the rank), `Mover` (label · spark · value · delta), `LineChart` (end labels, no legend box
  for ≤4 series), `Ring` (the ONE circle allowed: share of something, ≤4 slices, your number in the centre),
  `PlatformIcon`. `ProportionBar`/`BarLegend` stay for splits.
- **Colour jobs on tiles:** you / positive = green (`--positive`, `--primary`); wider category = slate; a
  competitor = clay (first), ochre, plum, slate; rest-of-field = `--input` sand; mixed / early = warning gold;
  the verbatim rule stays the signature (clay/primary left rule).
- **Numbers:** counts of real voices, videos, themes and shares are shown big and in mono; model confidence is
  never a number. Formatters in `lib/format.ts` are hydration-safe (UTC dates, hand-rolled separators).

## Rules

1. Write Tailwind class strings out in full — never interpolated — so v4 detects them (see `lib/ui-colors.ts` header).
2. Client-facing language ban list applies to all UI copy (Redesign Spec §1): no *run, pass, gather, scraped, pipeline, corpus, run id*.
3. Charts are server-rendered (divs/SVG) with the chart-green range or category accents — no chart libraries, no client JS for static data.
4. shadcn/ui components in `components/ui/` are the base layer; extend, don't fork.

## Anti-patterns

- ❌ Emojis as icons (use Lucide SVGs)
- ❌ Raw confidence/opportunity scores in client-facing UI
- ❌ Layout-shifting hovers; instant state changes (use 150–300ms transitions)
- ❌ Low-contrast text (4.5:1 minimum) or invisible focus states
- ❌ Cool grays, pure white surfaces, neon accents — everything stays warm

## Pre-delivery checklist

- [ ] Reads correctly in light AND dark themes
- [ ] Desktop-first layout verified at 1280–1440px, then mobile at 375px (no horizontal scroll)
- [ ] Empty states in client language, no pipeline jargon
- [ ] `cursor-pointer` + visible focus states on interactive elements
