-- Incremental Pass A (Theme Registry shape A, 2026-08-17). Insights become
-- durable facts about a VIDEO instead of belonging to a run: Pass A re-reads a
-- video only when it changed (new / comments grew / transcript landed / lane
-- changed / prompt bumped) and every run's A2 rebuilds themes from the current
-- insight set. Measured before this change (Össur run 147899d3): 342 of 496
-- analysed videos had no new comments — the corpus-wide re-read was ~70% waste
-- and the source of run-to-run theme churn (71% of theme slugs changed on
-- identical inputs).
--
-- THE INVARIANT: videos.analyzed_run_id points at the run that produced a
-- video's authoritative analysis. A video's CURRENT insights / language samples
-- are the rows whose run_id = videos.analyzed_run_id; every other row is stale
-- and pruned at the next successful close-run. Old rows are never touched by
-- Pass A itself, so the dashboard's displayed run keeps resolving its quotes
-- while a run is in flight or after a failed run.
--
-- Additive: new nullable columns, two views, a strictly-safer FK, and an
-- idempotent backfill so dashboards keep rendering the moment this applies
-- (before the new code has run once). Old code ignores all of it.

-- 1. Per-video analysis bookkeeping ------------------------------------------
alter table public.videos
  add column if not exists analyzed_at timestamptz,
  add column if not exists analyzed_run_id uuid,   -- FK added below
  add column if not exists analyzed_comment_count integer,
  add column if not exists analyzed_prompt_version text,
  add column if not exists analyzed_lane text,
  add column if not exists analyzed_with_transcript boolean;

-- Deleting a run nulls the pointer (never restricts the delete): the video then
-- reads as "never analysed" and is re-selected as new, which is exactly right —
-- its rows went with the run (audience_insights.run_id → set null → pruned).
alter table public.videos drop constraint if exists videos_analyzed_run_id_fkey;
alter table public.videos add constraint videos_analyzed_run_id_fkey
  foreign key (analyzed_run_id) references public.pipeline_runs(id) on delete set null;

alter table public.videos drop constraint if exists videos_analyzed_lane_check;
alter table public.videos add constraint videos_analyzed_lane_check
  check (analyzed_lane is null or analyzed_lane in ('full', 'claims_only', 'skip'));

create index if not exists videos_analyzed_run_idx
  on public.videos using btree (client_id, analyzed_run_id);

comment on column public.videos.analyzed_run_id is
  'Pointer to the run that produced this video''s authoritative Pass A output. Current insights/language samples = rows with run_id = analyzed_run_id. FK on delete set null: deleting a run nulls the pointer and the video is re-analysed as new.';
comment on column public.videos.analyzed_comment_count is
  'Stored comment rows for the video at analysis time — the growth baseline for re-selection (min(3, 20%) growth, cumulative).';
comment on column public.videos.analyzed_lane is
  'Lane at analysis: full (comments ≥ floor) · claims_only (brand-side transcript, no comments) · skip (fell below the floor after spam filtering; bookkept so it is not re-loaded every run).';
comment on column public.videos.analyzed_with_transcript is
  'Whether a usable transcript was in the prompt at analysis — a transcript landing later re-selects the video.';

-- 2. run_id on insights/language samples becomes provenance only --------------
-- Before: NOT NULL + FK on delete CASCADE — once insights outlive their run,
-- deleting an old pipeline_runs row would delete CURRENT insights. Now: nullable,
-- on delete SET NULL ("produced by run R", nothing more).
alter table public.audience_insights alter column run_id drop not null;
alter table public.audience_insights drop constraint if exists audience_insights_run_id_fkey;
alter table public.audience_insights add constraint audience_insights_run_id_fkey
  foreign key (run_id) references public.pipeline_runs(id) on delete set null;

alter table public.language_samples alter column run_id drop not null;
alter table public.language_samples drop constraint if exists language_samples_run_id_fkey;
alter table public.language_samples add constraint language_samples_run_id_fkey
  foreign key (run_id) references public.pipeline_runs(id) on delete set null;

