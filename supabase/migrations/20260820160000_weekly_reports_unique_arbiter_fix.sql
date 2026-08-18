-- Correction to 20260820140000_report_idempotency.sql, same day (T0-6).
--
-- That index was created PARTIAL (`where run_id is not null`). Postgres cannot
-- infer a partial unique index from `ON CONFLICT (client_id, run_id)` unless the
-- statement repeats the index predicate, and PostgREST does not emit one, so
-- lib/report.ts's upsert would have failed 42P10 ("no unique or exclusion
-- constraint matching the ON CONFLICT specification") on EVERY report. Caught by
-- probing this database directly rather than by reading the docs; both the
-- failure and the fix were verified against it in rolled-back transactions.
--
-- A plain unique index is inferrable and keeps the semantics we wanted: NULLs
-- are distinct in a Postgres unique index, so rows with a null run_id (a report
-- stored outside a run) can still repeat. Verified: two null-run_id rows insert
-- fine under this index.
drop index if exists public.weekly_reports_client_run_unique;
create unique index weekly_reports_client_run_unique
  on public.weekly_reports (client_id, run_id);

comment on index public.weekly_reports_client_run_unique is
  'T0-6: one stored report per run. Deliberately NOT partial — a partial index cannot serve as an ON CONFLICT arbiter for PostgREST upserts. Null run_id rows stay repeatable because unique indexes treat NULLs as distinct.';
