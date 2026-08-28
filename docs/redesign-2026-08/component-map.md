# Component map — reference dashboards → Verbatim files

> Per the 2026-08-28 decision: Heinrich sends a dashboard he likes; Claude maps its parts onto our files
> **before** touching code. Skin is always ours (`design-system/verbatim/MASTER.md` §Visual identity);
> what we take from a reference is composition and interaction. Append one section per reference.
>
> **The brief in one line (Heinrich, 2026-08-28):** *the same amount of useful information the pages carry today,
> delivered cleaner.* Density is not the problem; noise is. Clarity comes from grouping (blocks inside blocks),
> alignment, consistent padding and open space — not from removing information.

## 1. ShadcnStore — "Shadcn Dashboard & Landing Template", Dashboard 2 (2026-08-28)

- **Source:** https://shadcnstore.com/templates/dashboard/shadcn-dashboard-landing-template/dashboard-2
  · repo https://github.com/silicondeck/shadcn-dashboard-landing-template (**MIT, free**, 1.1k★)
- **Stack:** Next.js 15 App Router *or* Vite · React 19 · Tailwind 4 · shadcn v3 (Radix) · Recharts · TanStack
  Table · Zustand · RHF + Zod. Fits ours (Next 16 / React 19 / Tailwind 4 / shadcn `radix-nova`). It is a
  **template repo, not a registry** — copy files from `nextjs-version/src/components/**`, no `npx shadcn add`.
- **Its look (do NOT take):** dark-first, indigo/green/orange/purple categoricals, pill chips everywhere, floating
  theme-customiser gear. Our tokens replace all of that.
- **Its structure (DO take — Heinrich, explicitly):** blocks inside blocks. The nested row-cards are a large part
  of why it reads clean while carrying a lot: each item gets its own bounded container, so the eye groups
  before it reads. Keep that, with the nesting discipline below so it stays clean rather than "container soup".

### What Heinrich is responding to (composition + interaction)
| Their part | What it does | → Our file / page | Take |
|---|---|---|---|
| Sidebar: grouped sections (Dashboards · Apps · Pages), icon rail collapse, ⌘K search, user footer | Structure + a collapsible rail | `components/app-sidebar.tsx` + `components/ui/sidebar.tsx` | Grouped sections (Intelligence · Account), collapsible rail, ⌘K search **inside the sidebar** (our top bar is being removed — rule 8), user footer. Green active mark, no pill fill. |
| Page header: title + one-line subtitle + right-side actions (primary + secondary) | Orientation + actions in one row | `components/shell/page-grid.tsx` `PageBar` | Title · meta line · actions right. Ours already close; adopt the subtitle slot. |
| 4 KPI cards: label · delta chip top-right · big number · trend sentence · caption | Number + judgement in one card | Dashboard strip (`Tile variant="strip"`, `StripCell`, `components/charts/stat.tsx`) | Delta chip top-right, trend sentence under the number. Keep our sparkline. Green/red only on the delta. |
| Sales area chart: range select ("Last 12 months"), Export, dashed target line, hover tooltip | Chart with its own controls | `components/charts/line-chart.tsx` (SSR SVG) + tile `meta` slot | **Range select in the tile meta**, hover tooltip with exact value (client overlay on our SVG), dashed line = "previous update". This is preference "hover that answers a question" + "page inside the page". |
| Revenue donut: centre value swaps with the selected/hovered segment; legend rows highlight in sync; segment select | Segment ↔ row hover sync | `components/charts/ring.tsx` (share ring) + Competitive share | **Take exactly this**: hover a segment or its row → segment expands, centre shows that bucket's %, row highlights. Heinrich's "pie expands and shows the percentage". |
| Recent Transactions: rows with monogram · name/sub · status chip · amount · age · kebab | List with state per row | Content "worth a reply" inbox, Reports list | Row anatomy (monogram · title/sub · chip · value · age · actions) **as nested row-cards** — a flat, faintly tinted inner block per item (no shadow, no border), hover lighten. |
| Top Products: `#rank` monogram · name + category chip · rating · count · value · delta chip · stock bar | Ranked list with a bar per row | Dashboard themes tile, Market recommendation agenda | Rank monogram + inline bar + delta chip. Category as grey text (rule 2), not a chip. |
| Customer Insights card: **tabs inside the card** (Growth · Demographics · Regions) with chart + metrics list | A page inside the page | Voice filter header, Competitive findings, Profile | Give `Tile` a `tabs` slot; content switches inside the tile without navigation. |
| Users page: TanStack table with sorting/filtering | Data table | Content field table (9 columns) | Sorting, column filters, sticky header, horizontal scroll inside the tile. |
| Mail / Chat / Calendar / Tasks / Auth / Errors / Landing / theme customiser | — | — | Skip. Marketing has its own `DESIGN.md`; auth stays. |

