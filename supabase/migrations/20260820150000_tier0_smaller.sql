-- Tier 0 T0-11 (2026-08-18): the smaller locks.
--
-- 1. Stripe event de-duplication. The webhook applied every delivery it
--    received, and Stripe retries, so a redelivered subscription event
--    re-applied its update. Recording processed ids makes a REDELIVERY a
--    no-op. It does not order anything: two different events arriving out of
--    order still apply in the order they arrive, which is a separate problem
--    and not one this table solves. Service-role only.
create table if not exists public.stripe_events (
  id text primary key,
  type text not null,
  processed_at timestamptz not null default now()
);

alter table public.stripe_events enable row level security;
-- No policies: only the service role (the webhook) touches this.

comment on table public.stripe_events is
  'Processed Stripe event ids, for webhook idempotency (T0-11). Stripe retries deliveries; without this a redelivery re-applied its update.';

-- 2. Invitations: an admin could rewrite any of their tenant's invite rows,
--    including role, email and token, because the UPDATE policy re-checked the
--    role only in USING and not in WITH CHECK. Column privileges make the
--    sensitive fields unwritable from the client entirely; the app changes an
--    invite's status and nothing else.
revoke update on public.invitations from authenticated;
grant update (status, accepted_at) on public.invitations to authenticated;
