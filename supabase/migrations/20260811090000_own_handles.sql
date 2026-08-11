-- Owned-account scrape interim (Wave 2, 2026-08-11): which of the client's own
-- public profiles we snapshot daily and pull own-post comments from weekly.
-- Shape: {"instagram": "ossur", "tiktok": "ossur_corp", "youtube": "UC..."}
-- (YouTube value is the CHANNEL ID, not the handle). Empty object = owned
-- layer off for that tenant. Operator-set (facts-vs-knobs); shown read-only
-- on Settings.
alter table public.tracking_configs
  add column own_handles jsonb not null default '{}'::jsonb;
