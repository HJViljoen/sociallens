-- News context layer (Wave 2, 2026-08-11): ring-classified Google News RSS
-- items per run, surfaced as an "In the news" context panel on Trends.
-- Context only — nothing correlates or claims causation (that layer waits
-- for real account events). Mirrors keyword_performance's conventions.
create table public.news_items (
  id uuid default gen_random_uuid() primary key,
  client_id uuid not null references public.clients(id) on delete cascade,
  run_id uuid references public.pipeline_runs(id) on delete set null,
  source text not null,
  source_ref text not null default '',
  url text not null,
  url_hash text not null,
  title text not null,
  summary text not null default '',
  published_at timestamptz,
  -- 0 direct (brand) · 1 competitive · 2 category · 4 macro (3 thematic unused)
  ring smallint not null,
  bucket text not null default '',
  created_at timestamptz default now() not null,
  unique (client_id, url_hash)
);

create index news_items_client_run_idx on public.news_items using btree (client_id, run_id);

alter table public.news_items enable row level security;

create policy "Users see their own news_items" on public.news_items
  for select using (client_id = get_my_client_id());
