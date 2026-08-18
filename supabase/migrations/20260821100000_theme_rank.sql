-- Tier 1 (2026-08-18): rank themes by how widely they were heard, not by their
-- single sharpest insight.
--
-- `themes.strength_score` is the MAX member insight's score, and it was the sort
-- key everywhere. That order is the only salience cue Pass C and Pass D-a
-- receive: they read one line per theme, so whatever sorts first is what the
-- model treats as the market's loudest signal. Measured on a live run: a
-- 3-video theme scoring 9 outranked a 47-video theme scoring 8.
--
-- rank_score = evidence x share-of-bucket. mean_strength replaces max as the
-- honest "how strong is this theme" number and breaks rank ties. Additive and
-- nullable, so old rows and old code are unaffected; the ordering falls back to
-- strength_score until a run has written the new columns.
alter table public.themes
  add column if not exists rank_score numeric,
  add column if not exists mean_strength numeric;

-- The same two on the cross-run history. persistThemes writes one observation
-- per (theme, run) from the SAME object, so omitting them here would make the
-- observations upsert reject an unknown column (PGRST204) — and because
-- registry writes are deliberately non-fatal, that failure would be swallowed:
-- theme_observations would stay permanently empty and themes.registry_id
-- permanently null, on every run, silently. Caught in review before this was
-- applied. They also belong here on merit: an observation's rank at that run is
-- what a cross-run chart should plot, rather than the strongest-member score.
alter table public.theme_observations
  add column if not exists rank_score numeric,
  add column if not exists mean_strength numeric;

comment on column public.themes.rank_score is
  'Salience: evidence count x share of its entity bucket. THE ordering key for anything a model or a client reads. strength_score is the strongest single member and says nothing about how widely a theme was heard.';
comment on column public.themes.mean_strength is
  'Mean member insight strength. Tie-breaks rank_score.';
comment on column public.theme_observations.rank_score is
  'The theme''s rank at this observation: evidence x share of its entity bucket. What a cross-run trend should plot.';

create index if not exists themes_rank_idx
  on public.themes using btree (client_id, run_id, rank_score desc nulls last);
