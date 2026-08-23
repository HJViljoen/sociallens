-- Performance advisors, 2026-08-23 (perf pass that shipped the skeleton
-- loaders). Two things the Supabase linter flagged:
--
-- 1. Unindexed foreign keys — every run-scoped table filters by run_id (the
--    pages anchor on the latest completed run) and pruning/deletes walk these
--    FKs; a missing index makes both a scan. Plain btree on each FK column.
--    CONCURRENTLY is not available inside a migration transaction; the tables
--    are small enough (200 MB DB) that a brief lock is fine.
--
-- 2. RLS initplan — seven "Users can view own …" policies call auth.uid()
--    bare inside the USING subquery, which Postgres re-evaluates PER ROW.
--    Wrapping it as (select auth.uid()) makes it an initplan, evaluated once
--    per statement. Same predicate, same rows, no semantic change.

create index if not exists account_events_run_id_idx            on public.account_events (run_id);
create index if not exists account_events_video_id_idx          on public.account_events (video_id);
create index if not exists account_snapshots_run_id_idx         on public.account_snapshots (run_id);
create index if not exists agent_messages_run_id_idx            on public.agent_messages (run_id);
create index if not exists agent_threads_plan_check_id_idx      on public.agent_threads (plan_check_id);
create index if not exists ai_call_log_run_id_idx               on public.ai_call_log (run_id);
create index if not exists audience_insights_run_id_idx         on public.audience_insights (run_id);
create index if not exists comments_run_id_idx                  on public.comments (run_id);
create index if not exists competitive_insights_run_id_idx      on public.competitive_insights (run_id);
create index if not exists consumer_profiles_run_id_idx         on public.consumer_profiles (run_id);
create index if not exists gate_verdicts_run_id_idx             on public.gate_verdicts (run_id);
create index if not exists insight_evidence_source_video_id_idx on public.insight_evidence (source_video_id);
create index if not exists invitations_invited_by_idx           on public.invitations (invited_by);
create index if not exists keyword_performance_run_id_idx       on public.keyword_performance (run_id);
create index if not exists language_samples_comment_id_idx      on public.language_samples (comment_id);
create index if not exists language_samples_run_id_idx          on public.language_samples (run_id);
create index if not exists language_samples_source_video_id_idx on public.language_samples (source_video_id);
create index if not exists market_insights_run_id_idx           on public.market_insights (run_id);
create index if not exists news_items_run_id_idx                on public.news_items (run_id);
create index if not exists plan_check_evaluations_run_id_idx    on public.plan_check_evaluations (run_id);
create index if not exists plan_checks_run_id_idx               on public.plan_checks (run_id);
create index if not exists recommendations_run_id_idx           on public.recommendations (run_id);
create index if not exists run_summary_run_id_idx               on public.run_summary (run_id);
create index if not exists theme_observations_run_id_idx        on public.theme_observations (run_id);
create index if not exists theme_registry_first_seen_run_id_idx on public.theme_registry (first_seen_run_id);
create index if not exists theme_registry_last_seen_run_id_idx  on public.theme_registry (last_seen_run_id);
create index if not exists theme_registry_parent_theme_id_idx   on public.theme_registry (parent_theme_id);
create index if not exists themes_registry_id_idx               on public.themes (registry_id);
create index if not exists themes_run_id_idx                    on public.themes (run_id);
create index if not exists video_claims_source_video_id_idx     on public.video_claims (source_video_id);
create index if not exists videos_analyzed_run_id_idx           on public.videos (analyzed_run_id);
create index if not exists weekly_reports_run_id_idx            on public.weekly_reports (run_id);

-- Duplicate index flagged by the linter: identical to idx_videos_client_competitor.
drop index if exists public.videos_is_competitor_idx;

alter policy "Users can view own audience_insights"    on public.audience_insights    using (client_id = (select u.client_id from public.users u where u.id = (select auth.uid())));
alter policy "Users can view own comments"             on public.comments             using (client_id = (select u.client_id from public.users u where u.id = (select auth.uid())));
alter policy "Users can view own competitive_insights" on public.competitive_insights using (client_id = (select u.client_id from public.users u where u.id = (select auth.uid())));
alter policy "Users can view own market_insights"      on public.market_insights      using (client_id = (select u.client_id from public.users u where u.id = (select auth.uid())));
alter policy "Users can view own recommendations"      on public.recommendations      using (client_id = (select u.client_id from public.users u where u.id = (select auth.uid())));
alter policy "Users can update own recommendations"    on public.recommendations
  using      (client_id = (select u.client_id from public.users u where u.id = (select auth.uid())))
  with check (client_id = (select u.client_id from public.users u where u.id = (select auth.uid())));
alter policy "Users can view own run_summary"          on public.run_summary          using (client_id = (select u.client_id from public.users u where u.id = (select auth.uid())));