### Decisions this map implies (confirm at build)
1. **Charts stay SSR SVG** (`components/charts/*`) and gain a thin client hover layer (tooltip, segment/row sync).
   Recharts is *not* adopted — it would ship client JS and its default look for every chart; revisit only if
   hover on SSR proves fiddly for the big line chart.
2. **Nesting discipline (so blocks-in-blocks stay clean):** exactly two levels — the tile (white, ambient
   shadow) and inner blocks (flat, canvas-tint `#F6F7F8`-ish, radius 4–6, **no shadow, no border**); never a third
   level. One padding scale throughout (tile 20–24px, inner 12–16px). Inner blocks align to the tile's inner edges.
   Chips and colour inside an inner block only where they carry meaning.
3. **Spacing:** their card padding (~24px) and row height are what Heinrich reads as "breathes" — take that
   scale, and allow an open quadrant where a tile has little to say (preference, not rule).
4. **Sidebar absorbs the top bar's jobs** (⌘K search, trigger) so rule 8 (no top bar) holds.

### Copy list (files to lift and re-skin, from `nextjs-version/src/`)
`components/layout/*sidebar*` · `app/(dashboard)/dashboard-2/**` (stat cards, list rows, tabs card) ·
`components/ui/tabs.tsx`, `select.tsx`, `dropdown-menu.tsx`, `badge.tsx`, `tooltip.tsx` (only the ones we lack:
we have button/card/input/separator/sheet/sidebar/skeleton/tooltip) · the TanStack table wrapper from `users/`.

## 2. ShadcnStore — same template, **Mail** page (2026-08-28)

- **Source:** https://shadcnstore.com/templates/dashboard/shadcn-dashboard-landing-template/mail (same MIT repo).
- **Heinrich's read:** not the mail metaphor — the *mechanism*: "a whole new page on this page, with sections,
  search and filtering". Wanted for the pages that hold a lot: **insights, recommendations, competitive
  findings**. "It won't be exactly like this, but the functionality of it."

### What the page actually does
Three **resizable panes** (drag handles between them; shadcn `resizable` = react-resizable-panels):
1. **Rail** — an account/scope selector on top, then groups with counts (Inbox 128 · Drafts 9 …), a divider, then
   a second set of groups (labels). One active row.
2. **List** — pane title + a segmented toggle (All mail · Unread), a search field, then item cards: sender ·
   age · subject · two-line preview · tag chips · unread dot. **The list scrolls inside its pane** (measured:
   739px tall, 2,456px of content); the page itself never scrolls.
3. **Reading pane** — action toolbar (archive · delete · snooze · reply · forward · more), item header
   (avatar · name · subject · meta · date), body, and a reply composer pinned at the bottom.
Selection is in-page (click an item → pane 3 updates) — no navigation, no drawer.

### Map onto Verbatim — a shared `MasterDetail` shell, then per page
| | Rail (scope, with counts) | List (search · segmented filter · items) | Detail pane |
|---|---|---|---|
| **Market Intelligence** | Recommendations · Key insights · Said about you · Say vs hear · News (counts = items this update / all) | title · one-line · evidence chip (Strong evidence / Early signal) · bucket · age; filters **All · New this update · Strong evidence**; search across insights | the full item: recommendation text, *grounded in N voices* with the quotes, say-vs-hear verdict, links to Voice/Competitive; status actions (Acknowledge / Acted on) **only once write-back exists** |
| **Competitive Intel** | competitors (Ottobock …) then finding types (lead · threat · gap · switching) with counts | findings: headline · brand · type chip · voices count · age; filter **All · This update**; search | finding + the face-off metrics for that brand + quotes + "compare in Voice" |
| **Voice of Customer** (optional) | categories / journey stages with counts | themes: label · bucket colour bar · spark · conversations; filters confirmed / early / once | theme detail: quotes, movers, language samples — replaces `?detail=` here |
| **Reports** | periods (this month, last, all) | report rows: date · variant · sent-to | the report itself, inline (today it opens in a sandboxed iframe route) |
| **Verbatim Agent** history | already close to this shape (thread list + answer) — align it to the same shell | | |

