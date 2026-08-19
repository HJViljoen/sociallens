-- Ask engine storage (2026-08-19). A client submits an idea or a whole plan;
-- the product answers per claim with echoes / contradicts / silent, backed by
-- the conversation it already mined, and separately with its own judgement.
--
-- Why two tables. `plan_checks` is the submission and its FIRST answer.
-- `plan_check_evaluations` is that same plan re-tested against each later run:
-- the plan stays put while the conversation moves, and "assumption 4 went from
-- silent to contradicted" is the thing worth coming back for. One row per
-- (check, run) so the series is a series, not an overwrite.
--
-- THE INVARIANT — three registers, structurally separate:
--   claims[]    GROUNDED. Verdict + counts + the themes and quotes behind it.
--               Nothing here may be the model's opinion.
--   judgement[] THE MODEL'S OWN PROPOSAL, marked as such, citing which claims
--               it reasons from. It may propose freely; it may not pose as
--               evidence.
--   'silent'    A FIRST-CLASS ANSWER. "The conversation does not speak to this"
--               is a real result, never padding to avoid an empty row.
-- They are separate columns/keys rather than a flag on one list because a flag
-- can be dropped in a render and a column cannot.
--
-- No quote TEXT is stored (same rule as consumer_profiles): claims carry the
-- insight ids they were grounded in and the voices are resolved live, so an
-- erased comment cannot survive inside a stored answer.

create table if not exists public.plan_checks (
  id uuid default gen_random_uuid() primary key,
  client_id uuid not null references public.clients(id) on delete cascade,
  -- The run whose conversation produced the first answer. Nullable so a check
  -- outlives the run it was first measured against.
  run_id uuid references public.pipeline_runs(id) on delete set null,
  kind text not null,
  title text,
  -- The submitted text. Kept because re-evaluation must re-read the ORIGINAL
  -- claims: re-extracting from a summary would let the plan drift silently.
  input_text text not null,
  -- Set when the text came from an uploaded document. The file itself is never
  -- stored — only what was read out of it.
  source_filename text,
  claims jsonb not null default '[]'::jsonb,
  summary jsonb not null default '{}'::jsonb,
  judgement jsonb not null default '[]'::jsonb,
  -- auth.users id of the submitter. No FK: a check outlives a team member.
  created_by uuid,
  created_at timestamptz default now() not null,
  constraint plan_checks_kind_check check (kind in ('idea', 'plan'))
);

create index if not exists plan_checks_client_created_idx
  on public.plan_checks using btree (client_id, created_at desc);

comment on column public.plan_checks.claims is
  'ClaimResult[] — the GROUNDED register. Each: ref, claim, verdict (echoes|contradicts|silent), theySay, conversationCount, themeRefs (theme + registry ids), insightIds. No model opinion, no quote text.';
comment on column public.plan_checks.judgement is
  'The model''s own proposals, each citing the claim refs it reasons from. Rendered as judgement, never as evidence. Kept apart from claims so the two can never be merged by a careless render.';
comment on column public.plan_checks.input_text is
  'The submitted text verbatim. Re-evaluation re-reads THIS, so a later run tests the same plan rather than a drifted paraphrase of it.';

-- The time series: the same plan, re-tested against each later run.
create table if not exists public.plan_check_evaluations (
  id uuid default gen_random_uuid() primary key,
  plan_check_id uuid not null references public.plan_checks(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  run_id uuid references public.pipeline_runs(id) on delete set null,
  run_date date not null,
  claims jsonb not null default '[]'::jsonb,
  summary jsonb not null default '{}'::jsonb,
  -- Verdicts that CHANGED against the previous evaluation, with both sides.
  -- This is the whole reason the table exists — the weekly email says "your
  -- plan's assumption 4 moved from silent to contradicted", not "here is your
  -- plan again".
  moved jsonb not null default '[]'::jsonb,
  created_at timestamptz default now() not null,
  constraint plan_check_evaluations_check_run_key unique (plan_check_id, run_id)
);

create index if not exists plan_check_evaluations_check_date_idx
  on public.plan_check_evaluations using btree (plan_check_id, run_date desc);
create index if not exists plan_check_evaluations_client_run_idx
  on public.plan_check_evaluations using btree (client_id, run_id);

comment on column public.plan_check_evaluations.moved is
  'Claims whose verdict changed since the previous evaluation: { ref, claim, from, to }. Empty is meaningful — the plan still reads the same way against a week of new conversation.';

-- RLS — tenant reads its own; writes are service-role behind an authenticated
-- route, as everywhere else in this product.
alter table public.plan_checks enable row level security;
drop policy if exists "Users see their own plan_checks" on public.plan_checks;
create policy "Users see their own plan_checks" on public.plan_checks
  for select using (client_id = get_my_client_id());

alter table public.plan_check_evaluations enable row level security;
drop policy if exists "Users see their own plan_check_evaluations" on public.plan_check_evaluations;
create policy "Users see their own plan_check_evaluations" on public.plan_check_evaluations
  for select using (client_id = get_my_client_id());

-- Post-apply check (run by hand): both tables empty, RLS on, one policy each.
--   select count(*) from public.plan_checks;              -- 0
--   select count(*) from public.plan_check_evaluations;   -- 0
--   select tablename, policyname from pg_policies
--    where tablename in ('plan_checks', 'plan_check_evaluations');
