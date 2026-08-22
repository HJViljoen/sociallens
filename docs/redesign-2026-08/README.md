# One-screen redesign — rounds 1–2 (2026-08-22)

Branch: `feat/redesign-one-screen` (worktree `~/Documents/code/verbatim-redesign`, cut from `main` @ `e56c4fc`).
Canvas (hi-fi mockups, editable): https://claude.ai/code/artifact/1509f97c-6a56-4553-9008-7f8fb94458a4
Generator for the artboards: `canvas-gen.py` (python3; writes `*.dc.html` + `canvas.json`; seeded with the Claude Design helper).
Research synthesis: `research-design-direction.md`.

## The brief (Heinrich, 22 Aug)
- The app reads like a blog/review, not a professional dashboard. Every page must be ONE screen at desktop — smaller type, smaller blocks, dropdowns/tabs/collapsibles/drawers instead of scroll.
- Dynamic grid: big/small/wide/tall blocks, charts, "alive and interesting on the eye" — the look B2B buyers already read every day, filled with *our information* instead of KPI metrics.
- Trends page dissolved into the pages where each trend is relevant.
- Numbers ARE welcome when they are operational/volume (terms tracked, videos, comments, themes, share, sentiment split) — show them "in a cool way". Model confidence is still never a number.
- Palette redesign (feat/palette-press-green) dropped; the green refresh tokens stay. Work started from `main` in a new worktree; the uncommitted palette files are untouched.

## Decisions carried into the mockups
1. Frame 1440×900. Grid: 12 columns × 6 rows of 116 px, 16 px gap, inside the existing shell (floating 256 px sidebar, 48 px top bar, 24 px padding). Below ~1280 px the grid stacks in importance order and the page scrolls (desktop-first per MASTER.md).
2. Every page = strip (12×1, five counted receipts) + ONE hero + supports. ≤9 tiles. Tile = eyebrow + meta · content · footer link → right-hand detail drawer (URL-driven, like today's `?detail=`). Long lists scroll *inside* the tile with a visible hint.
3. Tiles are solid `#FDFAF3` (the existing popover token), 10 px radius, 1 px warm ring, soft shadow — no backdrop blur (perf + 2026 glass backlash). Crowd backdrop stays at 0.1.
4. Type: ratio 1.2, base 13. Hero headline 19/600 · finding 15/600 · body 12.5/1.45 · eyebrow 10.5 caps · meta 11 · stat value JetBrains Mono 24/600 tabular · deltas mono 11.
5. Colour jobs (unchanged tokens): pine/green = you, good, interactive · slate = wider category · clay = competitor AND the verbatim rule · ochre = mixed / early · sand = rest-of-field.
6. Charts (all SSR SVG, `components/charts/`): stat+sparkline, proportion bar, ranked bar, mover (delta+spark), line-over-time with end labels, ring (share only, ≤4 slices, centre = your number — the one circle allowed). No pies, no gauges, no word clouds, no legends for ≤4 series where direct labels fit.
7. Trends → Competitive (share over time), Dashboard (sentiment, volume, "since your first update" movement strip), Voice (gaining/fading + per-theme sparks), Content (owned-account follower lines + events), Market (news context). Every movement block gates on ≥2 updates; the Trends nav item and page go.
8. One dark pine hero (the executive brief) on Dashboard only; Market's hero is the featured recommendation with a clay ring.
9. Honest empties: a tile with too little data says so in one line and keeps its size.

## Round 2 (same day) — Heinrich's feedback and what changed
- Dashboard approved as-is.
- Consumer Profile and Verbatim Agent **revert to their current designs** (figure + connectors; crowd landing) — only density tokens apply. Removed from the canvas.
- "Every page looked the same" — the reference was a feeling, not a template. Market, Voice, Competitive and Content rebuilt as bespoke compositions of the same family:
  - **Market = the decision ledger**: a tall left agenda of numbered recommendations (featured #1 with quote + status controls, #2–5 compact with "grounded in"), right side = the short read as one 2×2 panel, the *say vs hear* ledger (you say · verdict · they hear), key insights, said-about-you, news.
  - **Voice = the theme map**: a squarified treemap of the top themes (block = conversations, tint = bucket, left edge = bucket colour, category chip + spark on big blocks), category tabs + journey filter in the tile; movers, language, mood on the right; a five-quote ribbon across the bottom.
  - **Competitive = the face-off**: a butterfly comparison (you left / Ottobock right, six metrics from the centre, each brand's "praised for" line), the share-over-time line, and a single findings column (lead / threat / gap / switching).
  - **Content = the reply inbox + playbook**: "Worth a reply" as the hero inbox (intent chips, platform, age, Reply), hooks + formats in one "what works" tile, the field table, top voices, owned accounts.
- Dropped the per-page strip except on Dashboard; each page's counts sit in its hero's meta line instead.

## Round 3 (same day) — palette: settled
- Heinrich briefly asked to move toward "Press, with green", saw it, and reverted. Then also reverted the stone-for-category experiment: **the cream/pine green refresh stays exactly as round 2, category bucket stays slate blue.** Design approved — build starts.

## Open questions for Heinrich (round 2, on the canvas)
1. Market: is the left-hand agenda the right spine, or should the short read lead?  2. Voice: keep the theme map as hero vs a ranked list?  3. Competitive: face-off first or the share line first?  4. Content: the reply inbox as hero — is that the daily-use page you want?

## Open questions from round 1 (superseded where answered)
1. Dark hero on Dashboard only, or Market too?  2. Ring for share — keep, or proportion bar everywhere?  3. Strip on every page vs only where counts matter?  4. Sidebar: keep the floating panel or slim it?

## Illustrative data in the mockups
Real Össur content from the 16 Aug update (counts, share, sentiment, themes, recs, competitive insights, personas, agent check). Illustrative: 5-update sparkline history (only 2 updates exist), hook/format multipliers, audience-mood %, news items, account events, top voices, "worth a reply" rows, early-signal list.

## Build log
- **Phase 1 — shell + Dashboard — BUILT 2026-08-22 evening** on `feat/redesign-one-screen` (`76d223d` tokens+formatters · `bb10ca8` shell+charts+tile shaping · `cdb5127` dashboard · `e0401a4` docs · `42d6edc` review fixes). Plan + status: `~/.claude/plans/verbatim-redesign-p1-plan.md`; research: `…-p1-research.md`. How the shell works: `design-system/verbatim/MASTER.md` §One-screen grid pages. Verified in dev on Sealand (numbers match the DB; one screen at 1440×900; phone stacks). Not merged, not deployed.
- Next phases: Market (decision ledger) → Voice (theme map) → Competitive (face-off) → Content (reply inbox) → delete Trends + sidebar + report deep-links. Profile and Agent untouched.

## Next steps (APPROVED 2026-08-22 evening — build starts)
1. Iterate the canvas until the Dashboard direction is approved.
2. Build the shell once: `PageGrid` + `Tile` (eyebrow/meta/footer/overflow), `Drawer`, `components/charts/*`, density tokens in `globals.css`.
3. Build Dashboard end-to-end as the pattern proof → review live → then Market, Voice, Competitive, Content, Profile, Agent, Reports — one `/implement` each.
4. Delete Trends, update sidebar + report deep-links + "How to read" copy.
