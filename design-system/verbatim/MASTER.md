# Design System Master File

> **LOGIC:** When building a specific page, first check `design-system/verbatim/pages/[page-name].md`.
> If that file exists, its rules **override** this Master file.
> If not, strictly follow the rules below.

---

**Project:** Verbatim
**System:** the "green refresh" (live since June 2026)
**Updated:** 2026-08-28 — new visual-identity target added (see first section); 2026-07-03 replaced the stale April blue/amber system.
**Source of truth:** `app/globals.css` (tokens) + `lib/ui-colors.ts` (accent/status helpers). This file describes them; if they disagree, the code wins.

---

## Visual identity — 2026-08-28 direction (APPROVED on the Dashboard mock · the target for the refresh)

> **Status:** approved by Heinrich on 2026-08-28 after four mock rounds. **Not yet in code** — `app/globals.css`
> still runs the 2026-07 green refresh until the refresh ships. Where this section and the sections below
> disagree, **this section is the target**; the sections below describe the code as it is today.
> Mock (open in a browser; click an underlined claim): `docs/redesign-2026-08/mock-dashboard-2026-08-28.html`.
> Reasoning + research: vault `Decisions/Log` 2026-08-28 (evening).

### Why
Cream `#F6F1E7` + pine `#14503A` + serif display is the recognised AI-default look ("cluster 1"; Chayka, Nielsen,
Unslop all name it). Banning colours only re-samples the next default — a tell is an *unspecified* default — so
this is a positive spec: grey-scale chrome, colour reserved for meaning, and a green that is not the sage.

### Tokens (light theme — derive dark from these; every surface must read in both)

| Job | Hex | Notes |
|---|---|---|
| Canvas **and** tile | `#FFFFFF` | same white; depth comes from elevation, never tone |
| Elevation | `0 0 0 1px rgba(38,41,44,.04), 0 1px 3px rgba(38,41,44,.05), 0 0 16px rgba(38,41,44,.09)` | **ambient** (no offset, no negative spread) so all edges/corners read alike; sidebar uses the same |
| Ink | `#26292C` | charcoal — never black; no black blocks / dark heroes |
| Ink-2 / muted / faint | `#45494D` / `#6E7378` / `#9AA0A6` | cool greys |
| Hairline / hairline-2 | `#DCDFE3` / `#EBEDF0` | inside tiles only |
| **Verbatim green** | `#0E8A5F` | primary button · active-nav mark · "you" in every chart · "good" (positive sentiment, up-deltas, evidence chip). Mid-light, higher chroma, blue-leaning — the shift from the old pine is lightness + chroma, not just hue |
| Green tint | `#DDF3E9` | chips, hover fills only |
| Competitor | `#F0742B` | data only |
| Category / rest of field | `#9AA1A9` | data only |
| Mixed / early | `#E6B03C` | data only |
| Negative | `#DB3B2E` | data only |
| Neutral segment | `#CDD2D7` | data only |
| Retired | `#F6F1E7` cream · `#14503A` pine · `#FDFAF3` tile · all `--accent-*` bucket hues · glass/backdrop-blur | |

### Rules (decided, 2026-08-28)
1. **Chrome is grey-scale.** Green does exactly four jobs (above). Nothing else in the frame carries a hue.
2. **Colour = meaning, in data only.** You green · competitor orange · category grey; valence green / amber / red.
   Category chips are grey text labels — retire the hashed `ACCENT_TINTS` cycling in `lib/ui-colors.ts`.
   Accepted: "you" and "positive" share the green; where a chart needs them apart, positive drops to the tint.
3. **Depth by elevation, not tone or borders.** No 1px border on every card, no pill-everything; radius 6;
   `rounded-full` only on single-line pills (existing rule).
4. **Type — DECIDED 2026-08-28: IBM Plex Sans (UI) · IBM Plex Serif (verbatim quotes only — quotes are speech) ·
   IBM Plex Mono (counts, metadata; tabular figures).** One superfamily, so all three share the same bones.
   Google Fonts via `next/font` (replaces Plus Jakarta Sans + JetBrains Mono). Chosen by eye from three sets on
   the Dashboard tile (Schibsted/Source Serif/JetBrains · Plex · Manrope/Literata/DM Mono). No Inter, no display
   serifs. Marketing keeps its own `DESIGN.md` faces until it is migrated deliberately.
