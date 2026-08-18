-- Tier 0 T0-2 (2026-08-18): lock the cost knobs, gate on billing, hold new
-- tenants until a human approves them.
--
-- Today `authenticated` holds UPDATE on all 16 tracking_configs columns with no
-- CHECK anywhere, and the RLS UPDATE policy's WITH CHECK only re-asserts the
-- tenant id. The settings page deliberately posts just four fields (its comment
-- says the knobs are "hidden, not blocked"), so a crafted POST from any tenant
-- admin could raise max_videos / comment_depth / max_comments / platforms /
-- industry_keywords and spend Apify and OpenAI money without limit. Column
-- privileges make that impossible rather than merely unlikely.
--
-- Prod values at apply time (all pass): max_videos 10-70, comment_depth 50-100,
-- max_comments 5-10, keywords <= 7 per bucket, platforms within the four known.

-- 1. Column-level UPDATE ------------------------------------------------------
-- updated_at is included because app/dashboard/settings/actions.ts writes it
-- alongside the four facts; without it every settings save would 403.
revoke update on public.tracking_configs from authenticated;
grant update (competitor_names, report_emails, report_period, report_day, updated_at)
  on public.tracking_configs to authenticated;

-- Report content is ours to write; a tenant member may only move a
-- recommendation through its lifecycle (the column exists and is unused today,
-- so this grants the future without granting the report body).
revoke update on public.recommendations from authenticated;
grant update (status) on public.recommendations to authenticated;

-- 2. Ceilings -----------------------------------------------------------------
-- Bounds, not policy: they sit far above every real value so an operator never
-- meets them, and a runaway config cannot outrun the account's credit.
alter table public.tracking_configs drop constraint if exists tracking_configs_cost_ceilings_check;
alter table public.tracking_configs add constraint tracking_configs_cost_ceilings_check check (
  (max_videos is null or (max_videos > 0 and max_videos <= 100)) and
  (comment_depth is null or (comment_depth > 0 and comment_depth <= 500)) and
  (max_comments is null or (max_comments > 0 and max_comments <= 1000)) and
  (industry_keywords is null or cardinality(industry_keywords) <= 15) and
  (competitor_keywords is null or cardinality(competitor_keywords) <= 15) and
  (brand_keywords is null or cardinality(brand_keywords) <= 15) and
  (competitor_names is null or cardinality(competitor_names) <= 15) and
  (report_emails is null or cardinality(report_emails) <= 25)
);

alter table public.tracking_configs drop constraint if exists tracking_configs_platforms_check;
alter table public.tracking_configs add constraint tracking_configs_platforms_check
  check (platforms is null or platforms <@ array['tiktok','youtube','instagram','reddit']::text[]);

-- 'paused' is a real production value (three tenants carry it) that exists only
-- in the database: the settings form's select cannot represent it, so a save
-- silently rewrote it to 'weekly' and re-armed the scheduler. The CHECK names
-- the vocabulary; app/dashboard/settings stops rewriting it in the same batch.
alter table public.tracking_configs drop constraint if exists tracking_configs_report_period_check;
alter table public.tracking_configs add constraint tracking_configs_report_period_check
  check (report_period is null or report_period in ('weekly', 'monthly', 'daily', 'paused'));

-- 3. Approval ------------------------------------------------------------------
-- A self-serve signup currently creates a live tenant that the Monday scheduler
-- picks up and starts spending on. New tenants now land inactive with no
-- approval stamp; an operator sets both. Existing tenants are stamped approved
-- so nothing changes for them.
alter table public.clients add column if not exists approved_at timestamptz;
update public.clients set approved_at = coalesce(approved_at, created_at) where approved_at is null;

comment on column public.clients.approved_at is
  'When an operator admitted this tenant to paid runs. Null = signed up but never approved: the dashboard says so and the scheduler never dispatches (is_active is false alongside).';
