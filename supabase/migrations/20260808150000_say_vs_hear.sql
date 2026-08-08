-- Step 2b: say-vs-hear — what the client says in its own videos vs what the
-- audience says. One jsonb blob per run on run_summary (shape mirrors
-- consumer_intelligence_summary / executive_brief: additive, nullable, written
-- by writeRunSummary, read RLS-side by the Market page). Null = no client
-- claims existed for the run (tenant never ran Pass A v4, or no brand videos
-- with speech) — the UI self-gates.
alter table run_summary
  add column if not exists say_vs_hear jsonb;
