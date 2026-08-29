-- Reports & Exports, Stage 1 — the spine (2026-08-29). Vault: Architecture/Reports-Exports.
--
-- An export is a SNAPSHOT rendered to a FILE, and both are logged.
--
--   report_snapshots  what was exported: the page/tile/thread, the reader's
--                     selection, and the tile-ready DATA frozen at that moment
--                     — numbers, ordering, ids. NO QUOTE TEXT: every quote in
--                     `data` is { ref, text: '' } and the words are resolved live
--                     at render, through insight_evidence, exactly as the agent
--                     stores its answers. `evidence_ids` repeats the refs as an
--                     indexed array so erase-commenter can find every snapshot
--                     a commenter's words reached.
--   artifacts         a rendered file (PDF or PNG) in Storage, keyed by snapshot,
--                     format and version. `stale` is set by the erasure sweep
--                     after it deletes the file; the next download re-renders
--                     from the snapshot, and the erased voice is no longer there.
--   export_events     every export and download. This log is the Stage-1 gate:
--                     it says whether artifacts travel before Stage 2 is built.
--
-- Why freeze data and not just the run id: Voice reads the *_current population
-- views, the profile page reads the newest consumer_profiles row regardless of
-- run, Market's news is not run-pinned, and Voice's ribbon picks a random seed.
-- A snapshot pinned to run_id would not render the same twice.

create table if not exists public.report_snapshots (
  id uuid default gen_random_uuid() primary key,
  client_id uuid not null references public.clients(id) on delete cascade,
  kind text not null check (kind in ('page', 'tile', 'agent_thread')),
  -- { page?, tileKey?, threadId?, params, variant? } — enough to say what this
  -- is and to re-export the same thing live.
  ref jsonb not null,
  title text not null,
  -- The run the numbers came from; nullable so a snapshot outlives its run.
  run_id uuid references public.pipeline_runs(id) on delete set null,
  -- Tile-ready data, quotes frozen to { ref, text: '' }.
  data jsonb not null,
  -- Quote refs in `data`: 'e:<insight_evidence.id>' | 'c:<comments.id>' | 'v:<videos.id>'.
  evidence_ids text[] not null default '{}',
  -- auth.users id, no FK: an export outlives a team member (as agent_threads).
  created_by uuid,
  created_at timestamptz default now() not null
);

create index if not exists report_snapshots_client_created_idx
  on public.report_snapshots using btree (client_id, created_at desc);
create index if not exists report_snapshots_evidence_idx
  on public.report_snapshots using gin (evidence_ids);
create index if not exists report_snapshots_run_id_idx
  on public.report_snapshots using btree (run_id);

comment on column public.report_snapshots.data is
  'Tile-ready page data frozen at export. Quotes are { ref, text: '''' } — no third party''s words are stored; they resolve live through insight_evidence at render.';

create table if not exists public.artifacts (
  id uuid default gen_random_uuid() primary key,
  client_id uuid not null references public.clients(id) on delete cascade,
  snapshot_id uuid not null references public.report_snapshots(id) on delete cascade,
  format text not null check (format in ('pdf', 'png')),
  -- Set when the file is one tile (PNG of 'dashboard.strip'), null for a page/thread.
  tile_key text,
  -- Storage object path in the private `artifacts` bucket:
  --   artifacts/<client_id>/<snapshot_id>/<tile_key|page>-v<version>.<format>
  storage_path text not null,
  bytes integer not null,
  version integer not null default 1,
  render_ms integer,
  -- True once the erasure sweep has deleted the file; re-rendered on next download.
  stale boolean not null default false,
  rendered_at timestamptz default now() not null
);

create index if not exists artifacts_client_rendered_idx
  on public.artifacts using btree (client_id, rendered_at desc);
create index if not exists artifacts_snapshot_id_idx
  on public.artifacts using btree (snapshot_id);

create table if not exists public.export_events (
  id bigint generated always as identity primary key,
  client_id uuid not null references public.clients(id) on delete cascade,
  user_id uuid,
  snapshot_id uuid references public.report_snapshots(id) on delete set null,
  artifact_id uuid references public.artifacts(id) on delete set null,
  action text not null check (action in ('export', 'download', 'rerender')),
  kind text not null,
  format text not null,
  page text,
  tile_key text,
  created_at timestamptz default now() not null
);

create index if not exists export_events_client_created_idx
  on public.export_events using btree (client_id, created_at desc);
create index if not exists export_events_snapshot_id_idx
  on public.export_events using btree (snapshot_id);
create index if not exists export_events_artifact_id_idx
  on public.export_events using btree (artifact_id);

-- RLS — tenant reads its own; writes are service-role behind an authenticated
-- route, as everywhere else in this product.
alter table public.report_snapshots enable row level security;
drop policy if exists "Users see their own report_snapshots" on public.report_snapshots;
create policy "Users see their own report_snapshots" on public.report_snapshots
  for select using (client_id = get_my_client_id());

alter table public.artifacts enable row level security;
drop policy if exists "Users see their own artifacts" on public.artifacts;
create policy "Users see their own artifacts" on public.artifacts
  for select using (client_id = get_my_client_id());

alter table public.export_events enable row level security;
drop policy if exists "Users see their own export_events" on public.export_events;
create policy "Users see their own export_events" on public.export_events
  for select using (client_id = get_my_client_id());

-- Storage: one PRIVATE bucket. No storage policies for anon/authenticated on
-- purpose — every read is a signed URL minted by the service role after the
-- tenant check in /api/artifacts/[id]; every write is the service role.
insert into storage.buckets (id, name, public)
  values ('artifacts', 'artifacts', false)
  on conflict (id) do nothing;

-- Post-apply check (run by hand): three tables empty, RLS on, one policy each,
-- the bucket present and private.
--   select count(*) from public.report_snapshots;   -- 0
--   select count(*) from public.artifacts;          -- 0
--   select count(*) from public.export_events;      -- 0
--   select tablename, policyname from pg_policies
--     where tablename in ('report_snapshots','artifacts','export_events');
--   select id, public from storage.buckets where id = 'artifacts';  -- artifacts | false
