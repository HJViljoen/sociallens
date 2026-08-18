-- Tier 1.5 (2026-08-22): redact the historical demographic_signal quotes.
--
-- ORDER MATTERS. Apply this AFTER the code that filters insight_evidence on
-- redacted = false is live (lib/quotes.ts, app/dashboard/voice, pass-d
-- retrieveQuotes, scripts/eval.ts, scripts/seed-demo.ts). Applied before that
-- code, the old readers would render 1,092 empty quotes. The schema half
-- (20260822100000_retention_refresh.sql) is additive and can go first.
--
-- Counts-not-quotes (LIA/DPIA v0.2, 2026-08-18): the demographic_signal
-- category asks the model who the audience is — condition, use-case, location.
-- In a health-adjacent corpus that is a person's account of their own body,
-- derived by inference and quoted back. Art 9(2)(e) protects what a person
-- manifestly made public, not what was derived about them; so the product
-- keeps the citation (the FK is what the evidence floor counts) and drops the
-- words. New rows arrive redacted from persistVideo; this rewrites the rows
-- that already exist. Measured on prod 2026-08-18: 1,092 evidence rows across
-- 584 demographic_signal insights (of 5,393). Idempotent.
update public.insight_evidence e
   set quote = '', redacted = true
  from public.audience_insights ai
 where ai.id = e.audience_insight_id
   and ai.category = 'demographic_signal'
   and e.redacted = false;