- **Replaces the right-hand `?detail=` drawer on these pages** — depth becomes *on* the page (pane 3) instead of
  one click away. The drawer stays for Dashboard tiles, where the page is a grid not a list.
- **URL-driven selection** stays (successor of `?rec=<id>` / `?detail=`): `?item=<id>` selects pane 3, so links
  from the weekly email and the Dashboard deep-link straight into an open item.
- **Scrolling:** list and detail scroll inside their panes; consistent with rule 7 (pages *may* scroll) — here
  the page mostly doesn't need to.
- **Mobile:** panes stack as pushed views (rail → list → item), like every mail app.

### What we do NOT carry over
Compose, mail actions (archive/snooze/forward), unread-dot semantics, the account switcher. Our toolbar in pane 3
carries item actions that exist: open in Voice / Competitive, copy quote, (later) acknowledge / acted-on.

### Build note
New shell piece `components/shell/master-detail.tsx` — `ResizablePanelGroup` with three panels, default
sizes ≈ 20 / 35 / 45, min sizes, persisted layout (localStorage), rail + list as server-rendered lists, pane 3
server-rendered from `?item=`; client only for resize + selection highlight + search-as-you-type over the
already-rendered list. Nesting discipline (map §1, decision 2) applies: the three panes are the tile level;
item cards are the inner-block level; nothing deeper.

## 3. ShadcnStore — same template, **Settings** (user · account · billing · appearance · notifications · connections) (2026-08-28)

- **Source:** `…/settings/{user,account,billing,appearance,notifications,connections}` (same MIT repo).
- **Heinrich:** "this is all we need for settings." Our Settings is incomplete for the final product; take the
  *structure* for a future with Connections (Slack / Teams / Meta Ads …) and Plan & billing. **Billing stays empty
  blocks for now.** Some of these page types belong on the **Team** page rather than Settings (Heinrich; the
  dictation first rendered it "themes"): member-level things — a member's profile, role, and their own
  notification matrix — live under **Team** next to members and invites, not in a settings rail.
- **What we have today:** `settings/page.tsx` = one page: read-only "Your accounts" card (operator-set
  `own_handles`) + `SettingsForm` (competitor names · report period · report day · report emails) on
  `tracking_configs`, owner/admin edit, members read-only. `team/page.tsx` = members + invites. `billing/page.tsx`
  = "No billing action needed." No sub-navigation, no personal settings, no connections, no notifications.

### What their pages do (structure worth taking)
| Page | Structure | Take |
|---|---|---|
| **User** | one card: avatar upload row · 2-column field grid (name, email, company, phone, location, website, language, timezone) · bio · Save/Cancel | The card-with-2-column-grid form and the sticky Save/Cancel pair. Fields are ours (far fewer). |
| **Account** | three stacked cards: Personal info · Change password · **Danger zone** (destructive action set apart in its own card) | Card-per-concern stacking; danger zone pattern for "leave workspace / delete account". |
| **Billing** | Current plan card (plan · price · next billing · attention banner with progress) + Billing history list (period · plan · amount · Paid chip) + Available plans (3 columns, current highlighted) | The three blocks **as empty, honest placeholders now**: current plan (from `clients.plan` — "design partner"), next update date, "no invoices yet". No plan picker until plans exist. |
| **Appearance** | Theme (light/dark) · font family · font size · sidebar width · content width | **Theme + density only**, personal. We ship a real dark theme (MASTER rule: every surface reads in both), so a theme switch is warranted; font choices are not. |
| **Notifications** | Email toggles · push toggles · frequency + quiet hours · **TYPE × EMAIL / BROWSER / APP checkbox matrix** · channel cards | The **matrix** is the useful one: rows = things Verbatim can tell you, columns = channels. Everything else is noise for us. |
| **Connections** | Connected accounts (icon · name · one-liner · toggle) · Social accounts (status chip · action) · API integrations · API keys (masked key · Regenerate · Copy) | Row anatomy (icon · name · what it does · status chip · action). Groups become *ours* (below). API keys only when an API exists. |

