-- Fresh-eyes review fixes, 2026-08-18. Three defects the review found in the
-- Tier 0 work itself, each verified against production before fixing.

-- 1. ai_call_log.request is NOT NULL, so the new retention sweep's
--    `update ... set request = null` would have raised 23502 on the first of
--    1,638 eligible rows, killing the cron at step 2 EVERY night and taking
--    the YouTube step with it, while the published privacy notice asserted all
--    three windows were enforced. Nothing reads these bodies; the audit value
--    is the metadata (cost, tokens, timing, validation status).
alter table public.ai_call_log alter column request drop not null;

comment on column public.ai_call_log.request is
  'Prompt bodies. Nullable since 2026-08-18: the retention sweep strips them after 30 days and keeps the metadata.';

-- 2. The invite token stayed readable by every owner/admin. T0-11 nulled it in
--    JavaScript, but the RLS SELECT policy grants all columns, so any admin
--    could read every pending token straight from PostgREST with their own JWT.
--    That is an escalation, not a leak: the not-signed-in accept path creates
--    the account for the invited address with a caller-chosen password, so a
--    stolen OWNER token is an admin-to-owner takeover needing no mailbox
--    access. A column privilege cannot be bypassed by a policy. The Team page
--    now reads tokens through the service role, scoped to the invites you sent.
revoke select (token) on public.invitations from authenticated;

-- 3. Every existing run_summary row predates audience_sentiment, so the next
--    report for every client would have carried no sentiment line at all, and
--    the trends chart would have plotted a blended number beside an
--    audience-only one and narrated the difference as movement. Recompute the
--    audience family for each client's LATEST row from the videos table: valid
--    because overall_sentiment_* is computed over the whole current corpus
--    rather than run-scoped, and no gather has happened since that row was
--    written. Older rows stay null and are excluded from comparison by design.
--    Result: Ossur 85.1% of 496 judged (was 85.7% of 1,155 blended), Sealand
--    77.7% of 381 (was 79.9% of 867).
with latest as (
  select distinct on (client_id) id, client_id, run_id
  from public.run_summary
  order by client_id, run_date desc
),
fam as (
  select
    l.id,
    count(*) filter (where v.sentiment in ('positive','neutral','negative','mixed')) as judged,
    count(*) filter (where v.sentiment = 'positive') as pos,
    count(*) filter (where v.sentiment = 'neutral')  as neu,
    count(*) filter (where v.sentiment = 'negative') as neg,
    count(*) filter (where v.sentiment = 'mixed')    as mix
  from latest l
  join public.videos v
    on v.client_id = l.client_id
   and coalesce(v.source, 'discovered') <> 'owned'
   and v.sentiment_source = 'audience'
  group by l.id
)
update public.run_summary rs
set audience_sentiment = jsonb_build_object(
      'positive', case when f.judged > 0 then round((f.pos::numeric / f.judged) * 100, 1) else null end,
      'neutral',  case when f.judged > 0 then round((f.neu::numeric / f.judged) * 100, 1) else null end,
      'negative', case when f.judged > 0 then round((f.neg::numeric / f.judged) * 100, 1) else null end,
      'judged',   f.judged,
      'counts',   jsonb_build_object('positive', f.pos, 'neutral', f.neu, 'negative', f.neg, 'mixed', f.mix),
      'backfilled', true
    )
from fam f
where rs.id = f.id and rs.audience_sentiment is null;
