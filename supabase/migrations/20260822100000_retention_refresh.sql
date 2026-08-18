-- Tier 1.5 (2026-08-22): YouTube refresh, redacted evidence, commenter suppression.
--
-- Additive only. Safe to apply before or after the code that uses it. The
-- data backfill that depends on the new code lives in the NEXT migration
-- (20260822110000_demographic_redact_backfill.sql) and must run after deploy.
--
-- 1. refreshed_at on comments and videos. The YouTube API Services Developer
--    Policy (III.E.4.d) lets an API Client store Non-Authorized Data for at
--    most 30 calendar days, after which it must "either delete or refresh" it;
--    III.E.4.b says the same of statistics; III.E.4.e asks that stored data be
--    kept consistent with what the API serves. Until now the retention job
--    could only DELETE — which thinned the analysis corpus on every re-read
--    (Pass A re-reads every eligible video each run) and still left cited rows
--    unrefreshed. Now: rows are re-fetched from the API on a rolling 25-day
--    cadence and stamped; the delete path stays as the 30-day backstop for
--    anything the refresh could not reach. Measured on prod 2026-08-18: 5,707
--    YouTube comments (589 distinct ids past 25 days across 745 rows — 156 ids
--    are held by more than one tenant), 1,585 YouTube videos (605 past 25 days).
--    Refreshing all of it costs ~115 quota units a month against a 10,000/day
--    quota. Stamped at gather time too: a re-scrape IS a refresh.
--    NULL means "never refreshed" — the retention job reads
--    coalesce(refreshed_at, created_at) / coalesce(refreshed_at, scraped_at).
-- 2. videos.unavailable_at — a YouTube video the API no longer returns
--    (deleted, private, taken down). videos(id) cascades into audience_insights,
--    insight_evidence, language_samples, video_claims and account_events, so the
--    row can never be deleted without destroying the analysis; instead it is
--    tombstoned (API-sourced fields cleared, this stamp set) and its YouTube
--    comments — which the API no longer serves either — are deleted.
-- 3. insight_evidence.redacted — counts-not-quotes for the demographic_signal
--    category (LIA/DPIA v0.2, 2026-08-18: Art 9(2)(e) "manifestly made public"
--    is read narrowly and does not obviously cover what the model DERIVES about
--    a person; so the product keeps the citation — the foreign key is what the
--    evidence floor counts — and never keeps or shows the words). quote stays
--    NOT NULL and is stored as '' for redacted rows. Every reader filters
--    redacted = false; the theme-level category is the mode of its members
--    (step-a2), so exclusion has to be row-level.
-- 4. suppressed_commenters — erasure has to be durable. Comments upsert on
--    (client_id, platform, comment_id), so an erased handle would be re-inserted
--    the next time its video is re-scraped. scripts/erase-commenter.ts writes a
--    row here; lib/gather/suppression.ts filters at the single ingest choke
--    point (scrapeCommentsBatch). author_key is the normalised handle
--    (lower-cased, trimmed, one leading '@' / Reddit 'u/' stripped). Operator
--    data: no tenant policy, superadmin read only.

alter table public.comments add column if not exists refreshed_at timestamptz;
create index if not exists idx_comments_youtube_refresh_due
  on public.comments ((coalesce(refreshed_at, created_at)))
  where platform = 'youtube';

alter table public.videos add column if not exists refreshed_at timestamptz;
alter table public.videos add column if not exists unavailable_at timestamptz;
create index if not exists idx_videos_youtube_refresh_due
  on public.videos ((coalesce(refreshed_at, scraped_at)))
  where platform = 'youtube';

alter table public.insight_evidence add column if not exists redacted boolean not null default false;

create table if not exists public.suppressed_commenters (
  platform text not null,
  author_key text not null,
  note text,
  created_at timestamptz not null default now(),
  primary key (platform, author_key)
);
alter table public.suppressed_commenters enable row level security;
drop policy if exists "Superadmins read suppressed_commenters" on public.suppressed_commenters;
create policy "Superadmins read suppressed_commenters" on public.suppressed_commenters
  for select using (public.is_superadmin());

comment on column public.comments.refreshed_at is
  'Last time this row was re-fetched from its source (gather upsert or the retention refresh). NULL = never; the retention job reads coalesce(refreshed_at, created_at). YouTube rows must be refreshed or deleted within 30 days (Developer Policy III.E.4.d).';
comment on column public.videos.refreshed_at is
  'Last time this row''s API-sourced fields were re-fetched (gather upsert or the retention refresh). NULL = never; the retention job reads coalesce(refreshed_at, scraped_at).';
comment on column public.videos.unavailable_at is
  'Set when the source API no longer returns this video (deleted/private/taken down). The row is tombstoned, never deleted — videos(id) cascades into the analysis tables. Its YouTube comments are deleted at the same time.';
comment on column public.insight_evidence.redacted is
  'true = the citation is kept (comment_id, for the evidence floor and grounding) but the quote text is not: quote is stored as ''''. Used for the demographic_signal category (counts, not quotes). Readers must filter redacted = false.';
comment on table public.suppressed_commenters is
  'Erasure durability: handles (normalised author_key per platform) that must never be re-ingested. Written by scripts/erase-commenter.ts, read by lib/gather/suppression.ts at ingest.';
