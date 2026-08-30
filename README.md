# Verbatim

Media-based consumer intelligence for mid-market D2C brands. Verbatim gathers
TikTok / YouTube / Instagram video and comment conversations around a client's
category, runs them through a multi-pass GPT analysis pipeline, and delivers a
dashboard plus scheduled email updates — multi-tenant SaaS at
[app.verbatimintel.com](https://app.verbatimintel.com).

## Stack

- **Next.js 16** (App Router) · React 19 · TypeScript · Tailwind 4 · shadcn/ui
- **Supabase** — Postgres + auth, multi-tenant RLS. Accessed directly via
  `@supabase/supabase-js` (no ORM, client is deliberately untyped)
- **Inngest** — the analysis pipeline as one durable function (`inngest/`)
- **OpenAI** — analysis (`gpt-4.1-mini`), synthesis (`gpt-5.4`), embeddings,
  Whisper transcription
- **Apify** (TikTok/Instagram scraping) + **YouTube Data API v3** (free, official)
- **Resend** — invite + scheduled update emails (PDF attached)
- **Vercel** — Hobby plan, region `dub1`; 300s function cap shapes the pipeline's
  step sizing

## Local setup

```sh
npm ci
cp .env.example .env.local   # fill in real values
npm run dev
```

| Command | What |
| --- | --- |
| `npm run dev` | Dev server |
| `npm run build` | Production build |
| `npm run lint` | ESLint |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Vitest — `lib/**/*.test.ts`, pure pipeline logic only (no network/DB) |

CI (GitHub Actions) runs typecheck + lint + test on every push to every branch.

## How the pipeline works

Everything hangs off one event, `pipeline/run.requested` → `runPipeline`
(`inngest/functions/pipeline.ts`), a durable Inngest function whose steps are
each sized to fit the 300s cap:

1. **Gather** (skipped on analysis-only resumes) — per-keyword search steps →
   one relevance/attribution gate per platform → comment-scrape batches →
   transcript batches (flag-gated by `TRANSCRIPTS_ENABLED`). Delta-scraping
   skips unchanged re-finds and re-checks grown videos.
2. **Pass A** — per-video GPT insight extraction, fanned out in batches.
   **Incremental since 2026-08-17** (flag `INCREMENTAL_PASS_A`): insights are
   durable facts about a *video* — `videos.analyzed_run_id` points at the run
   that produced a video's current rows, and `plan-pass-a` re-reads a video only
   when it is new, its stored comments grew (≥ min(3, 20%) since last analysis),
   a usable transcript landed, its lane changed, the prompt version bumped, or
   `options.forcePassA` is set. Flag off = every eligible video re-read (the
   pre-2026-08-17 behaviour) on the same bookkeeping. "Current corpus" reads go
   through the `audience_insights_current` / `language_samples_current` views;
   stale rows are pruned after `close-run`.
3. **Cross-reference** — deterministic client-brand mention detection.
4. **Themes** — fan-out per entity bucket (`plan-themes` → `themes:<bucket>`
   clustering + LLM label-merge → `pass-b` labels → `persist-themes`).
   **Theme identity** (flag `THEME_REGISTRY`): `persist-themes` matches this
   run's themes to a per-client `theme_registry` on **membership** (the
   `supporting_insight_ids` set, durable since Pass A went incremental), not on
   the label — measured, 507 of 537 themes had an identical member set run to
   run while 48 of 58 "new" flags were the same theme relabelled. Each match
   writes a `theme_observations` row and stamps `themes.registry_id`;
   `first_seen` then means *genuinely new*. Trends and the Voice history join on
   that id instead of the label string.
5. **Synthesize** — metrics → Pass C (competitive) → Pass D (market insights,
   recommendations, executive brief) → `run_summary`.
6. **Close run** → `prune-stale-analysis` → optionally emit
   `report/send.requested` → `sendWeeklyReport` finds the due schedules and calls
   `POST /api/admin/schedules/run` per schedule (build, PDF, link, email → `report_sends`).

A daily cron (`inngest/functions/scheduler.ts`, 06:00 Africa/Johannesburg)
dispatches runs for clients whose `report_day`/`report_period` are due.

