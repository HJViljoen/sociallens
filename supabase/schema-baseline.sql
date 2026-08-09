-- Verbatim — full schema baseline
--
-- Captured from the production Supabase project (mkwjlckescdveosvrvaq) on
-- 2026-08-09 by introspecting pg_catalog (the project has no linked Supabase
-- CLI and the pre-2026-06-29 schema was never in git — this file closes that
-- gap). It supersedes every file in supabase/migrations/ dated on or before
-- 2026-08-08: those are historical record, already folded in here.
--
-- Fresh database = run this file, then any migrations dated AFTER 2026-08-09.
--
-- Restore notes:
-- * On Supabase, the auth schema, auth.uid(), and the anon/authenticated/
--   service_role grants already exist — this file assumes them.
-- * On plain Postgres (schema-only smoke test), create a shim first:
--     create schema auth;
--     create table auth.users (id uuid primary key);
--     create function auth.uid() returns uuid language sql as 'select null::uuid';
-- * supabase_vault and pg_stat_statements are platform-managed extensions the
--   app schema does not depend on; they are deliberately not created here.

set check_function_bodies = off;

create extension if not exists pgcrypto;
create extension if not exists "uuid-ossp";

-- ---------------------------------------------------------------- tables ----

create table public.account_events (
  id uuid default gen_random_uuid() not null,
  client_id uuid not null,
  run_id uuid not null,
  platform text not null,
  metric text not null,
  event_date date not null,
  direction text not null,
  magnitude_pct numeric,
  magnitude_label text not null,
  severity integer not null,
  video_id uuid,
  explained boolean default false not null,
  explanation text,
  supporting_theme_labels text[] default '{}'::text[] not null,
  hero_quote text,
  created_at timestamp with time zone default now() not null
);

create table public.account_snapshots (
  id uuid default gen_random_uuid() not null,
  client_id uuid not null,
  run_id uuid,
  platform text not null,
  handle text,
  snapshot_date date not null,
  followers integer,
  posts_count integer,
  metrics jsonb,
  created_at timestamp with time zone default now() not null
);

create table public.ai_call_log (
  id uuid default gen_random_uuid() not null,
  client_id uuid,
  run_id uuid,
  pass text not null,
  call_index integer,
  model text not null,
  prompt_version text,
  request jsonb not null,
  response jsonb,
  error_message text,
  prompt_tokens integer,
  completion_tokens integer,
  cost_usd numeric(10,6),
  duration_ms integer,
  validation_status text,
  created_at timestamp with time zone default now()
);

create table public.audience_insights (
  id uuid default gen_random_uuid() not null,
  client_id uuid not null,
  run_id uuid not null,
  platform text,
  category text not null,
  theme text not null,
  description text not null,
  evidence jsonb default '[]'::jsonb,
  strength_score integer,
  emotion text,
  sentiment_impact text,
  created_at timestamp with time zone default now(),
  source_video_id uuid,
  journey_stage text
);

create table public.clients (
  id uuid default gen_random_uuid() not null,
  company_name text not null,
  plan text default 'trial'::text not null,
  is_active boolean default true not null,
  trial_ends_at timestamp with time zone,
  stripe_customer_id text,
  created_at timestamp with time zone default now() not null,
  is_comped boolean default false not null,
  stripe_subscription_id text,
  subscription_status text
);

create table public.comments (
  id uuid default gen_random_uuid() not null,
  client_id uuid not null,
  run_id uuid not null,
  video_id text not null,
  platform text not null,
  comment_id text not null,
  author text,
  text text,
  likes integer default 0,
  reply_count integer default 0,
  is_reply boolean default false,
  comment_date timestamp with time zone,
  created_at timestamp with time zone default now(),
  is_low_signal boolean default false,
  client_brand_mention boolean default false not null,
  brand_mention_keyword text,
  source text default 'discovered'::text not null
);

