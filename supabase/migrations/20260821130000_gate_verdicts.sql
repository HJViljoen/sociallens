-- Tier 1 (2026-08-18): keep a record of what the relevance gate throws away.
--
-- The gate is the largest unmeasured decision in the product. Measured on the
-- live corpus: it discards 3,183 of Sealand's 5,233 gathered videos (60.8%) and
-- 1,517 of Össur's 3,951 (38.4%), and NONE of it is recoverable — a dropped
-- video is filtered out before the `videos` upsert, so it leaves no row at all,
-- and the per-video reasons go to a console line that ages out of the host's
-- log retention within the hour. The only persisted trace is one ai_call_log
-- row per platform holding counts, with a placeholder prompt, so it is not even
-- replayable.
--
-- Per-keyword survival says this matters: `freitag` 16.2%, `#runningblade`
-- 24.7%, `poler` 31.2% — and `sealandgear`, the client's OWN brand handle, at
-- 16.1%. Either the gate is eating the client's own content or that search
-- returns junk, and today there is no way to tell.
--
-- One row per judged candidate, kept and dropped alike. Operator data, not
-- tenant data: no tenant policy, superadmin read only.
create table if not exists public.gate_verdicts (
  id bigint generated always as identity primary key,
  client_id uuid not null references public.clients(id) on delete cascade,
  run_id uuid references public.pipeline_runs(id) on delete cascade,
  platform text not null,
  video_id text not null,
  account_name text,
  -- Enough of the caption to judge the judgement, not the whole payload.
  caption_excerpt text,
  keyword text,
  kept boolean not null,
  reason text,
  -- 'heuristic' = the free denylist, 'gpt' = the model, 'default' = NOBODY
  -- judged it and the gate failed open. That third value has never been
  -- countable before, and the gate fails open in three separate ways.
  source text not null,
  created_at timestamptz not null default now(),
  constraint gate_verdicts_source_check check (source in ('heuristic', 'gpt', 'default'))
);

create index if not exists gate_verdicts_run_idx on public.gate_verdicts (client_id, run_id, kept);
create index if not exists gate_verdicts_keyword_idx on public.gate_verdicts (client_id, keyword, kept);

alter table public.gate_verdicts enable row level security;
create policy "Superadmins read gate_verdicts" on public.gate_verdicts for select using (public.is_superadmin());

comment on table public.gate_verdicts is
  'Every relevance-gate decision, kept and dropped (Tier 1). The gate discards 38-61% of what a run gathers; before this, none of it left a trace. Precondition for measuring or improving the gate.';
