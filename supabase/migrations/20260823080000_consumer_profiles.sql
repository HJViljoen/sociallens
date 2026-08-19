-- Consumer profile (Pass E, 2026-08-19). One stored portrait of WHO is talking
-- in a client's category, per run: a small set of personas, each grounded in
-- counted real insights with its own evidence.
--
-- Why store it per run instead of deriving it on read: the profile is the input
-- to the drift layer ("the mindset shifted from X to Y"), and drift needs a
-- history that only exists if every run writes one. The theme registry shipped
-- two days ago with no backfill and had to seed itself from run 0; this table
-- avoids repeating that by writing from the first run Pass E sees.
--
-- THE INVARIANT: a persona is a GROUPING OF COUNTED INSIGHTS, never a character.
-- Every persona in `personas` carries the theme ids, insight ids and source
-- video counts it was built from, and anything that fell below the evidence
-- floors is recorded in `dropped` with a reason rather than padded out. The
-- product contract (.agents/product-marketing.md) bans invented personas, so
-- the grounding columns are the feature, not metadata.
--
-- Additive: one new table, nothing altered, no backfill. Old code ignores it,
-- and the pipeline only writes when CONSUMER_PROFILE=1.

create table if not exists public.consumer_profiles (
  id uuid default gen_random_uuid() primary key,
  client_id uuid not null references public.clients(id) on delete cascade,
  run_id uuid not null references public.pipeline_runs(id) on delete cascade,
  -- Denormalised from the run so the drift diff can order profiles without a join.
  run_date date not null,
  -- One calibrated line naming who is talking. No raw scores (lib/calibration.ts).
  headline text,
  -- GroundedPersona[] — see lib/pipeline/persona-assembly.ts for the shape.
  -- Each entry carries scope ('category' | 'client'), the calibrated prevalence
  -- word, its theme/registry/insight ids, evidence + source-video counts, the
  -- bucket mix it was drawn from, and up to 3 exact-copy validated hero quotes.
  personas jsonb not null default '[]'::jsonb,
  -- Size of the population the profile was synthesised from. Kept so a thin run
  -- is legible after the fact ("one persona because there were 40 insights").
  insight_population integer not null default 0,
  theme_population integer not null default 0,
  -- Personas the evidence floors rejected, with the reason and the counts that
  -- failed. Operator honesty: "we found nothing" and "we found it and dropped
  -- it" are different facts and the page may need to say which.
  dropped jsonb not null default '[]'::jsonb,
  prompt_version text not null,
  created_at timestamptz default now() not null,
  -- One profile per run. Re-running Pass E for a run replaces its row.
  constraint consumer_profiles_client_run_key unique (client_id, run_id)
);

-- The page reads "newest profile for this client"; the drift diff walks a
-- client's profiles newest-first.
create index if not exists consumer_profiles_client_run_date_idx
  on public.consumer_profiles using btree (client_id, run_date desc);

comment on column public.consumer_profiles.personas is
  'GroundedPersona[]. Every persona is a grouping of counted insights: it carries theme_ids, registry_ids, insight_ids, evidence_count and source_video_count. A persona with no grounding is a product-contract violation, not a display bug.';
comment on column public.consumer_profiles.dropped is
  'Personas the model proposed that failed the evidence floors (PERSONA_MIN_INSIGHTS / PERSONA_MIN_VIDEOS), with the counts that failed. Never shown to a client; the operator lever reads it when tuning the floors.';
comment on column public.consumer_profiles.run_date is
  'Copied from the run. The drift layer orders on this, so it must not be null even when a run is re-processed.';

-- RLS — read-only for the tenant, writes are service-role (as themes/registry).
alter table public.consumer_profiles enable row level security;
drop policy if exists "Users see their own consumer_profiles" on public.consumer_profiles;
create policy "Users see their own consumer_profiles" on public.consumer_profiles
  for select using (client_id = get_my_client_id());

-- No backfill by design: profiles start accumulating from the first run Pass E
-- runs on (in-pipeline with CONSUMER_PROFILE=1, or offline via
-- scripts/consumer-profile.ts against an already-completed run).
--
-- Post-apply check (run by hand): table exists and is empty.
--   select count(*) from public.consumer_profiles;  -- 0
--   select policyname from pg_policies where tablename = 'consumer_profiles';
--     -- "Users see their own consumer_profiles"