5. **Claims are clickable evidence** (the Agent page's document-review pattern): a sentence with voices behind it
   gets a quiet grey dotted underline; click → popover with count, platform split, two quotes, link to the page
   that holds the rest. **Nothing is underlined that cannot be clicked.** No highlighter fills, no coloured tints.
6. **The crowd art leaves the app shell.** Login and the Agent landing may keep it.
7. **Pages may scroll.** The 2026-08-22 "one screen, no scroll at 1440×900" rule is **retired** — it is no longer
   a constraint, not a new requirement. The 12-column grid, `Tile`, `PageGrid` and `Drawer` stay; the 6-row height
   cap goes. Whether a given page fits one screen or scrolls is a per-page judgment.
8. **No top bar.** The 48px `<header>` in `app/dashboard/layout.tsx` only ever held the mobile sidebar trigger
   (the drift fix was the `h-dvh` inner-scrolling `<main>`, not the bar). Remove it; move the trigger into the
   sidebar rail (desktop) / a floating control (mobile). With the crowd gone from the shell the inner-scroll pane
   is optional — keep it if the sidebar should stay put while content scrolls.
9. **Drift guards (mechanical, run before merge):** every neutral must have blue ≥ red in RGB (cream fails);
   the only green in `globals.css` is `#0E8A5F` and its tint; no `backdrop-blur` in the app.

### Preferences — things Heinrich likes and wants more of (2026-08-28). NOT rules: apply with judgment, page by page
> His words: "the things I say aren't always going to be a fit — just stuff that I liked and that I want more of."
> Use these as a direction to lean toward, and leave them out where they don't serve the page.

- **The brief in one line: the same amount of useful information as today, delivered cleaner.** Density is not
  the problem, noise is — clarity comes from grouping, alignment, one padding scale and open space, never from
  cutting information.
- **Blocks inside blocks.** He likes items as bounded inner blocks inside a tile (ShadcnStore Dashboard 2): the
  eye groups before it reads. Discipline: two levels only (tile with shadow → flat tinted inner block, no shadow
  or border), one padding scale, never a third level.
- **Spacing as a material.** Sites he admires use open space for emphasis; leaving an area open can look as good
  as putting something there. Ours tend to fill every tile to the edge. Lean toward more air — while the 08-23
  note that content shouldn't pack into a tile's top-left with a void below still applies where it applies.
- **"A page inside the page."** Tiles that do more than sit still: their own filters, tabs, sorting, a list that
  scrolls inside the tile. Use where a tile genuinely holds more than one view; don't bolt controls onto tiles
  that have one thing to say.
- **Hover that answers a question.** Exact values at the hovered point on a chart; a ring / proportion segment
  that expands and shows its %; buttons and rows that lighten on hover. Do it where the hover reveals something
  the static view can't show; skip decorative motion.

### Build sequence
Tokens in `globals.css` → rewrite the sections below to match → Dashboard (pattern proof, reviewed live) →
Market, Voice, Competitive, Content → Profile, Agent, Reports. Components from **21st.dev** (Heinrich's pick)
normalised onto one **tweakcn** token set; keep our SSR SVG charts and add a client hover layer.

---

## Character

Warm editorial intelligence, not SaaS-dashboard chrome. Cream paper canvas, deep-green ink,
glass cards floating over a faint crowd illustration (the voices behind the data). No neon,
no pure white, no pure black. The product expresses judgment — chips and prose, never raw
scores (Redesign Spec §1).

**Primary viewport: laptop/desktop.** Clients read this on laptops; design desktop-first.
Mobile must work but is the secondary pass.

## Color Palette

> **Current code.** Superseded as the *target* by §Visual identity — 2026-08-28 above.

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

> **2026-08-28:** the *no-scroll one-screen* rule is retired (§Visual identity rule 9). `PageGrid`/`Tile`/`Drawer` and the 12-column grid stay.

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
- **Rounding follows the content, not the box:** `rounded-full` ONLY on single-line pills (fixed height or
  `whitespace-nowrap`). Anything that can wrap — quotes, phrases, labels in a list — takes a fixed radius
  (`rounded-lg`/`rounded-[10px]`), otherwise a three-line chip renders as an oval (Heinrich, 2026-08-22).

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
