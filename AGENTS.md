<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Repo rules

- **Verify claims against code and DB, not docs or notes.** Shipped-state
  comments and older docs drift; the code is the record.
- **Inngest step IDs are a stability contract.** Completed steps replay by ID
  string; renaming/renumbering strands in-flight runs across a deploy. Change
  step shape only between runs, and re-register after function changes:
  `curl -X PUT https://app.verbatimintel.com/api/inngest`.
- **Tests are pure-logic only** (`lib/**/*.test.ts`, vitest — no network, DB,
  or GPT). New pure pipeline logic gets a test; don't mock the world to test
  I/O glue.
- **Insights belong to videos, not runs (incremental Pass A, 2026-08-17).**
  `videos.analyzed_run_id` names the run whose `audience_insights` /
  `language_samples` rows are a video's current analysis. Population reads
  ("all current insights") go through the `audience_insights_current` /
  `language_samples_current` views — never `audience_insights … eq('run_id')`
  (that means "produced by this run", which is only what
  `keyword-attribution.ts` wants). Id-set lookups (by `audience_insight_id`)
  stay on the base tables so they resolve rows an in-flight run has superseded
  but not yet pruned. A Pass A prompt-version bump re-reads the whole corpus
  on the next run — that is the cost of a change, budget for it.
- **Theme identity lives in `theme_registry`.** `themes.id` is a per-run row id
  (the table is fully replaced each run) and must NEVER be used as a cross-run
  key; `themes.registry_id` is the stable identity, and cross-run joins use it.
  Do not join themes by `label` — labels churn ~88% run to run because a
  reasoning model writes them and reasoning models take no temperature.
- **The Supabase client is untyped** (no `Database` generic). Reads past 1000
  rows must use `selectAll` (`lib/supabase-admin.ts`) — a bare `.select()`
  silently caps at 1000.
- **Client-facing copy is calibrated**: no pipeline jargon (T#, Pass C, run),
  no raw scores; "comments" vs "conversations" have fixed meanings
  (`lib/calibration.ts` GLOSSARY). Copy claims about behavior must match the
  code (a page once claimed "no email is sent" while Resend sent).
- **Costs are real**: gather scripts spend Apify money; synthesis calls spend
  OpenAI. Prefer inspectors/dry-run flags (`run-relevance.ts`, `--no-merge`,
  send-report's default preview) when iterating.
- `.env.local` holds real production credentials — never commit it, never
  print its values into logs or command output.
- **Exports and reports freeze numbers, never words.** A snapshot
  (`report_snapshots.data`) holds tile-ready data with every quote as a ref
  (`lib/renderables/quotes-freeze.ts`) and `text: ''`; the words resolve at
  render. Nothing under `lib/reports/` may store or send to a model a
  comment's text — the cover prompt gets figure KEYS and validated brief
  prose only. A share link (`/r/<token>`) reads the link, its snapshot and
  the quote texts — never a tenant table live. A scheduled send
  (`report_sends`) stores subject, recipients and ids — never the email body;
  "the email as sent" re-renders from the snapshot. `weekly_reports` is
  legacy (read-only, stored HTML) and gets no new rows.
- **Rendering never runs inside an Inngest step.** Chromium (PDF, PNG) and
  the email body are produced in route handlers (`/api/export`,
  `/api/reports/[id]/build`, `/api/admin/schedules/run`, `/api/schedules/*`);
  an Inngest function only `fetch`es them, one step per schedule. The account
  has a hard 5-slot concurrency shared with the pipeline. `react-dom/server`
  cannot be imported statically in an app route (Next compiles it in the RSC
  layer) — `lib/email/render-html.ts` loads it at runtime; new browser or
  email routes need their `outputFileTracingIncludes` entry.