create table public.competitive_insights (
  id uuid default gen_random_uuid() not null,
  client_id uuid not null,
  run_id uuid not null,
  category text not null,
  competitor_name text,
  title text not null,
  finding text not null,
  evidence jsonb default '{}'::jsonb,
  impact_level text,
  created_at timestamp with time zone default now(),
  hero_quote text
);

create table public.insight_evidence (
  id uuid default gen_random_uuid() not null,
  audience_insight_id uuid not null,
  comment_id uuid,
  quote text not null,
  relevance_rank integer,
  created_at timestamp with time zone default now(),
  source text default 'comment'::text not null,
  source_video_id uuid
);

create table public.invitations (
  id uuid default gen_random_uuid() not null,
  client_id uuid not null,
  email text not null,
  role text default 'member'::text not null,
  token text not null,
  invited_by uuid,
  status text default 'pending'::text not null,
  created_at timestamp with time zone default now() not null,
  expires_at timestamp with time zone default (now() + '7 days'::interval) not null,
  accepted_at timestamp with time zone
);

create table public.keyword_performance (
  id uuid default gen_random_uuid() not null,
  client_id uuid not null,
  run_id uuid not null,
  platform text not null,
  keyword text not null,
  bucket text not null,
  videos_found integer default 0 not null,
  gate_survived integer default 0 not null,
  eligible_videos integer default 0 not null,
  insights_contributed integer,
  value_score numeric(6,2),
  created_at timestamp with time zone default now() not null
);

create table public.language_samples (
  id uuid default gen_random_uuid() not null,
  client_id uuid not null,
  run_id uuid not null,
  platform text,
  source_video_id uuid,
  comment_id uuid,
  phrase text not null,
  created_at timestamp with time zone default now() not null
);

create table public.market_insights (
  id uuid default gen_random_uuid() not null,
  client_id uuid not null,
  run_id uuid not null,
  insight_type text not null,
  title text not null,
  description text not null,
  evidence jsonb default '{}'::jsonb,
  confidence_score integer,
  opportunity_score integer,
  created_at timestamp with time zone default now(),
  hero_quote text
);

create table public.pipeline_runs (
  id uuid default gen_random_uuid() not null,
  client_id uuid not null,
  status text default 'running'::text not null,
  videos_scraped integer,
  error_message text,
  started_at timestamp with time zone default now() not null,
  completed_at timestamp with time zone,
  errors jsonb default '[]'::jsonb,
  steps_completed text[] default '{}'::text[]
);

create table public.platform_admins (
  user_id uuid not null,
  created_at timestamp with time zone default now() not null
);

create table public.recommendations (
  id uuid default gen_random_uuid() not null,
  client_id uuid not null,
  run_id uuid not null,
  type text not null,
  title text not null,
  reasoning text not null,
  priority text,
  based_on jsonb default '{}'::jsonb,
  status text default 'new'::text,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  hero_quote text
);

create table public.run_summary (
  id uuid default gen_random_uuid() not null,
  client_id uuid not null,
  run_id uuid not null,
  total_videos integer default 0,
  total_comments integer default 0,
  client_videos integer default 0,
  competitor_videos integer default 0,
  platforms_covered text[] default '{}'::text[],
  avg_engagement_rate numeric(8,4),
  top_video_id text,
  top_video_views bigint,
  top_video_platform text,
  share_of_voice jsonb default '{}'::jsonb,
  platforms_summary jsonb default '{}'::jsonb,
  overall_sentiment_positive numeric(5,2),
  overall_sentiment_neutral numeric(5,2),
  overall_sentiment_negative numeric(5,2),
  sentiment_drivers jsonb default '{}'::jsonb,
  top_insights jsonb default '[]'::jsonb,
  wow_sentiment_change numeric(5,2),
  wow_engagement_change numeric(5,2),
  wow_highlights jsonb,
  created_at timestamp with time zone default now(),
  period text default 'weekly'::text,
  run_date timestamp with time zone default now(),
  consumer_intelligence_summary jsonb,
  period_videos integer,
  period_comments integer,
  period_client_videos integer,
  period_competitor_videos integer,
  period_avg_engagement_rate numeric,
  period_share_of_voice jsonb,
  period_sentiment_positive numeric,
  period_sentiment_neutral numeric,
  period_sentiment_negative numeric,
  period_sentiment_drivers jsonb,
  executive_brief jsonb,
  say_vs_hear jsonb
);

