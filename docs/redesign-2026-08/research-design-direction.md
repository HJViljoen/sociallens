# Design-direction research (agent report, 2026-08-22) — condensed

## Consensus look (2025–26 premium B2B)
- Visually sparse, interaction-dense; colour reserved for meaning; one accent. Linear = highest density / lowest noise. Skeleton: 4–6 KPI cards → charts that explain them → list/table for detail.
- Geist: type 24/32, 16/24, 14/20, 12/16; 4px unit; radii 6/8/12; tabular+mono numerals. Linear caption 13px. Enterprise type: H1 24–32/600, H2 18–20/600, body 14, caption 12; data values larger than labels, ≥600; humanist sans + mono numbers (= Plus Jakarta + JetBrains Mono — keep).
- Attio: near-black ink with green cast, teal accent only for focus/primary/data → green-family B2B reads modern.
- Incumbents (Sprout/Meltwater/Brandwatch) = widget grid: volume line, SoV donut/bar, sentiment split, theme ranking, mentions feed. Deliver that silhouette at Linear/Attio quality.
- Feedback-analytics analogues (Enterpret, Dovetail, Thematic): number + ranked bar + traceable quote; evidence counts and citations, never confidence. Thematic: "stats on top, stories below", pair metric with one punchy quote. Dovetail: 5 widget types (theme, sentiment, NPS, keywords over time).

## One-screen patterns
- App-shell: 100dvh, no body scroll, fixed top bar, each panel scrolls independently with sticky headers; show scrollbars when a panel scrolls.
- Progressive disclosure: 5–9 core elements visible, rest behind tabs/drill-down. Above-the-fold ≈80% attention.
- Long AI text in tiles: truncate + expand to drawer; tabs inside tiles; "if you're shrinking font to fit, split the tile".
- One right drawer (~480px) as the universal drill-down.
- Degradation: desktop assumed (1366+); 768 → hero tiles full width, icon rail; 375 → stack in importance order. Container queries.

## Numbers without a KPI wall
- KPI card anatomy: period → label → value → delta (vs prior) → context → light sparkline no markers. Neutral colour when direction isn't inherently good/bad (share, volume).
- Tasteful: big number + hairline sparkline; single stacked proportion bar for sentiment; ranked horizontal bars for theme volume; half-donut (less vertical space) / donut ≤5 slices; small multiples; treemap or sorted bars instead of word clouds. Streamgraph OK as hero for 5–15 themes with toggle to stacked bars.
- Dated: 3D, gradient slices, heavy grid, word clouds, RAG gauges, three donuts in a row.
- A11y: text 4.5:1, graphics 3:1, never colour-only; direct labels; grey field + one accent.

## Qualitative findings in a grid
- Finding-as-headline tile: ≤12-word headline, 1–2 line support, eyebrow with evidence count + theme chip, footer "view evidence →" (drawer).
- Quote tile: one verbatim, platform glyph, tiny mono like-count; rotate rather than list; ≤2 quotes visible per tile.
- Metric + story pairing (stats row above finding row). Recommendation tile = finding + status affordance. Agent = side panel/overlay, not the canvas.

## Bento guidance
- Size encodes importance; each tile a self-contained fact. Fails when all equal, ≥3 heroes, oversized containers (empty giants). ≤12 tiles; 1–2 heroes per viewport; gap 16–24; radius 8–12 (not Apple 20–24). Content-to-size: 1–2 col single KPI/alert; 3–4 col sparkline/bar/donut; 5–6 col area/stream/list; full width feeds/heatmaps never a lone number. min-height + skeletons.

## 2026 trends
- Adopt: raw aesthetics (visible structure, mono data), purposeful motion (200–300ms, 16px fade-up on entry), clamp() type, ONE dark ink accent tile per screen, typography-led hierarchy, AI in a side panel.
- Avoid: glassmorphism/liquid glass (2026 backlash; backdrop-filter cost), pastel gradient cards, pill-everything, decorative animation, dark-mode default.

## Suggested grid
- Fluid container, 24px side padding, optimise 1440–1536. 12 cols, 16px gap (20 ≥1536). Row unit 96px; 56px top bar + 24px padding → ~7 rows at 1440×900, 9 at 1920×1080.
- Tile vocabulary: S 3c×1r (stat) · S-tall 3c×2r · M 4c×2r · W 6c×2r · L 6c×3r · XL 8c×3r · Strip 12c×1r. Radius 10, 1px border ink/10%, no shadow at rest, 16–20px padding (24 on L/XL). ≤10–12 tiles/page, 1–2 hero.

## Type/density scale
- Page title 20/28/600 · Tile title 13/16/600 (or 11/14/600 caps mono eyebrow) · Finding headline 16/22/600 (hero 20/26) · Body 13/18 · Caption 11/14 · Stat value 28/32/600 mono tabular (hero 40/44) · Delta 12/16/500 mono · Axis 11/14 · Table 13/18. Min 11px.

## Refs
Geist designsystems.one · Attio designmd.co · Linear refero · Orbix bento dashboards · SaaSFrame bento 2026 · Thematic qual dashboards · Dovetail Fall 2025 · Enterpret themes guide · Anatomy of the KPI card (nastengraph) · Smashing chart a11y · Displayr word-cloud alternatives · 925 Studios 35 dashboards 2026 · Tubik UI trends 2026 · Lollypop enterprise typography 2026.
