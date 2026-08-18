-- Tier 0 T0-1 (2026-08-18): one pipeline run per client at a time, enforced in
-- the database.
--
-- Until now single-flight came from the Inngest function's
-- `concurrency: { limit: 1, key: clientId }`. That option limits concurrent
-- STEPS, not runs, so every "parallel" wave (search, comments, transcribe,
-- Pass A, classify-meta, themes) ran one step at a time for the pipeline's
-- whole life (an ai_call_log interval sweep found zero overlapping calls in any
-- run). The step limit is now raised so waves fan out; "one run per client"
-- moves to the open-run step (lib/pipeline/run-guard.ts) with this partial
-- unique index as the backstop for the race the pre-check cannot see.
--
-- Safe ahead of the code deploy: prod holds no 'running' rows at apply time
-- (checked 2026-08-18) and today's function only ever has one running row per
-- client anyway. Old code that hits a violation fails open-run, retries, and
-- lands in onFailure — the same terminal path as any other open-run error.

create unique index if not exists pipeline_runs_one_running_per_client
  on public.pipeline_runs (client_id)
  where status = 'running';