create table public.themes (
  id uuid default gen_random_uuid() not null,
  client_id uuid not null,
  run_id uuid not null,
  bucket text not null,
  category text not null,
  label text not null,
  description text,
  member_themes text[] default '{}'::text[] not null,
  supporting_insight_ids uuid[] default '{}'::uuid[] not null,
  supporting_video_ids uuid[] default '{}'::uuid[] not null,
  evidence_count integer default 0 not null,
  strength_score integer,
  dominant_emotion text,
  dominant_sentiment_impact text,
  single_source boolean default false not null,
  first_seen boolean default true not null,
  embedding jsonb,
  created_at timestamp with time zone default now() not null
);

create table public.tracking_configs (
  id uuid default gen_random_uuid() not null,
  client_id uuid not null,
  brand_keywords text[] default '{}'::text[] not null,
  competitor_keywords text[] default '{}'::text[] not null,
  competitor_names text[] default '{}'::text[] not null,
  platforms text[] default '{}'::text[] not null,
  report_emails text[] default '{}'::text[] not null,
  report_day text default 'monday'::text not null,
  updated_at timestamp with time zone default now() not null,
  max_videos integer default 10 not null,
  max_comments integer default 100 not null,
  report_period text default 'weekly'::text not null,
  industry_keywords text[] default '{}'::text[],
  comment_depth integer default 50
);

create table public.users (
  id uuid not null,
  client_id uuid not null,
  full_name text not null,
  email text not null,
  role text default 'member'::text not null,
  created_at timestamp with time zone default now() not null
);

create table public.video_claims (
  id uuid default gen_random_uuid() not null,
  client_id uuid not null,
  run_id uuid not null,
  platform text not null,
  source_video_id uuid not null,
  entity text not null,
  competitor_name text,
  claim text not null,
  quote text not null,
  created_at timestamp with time zone default now() not null
);

create table public.video_raw (
  id bigint generated always as identity not null,
  client_id uuid not null,
  run_id uuid not null,
  platform text not null,
  video_id text not null,
  raw jsonb not null,
  captured_at timestamp with time zone default now() not null
);

create table public.videos (
  id uuid default gen_random_uuid() not null,
  client_id uuid not null,
  run_id uuid,
  platform text not null,
  video_id text not null,
  video_url text not null,
  account_name text not null,
  is_competitor boolean default false not null,
  competitor_name text,
  caption text,
  hashtags text[] default '{}'::text[],
  views integer default 0 not null,
  likes integer default 0 not null,
  shares integer default 0 not null,
  comments_count integer default 0 not null,
  engagement_rate numeric(5,2),
  upload_date date,
  classified_type text,
  hook_style text,
  scraped_at timestamp with time zone default now() not null,
  is_client boolean default false,
  audio_name text,
  is_sponsored boolean default false,
  content_format text,
  hook_text text,
  topics text[] default '{}'::text[],
  sentiment text,
  comment_quality_score integer,
  account_followers integer default 0,
  duration_seconds integer default 0,
  source_keywords text[] default '{}'::text[] not null,
  source text default 'discovered'::text not null,
  comments_count_at_scrape integer,
  transcript text,
  transcript_lang text,
  transcript_source text,
  transcript_status text
);

create table public.weekly_reports (
  id uuid default gen_random_uuid() not null,
  client_id uuid not null,
  run_id uuid,
  html_content text not null,
  week_start date,
  week_end date,
  sent_to text[] default '{}'::text[] not null,
  sent_at timestamp with time zone default now(),
  subject text
);

-- ---------------------------------------------- primary keys & uniques ----

