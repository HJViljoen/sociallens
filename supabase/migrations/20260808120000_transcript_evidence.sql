-- Video transcripts Step 2 Phase 1: evidence can cite a video's transcript.
-- (Design 2026-08-08: brand voice vs customer voice — industry-other transcripts
-- are first-class evidence stamped source='video'; client/competitor speech is
-- brand messaging, captured separately in video_claims.)
-- Additive + inert: existing rows read as source='comment'; nothing writes
-- source='video' until Pass A v4 ships behind TRANSCRIPTS_ENABLED.

-- 1. insight_evidence: a row cites exactly one of a comment or a source video.
alter table insight_evidence
  alter column comment_id drop not null;

alter table insight_evidence
  add column if not exists source text not null default 'comment'
    check (source in ('comment', 'video')),
  add column if not exists source_video_id uuid references videos(id) on delete cascade;

alter table insight_evidence
  add constraint insight_evidence_source_shape check (
    (source = 'comment' and comment_id is not null and source_video_id is null)
    or
    (source = 'video' and source_video_id is not null and comment_id is null)
  );

-- 2. Brand messaging extracted from client/competitor transcripts (Pass A v4).
--    Never audience evidence; feeds Pass C / say-vs-hear later (Step 2b).
create table if not exists video_claims (
  id              uuid primary key default gen_random_uuid(),
  client_id       uuid not null,
  run_id          uuid not null,
  platform        text not null,
  source_video_id uuid not null references videos(id) on delete cascade,
  entity          text not null check (entity in ('client', 'competitor')),
  competitor_name text,
  claim           text not null,
  quote           text not null,
  created_at      timestamptz not null default now(),
  check (entity = 'client' or competitor_name is not null)
);

create index if not exists video_claims_run_idx
  on video_claims (client_id, run_id, entity);

-- Internal analysis table — service-role only, like video_raw.
alter table video_claims enable row level security;
