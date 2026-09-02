-- One schedule per report (2026-09-02).
--
-- The Studio has always assumed it: `scheduleOf` is a Map keyed by report_id,
-- so a second schedule on the same report silently disappeared behind
-- whichever row came back last, taking its recipients and its review flag with
-- it. Nothing enforced it, so the assumption was only ever true by luck.
--
-- Checked before writing this: production holds four schedules, one per
-- workspace, none sharing a report. The index therefore adds a rule rather
-- than breaking existing data.
--
-- A starter-key schedule is deliberately NOT covered: a workspace may well
-- want the Weekly digest going to two lists on two cadences, and nothing in
-- the UI keys off starter_key the way it does off report_id.
create unique index if not exists report_schedules_one_per_report
  on public.report_schedules (report_id)
  where report_id is not null;

comment on index public.report_schedules_one_per_report is
  'The Studio edits one schedule in place per report; a second row would be invisible there.';

-- Verify:
--   select report_id, count(*) from public.report_schedules where report_id is not null group by 1 having count(*) > 1;