alter table public.account_events add constraint account_events_pkey primary key (id);
alter table public.account_snapshots add constraint account_snapshots_pkey primary key (id);
alter table public.ai_call_log add constraint ai_call_log_pkey primary key (id);
alter table public.audience_insights add constraint audience_insights_pkey primary key (id);
alter table public.clients add constraint clients_pkey primary key (id);
alter table public.comments add constraint comments_pkey primary key (id);
alter table public.competitive_insights add constraint competitive_insights_pkey primary key (id);
alter table public.insight_evidence add constraint insight_evidence_pkey primary key (id);
alter table public.invitations add constraint invitations_pkey primary key (id);
alter table public.keyword_performance add constraint keyword_performance_pkey primary key (id);
alter table public.language_samples add constraint language_samples_pkey primary key (id);
alter table public.market_insights add constraint market_insights_pkey primary key (id);
alter table public.pipeline_runs add constraint pipeline_runs_pkey primary key (id);
alter table public.platform_admins add constraint platform_admins_pkey primary key (user_id);
alter table public.recommendations add constraint recommendations_pkey primary key (id);
alter table public.run_summary add constraint run_summary_pkey primary key (id);
alter table public.themes add constraint themes_pkey primary key (id);
alter table public.tracking_configs add constraint tracking_configs_pkey primary key (id);
alter table public.users add constraint users_pkey primary key (id);
alter table public.video_claims add constraint video_claims_pkey primary key (id);
alter table public.video_raw add constraint video_raw_pkey primary key (id);
alter table public.videos add constraint videos_pkey primary key (id);
alter table public.weekly_reports add constraint weekly_reports_pkey primary key (id);

alter table public.account_snapshots add constraint account_snapshots_client_id_platform_snapshot_date_key unique (client_id, platform, snapshot_date);
alter table public.comments add constraint comments_unique unique (client_id, platform, comment_id);
alter table public.invitations add constraint invitations_token_key unique (token);
alter table public.keyword_performance add constraint keyword_performance_client_id_run_id_platform_keyword_key unique (client_id, run_id, platform, keyword);
alter table public.run_summary add constraint run_summary_unique unique (client_id, run_id);
alter table public.tracking_configs add constraint tracking_configs_client_id_key unique (client_id);
alter table public.users add constraint users_email_key unique (email);
alter table public.video_raw add constraint video_raw_client_id_platform_video_id_run_id_key unique (client_id, platform, video_id, run_id);
alter table public.videos add constraint videos_client_id_platform_video_id_key unique (client_id, platform, video_id);

-- ---------------------------------------------------------------- checks ----

