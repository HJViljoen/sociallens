# Verbatim — Design System (marketing surfaces)

> The design contract for `verbatimintel.com` (app/site/*). Consult BEFORE styling
> anything. The app (`app.verbatimintel.com`) still runs the 2026-07-01 green
> refresh (see `## App tokens` below); the marketing evolution here is intended
> to flow back into the app later, deliberately, not by drift.

## Direction — "Annotated transcript"

Verbatim's world is qualitative research: transcripts, verbatim quotes, marker
highlights, theme codes, margin notes, evidence counts. The design speaks that
language. One idea carries the page: **raw conversation, marked up by a
researcher who knows what matters.**

**Signature element (spend all boldness here):** the marker-highlight system.
The hero headline carries a drawn marker sweep; key quotes render as transcript
excerpts (serif italic body, mono metadata line); theme labels look like a
researcher's codes. Everything else stays quiet and disciplined.

## Palette (marketing)

| Token | Hex | Role |
|---|---|---|
| Paper | `#F1F2EC` | Background — sage-cast paper, cooler than the app's cream |
| Ink | `#0D2117` | Text — green-black, never pure black |
| Verbatim Green | `#14503A` | Primary — buttons, links, brand mark (unchanged from app) |
| Pine | `#0B2E20` | Dark bands, footer fields |
| Marker | `#F7D046` | The highlighter. FUNCTIONAL only: highlight sweeps, marked phrases. Never buttons, never borders, never decoration |
| Moss | `#5C685C` | Secondary text on paper |

Ratio ≈ 60 paper/ink · 30 green · 10 marker. Tint neutrals, never pure #FFF/#000.

**Anti-list (aware and deliberate):** AI-generated design currently clusters on
(1) warm cream + serif display + terracotta, (2) near-black + acid green,
(3) broadsheet hairlines. We sit near (1) by brand history — we diverge via the
sage-cast neutrals, the functional marker accent (not decorative terracotta),
and the annotation motif. Never: purple/indigo anything, gradient text, glass
blur on marketing, flat 1px gray card borders, colored left-border strips.

## Typography

| Role | Face | Notes |
|---|---|---|
| Display | **Newsreader** (opsz) | Editorial voice. Weights 500–600. Italic is reserved for actual quotes — semantic, never a decorative accent word |
| Body / UI | **Plus Jakarta Sans** | Continuity with the app. 16–17px body minimum |
| Data / meta | **JetBrains Mono** | Transcript metadata (@handle · platform · date), counts, tags. Small doses |

Scale: big jumps (hero `clamp(2.75rem, 6vw, 4.75rem)`), not 1.25× increments.
All-caps mono eyebrows: max ONE per page — everywhere else, use theme-code
chips or nothing.

## Layout

- Asymmetric, editorial. Left-weighted hero; sections vary rhythm — no two
  consecutive bands with the same internal structure.
- Separation = whitespace first, then a 3–5% background lightness shift, then
  soft elevation. A border only if all three fail — and never flat gray.
- No uniform card grids ("three equal boxes with icons" is the template
  answer). Steps may be numbered ONLY where order is real information.
- Quotes are artifacts, not decoration: serif italic, marker where the insight
  lives, mono attribution line. Max one marker highlight per viewport.
- Crowd line-art (`crowd.svg` / `crowd-live.svg`) is the ambient layer — ours,
  keep it. Bottom-anchored, masked, ≤0.25 opacity.

## Motion

- ONE orchestrated moment: hero load — staggered text reveal, then the marker
  sweep draws itself (~500ms, after text settles). Ambient crowd sway continues.
- Everything else micro and purposeful: link underlines, button `:active`
  scale(0.97). Durations 150–400ms. Ease-out `cubic-bezier(0.23, 1, 0.32, 1)`.
  Never bounce, never ease-in, never identical fade-ins on every section.
- `prefers-reduced-motion` always respected.

## Copy rules

**The full copy contract lives in `.agents/product-marketing.md`** — positioning,
VoC bank, voice, banned words, review loop. Read it before writing ANY marketing
copy. (Also see `lib/calibration.ts` — client-facing vocabulary is a contract.)
- Specific and falsifiable over clever. No hedging ("can help", "may enable").
- Claims match shipped code: comments + video transcripts YES; news = roadmap
  framing only; never scene/vision analysis; no comprehensiveness claims.
- No fabricated testimonials, logos, or numbers — leave the section out.
- Errors never apologize; buttons say what happens ("Request early access").

## Quality floor (non-negotiable, never announced)

Responsive to 375px · visible keyboard focus · reduced motion · semantic HTML ·
APCA-legible contrast (marker yellow is never a text color on paper) ·
`cursor-pointer` on interactive elements · every state designed (hover, focus,
disabled, loading, error, empty).

## Review loop

After any visual change: screenshot at 1440 / 768 / 375 (headless Chrome:
`"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless
--screenshot=out.png --window-size=W,H --hide-scrollbars
--virtual-time-budget=6000 URL` — the virtual-time budget lets load animations
and web fonts finish; without it you screenshot the page mid-reveal), critique
against this file, iterate 2–3×.

Mobile captures: bare `--window-size=375,H` does NOT emulate a mobile viewport
(Chrome lays out at ~455px and crops — false overflow "bugs"). Use the Chrome
DevTools MCP with device emulation, or puppeteer-core with
`setViewport({ width: 375, isMobile: true })`, and verify
`document.scrollingElement.scrollWidth === clientWidth` before trusting pixels. Ship gate: the design-reviewer agent
(`.claude/agents/design-reviewer.md`).

## App tokens (current, for reference)

Warm cream `#F6F1E7` · deep green `#14503A` · glass cards · radius 0.3rem tiered
· Plus Jakarta Sans + JetBrains Mono · full tokens in `app/globals.css`.
Migration of the app toward this document is a future, explicit decision.
