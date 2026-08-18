# Verbatim

Media-based consumer intelligence for mid-market D2C brands. Verbatim gathers
TikTok / YouTube / Instagram video and comment conversations around a client's
category, runs them through a multi-pass GPT analysis pipeline, and delivers a
dashboard plus weekly email reports — multi-tenant SaaS at
[app.verbatimintel.com](https://app.verbatimintel.com).

## Stack

- **Next.js 16** (App Router) · React 19 · TypeScript · Tailwind 4 · shadcn/ui
- **Supabase** — Postgres + auth, multi-tenant RLS. Accessed directly via
  `@supabase/supabase-js` (no ORM, client is deliberately untyped)
- **Inngest** — the analysis pipeline as one durable function (`inngest/`)
- **OpenAI** — analysis (`gpt-4.1-mini`), synthesis (`gpt-5.4`), embeddings,
  Whisper transcription
- **Apify** (TikTok/Instagram scraping) + **YouTube Data API v3** (free, official)
- **Resend** — invite + weekly-report email
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
   `report/send.requested` → `sendWeeklyReport` (Resend + `weekly_reports` row).

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
- **Report preview/send**: `scripts/send-report.ts` (safe preview by default;
  `--commit` persists, `--no-send` skips email) or `POST /api/admin/send-report`.
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
| `send-report.ts` | Weekly report preview/send |
| `seed-demo.ts` | Idempotent demo-tenant seeder (careful: doesn't recreate account_events/weekly_reports; after a re-seed, re-run the backfill block of `supabase/migrations/20260818090000_incremental_pass_a.sql` so the demo videos' `analyzed_run_id` points at W6 — the `*_current` views are empty until it does) |
| `regate-corpus.ts` | Re-apply the relevance gate post-hoc (`--apply` deletes) |
| `backfill-transcripts.ts` | Transcript backfill for stored corpus |
| `ab-pass-a.ts` | Pass A transcript A/B harness (runs with `trackAnalysis: false` — arms write rows under throwaway runs without moving the corpus pointer) |
| `citation-floor.ts` | Citation-relevance floor calibrator (read-only). Aimed at an OLD run it now under-reports: that run's insights are pruned once a newer run supersedes them (incremental Pass A) |
| `theme-registry.ts` | Theme-identity inspector + repair lever — entries, observations, label history, weak-band matches; `--merge` / `--dormant` / `--revive` need `--apply` |
| `retention-dry.ts` | What tonight's retention sweep would do, read-only (`--refresh-sample N` also calls YouTube for N due comment ids and reports found/missing/edited — still read-only) |
| `erase-commenter.ts` | Erase one commenter on request: `--platform <p> --handle <h>` finds their rows across every tenant + the demo clone, the evidence/language samples the delete cascades, hero-quote copies, and prompt bodies inside 30 days; dry-run by default, `--apply` deletes and records the handle in `suppressed_commenters` so a re-scrape never brings it back. Prints the reply template. 7-day SLA per the privacy notice |
| `keyword-roi.ts` | Keyword ROI pruning table, worst first |
