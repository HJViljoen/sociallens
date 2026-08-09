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
3. **Cross-reference** — deterministic client-brand mention detection.
4. **Themes** — fan-out per entity bucket (`plan-themes` → `themes:<bucket>`
   clustering + LLM label-merge → `pass-b` labels → `persist-themes`).
5. **Synthesize** — metrics → Pass C (competitive) → Pass D (market insights,
   recommendations, executive brief) → `run_summary`.
6. **Close run** → optionally emit `report/send.requested` →
   `sendWeeklyReport` (Resend + `weekly_reports` row).

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
  <service-role key>` and body `{"clientId": "..."}`. Add
  `"options": {"runId": "...", "skipGather": true}` for an **analysis-only
  resume** — reuses the stored corpus, the recovery lever when a run's
  analysis half dies.
- **Report preview/send**: `scripts/send-report.ts` (safe preview by default;
  `--commit` persists, `--no-send` skips email) or `POST /api/admin/send-report`.
- Run state lives in `pipeline_runs.status`
  (`running`/`completed`/`partial`/`failed`); a run failure also emails
  `ALERT_EMAIL` when configured.

## Operator scripts

All run as `node --env-file=.env.local --import tsx scripts/<name>.ts`.

| Script | Purpose |
| --- | --- |
| `run-gather.ts` | CLI gather stage (Apify spend!) |
| `run-pass-a.ts` | CLI Pass A iteration |
| `run-a2.ts` | Step A2 inspector (`--debug` prints similarity matrices) |
| `run-cd.ts` | Back half locally: metrics → A2 → Pass B/C/D → run_summary |
| `run-recs.ts` | Regenerate one run's recommendations only |
| `run-relevance.ts` | Relevance gate dry-run over stored videos (no spend) |
| `run-tagging.ts` | Entity-tagging strategy comparison |
| `run-owned-events.ts` | Owned-account event detection |
| `send-report.ts` | Weekly report preview/send |
| `seed-demo.ts` | Idempotent demo-tenant seeder (careful: doesn't recreate account_events/weekly_reports) |
| `regate-corpus.ts` | Re-apply the relevance gate post-hoc (`--apply` deletes) |
| `backfill-transcripts.ts` | Transcript backfill for stored corpus |
| `ab-pass-a.ts` | Pass A transcript A/B harness |
| `citation-floor.ts` | Citation-relevance floor calibrator (read-only) |
| `keyword-roi.ts` | Keyword ROI pruning table, worst first |
