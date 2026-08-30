-- Reports & Exports Stage 3 review follow-ups (2026-08-30).
--
-- 1. report_templates is retired: a workspace's own template IS its reports
--    row (Stage 3 folded the two); nothing reads the table any more.
-- 2. A send is part of the archive ("what went out"), so deleting its
--    schedule must not erase it: schedule_id → set null, and the schedule's
--    name travels on the row (the archive still says which schedule sent it).
-- 3. The unique (schedule_id, run_id) does not collide on NULLs: runs are
--    never deleted today, and if one ever is the send row's run_id nulls —
--    named here so nobody relies on the pair being unique for a null run.

drop table if exists public.report_templates;

alter table public.report_sends drop constraint if exists report_sends_schedule_id_fkey;
alter table public.report_sends alter column schedule_id drop not null;
alter table public.report_sends
  add constraint report_sends_schedule_id_fkey foreign key (schedule_id) references public.report_schedules(id) on delete set null;
alter table public.report_sends add column if not exists schedule_name text;
update public.report_sends s set schedule_name = r.name from public.report_schedules r where r.id = s.schedule_id and s.schedule_name is null;
comment on column public.report_sends.schedule_name is 'The schedule''s name when it sent — kept when the schedule is deleted (schedule_id nulls).';
comment on constraint report_sends_once_per_run on public.report_sends is 'One send per schedule per update. NULLs do not collide: a deleted run nulls run_id (never happens today).';

-- Post-apply check (run by hand):
--   select conname, pg_get_constraintdef(oid) from pg_constraint where conrelid = 'public.report_sends'::regclass;
--   select count(*) from information_schema.tables where table_name = 'report_templates';  -- 0