**Step-ID stability matters**: Inngest memoizes completed steps by their ID
string. Renaming or renumbering steps strands any in-flight run across a
deploy — change step shape only between runs.

Key directories: `app/` (pages + API routes) · `lib/pipeline/` (passes,
clustering, themes) · `lib/gather/` (platform adapters, delta logic) ·
`inngest/` (functions) · `scripts/` (operator CLIs) · `supabase/migrations/`.

## Database

Schema baseline: `supabase/schema-baseline.sql` (full prod schema as of
2026-08-09). A fresh database = apply the baseline; files in
`supabase/migrations/` dated **before** the baseline are historical record
(already folded in), files dated **after** it are new migrations. Migrations
are hand-authored SQL, applied to prod by hand (no Supabase CLI link).
Multi-tenant RLS leans on the `get_my_client_id()` / `get_my_role()` helper
functions (defined in the baseline).

## Deploy & ops

- **Deploy** = push `main` (Vercel auto-deploys) or `npx vercel --prod`.
- **After any Inngest function change**, re-register:
  `curl -X PUT https://app.verbatimintel.com/api/inngest`
- **Inngest locally** (first used for `build-document`, 2026-08-31): run the
  app with `INNGEST_DEV=1 npm run dev` and, beside it,
  `npx inngest-cli@latest dev -u http://localhost:3000/api/inngest --no-discovery`;
  `inngest.send` then lands on the dev server at :8288 and functions run
  against localhost. `scripts/document-smoke.ts` needs both.
- **Manual run**: `POST /api/admin/trigger-run` with header `X-Admin-Key:
  <ADMIN_API_KEY>` and body `{"clientId": "..."}`. (The service-role key is
  still accepted during the changeover; stop using it — the ops bearer is a
  separate credential now so it can be rotated on its own.) Add
  `"options": {"runId": "...", "skipGather": true}` for an **analysis-only
  resume** — reuses the stored corpus, the recovery lever when a run's
  analysis half dies. Add `"forcePassA": true` to re-read every eligible video
  even if nothing changed (after a prompt/model change that kept the version
  string; no effect while `INCREMENTAL_PASS_A` is off). Note `forcePassA` does
  **not** re-read videos this same run already analysed — on a `skipGather`
  resume of the *same* `runId` those are already this run's output; use a new
  run id to force a genuine re-read.
- **Schedule preview/send**: `scripts/send-report.ts` (preview by default →
  `email-preview.html`; `--test <email>`; `--commit` sends to the list) or
  `POST /api/admin/send-report { clientId, scheduleId?, mode }`.
- **Retention** (`retention-daily`, 04:00 SAST, dormant until `RETENTION_ENABLED=1`):
  raw payloads and prompt bodies past 30 days go; **YouTube rows are refreshed,
  not deleted** — re-fetched from the API every ≤30 days (Developer Policy
  III.E.4.d), rows YouTube no longer serves are deleted (evidence cascades,
  hero-quote copies nulled), vanished videos are tombstoned; the Tier 0 delete
  path stays as a 30-day backstop and logs loudly if it ever fires. Preview with
  `scripts/retention-dry.ts`. **Order:** apply
  `20260822100000_retention_refresh.sql` (schema) BEFORE deploying this code
  (gather/Pass A write the new columns) → deploy + re-register Inngest →
  apply `20260822110000_demographic_redact_backfill.sql` AFTER (its readers
  must be live) → run `retention-dry.ts --refresh-sample 50` → then
  `RETENTION_ENABLED=1` and watch the first sweep.
- Run state lives in `pipeline_runs.status`
  (`running`/`completed`/`partial`/`failed`); a run failure also emails
  `ALERT_EMAIL` when configured.

## Reports & Exports

The artifact system (2026-08-29/30; vault: Architecture/Reports-Exports).
Every dashboard page is a **loader** (`lib/pages/<page>.ts`) plus **renderers**
(`components/pages/<page>`, catalogue `components/pages/registry.ts`, keys
`<page>.<tile>`); the same data feeds the app, paper and the Studio.