alter table public.account_events add constraint account_events_direction_check check ((direction = any (array['up'::text, 'down'::text])));
alter table public.account_events add constraint account_events_metric_check check ((metric = any (array['followers'::text, 'post_performance'::text])));
alter table public.account_events add constraint account_events_severity_check check (((severity >= 1) and (severity <= 3)));
alter table public.audience_insights add constraint audience_insights_emotion_check check ((emotion = any (array['frustrated'::text, 'excited'::text, 'confused'::text, 'angry'::text, 'joyful'::text, 'disappointed'::text, 'hopeful'::text, 'curious'::text, 'neutral'::text])));
alter table public.audience_insights add constraint audience_insights_strength_score_check check (((strength_score >= 1) and (strength_score <= 10)));
alter table public.comments add constraint comments_source_check check ((source = any (array['discovered'::text, 'owned'::text])));
alter table public.competitive_insights add constraint competitive_insights_impact_level_check check ((impact_level = any (array['high'::text, 'medium'::text, 'low'::text])));
alter table public.insight_evidence add constraint insight_evidence_source_check check ((source = any (array['comment'::text, 'video'::text])));
alter table public.insight_evidence add constraint insight_evidence_source_shape check ((((source = 'comment'::text) and (comment_id is not null) and (source_video_id is null)) or ((source = 'video'::text) and (source_video_id is not null) and (comment_id is null))));
alter table public.invitations add constraint invitations_role_check check ((role = any (array['owner'::text, 'admin'::text, 'member'::text])));
alter table public.invitations add constraint invitations_status_check check ((status = any (array['pending'::text, 'accepted'::text, 'revoked'::text])));
alter table public.keyword_performance add constraint keyword_performance_bucket_check check ((bucket = any (array['brand'::text, 'competitor'::text, 'industry'::text])));
alter table public.market_insights add constraint market_insights_confidence_score_check check (((confidence_score >= 1) and (confidence_score <= 10)));
alter table public.market_insights add constraint market_insights_opportunity_score_check check (((opportunity_score >= 1) and (opportunity_score <= 10)));
alter table public.recommendations add constraint recommendations_priority_check check ((priority = any (array['high'::text, 'medium'::text, 'low'::text])));
alter table public.recommendations add constraint recommendations_status_check check ((status = any (array['new'::text, 'acknowledged'::text, 'acted_on'::text, 'dismissed'::text])));
alter table public.themes add constraint themes_strength_score_check check (((strength_score >= 1) and (strength_score <= 10)));
alter table public.users add constraint users_role_check check ((role = any (array['owner'::text, 'admin'::text, 'member'::text])));
alter table public.video_claims add constraint video_claims_check check (((entity = 'client'::text) or (competitor_name is not null)));
alter table public.video_claims add constraint video_claims_entity_check check ((entity = any (array['client'::text, 'competitor'::text])));
alter table public.videos add constraint videos_classified_type_check check ((classified_type = any (array['tutorial'::text, 'review'::text, 'comparison'::text, 'testimonial'::text, 'unboxing'::text, 'how-to'::text, 'story'::text, 'challenge'::text, 'behind-the-scenes'::text, 'educational'::text, 'promotional'::text, 'entertainment'::text])));
alter table public.videos add constraint videos_hook_style_check check ((hook_style = any (array['question'::text, 'statistic'::text, 'bold-claim'::text, 'personal-story'::text, 'before-after'::text, 'controversy'::text, 'demonstration'::text, 'listicle'::text, 'trend-riding'::text, 'shock-value'::text])));
alter table public.videos add constraint videos_source_check check ((source = any (array['discovered'::text, 'owned'::text])));

-- ------------------------------------------------------------- functions ----
-- RLS helpers. SECURITY DEFINER so policies can consult users/platform_admins
-- without recursive RLS; auth.uid() is Supabase-provided.

create or replace function public.get_my_client_id()
 returns uuid
 language sql
 stable security definer
 set search_path to 'public', 'pg_temp'
as $function$ select client_id from public.users where id = auth.uid() $function$;

create or replace function public.get_my_role()
 returns text
 language sql
 stable security definer
 set search_path to 'public', 'pg_temp'
as $function$ select role from public.users where id = auth.uid() $function$;

create or replace function public.is_superadmin()
 returns boolean
 language sql
 stable security definer
 set search_path to 'public', 'pg_temp'
as $function$ select exists (select 1 from public.platform_admins where user_id = auth.uid()) $function$;

-- ---------------------------------------------------------- foreign keys ----

