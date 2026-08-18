-- Tier 1 (2026-08-18): make cost a run output instead of a month-end surprise.
--
-- OpenAI and Whisper spend is already computed per call in ai_call_log, but
-- nothing ever rolled it up, so "what did this run cost" meant writing SQL by
-- hand. Apify spend was worse than invisible: when the 2026-08-16 run failed,
-- the diagnosis had to come from Apify's own billing history because the
-- product held no record of what it had spent.
--
-- One row per run. Written at close-run, non-fatal — a bookkeeping failure must
-- never change a run's outcome.
create table if not exists public.run_costs (
  run_id uuid primary key references public.pipeline_runs(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  -- Exact: summed from ai_call_log, which records every call's cost.
  openai_usd numeric(10,4) not null default 0,
  -- Whisper and paid caption actors bill per minute/item, outside estimateCost.
  transcribe_usd numeric(10,4) not null default 0,
  -- Best-effort: attributed from Apify's account-level runs list by time
  -- window, since run-sync-get-dataset-items returns no run metadata.
  apify_usd numeric(10,4),
  -- 'exact' when this run was the only pipeline run in flight account-wide for
  -- its window, 'ambiguous' when another run overlapped, 'unavailable' when the
  -- Apify API could not be reached.
  apify_attribution text,
  by_pass jsonb,
  created_at timestamptz not null default now()
);

create index if not exists run_costs_client_idx on public.run_costs using btree (client_id, created_at desc);

alter table public.run_costs enable row level security;
-- Operator-only: cost is not a tenant-facing number.
create policy "Superadmins read run_costs" on public.run_costs for select using (public.is_superadmin());

comment on table public.run_costs is
  'Per-run spend ledger (Tier 1). openai_usd/transcribe_usd are exact from ai_call_log; apify_usd is attributed by time window and carries its own confidence in apify_attribution.';
