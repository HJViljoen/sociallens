-- Video transcripts — Step 1 (2026-07-23): CAPTURE ONLY. Gather stores the full
-- raw actor/API item per kept video, and resolves one transcript per video
-- (TikTok caption track when the actor returns one — free — else Whisper on the
-- media; Instagram always Whisper; YouTube deferred: its transcript text is
-- pot-gated, see _Claude/Projects/SaaS/Architecture/Video-Transcripts). NOTHING
-- here is read by the analysis passes yet — Pass A/B/C/D ignore these columns.
-- Gated behind TRANSCRIPTS_ENABLED, so applying + deploying this is a no-op until
-- the flag is switched on.

-- Full raw item, so gather stops discarding fields it later wants. The media +
-- subtitle URLs live in here but are signed and EXPIRING — the durable transcript
-- is derived at gather time; the stored URLs are only for debugging / reprocessing
-- within Apify's retention.
create table if not exists video_raw (
  id           bigint generated always as identity primary key,
  client_id    uuid not null,
  run_id       uuid not null,
  platform     text not null,
  video_id     text not null,
  raw          jsonb not null,
  captured_at  timestamptz not null default now(),
  unique (client_id, platform, video_id, run_id)
);

create index if not exists video_raw_run_idx on video_raw (client_id, run_id, platform);

-- Internal capture table — never client-read. RLS on with no policy denies the
-- anon/authenticated roles by default; the service-role writes bypass RLS.
alter table video_raw enable row level security;

comment on table video_raw is
  'Full raw actor/API item per kept video (Step 1 transcript capture). Source of media + caption URLs for transcript resolution; future-proofs against dropped fields. Not read by the analysis passes.';

-- Derived, durable transcript (the URLs in video_raw expire; this text does not).
alter table videos
  add column if not exists transcript        text,
  add column if not exists transcript_lang   text,
  add column if not exists transcript_source text,   -- 'tiktok_caption' | 'whisper' | null
  add column if not exists transcript_status text;   -- 'ok' | 'no_speech' | 'no_media' | 'failed' | null (=not attempted)

comment on column videos.transcript is
  'Spoken-word transcript of the video (Step 1 capture). Sourced from a caption track or Whisper. NOT yet read by the analysis passes. transcript_status=no_speech marks music-only videos (the speech-gate).';
