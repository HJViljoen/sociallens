-- Document reports (2026-08-31): a second kind of report next to the arranged
-- ones. A DOCUMENT is written by the Consumer Intelligence Agent in a role,
-- inside a fixed skeleton, from the update's data: the research and writing
-- happen at build, the result freezes as an ordinary report snapshot (kind
-- 'report', data.kind = 'document', quotes as refs), the PDF is an ordinary
-- artifact, links and schedules ride unchanged. The first template is the
-- Sales brief (vault: Projects/SaaS/Architecture/Sales-Brief).
--
-- Four things the arranged kind never needed:
--   1. reports.kind + reports.settings — which kind a row is, and a document's
--      few settings (who you sell to, competitors, language).
--   2. report_snapshots.workings — the Studio-only evidence behind each block
--      (grounded points, counts, quote refs, the questions asked). Its own
--      column so the render and share paths never select it: evidence stays
--      off the paper by construction, not by a flag a renderer could drop.
--   3. report_edits — the operator's edited text per block, an OVERLAY applied
--      at render. Snapshots stay write-once (share links, erasure and
--      evidence_ids all rely on that); an edit stales the PDF so the next
--      download re-renders with the edit in.
--   4. report_builds — a build takes minutes (agent questions, a writing
--      pass, a self-check, the render), so it runs as Inngest steps and this
--      row is what the Studio polls; a failed build is recorded here, which
--      no report build was before.
-- Plus review mode on schedules: a build ends as a send in status 'ready'
-- and a person's Send delivers it; any member may approve.

alter table public.reports add column if not exists kind text not null default 'arranged'
  check (kind in ('arranged', 'document'));
alter table public.reports add column if not exists settings jsonb not null default '{}'::jsonb;
comment on column public.reports.kind is
  'arranged = an ordered list of page sections (Stage 2); document = written by the agent in a role inside a fixed skeleton (Sales brief and later templates).';
comment on column public.reports.settings is
  'Document settings: { sellsTo, competitors, language, findings }. Empty for arranged reports.';

alter table public.report_snapshots add column if not exists workings jsonb;
comment on column public.report_snapshots.workings is
  'Document builds only: the evidence behind each block (insight ids, counts, theme labels, quote refs, the questions asked, cost). Read by the Studio; never by render or share. No quote text.';

create table if not exists public.report_edits (
  id uuid default gen_random_uuid() primary key,
  client_id uuid not null references public.clients(id) on delete cascade,
  snapshot_id uuid not null references public.report_snapshots(id) on delete cascade,
  block_id text not null,
  text text not null,
  edited_by uuid,
  edited_at timestamptz default now() not null,
  constraint report_edits_one_per_block unique (snapshot_id, block_id)
);
create index if not exists report_edits_snapshot_idx on public.report_edits using btree (snapshot_id);
comment on table public.report_edits is
  'The operator''s edited text per document block, applied over the frozen snapshot at render. Free text: erase-commenter scrubs it like plan_checks prose.';

create table if not exists public.report_builds (
  id uuid default gen_random_uuid() primary key,
  client_id uuid not null references public.clients(id) on delete cascade,
  report_id uuid references public.reports(id) on delete set null,
  schedule_id uuid references public.report_schedules(id) on delete set null,
  send_id uuid references public.report_sends(id) on delete set null,
  run_id uuid references public.pipeline_runs(id) on delete set null,
  status text not null default 'queued'
    check (status in ('queued', 'researching', 'writing', 'checking', 'rendering', 'delivering', 'done', 'failed')),
  needs_review boolean not null default false,
  error text,
  snapshot_id uuid references public.report_snapshots(id) on delete set null,
  artifact_id uuid references public.artifacts(id) on delete set null,
  cost_usd numeric(10, 6) not null default 0,
  requested_by uuid,
  started_at timestamptz default now() not null,
  finished_at timestamptz
);
create index if not exists report_builds_report_idx on public.report_builds using btree (report_id, started_at desc);
create index if not exists report_builds_client_idx on public.report_builds using btree (client_id, started_at desc);
comment on table public.report_builds is
  'One row per document build. The Studio polls status; needs_review is set when the self-check dropped a contradicted finding, and an automatic schedule then waits for a person instead of sending.';

alter table public.report_schedules add column if not exists review boolean not null default false;
comment on column public.report_schedules.review is
  'Review before sending: the build lands as a send in status ready, the workspace is emailed, and a member''s Send delivers it. Off = send automatically.';

alter table public.report_sends drop constraint if exists report_sends_status_check;
alter table public.report_sends add constraint report_sends_status_check
  check (status in ('claimed', 'ready', 'sent', 'failed', 'skipped'));
alter table public.report_sends add column if not exists approved_by uuid;
alter table public.report_sends add column if not exists ready_at timestamptz;
comment on column public.report_sends.approved_by is 'Who pressed Send on a review send (any member may).';

-- RLS: tenant reads its own; every write is the service role behind an
-- authenticated server action or route, as for reports / schedules.
alter table public.report_edits enable row level security;
drop policy if exists "Users see their own report_edits" on public.report_edits;
create policy "Users see their own report_edits" on public.report_edits
  for select using (client_id = (select get_my_client_id()));

alter table public.report_builds enable row level security;
drop policy if exists "Users see their own report_builds" on public.report_builds;
create policy "Users see their own report_builds" on public.report_builds
  for select using (client_id = (select get_my_client_id()));

-- Post-apply check (run by hand):
--   select column_name from information_schema.columns where table_name = 'reports' and column_name in ('kind', 'settings');
--   select pg_get_constraintdef(oid) from pg_constraint where conname = 'report_sends_status_check';
--   select tablename, policyname from pg_policies where tablename in ('report_edits', 'report_builds');
--   select count(*) from public.reports where kind <> 'arranged';  -- 0 on apply
