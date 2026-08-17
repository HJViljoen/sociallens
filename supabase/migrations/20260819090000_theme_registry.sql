-- Theme registry (Theme Registry shape B-lite, 2026-08-17). A theme gets a
-- STABLE IDENTITY across runs, so "new", Trends trajectories and the Voice
-- history stop depending on gpt-5.4 repeating a label verbatim.
--
-- Why membership and not embeddings — measured on two Sealand runs with
-- byte-identical Pass A input (shape A froze it): 507 of 537 themes had an
-- EXACTLY identical supporting_insight_ids set run to run (94.4%), while 48 of
-- the 58 themes flagged "new" by the label-embedding rule were the same theme
-- with a new label. Cosine among provably-identical themes ranged 0.51–1.00,
-- overlapping the "different theme" band, so no threshold fixes it. Clustering
-- is now 100% reproducible; all residual churn comes from the two gpt-5.4 calls
-- (theme-merge, pass-b), neither of which accepts a temperature.
--
-- THE INVARIANT: theme_registry.id is a theme's identity. themes.id remains a
-- per-RUN row id and must never be used as a cross-run key; themes.registry_id
-- points at the identity. theme_observations is the per-run time series.
--
-- Additive: two new tables, one nullable column on themes, no backfill — the
-- registry seeds itself on the first registry-aware run ("latest run as run 0").
-- Old code ignores all of it.

-- 1. The identity ------------------------------------------------------------
create table public.theme_registry (
  id uuid default gen_random_uuid() primary key,
  client_id uuid not null references public.clients(id) on delete cascade,
  -- Entity bucket (client / competitor:<name> / industry-other). Matching never
  -- crosses buckets: the same words about two brands are two themes.
  bucket text not null,
  -- Latest observation's label/description: display stays fresh, continuity
  -- comes from the id. Labels churn ~88% run to run and that is fine now.
  canonical_label text not null,
  description text,
  -- Last observed membership — the matching key (durable insight ids, shape A).
  member_insight_ids uuid[] not null default '{}'::uuid[],
  -- Pass A slugs of the last observation; a second non-LLM signal, matched on
  -- all 507 twins in the measurement. Kept for diagnostics/repair.
  member_slugs text[] not null default '{}'::text[],
  -- label+description embedding of the last observation — tiebreaker only.
  embedding jsonb,
  status text not null default 'active',
  first_seen_run_id uuid references public.pipeline_runs(id) on delete set null,
  last_seen_run_id uuid references public.pipeline_runs(id) on delete set null,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  observation_count integer not null default 0,
  -- Reserved for hierarchy (v1.1). Also set by the operator merge lever so a
  -- retired duplicate points at the entry that absorbed it.
  parent_theme_id uuid references public.theme_registry(id) on delete set null,
  created_at timestamptz default now() not null,
  constraint theme_registry_status_check check (status in ('active', 'dormant'))
);

create index theme_registry_client_bucket_idx
  on public.theme_registry using btree (client_id, bucket, status);

comment on column public.theme_registry.member_insight_ids is
  'Membership at the last observation — the matching key. Durable because Pass A is incremental (shape A): an unchanged video keeps its insight row ids.';
comment on column public.theme_registry.canonical_label is
  'Latest observation''s label. Deliberately NOT frozen: labels churn ~88% run to run, so the id carries identity and the label carries freshness.';
comment on column public.theme_registry.status is
  'active | dormant. Dormant = not observed for REGISTRY_DORMANT_RUNS consecutive themed runs; revives on the next match.';

-- 2. The time series ---------------------------------------------------------
create table public.theme_observations (
  id uuid default gen_random_uuid() primary key,
  theme_id uuid not null references public.theme_registry(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  run_id uuid references public.pipeline_runs(id) on delete set null,
  run_date date,
  evidence_count integer not null default 0,
  strength_score integer,
  dominant_emotion text,
  dominant_sentiment_impact text,
  single_source boolean not null default false,
  category text,
  -- The label THIS run gave it — the churn is now visible as data instead of
  -- being mistaken for a new theme.
  label text not null,
  member_insight_ids uuid[] not null default '{}'::uuid[],
  match_kind text not null,
  match_score numeric(5,4),
  created_at timestamptz default now() not null,
  unique (theme_id, run_id),
  constraint theme_observations_match_kind_check
    check (match_kind in ('exact', 'strong', 'weak', 'new', 'revived'))
);

create index theme_observations_client_run_idx
  on public.theme_observations using btree (client_id, run_id);
create index theme_observations_theme_idx
  on public.theme_observations using btree (theme_id, created_at);

comment on column public.theme_observations.match_kind is
  'How this run''s theme was matched to its registry entry: exact (identical member set) | strong (Jaccard >= REGISTRY_MATCH_STRONG) | weak (Jaccard >= WEAK and cosine >= THEME_MATCH_THRESHOLD — the split/tangle band) | new | revived (matched a dormant entry).';

-- 3. The run-scoped row points at the identity --------------------------------
-- themes stays exactly as it is (one row per theme per run, full replace) so
-- every current reader keeps working; registry_id is the new cross-run key.
alter table public.themes
  add column if not exists registry_id uuid;

alter table public.themes drop constraint if exists themes_registry_id_fkey;
alter table public.themes add constraint themes_registry_id_fkey
  foreign key (registry_id) references public.theme_registry(id) on delete set null;

create index if not exists themes_client_registry_idx
  on public.themes using btree (client_id, registry_id);

comment on column public.themes.registry_id is
  'The theme''s stable identity (theme_registry). themes.id is a per-run row id and must never be used as a cross-run key; Trends and the Voice history join on this instead of the label string.';

-- 4. RLS — read-only for the tenant, writes are service-role (as themes) ------
alter table public.theme_registry enable row level security;
create policy "Users see their own theme_registry" on public.theme_registry
  for select using (client_id = get_my_client_id());

alter table public.theme_observations enable row level security;
create policy "Users see their own theme_observations" on public.theme_observations
  for select using (client_id = get_my_client_id());

-- No backfill by design: the registry seeds itself on the first run with
-- THEME_REGISTRY=1 (every theme reads `new`, exactly like a tenant's first
-- themed run), and history stays where it is — the old runs' themes rows are
-- untouched and their label-joined Trends lines keep working via the fallback.
--
-- Post-apply check (run by hand): both tables empty, no theme carries an id yet.
--   select count(*) from public.theme_registry;      -- 0
--   select count(*) from public.theme_observations;  -- 0
--   select count(*) from public.themes where registry_id is not null;  -- 0
