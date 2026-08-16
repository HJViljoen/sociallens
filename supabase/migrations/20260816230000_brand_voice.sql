-- Brand Voice (2026-08-16): the RLS-safe snapshot Market reads for the
-- "About you" block and the brand-voice roll-up. video_claims is service-role
-- only, so — like say_vs_hear — the synthesis step writes a shaped snapshot
-- here: { counts: { own, about, competitors }, about: [{ claim, quote, account,
-- platform, url }] }. Additive, nullable; older rows read as "no snapshot".
alter table run_summary
  add column if not exists brand_voice jsonb;

comment on column run_summary.brand_voice is
  'Brand-voice snapshot: counts {own, about, competitors} + about-you entries (third-party claims about the client, verbatim). Written by the synthesis step; null before 2026-08-16.';