- **The spine** (Stage 1): `POST /api/export` freezes a **snapshot**
  (`report_snapshots`: tile-ready data, quotes as refs, never their text) →
  headless Chrome prints `/render/<snapshot>` under a signed token → the file
  lands in the private `artifacts` bucket → `GET /api/artifacts/<id>` 302s to
  a one-hour signed URL. Erasure stales the artifacts whose snapshots cite a
  voice (`deleteCommentsProperly`); the next download re-renders without it.
  The page-bar Export menu and the tile controls were removed from the
  dashboard pages in Stage 3 (to be redone after the Studio); the routes and
  `scripts/export-smoke.ts` remain.
- **The Studio** (Stage 2; its own page since Stage 3, reshaped 2026-08-30):
  `/dashboard/studio` lists your reports down the left; the picked one on the
  right shows its reader, pages, builds, share links and its **sending**.
  A report is a `reports` row: pages + tiles + one framing line per section
  + "written for" (free text, `cover.reader`; a known register keeps its
  prompt). **New report** (`/dashboard/studio/new`) starts from one of the
  five templates (`lib/reports/templates.ts`, arrange existing pages only) or
  custom; **Edit** opens `/dashboard/studio/edit/<id>` (outline beside the
  deck preview). **Build** (`POST /api/reports/<id>/build`) runs every
  section's loader, writes the cover in the reader's register (`COVER_MODEL`,
  figures substituted by code, the model never sees a number or a quote),
  freezes it all into ONE snapshot of kind `report` (with `delta`, what moved
  since the previous update), prints the PDF. On paper the cover is the title
  and the page count; every page carries its page name and "Created by
  {company} with Verbatim · date" with the page number.
