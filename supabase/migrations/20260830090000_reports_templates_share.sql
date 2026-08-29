-- Reports & Exports Stage 2 (2026-08-30): the Report Studio, templates and
-- share links, on the Stage-1 spine.
--
-- A REPORT is the operator's editable definition — an ordered list of
-- sections (page + selection + tiles + one line of framing) and a cover
-- register. BUILDING it freezes every section's data into ONE report_snapshots
-- row (kind 'report'), so the PDF is an ordinary artifact of that snapshot,
-- erasure stales it like any other, and a share link points at it. A new
-- build after a new update is a new snapshot; a link keeps showing the build
-- it was made from — a link is a frozen document, not a live dashboard.
--
-- Starter templates live in code (lib/reports/templates.ts); report_templates
-- holds only what a tenant saved as its own.
--
-- share_links: read-only, no account, by unguessable token. The token column
-- is kept out of the authenticated grant (the invitations idiom): a teammate
-- can list the workspace's links, never read another's raw token. The public
-- route looks a token up with the service role and serves the SNAPSHOT only.

create table if not exists public.reports (
  id uuid default gen_random_uuid() primary key,
  client_id uuid not null references public.clients(id) on delete cascade,
  template_key text,
  title text not null,
  audience text not null check (audience in ('leadership', 'marketing', 'sales', 'content', 'general')),
  sections jsonb not null default '[]'::jsonb,
  cover jsonb not null default '{}'::jsonb,
  status text not null default 'draft' check (status in ('draft', 'built')),
  latest_snapshot_id uuid references public.report_snapshots(id) on delete set null,
  created_by uuid,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);
create index if not exists reports_client_updated_idx on public.reports using btree (client_id, updated_at desc);
comment on column public.reports.sections is
  'ReportSection[] (lib/reports/types.ts): page, the page''s URL params, static tile keys, variant, one line of the operator''s framing. No quotes, no ids of third parties.';

create table if not exists public.report_templates (
  id uuid default gen_random_uuid() primary key,
  client_id uuid not null references public.clients(id) on delete cascade,
  name text not null,
  audience text not null check (audience in ('leadership', 'marketing', 'sales', 'content', 'general')),
  sections jsonb not null default '[]'::jsonb,
  cover jsonb not null default '{}'::jsonb,
  created_by uuid,
  created_at timestamptz default now() not null
);
create index if not exists report_templates_client_idx on public.report_templates using btree (client_id, created_at desc);

-- A report is a fourth kind of snapshot; the row remembers which report built it.
alter table public.report_snapshots drop constraint if exists report_snapshots_kind_check;
alter table public.report_snapshots add constraint report_snapshots_kind_check
  check (kind in ('page', 'tile', 'agent_thread', 'report'));
alter table public.report_snapshots add column if not exists report_id uuid references public.reports(id) on delete set null;
create index if not exists report_snapshots_report_id_idx on public.report_snapshots using btree (report_id);

create table if not exists public.share_links (
  id uuid default gen_random_uuid() primary key,
  client_id uuid not null references public.clients(id) on delete cascade,
  snapshot_id uuid not null references public.report_snapshots(id) on delete cascade,
  token text not null unique,
  title text not null,
  expires_at timestamptz,
  password_hash text,
  revoked_at timestamptz,
  view_count integer not null default 0,
  last_viewed_at timestamptz,
  created_by uuid,
  created_at timestamptz default now() not null
);
create index if not exists share_links_client_created_idx on public.share_links using btree (client_id, created_at desc);
create index if not exists share_links_snapshot_id_idx on public.share_links using btree (snapshot_id);

create table if not exists public.share_views (
  id bigint generated always as identity primary key,
  share_link_id uuid not null references public.share_links(id) on delete cascade,
  viewed_at timestamptz default now() not null,
  ip_hash text,
  user_agent text
);
create index if not exists share_views_link_viewed_idx on public.share_views using btree (share_link_id, viewed_at desc);

-- RLS — tenant reads its own; writes are service-role behind an authenticated
-- route or server action, as everywhere else in this product.
alter table public.reports enable row level security;
drop policy if exists "Users see their own reports" on public.reports;
create policy "Users see their own reports" on public.reports
  for select using (client_id = get_my_client_id());

alter table public.report_templates enable row level security;
drop policy if exists "Users see their own report_templates" on public.report_templates;
create policy "Users see their own report_templates" on public.report_templates
  for select using (client_id = get_my_client_id());

alter table public.share_links enable row level security;
drop policy if exists "Users see their own share_links" on public.share_links;
create policy "Users see their own share_links" on public.share_links
  for select using (client_id = get_my_client_id());
-- The token and the password hash never reach a session client.
revoke select on public.share_links from authenticated, anon;
grant select (id, client_id, snapshot_id, title, expires_at, revoked_at, view_count, last_viewed_at, created_by, created_at)
  on public.share_links to authenticated;

alter table public.share_views enable row level security;
-- No policies: the public route writes them with the service role; the
-- workspace reads counts off share_links.

-- Post-apply check (run by hand): tables empty, RLS on, one policy each,
-- the kind check widened, the token column withheld.
--   select count(*) from public.reports;            -- 0
--   select count(*) from public.report_templates;   -- 0
--   select count(*) from public.share_links;        -- 0
--   select count(*) from public.share_views;        -- 0
--   select tablename, policyname from pg_policies
--     where tablename in ('reports','report_templates','share_links','share_views');
--   select pg_get_constraintdef(oid) from pg_constraint where conname = 'report_snapshots_kind_check';
--   select column_name from information_schema.column_privileges
--     where table_name = 'share_links' and grantee = 'authenticated' and privilege_type = 'SELECT';  -- no token, no password_hash