alter table public.account_events add constraint account_events_client_id_fkey foreign key (client_id) references clients(id) on delete cascade;
alter table public.account_events add constraint account_events_run_id_fkey foreign key (run_id) references pipeline_runs(id) on delete cascade;
alter table public.account_events add constraint account_events_video_id_fkey foreign key (video_id) references videos(id) on delete cascade;
alter table public.account_snapshots add constraint account_snapshots_client_id_fkey foreign key (client_id) references clients(id) on delete cascade;
alter table public.account_snapshots add constraint account_snapshots_run_id_fkey foreign key (run_id) references pipeline_runs(id) on delete set null;
alter table public.ai_call_log add constraint ai_call_log_client_id_fkey foreign key (client_id) references clients(id);
alter table public.ai_call_log add constraint ai_call_log_run_id_fkey foreign key (run_id) references pipeline_runs(id);
alter table public.audience_insights add constraint audience_insights_client_id_fkey foreign key (client_id) references clients(id) on delete cascade;
alter table public.audience_insights add constraint audience_insights_run_id_fkey foreign key (run_id) references pipeline_runs(id) on delete cascade;
alter table public.audience_insights add constraint audience_insights_source_video_id_fkey foreign key (source_video_id) references videos(id) on delete cascade;
alter table public.comments add constraint comments_client_id_fkey foreign key (client_id) references clients(id) on delete cascade;
alter table public.comments add constraint comments_run_id_fkey foreign key (run_id) references pipeline_runs(id) on delete cascade;
alter table public.competitive_insights add constraint competitive_insights_client_id_fkey foreign key (client_id) references clients(id) on delete cascade;
alter table public.competitive_insights add constraint competitive_insights_run_id_fkey foreign key (run_id) references pipeline_runs(id) on delete cascade;
alter table public.insight_evidence add constraint insight_evidence_audience_insight_id_fkey foreign key (audience_insight_id) references audience_insights(id) on delete cascade;
alter table public.insight_evidence add constraint insight_evidence_comment_id_fkey foreign key (comment_id) references comments(id) on delete cascade;
alter table public.insight_evidence add constraint insight_evidence_source_video_id_fkey foreign key (source_video_id) references videos(id) on delete cascade;
alter table public.invitations add constraint invitations_client_id_fkey foreign key (client_id) references clients(id) on delete cascade;
alter table public.invitations add constraint invitations_invited_by_fkey foreign key (invited_by) references auth.users(id) on delete set null;
alter table public.keyword_performance add constraint keyword_performance_client_id_fkey foreign key (client_id) references clients(id) on delete cascade;
alter table public.keyword_performance add constraint keyword_performance_run_id_fkey foreign key (run_id) references pipeline_runs(id) on delete cascade;
alter table public.language_samples add constraint language_samples_client_id_fkey foreign key (client_id) references clients(id) on delete cascade;
alter table public.language_samples add constraint language_samples_comment_id_fkey foreign key (comment_id) references comments(id) on delete cascade;
alter table public.language_samples add constraint language_samples_run_id_fkey foreign key (run_id) references pipeline_runs(id) on delete cascade;
alter table public.language_samples add constraint language_samples_source_video_id_fkey foreign key (source_video_id) references videos(id) on delete cascade;
alter table public.market_insights add constraint market_insights_client_id_fkey foreign key (client_id) references clients(id) on delete cascade;
alter table public.market_insights add constraint market_insights_run_id_fkey foreign key (run_id) references pipeline_runs(id) on delete cascade;
alter table public.pipeline_runs add constraint pipeline_runs_client_id_fkey foreign key (client_id) references clients(id) on delete cascade;
alter table public.platform_admins add constraint platform_admins_user_id_fkey foreign key (user_id) references auth.users(id) on delete cascade;
alter table public.recommendations add constraint recommendations_client_id_fkey foreign key (client_id) references clients(id) on delete cascade;
alter table public.recommendations add constraint recommendations_run_id_fkey foreign key (run_id) references pipeline_runs(id) on delete cascade;
alter table public.run_summary add constraint run_summary_client_id_fkey foreign key (client_id) references clients(id) on delete cascade;
alter table public.run_summary add constraint run_summary_run_id_fkey foreign key (run_id) references pipeline_runs(id) on delete cascade;
alter table public.themes add constraint themes_client_id_fkey foreign key (client_id) references clients(id) on delete cascade;
alter table public.themes add constraint themes_run_id_fkey foreign key (run_id) references pipeline_runs(id) on delete cascade;
alter table public.tracking_configs add constraint tracking_configs_client_id_fkey foreign key (client_id) references clients(id) on delete cascade;
alter table public.users add constraint users_client_id_fkey foreign key (client_id) references clients(id) on delete cascade;
alter table public.video_claims add constraint video_claims_source_video_id_fkey foreign key (source_video_id) references videos(id) on delete cascade;
alter table public.videos add constraint videos_client_id_fkey foreign key (client_id) references clients(id) on delete cascade;
alter table public.videos add constraint videos_run_id_fkey foreign key (run_id) references pipeline_runs(id) on delete set null;
alter table public.weekly_reports add constraint weekly_reports_client_id_fkey foreign key (client_id) references clients(id) on delete cascade;
alter table public.weekly_reports add constraint weekly_reports_run_id_fkey foreign key (run_id) references pipeline_runs(id) on delete set null;

