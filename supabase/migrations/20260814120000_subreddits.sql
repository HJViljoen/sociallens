-- Reddit auto-discovery (Wave 3, 2026-08-14): which subreddits a tenant's Reddit
-- gather searches, and how each one earned its place.
--
-- Shape: [{"name": "amputee", "status": "active", "discovered_at": "2026-08-14"}]
--   name          bare, lowercase, no 'r/' prefix (the display layer adds it)
--   status        'candidate' → proposed by GPT, not yet probed
--                 'active'    → passed the relevance probe, searched on runs
--                 'rejected'  → probed and failed; kept so we don't re-propose it
--   discovered_at when it was first proposed
--
-- Empty array = Reddit discovery has never run for this tenant. Deliberately NOT
-- operator-curated: subreddits are proposed by GPT and confirmed by a live
-- relevance probe, because hand-picked communities are how the Poler/Patagonia
-- homonym pollution got in. Extra keys can be added without a migration (jsonb).
alter table public.tracking_configs
  add column subreddits jsonb not null default '[]'::jsonb;