-- 3. The one definition of "current" ------------------------------------------
-- security_invoker: the caller's RLS applies (authenticated users see their own
-- tenant through the base-table policies; service_role bypasses as usual).
-- Population reads (A2 input, dashboard tallies, engage candidates) use these
-- views; id-set lookups (by audience_insight_id) stay on the base tables so
-- they still resolve rows an in-flight run has superseded but not yet pruned.
create or replace view public.audience_insights_current
  with (security_invoker = true) as
  select ai.*
  from public.audience_insights ai
  join public.videos v on v.id = ai.source_video_id and ai.run_id = v.analyzed_run_id;

create or replace view public.language_samples_current
  with (security_invoker = true) as
  select ls.*
  from public.language_samples ls
  join public.videos v on v.id = ls.source_video_id and ls.run_id = v.analyzed_run_id;

grant select on public.audience_insights_current, public.language_samples_current
  to authenticated, service_role;

-- 4. Backfill (idempotent: never overwrites a real pointer) --------------------
-- For each client, the latest completed/partial run L is today's "current"
-- analysis (the corpus-wide re-read guarantees L covers every analysable
-- video). Videos with rows in L get the pointer; videos only in older runs stay
-- null (their old rows are stale → pruned on the next successful close; if
-- still eligible they are re-selected as new). analyzed_comment_count = comment
-- rows stored by the time L closed, so growth since L is measured exactly.
with latest as (
  select distinct on (client_id) client_id, id as run_id, completed_at
  from public.pipeline_runs
  where status in ('completed', 'partial')
  order by client_id, started_at desc
),
ins as (
  select ai.source_video_id, l.run_id, l.completed_at
  from public.audience_insights ai
  join latest l on l.run_id = ai.run_id
  where ai.source_video_id is not null
  group by ai.source_video_id, l.run_id, l.completed_at
),
cl as (
  select vc.source_video_id, l.run_id, l.completed_at
  from public.video_claims vc
  join latest l on l.run_id = vc.run_id
  group by vc.source_video_id, l.run_id, l.completed_at
),
pv as (
  select l.run_id,
         (select a.prompt_version from public.ai_call_log a
            where a.run_id = l.run_id and a.pass = 'pass_a' and a.prompt_version is not null
            limit 1) as prompt_version
  from latest l
),
target as (
  select coalesce(i.source_video_id, c.source_video_id) as video_id,
         coalesce(i.run_id, c.run_id)                   as run_id,
         coalesce(i.completed_at, c.completed_at)       as completed_at,
         case when i.source_video_id is not null then 'full' else 'claims_only' end as lane
  from ins i
  full outer join cl c on c.source_video_id = i.source_video_id
)
update public.videos v
set analyzed_run_id          = t.run_id,
    analyzed_at              = coalesce(t.completed_at, now()),
    analyzed_lane            = t.lane,
    analyzed_prompt_version  = pv.prompt_version,
    -- Imprecise by construction: a transcript that landed AFTER L (e.g. via
    -- scripts/backfill-transcripts.ts) reads as "already seen", so that video
    -- won't earn a transcript re-read. It still re-reads on comment growth or
    -- the next prompt bump; force with options.forcePassA if it matters.
    analyzed_with_transcript = (v.transcript_status = 'ok'),
    analyzed_comment_count   = (
      select count(*) from public.comments c
      where c.client_id = v.client_id and c.platform = v.platform and c.video_id = v.video_id
        and c.created_at <= coalesce(t.completed_at, now())
    )
from target t
join pv on pv.run_id = t.run_id
where v.id = t.video_id
  and v.analyzed_run_id is null;

-- Post-apply check (run by hand): per client, current-view count must equal the
-- latest run's insight count for rows with a source video (legacy rows with a
-- null source_video_id can never be "current" — the view joins on it).
--   select v.client_id, count(*) from public.audience_insights_current v group by 1;
--   select ai.client_id, count(*) from public.audience_insights ai
--     join (select distinct on (client_id) client_id, id from public.pipeline_runs
--           where status in ('completed','partial') order by client_id, started_at desc) l
--       on l.id = ai.run_id group by 1;
