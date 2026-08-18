-- Tier 0 T0-6 (2026-08-18): one stored report per run.
--
-- lib/report.ts sends the email and THEN inserts into weekly_reports, with no
-- unique key and no pre-check, inside an Inngest step that retries twice. If
-- the insert fails or the step's response is lost after a successful send, the
-- retry sends the client a second copy of the same update. Low probability,
-- high embarrassment, and the fix is a unique index plus writing the row first.
--
-- Checked before applying: no client has two weekly_reports rows for one run.

create unique index if not exists weekly_reports_client_run_unique
  on public.weekly_reports (client_id, run_id)
  where run_id is not null;