- **Sending** (Stage 3): a report's schedule, edited on the report itself:
  `report_schedules` (one per report; `report_id`, a cadence (every
  update / first update of the month, SAST), its own recipient list (≤ 25),
  attach the PDF, the share link's life; owners/admins edit, every member may
  look and preview. Every workspace has a default **Weekly digest** (an
  accepted invite joins its list; `tracking_configs.report_emails` is no
  longer read). After a scheduled update the pipeline emits
  `report/send.requested` → Inngest `send-weekly-report` finds the due
  schedules and, one step each, calls `POST /api/admin/schedules/run`
  (admin key) — the render never runs inside an Inngest step. The runner
  (`lib/schedules/run.ts`) claims `report_sends (schedule_id, run_id)` first
  (a retry cannot send twice), builds the snapshot, prints the PDF and the
  email's inline PNGs in one browser session, mints a share link, renders
  the **email from the same tiles** (`Renderable.email`, `components/email/*`
  — tables, inline styles, literal hex; the delta block leads) and sends
  through Resend with the PDF attached. A send stores ids, never the HTML:
  "the email as sent" re-renders from the snapshot
  (`GET /api/schedules/<id>/preview?send=`). **Reports** (`/dashboard/reports`)
  is the archive: Sent (with the pre-Stage-3 `weekly_reports` rows beneath)
  and Built. Ops: `POST /api/admin/send-report { clientId, scheduleId?, runId?,
  mode: preview|test|send, to? }`.
- **Share links**: `/r/<token>` renders a build live from its snapshot in
  app mode — no account, the evidence popovers work, dashboard links go
  quiet. 32-byte token, 7/30/90/no expiry, one-click revoke, optional
  password (scrypt), `noindex`, a view log (`share_views`: hashed address,
  agent). The token column is withheld from RLS reads; the Reports page shows
  links through the service role. `POST /api/share`.
- **Env**: `RENDER_TOKEN_SECRET` (signs render tokens and share-unlock
  cookies; falls back to the service-role key), `CHROME_PATH` (local dev
  only), `RENDER_BASE_URL` (optional origin override for the renderer).
- **Verify**: `scripts/render-page.ts` (any page / `--template` / `--report`
  to PDF, no session, snapshot deleted after; `--no-render` prints the cover
  and the delta), `scripts/send-report.ts` (a schedule's email: preview by
  default → `email-preview.html/.txt`; `--test <email>`; `--commit`),
  `scripts/export-smoke.ts`, `scripts/studio-smoke.ts` (the Studio, schedules,
  Reports, no export chrome — real browser, demo account),
  `scripts/share-smoke.ts`.

**Written reports** (`reports.kind = 'document'`, 2026-08-31; the Sales
brief first): the agent writes the document from the update in a role,
inside a fixed skeleton (`lib/reports/documents/`). A build is asynchronous:
`POST /api/reports/[id]/build` inserts a `report_builds` row and sends
`report/build.requested`; Inngest `build-document` runs research → write →
check → freeze as steps (model calls only; signals reload per step) and
`fetch`es `POST /api/admin/documents/render` for the PDF; the Studio polls
`GET /api/reports/[id]/builds/[buildId]`. The self-check judges each
finding's headline against the data (`check.ts`) and drops a contradicted
one, flagging the build. The Studio edits blocks in place as an overlay
(`report_edits`, `lib/reports/documents/edits.ts`; the snapshot never
changes, artifacts go stale) and shows the workings beside the page
(`report_snapshots.workings`, never selected by render or share).
`scripts/build-document.ts --report <id>` runs the same steps in process;
`scripts/eval-document.ts <snapshotId>` is the structural eval.

## Operator scripts

All run as `node --env-file=.env.local --import tsx scripts/<name>.ts`.

| Script | Purpose |
| --- | --- |
| `run-gather.ts` | CLI gather stage (Apify spend!) |
| `run-pass-a.ts` | CLI Pass A iteration (also the per-video re-read lever: `--video <id>` re-analyses and moves the video's pointer). **Persisting runs move `videos.analyzed_*` for every video they touch** — a `--min-comments`/`--limit`/`--platform` slice therefore rewrites what the corpus counts as current (and a below-override video is bookkept `skip`). Use `--dry-run`, or pass `trackAnalysis: false` when calling `runPassA` from a harness |
| `run-a2.ts` | Step A2 inspector (`--debug` prints similarity matrices) |
| `run-cd.ts` | Back half locally: metrics → A2 → Pass B/C/D → run_summary (A2 reads the corpus's *current* insights via `audience_insights_current`; `--run` is the run the output is written under) |
| `run-recs.ts` | Regenerate one run's recommendations only |
| `run-relevance.ts` | Relevance gate dry-run over stored videos (no spend) |
| `run-tagging.ts` | Entity-tagging strategy comparison |
| `run-owned-events.ts` | Owned-account event detection |
| `send-report.ts` | A schedule's digest: preview / test send / real send |
| `seed-demo.ts` | Idempotent demo-tenant seeder (careful: doesn't recreate account_events/weekly_reports; after a re-seed, re-run the backfill block of `supabase/migrations/20260818090000_incremental_pass_a.sql` so the demo videos' `analyzed_run_id` points at W6 — the `*_current` views are empty until it does) |
| `regate-corpus.ts` | Re-apply the relevance gate post-hoc (`--apply` deletes) |
| `backfill-transcripts.ts` | Transcript backfill for stored corpus |
| `ab-pass-a.ts` | Pass A transcript A/B harness (runs with `trackAnalysis: false` — arms write rows under throwaway runs without moving the corpus pointer) |
| `citation-floor.ts` | Citation-relevance floor calibrator (read-only). Aimed at an OLD run it now under-reports: that run's insights are pruned once a newer run supersedes them (incremental Pass A) |
| `theme-registry.ts` | Theme-identity inspector + repair lever — entries, observations, label history, weak-band matches; `--merge` / `--dormant` / `--revive` need `--apply` |
| `retention-dry.ts` | What tonight's retention sweep would do, read-only (`--refresh-sample N` also calls YouTube for N due comment ids and reports found/missing/edited — still read-only) |
| `erase-commenter.ts` | Erase one commenter on request: `--platform <p> --handle <h>` finds their rows across every tenant + the demo clone, the evidence/language samples the delete cascades, hero-quote copies, and prompt bodies inside 30 days; dry-run by default, `--apply` deletes and records the handle in `suppressed_commenters` so a re-scrape never brings it back. Prints the reply template. 7-day SLA per the privacy notice |
| `keyword-roi.ts` | Keyword ROI pruning table, worst first |
