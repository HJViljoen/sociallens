-- One document build in flight per report (M3, 2026-08-31): two racing POSTs
-- both saw "free"; the second insert now fails and the route answers 409
-- with the winner's id. Finished builds (done/failed) do not block.
create unique index if not exists report_builds_one_active_per_report
  on public.report_builds (report_id)
  where status in ('queued', 'researching', 'writing', 'checking', 'rendering', 'delivering');
