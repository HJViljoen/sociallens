# Verbatim — Design System (marketing surfaces)

> The design contract for `verbatimintel.com` (`app/site/*`). Consult BEFORE
> styling anything on the marketing site. The app (`app.verbatimintel.com`)
> runs its own identity (`design-system/verbatim/MASTER.md`); the two share the
> Verbatim green and the charcoal ink and deliberately nothing else. Rewritten
> 2026-09-06 for the site that replaced the August "Annotated transcript" page.

## Direction — "The murmur"

Verbatim's raw material is speech: thousands of overlapping voices in comment
threads, Reddit threads and videos. The site's one idea is **that murmur
resolving into a model of the market.** The hero is a dark room full of voices
drifting behind the headline; then the light comes on and the analysis appears
on white. All the boldness goes there. Everything else stays quiet.

**Signature element (spend all boldness here):** the murmur, and the moments
that show scale honestly: the 18,440-mark count, the streaming quotes, the
analyst stage that answers on its own. Product surfaces are drawn faithfully
from the app's real shapes (profiles, theme map, face-off, brief) so the page
shows the product rather than describing it.

## Palette (marketing)

| Token | Hex | Role |
|---|---|---|
| Room | `#0F1F19` | The dark band: hero, closing band. Green-tinted ink, never black |
| Paper | `#FFFFFF` | Page background |
| Paper 2 | `#F4F6F5` | Alternate section ground and inner blocks |
| Ink | `#26292C` | Text (charcoal, shared with the app) |
| Ink 2 / Muted | `#45494D` / `#5F656B` | Secondary text. Muted passes AA on Paper 2 |
| Hair | `#DCDFE3` | Rules inside panels only |
| Verbatim green | `#0E8A5F` | Buttons, "you", gaining, citation badges. The only signal colour on light |
| Green dark | `#3DBF8C` | The green on the dark band |
| Green tint | `#DDF3E9` | Highlight in quotes, the "you" tile, supported claims |
| Competitor / amber / red | `#F0742B` / `#E6B03C` / `#DB3B2E` | Data only: competitor bars, contradicted, fading |

Tokens live in `app/globals.css` under `.site-theme`, **below the drift-guard
marker**, so `scripts/check-design-drift.sh` never scans them. Component rules
live in `app/site/site.css`, every rule nested under `.site-theme`.

**Anti-list (aware and deliberate):** no cream, no terracotta, no marker
yellow, no pure black, no gradient washes, no glass blur, no all-caps eyebrow
labels, no mono metadata strings joined with middle dots, no single accented
word in a headline, no identical card grids, no text shadow on light headings.
The dark band is charcoal-green, not near-black plus acid green.

## Typography

| Role | Face | Notes |
|---|---|---|
| Everything a person did not say | **Bricolage Grotesque** (variable, `opsz` axis) | Display and body. Display at opsz 96, weights 600–700, tight tracking (−0.035 to −0.045em). Loaded in `app/site/layout.tsx` via `next/font`, var `--font-bricolage` |
| Everything a person did say | **IBM Plex Serif italic** | Quotes, voice fragments, the phrases in profiles. Loaded by the root layout, var `--font-plex-serif`. Italic is semantic, never decorative |

Scale: big jumps. Hero `clamp(56px, 9.2vw, 148px)`, statements `clamp(44px,
6.6vw, 104px)`, section leads `clamp(38px, 4.6vw, 68px)`, surface headings
`clamp(30px, 3vw, 44px)`. Body 19px on leads, 17–18px elsewhere, 15px for the
quiet line under a panel. No mono anywhere on the marketing site.

## Layout

- Left-weighted, 1320px content width, 72px section rhythm at 140px vertical.
- Sections alternate Paper and Paper 2; the dark Room band opens and closes
  the page. Separation is whitespace first, ground shift second, elevation
  third. No flat 1px borders between sections.
- Panels carry the ambient shadow (`--shadow-lg`); inner blocks are flat
  Paper 2, never bordered. Radius 6 on controls and tiles, 8 on panels.
- Subsections within a part must not repeat one layout: alternate text-left,
  text-right, full-width and dark blocks.

## Motion

- One orchestrated moment per section, triggered on first sight, then still.
  The murmur drifts continuously (one rAF loop, idle off-screen). The count
  draws once. Bars and tiles reveal once via `is-on` (CSS transitions). The
  analyst stage cycles on its own until a visitor picks a chip, then stops.
  The report covers cycle until hover, then stop.
- No hover transitions on every card. No fade-and-slide on every section.
- `prefers-reduced-motion`: everything visible and static, streams unrolled,
  cyclers off. Every effect has a cleanup; nothing runs after unmount.
- No animation dependency. CSS transitions plus two small rAF loops.

## Copy rules

Copy contract: `.agents/product-marketing.md`. On the site specifically:
- The home page stops people, makes them curious, moves them on. Specifics
  live on `/how-it-works`, in three parts: gather, analyse, deliver.
- No em-dashes. No comprehensiveness claims ("every comment", "whole market").
  One "it isn't X, it's Y" per page at most. No rule-of-three on autopilot.
- Sample data is one illustrative market (backpacks, fictional brands) from
  `app/site/_data/sample.ts`; every number must read the same everywhere.
- Quotes use typographic quotes and apostrophes. Anything a person said is
  set in the voice face.

## Quality floor (non-negotiable, never announced)

Responsive to 390px with no horizontal scroll. Visible focus on every control.
Muted text at AA contrast on the ground it sits on. Screen readers never hear
the analyst typing or the duplicate stream cards. Keyboard reaches every chip
and cover. Lead form: name, work email, brand, optional question; honeypot;
honest failure message.

## Review loop

Fresh-eyes design and copy review against this file and the copy contract;
a fact check of every mechanism against the code; mobile at 390px; then
Heinrich signs off. Merge and deploy are his call.