-- --------------------------------------------------------------- indexes ----

create index account_events_client_run_idx on public.account_events using btree (client_id, run_id);
create index account_snapshots_client_platform_idx on public.account_snapshots using btree (client_id, platform, snapshot_date);
create index idx_ai_call_log_pass on public.ai_call_log using btree (pass, prompt_version);
create index idx_ai_call_log_run on public.ai_call_log using btree (client_id, run_id);
create index idx_audience_insights_client_run on public.audience_insights using btree (client_id, run_id);
create index idx_audience_insights_client_run_category on public.audience_insights using btree (client_id, run_id, category);
create index idx_audience_insights_source_video on public.audience_insights using btree (source_video_id);
create index idx_comments_client_platform_video on public.comments using btree (client_id, platform, video_id);
create index idx_comments_client_run on public.comments using btree (client_id, run_id);
create index idx_comments_text_search on public.comments using gin (to_tsvector('english'::regconfig, coalesce(text, ''::text)));
create index idx_competitive_insights_client_run on public.competitive_insights using btree (client_id, run_id);
create index idx_competitive_insights_client_run_category on public.competitive_insights using btree (client_id, run_id, category);
create index idx_insight_evidence_comment on public.insight_evidence using btree (comment_id);
create index idx_insight_evidence_insight on public.insight_evidence using btree (audience_insight_id);
create index invitations_client_id_idx on public.invitations using btree (client_id);
create unique index invitations_pending_unique on public.invitations using btree (client_id, lower(email)) where (status = 'pending'::text);
create index keyword_performance_client_run_idx on public.keyword_performance using btree (client_id, run_id);
create index language_samples_client_run_idx on public.language_samples using btree (client_id, run_id);
create index idx_market_insights_client_run on public.market_insights using btree (client_id, run_id);
create index pipeline_runs_client_id_idx on public.pipeline_runs using btree (client_id);
create index pipeline_runs_started_at_idx on public.pipeline_runs using btree (started_at desc);
create index idx_recommendations_client_run on public.recommendations using btree (client_id, run_id);
create index idx_run_summary_client on public.run_summary using btree (client_id);
create index themes_client_run_idx on public.themes using btree (client_id, run_id);
create index tracking_configs_client_id_idx on public.tracking_configs using btree (client_id);
create index users_client_id_idx on public.users using btree (client_id);
create index video_claims_run_idx on public.video_claims using btree (client_id, run_id, entity);
create index video_raw_run_idx on public.video_raw using btree (client_id, run_id, platform);
create index idx_videos_client_competitor on public.videos using btree (client_id, is_competitor);
create index idx_videos_client_run on public.videos using btree (client_id, run_id);
create index videos_client_id_idx on public.videos using btree (client_id);
create index videos_is_competitor_idx on public.videos using btree (client_id, is_competitor);
create index videos_run_id_idx on public.videos using btree (run_id);
create index videos_scraped_at_idx on public.videos using btree (scraped_at desc);
create index weekly_reports_client_id_idx on public.weekly_reports using btree (client_id);
create index weekly_reports_sent_at_idx on public.weekly_reports using btree (sent_at desc);

-- ------------------------------------------------------------------ RLS ----
-- Every table is RLS-enabled. Clients read their own tenant's rows (service
-- role bypasses RLS for the pipeline); writes go through the service role
-- except the invite/config/recommendation actions below.

