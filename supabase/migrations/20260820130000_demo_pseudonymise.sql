-- Tier 0 T0-9 (2026-08-18): take the real people out of the demo tenant.
--
-- scripts/seed-demo.ts says the demo workspace holds "only synthetic data".
-- That is true of the owned-account layer and false of everything else: the
-- comments and videos are a verbatim clone of the live Össur corpus. Measured
-- before this migration: 4,969 comments, 4,701 distinct real handles, 4,894 of
-- them identical (comment_id and author) to their Össur source. The whole lock
-- on that workspace was the password '123456', hardcoded in the seed script.
--
-- The demo needs the shape of real conversation, not the identity of the people
-- who had it. Authors become a stable one-way pseudonym: the same person still
-- reads as the same voice across the six seeded weeks, and no real handle
-- remains. Comment TEXT is left alone, which is what makes the demo worth
-- showing; the seeded weekly_reports were checked and contain no handles.
--
-- Idempotent: rows already pseudonymised are skipped. Recoverable by re-running
-- scripts/seed-demo.ts, which now applies the same transform on clone and
-- refuses to run without a real DEMO_PASSWORD.

update public.comments
set author = 'user_' || left(md5(author), 8)
where client_id = 'de300055-0000-4000-8000-000000000001'
  and author is not null
  and author <> ''
  and author !~ '^user_[0-9a-f]{8}$';
