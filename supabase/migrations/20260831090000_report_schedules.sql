-- Reports & Exports Stage 3 (2026-08-30): schedules and sends — the operator's
-- distribution lists, on the Stage-1/2 spine.
--
-- A SCHEDULE names what to send (a starter template by key, or one of the
-- workspace's own templates = a reports row), when (every scheduled update,
-- or the first update of each month) and to whom (its own recipient list).
-- When it fires after an update it builds an ordinary report snapshot
-- (kind 'report'), one PDF artifact and one share link, and records a SEND:
-- subject, recipients, the ids, the timestamps — never the email HTML. The
-- words stay live in the snapshot (quotes as refs), so erasure reaches a sent
-- update the same way it reaches a share link. weekly_reports (stored HTML,
-- one list per tenant) stops being written; its rows stay readable.
--
-- The claim on (schedule_id, run_id) is taken BEFORE anything renders, so an
-- Inngest retry after a lost response cannot send twice (the T0-6 rule,
-- carried over from weekly_reports).

create table if not exists public.report_schedules (
  id uuid default gen_random_uuid() primary key,
  client_id uuid not null references public.clients(id) on delete cascade,
  name text not null,
  starter_key text,
  report_id uuid references public.reports(id) on delete cascade,
  cadence text not null default 'every_update' check (cadence in ('every_update', 'monthly')),
  recipients text[] not null default '{}',
  attach_pdf boolean not null default true,
  share_days integer check (share_days is null or share_days in (7, 30, 90)),
  active boolean not null default true,
  is_default boolean not null default false,
  last_sent_at timestamptz,
  created_by uuid,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null,
  constraint report_schedules_one_source check ((starter_key is not null) <> (report_id is not null))
);
create index if not exists report_schedules_client_idx on public.report_schedules using btree (client_id, created_at);
create unique index if not exists report_schedules_one_default on public.report_schedules (client_id) where is_default;
comment on column public.report_schedules.recipients is
  'Lower-cased, deduplicated addresses; at most 25 (the old tracking_configs.report_emails cap). Owners and admins edit; an accepted invite joins the default schedule.';
comment on column public.report_schedules.share_days is
  'Life of the share link put in each email: 7, 30, 90 or null (never expires).';

create table if not exists public.report_sends (
  id uuid default gen_random_uuid() primary key,
  client_id uuid not null references public.clients(id) on delete cascade,
  schedule_id uuid not null references public.report_schedules(id) on delete cascade,
  run_id uuid references public.pipeline_runs(id) on delete set null,
  snapshot_id uuid references public.report_snapshots(id) on delete set null,
  artifact_id uuid references public.artifacts(id) on delete set null,
  share_link_id uuid references public.share_links(id) on delete set null,
  subject text,
  recipients text[] not null default '{}',
  status text not null default 'claimed' check (status in ('claimed', 'sent', 'failed', 'skipped')),
  error text,
  claimed_at timestamptz default now() not null,
  sent_at timestamptz,
  constraint report_sends_once_per_run unique (schedule_id, run_id)
);
create index if not exists report_sends_client_sent_idx on public.report_sends using btree (client_id, claimed_at desc);
comment on table public.report_sends is
  'One row per schedule per update. No email body is stored: the "email as sent" view re-renders from the snapshot, so an erased voice is gone at the next look.';

-- RLS — tenant reads its own; writes are service-role behind an authenticated
-- route or server action, as for reports / share_links.
alter table public.report_schedules enable row level security;
drop policy if exists "Users see their own report_schedules" on public.report_schedules;
create policy "Users see their own report_schedules" on public.report_schedules
  for select using (client_id = (select get_my_client_id()));

alter table public.report_sends enable row level security;
drop policy if exists "Users see their own report_sends" on public.report_sends;
create policy "Users see their own report_sends" on public.report_sends
  for select using (client_id = (select get_my_client_id()));

-- Backfill: every workspace gets its default "Weekly digest" schedule carrying
-- the recipient list it had on tracking_configs, so nobody stops receiving the
-- update the morning this lands. tracking_configs.report_emails is not read
-- after this migration; the column is dropped later.
insert into public.report_schedules (client_id, name, starter_key, cadence, recipients, attach_pdf, share_days, active, is_default)
select t.client_id, 'Weekly digest', 'weekly_digest', 'every_update', coalesce(t.report_emails, '{}'), true, 30, true, true
from public.tracking_configs t
where not exists (select 1 from public.report_schedules s where s.client_id = t.client_id and s.is_default);

-- Post-apply check (run by hand):
--   select tablename, policyname, cmd from pg_policies where tablename in ('report_schedules', 'report_sends');
--   select c.company_name, s.name, s.cadence, cardinality(s.recipients) as recipients, s.is_default
--     from public.report_schedules s join public.clients c on c.id = s.client_id order by 1;
--   -- expect one default row per tracking_configs row, recipients = the old report_emails
