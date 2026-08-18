-- Tier 1 (2026-08-18): record what a run actually ran with.
--
-- Feature flags are read from process.env at call time (they must be, to work
-- in a serverless function), and Inngest invokes each STEP as its own request.
-- So an env change or a deploy part-way through a run means later steps see
-- different values than earlier ones, and nothing recorded which values any
-- given run used. The pipeline has repeatedly needed to explain a run's odd
-- behaviour after the fact and had nothing to go on.
--
-- The snapshot is taken in the memoised `open-run` step, so it is frozen for
-- the life of the run, and stored here alongside the trigger options.
alter table public.pipeline_runs
  add column if not exists flags jsonb,
  add column if not exists options jsonb;

comment on column public.pipeline_runs.flags is
  'Feature flags captured at open-run and frozen for the run: transcripts, incrementalPassA, themeRegistry, redditDiscovery. Reading them per step let a mid-run flip produce a half-and-half run.';
comment on column public.pipeline_runs.options is
  'The trigger options this run was dispatched with (skipGather, forcePassA, platforms, maxVideos, sendReport...).';