### Proposed Settings IA for Verbatim (a settings rail inside the page — same in-page sub-nav mechanism as §2)
**Workspace** (owner/admin edit; members read-only, as today)
- **Tracking** — the existing form, promoted: brand terms · competitors · category terms · platforms · "Your accounts" (read-only facts) · update day/period.
- **Reports** — report emails · period · day (exists today) + the report archive link.
- **Team** — members · roles · invites (today's `team/` page, folded into the rail; route can stay).
- **Connections** — rows with status chips *Connected / Not connected / Coming soon*: **Sources we read** (TikTok · Instagram · YouTube — read-only, operator-set; Reddit "in development"); **Where reports go** (Email — live; Slack, Microsoft Teams — coming); **Ad & commerce platforms** (Meta Ads, Google Ads, Shopify — coming; the "say vs hear" and initiative-tracking use cases); **API** — placeholder until it exists. Honest empties, never a toggle that does nothing.
- **Plan & billing** — the three empty blocks (current plan · next update · invoices). Design-partner terms text can live here.

**Team** (member-level, per Heinrich — takes the User / Account / Notifications page types)
- Members list (today's `team/`) where **your own row opens your profile**: name · email · role · password (Supabase) ·
  leave workspace (danger-zone pattern), and **your notification matrix**: rows = weekly report · movement alert
  (gated on baseline variance, per the alerts decision) · new recommendation · update failed / late; columns =
  Email · Slack (when connected) · In-app. Owners/admins see the same for invites and roles.

**You** (shrinks to what isn't about membership)
- **Appearance** — light / dark / system · density (comfortable / compact).

### Build notes
- One layout: `app/dashboard/settings/layout.tsx` with the rail (two groups) + `page.tsx` per section; keep
  server actions + RLS as today (authorization is server-side; disabled fieldsets are UX only — existing rule).
- Cards = tile level (white, ambient shadow); rows / field groups = inner level (flat, tinted). Save/Cancel pinned
  at the card foot, not floating. Status chips grey unless they carry meaning (Connected = green tint).
- Components to lift from the template: `switch`, `checkbox`, `select`, `separator` patterns, the notification
  matrix table, the connection row. Skip avatar upload, API keys, plan picker, font settings.

## 4. ShadcnStore — same template, **FAQs** page → two things for us (2026-08-28)

- **Source:** `…/faqs` (same MIT repo).
- **Their structure:** left card = "Categories" with a search field and a category rail with counts (All 46 ·
  General 8 · Account 6 …); right card = accordion list, each row = question · category chip · chevron, one open.
  Bottom = four equal feature cards (skip — the template tell).
- **Heinrich:** useful twice — **(a)** on the **marketing site** as product questions, **(b)** in the **app as a
  guide**: "how should they use each of the features — how do all the features work."

### (a) Marketing FAQ — `app/site` (contracts: `DESIGN.md` + `.agents/product-marketing.md`)
- Content = questions a buyer asks *before* early access, assembled from the VoC bank and the capability map in
  `product-marketing.md`: what it reads (comments + what's said in the videos, TikTok / Instagram / YouTube; your
  brand, competitors and the category together) · what setup needs (brand + competitor names, nothing else) · how
  often and what arrives (weekly report, recommendations, every insight traced to a verbatim quote) · what it does
  **not** claim (comprehensiveness, vision analysis) · what's "in development" (labelled exactly that) · the
  design-partner offer (five partners, three months, 14-day exit, feedback every two weeks) · price altitude ·
  data & privacy (public comments only). Copy rules apply in full (banned words, no em-dashes on marketing).
- Structure: same rail + accordion on desktop (rail = Product · Setup · Reports · Data · Partners), single-column
  accordion on mobile. Add FAQ structured data (JSON-LD) — the cold review said buyers search "TikTok comment
  analysis"; a FAQ page is the cheapest surface that can rank for those phrases.

### (b) In-app **Guide** — new route `app/dashboard/guide` (sidebar: Account group, or a `?` in the sidebar footer)
- Content = one section per page: Dashboard · Market Intelligence · Voice of Customer · Consumer Profile ·
  Competitive Intel · Content · Verbatim Agent · Reports · Settings. Each answers, in this order: *what this page
  tells you* · *how to read it* (the calibrated-language definitions — **single source `lib/calibration.ts`
  GLOSSARY**, which `components/how-to-read.tsx` already renders per page) · *what to do with it each week* ·
  *what it can't tell you* (honest limits: sampled not comprehensive, model confidence is a word not a number).
- Structure: rail = the pages with counts · search across all entries · accordion rows = question · page chip.
  **The "How to read this page" pill keeps its lightweight legend** (it's zero-cost and in-place) and gains a
  "Full guide →" link to `/dashboard/guide#<page>`; the guide is where the longer explanations live — consistent
  with the 08-23 rule that explanatory micro-copy stays out of tiles.
- Copy is calibrated (no pipeline jargon: T#, Pass C, run) and **every behavioural claim must match the code**
  (AGENTS.md rule — a page once claimed "no email is sent" while Resend sent). Later: the Agent can answer
  "how do I…" questions from the same entries.

### Skip
The four feature cards under the FAQ; per-question category chips where the rail already says the category
(chips only in "All").

## 5. Creative Tim — Material Dashboard 3 PRO React, **Analytics** + **Sales** (2026-08-28)

- **Source:** https://demos.creative-tim.com/material-dashboard-pro-react/#/dashboards/analytics and `…/sales`.
  **Different creator, different stack (MUI, Chart.js canvases), paid.** Nothing is lifted as code — pattern source
  only; every pattern is rebuilt on our shell/tokens/SSR charts.
- **Heinrich:** "very clean animations and good numbers representation with graphs and percentage growth."

### The numbers patterns (what makes them read well)
| Their pattern | Why it works | → Ours |
|---|---|---|
| **Stat card = label · big number · `+55%` (coloured) + `since last month` (grey), period top-right** | One glance = value, direction, comparison base. The *delta is the only coloured thing* on the card. | Strip cells + `stat.tsx`: number mono 24; delta mono in green/red; comparison base in grey; **period as meta top-right** (we already do). Adopt the exact three-part sentence *value · delta · base*. |
| **Chart-first cards**: title · one-line reading ("(+15%) increase in today sales.") · the chart · footer "updated 4 min ago" | The sentence *interprets* the chart; the footer dates it. | Our tile eyebrow/meta/footer already fit: eyebrow = title, first line = the reading, footer = "update of Sun 23 Aug". The reading is the calibrated sentence, never a raw score. |
| **Horizontal bars for categories** (Sales by age) — labels left, bars fill the width, sorted | Category comparisons read left→right; long labels fit | `ranked-bar.tsx` for themes / platforms / age bands on Profile: full-width bars, sorted, count at the end. |
| **Country table**: icon · label · two or three numbers per row, columns labelled inline ("Sales: 2500 · Bounce: 29.9%") | Small table without table chrome | Competitive per-brand rows and Profile demographics: inline-labelled numbers, no header row when ≤3 columns. |
| **Top Selling Products table**: name + sub-count · value · spend · refunds with an ↑/↓ arrow per row | Every row carries its own direction | Content field table and Market recs: a per-row delta arrow where a previous update exists (gated on ≥2 updates, as today). |
| Two-series line with dot markers + inline legend dots above the chart | Legend as text, not a box | `line-chart.tsx`: inline legend in the meta line (you · Ottobock), end labels on the lines (already our rule), dot markers at data points. |
| Pie with legend list + a sentence under it ("More than 1,200,000 sales are made using referral…") | The sentence carries the finding | Share ring keeps the sentence: one calibrated line under the ring. **No pie** (spec rule — ring only, ≤4 slices). |
| Ratio 3 stat cards / 4 icon stat cards across the top, then charts, then tables | Numbers → pictures → detail, top to bottom | Page order for scrolling pages (rule 7): receipts strip → charts → lists/tables → drawer/detail. |

### The animations ("clean")
What they actually are: (1) **charts draw in on mount** — bars grow from the baseline, lines trace left→right,
~600–800 ms with ease-out (Chart.js defaults); (2) **cards lift on hover** — a 2–4 px translate-Y + a slightly
stronger shadow; (3) **numbers do not tick** (they appear set — no count-up); (4) sidebar collapse and section
expand are simple height/width transitions. Nothing decorative, nothing looping.
→ Ours, as a preference (MASTER "hover that answers a question"): (1) draw-in on first paint for bars / lines /
ring via CSS on the SSR SVG (`stroke-dashoffset` for lines, `transform: scaleY` for bars, `stroke-dasharray` for
the ring) — **once per mount, ≤700 ms, ease-out, disabled under `prefers-reduced-motion`**; (2) tile hover lift
= translate-Y −2 px + shadow step, only on tiles that are clickable; (3) no count-up numbers; (4) drawer /
master-detail pane transitions 150–200 ms. No looping, no glow, no aurora.

### Do NOT take
Icon-in-a-black-square stat cards, photo cards, the green Chart.js palette on white, MUI density and 8 px
radius everywhere, the configurator gear, "Read More" buttons.