alter table public.account_events enable row level security;
alter table public.account_snapshots enable row level security;
alter table public.ai_call_log enable row level security;
alter table public.audience_insights enable row level security;
alter table public.clients enable row level security;
alter table public.comments enable row level security;
alter table public.competitive_insights enable row level security;
alter table public.insight_evidence enable row level security;
alter table public.invitations enable row level security;
alter table public.keyword_performance enable row level security;
alter table public.language_samples enable row level security;
alter table public.market_insights enable row level security;
alter table public.pipeline_runs enable row level security;
alter table public.platform_admins enable row level security;
alter table public.recommendations enable row level security;
alter table public.run_summary enable row level security;
alter table public.themes enable row level security;
alter table public.tracking_configs enable row level security;
alter table public.users enable row level security;
alter table public.video_claims enable row level security;
alter table public.video_raw enable row level security;
alter table public.videos enable row level security;
alter table public.weekly_reports enable row level security;

create policy "Users see their own account_events" on public.account_events for select using (client_id = get_my_client_id());
create policy "Users see their own account_snapshots" on public.account_snapshots for select using (client_id = get_my_client_id());
create policy "Superadmins read ai_call_log" on public.ai_call_log for select to authenticated using (is_superadmin());
create policy "Users can view own audience_insights" on public.audience_insights for select to authenticated using (client_id = (select users.client_id from users where users.id = auth.uid()));
create policy "Users see their own client" on public.clients for select to authenticated using (id = get_my_client_id());
create policy "Users can view own comments" on public.comments for select to authenticated using (client_id = (select users.client_id from users where users.id = auth.uid()));
create policy "Users can view own competitive_insights" on public.competitive_insights for select to authenticated using (client_id = (select users.client_id from users where users.id = auth.uid()));
create policy "Users view own insight evidence" on public.insight_evidence for select to authenticated using (exists (select 1 from audience_insights ai where ai.id = insight_evidence.audience_insight_id and ai.client_id = get_my_client_id()));
create policy "Owners and admins create invitations" on public.invitations for insert to authenticated with check ((client_id = get_my_client_id()) and (get_my_role() = any (array['owner'::text, 'admin'::text])));
create policy "Owners and admins see invitations" on public.invitations for select to authenticated using ((client_id = get_my_client_id()) and (get_my_role() = any (array['owner'::text, 'admin'::text])));
create policy "Owners and admins update invitations" on public.invitations for update to authenticated using ((client_id = get_my_client_id()) and (get_my_role() = any (array['owner'::text, 'admin'::text]))) with check (client_id = get_my_client_id());
create policy "Users see their own keyword_performance" on public.keyword_performance for select using (client_id = get_my_client_id());
create policy "Users see their own language_samples" on public.language_samples for select using (client_id = get_my_client_id());
create policy "Users can view own market_insights" on public.market_insights for select to authenticated using (client_id = (select users.client_id from users where users.id = auth.uid()));
create policy "Users see their own pipeline runs" on public.pipeline_runs for select to authenticated using (client_id = get_my_client_id());
create policy "Users can update own recommendations" on public.recommendations for update to authenticated using (client_id = (select users.client_id from users where users.id = auth.uid())) with check (client_id = (select users.client_id from users where users.id = auth.uid()));
create policy "Users can view own recommendations" on public.recommendations for select to authenticated using (client_id = (select users.client_id from users where users.id = auth.uid()));
create policy "Users can view own run_summary" on public.run_summary for select to authenticated using (client_id = (select users.client_id from users where users.id = auth.uid()));
create policy "Users see their own themes" on public.themes for select using (client_id = get_my_client_id());
create policy "Owners and admins update config" on public.tracking_configs for update to authenticated using ((client_id = get_my_client_id()) and (get_my_role() = any (array['owner'::text, 'admin'::text]))) with check (client_id = get_my_client_id());
create policy "Users see their own config" on public.tracking_configs for select to authenticated using (client_id = get_my_client_id());
create policy "Users see teammates" on public.users for select to authenticated using (client_id = get_my_client_id());
create policy "Users see their own videos" on public.videos for select to authenticated using (client_id = get_my_client_id());
create policy "Users see their own reports" on public.weekly_reports for select to authenticated using (client_id = get_my_client_id());
