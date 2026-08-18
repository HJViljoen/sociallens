-- Tier 0 T0-8 (2026-08-18): split video sentiment into two families that are
-- never blended, and give run_summary a place to keep them apart.
--
-- videos.sentiment has two writers with two meanings: Pass A (full lane) reads
-- the COMMENTS and writes how the audience received the video; classify-meta
-- reads the caption + transcript and writes the video's own FRAMING. Since
-- classify-meta moved before Pass A (2026-08-16) it stamps every discovered
-- video, so run_summary's "N% positive" was 59% framing on Össur — and the
-- reorder alone read as "sentiment up 6.2 pts" in a sent subject line. Nothing
-- recorded which pass wrote the value.
--
-- Additive: one provenance column + CHECK, four jsonb columns on run_summary,
-- and a best-effort backfill (analyzed_lane = 'full' → audience; any other
-- video with a sentiment → framing). Old code ignores all of it.

alter table public.videos
  add column if not exists sentiment_source text;

alter table public.videos drop constraint if exists videos_sentiment_source_check;
alter table public.videos add constraint videos_sentiment_source_check
  check (sentiment_source is null or sentiment_source in ('audience', 'framing'));

comment on column public.videos.sentiment_source is
  'Which pass wrote videos.sentiment: audience (Pass A full lane, comment-derived) or framing (classify-meta, caption/transcript). run_summary reports the two families separately; the headline number is audience only.';

update public.videos
set sentiment_source = case when analyzed_lane = 'full' then 'audience' else 'framing' end
where sentiment is not null and sentiment_source is null;

-- run_summary: the two families as jsonb {positive, neutral, negative, judged, counts}.
-- The legacy overall_sentiment_* / period_sentiment_* / *_drivers columns keep
-- being written, now as the AUDIENCE family only (what they always claimed to
-- be). Rows written before this migration hold blended values; deltas compare
-- the new columns and only when BOTH sides carry them.
alter table public.run_summary
  add column if not exists audience_sentiment jsonb,
  add column if not exists period_audience_sentiment jsonb,
  add column if not exists framing_sentiment jsonb,
  add column if not exists period_framing_sentiment jsonb;

comment on column public.run_summary.audience_sentiment is
  'Corpus-wide audience sentiment (Pass A full-lane videos only): {positive, neutral, negative, judged, counts}. The headline family.';
comment on column public.run_summary.framing_sentiment is
  'Corpus-wide framing sentiment (classify-meta): same shape. Shown only when labelled as framing; never blended with audience.';
