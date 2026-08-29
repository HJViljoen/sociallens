-- Reports & Exports Stage 2, review follow-ups (2026-08-30).
-- (1) share_links.view_count is bumped atomically by the public page through
--     this function (a read-modify-write lost counts under concurrent opens).
-- (2) The three new tenant policies take the initplan form the rest of the
--     schema moved to in 20260823150000 — get_my_client_id() evaluated once
--     per query, not once per row.

create or replace function public.increment_share_view(link_id uuid)
returns void
language sql
security definer
set search_path to 'public', 'pg_temp'
as $$
  update public.share_links
     set view_count = view_count + 1,
         last_viewed_at = now()
   where id = link_id;
$$;
revoke all on function public.increment_share_view(uuid) from public, anon, authenticated;
-- The service role calls it; nobody else can.

alter policy "Users see their own reports" on public.reports
  using (client_id = (select get_my_client_id()));
alter policy "Users see their own report_templates" on public.report_templates
  using (client_id = (select get_my_client_id()));
alter policy "Users see their own share_links" on public.share_links
  using (client_id = (select get_my_client_id()));

-- Post-apply check (run by hand):
--   select increment_share_view('00000000-0000-0000-0000-000000000000');  -- no error, 0 rows
--   select policyname, qual from pg_policies where tablename in ('reports','report_templates','share_links');  -- (select get_my_client_id())
