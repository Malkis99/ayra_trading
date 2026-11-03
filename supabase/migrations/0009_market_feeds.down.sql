-- AYRA Trading — Rollback of 0009: removes the Market calendar and official news tables.
-- Only shared market data collected from public sources is lost (the collector can fetch it again);
-- no user data is touched. If the collector's schedule is set up (PR 2), remove it first:
--   SELECT cron.unschedule('market-feeds');   -- only if pg_cron and that job exist
BEGIN;
DROP TABLE IF EXISTS public.market_news;
DROP TABLE IF EXISTS public.market_events;
DROP TABLE IF EXISTS public.market_feed_runs;
DROP FUNCTION IF EXISTS public.market_feeds_prune();
DROP FUNCTION IF EXISTS public.market_feed_touch();
COMMIT;
