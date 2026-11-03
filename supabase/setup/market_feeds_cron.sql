-- AYRA Trading — the Market feeds collector's schedule (docs/market-feeds-plan.md, section 4).
-- Run in the Supabase SQL Editor AFTER the site has MARKET_FEEDS_SECRET and SUPABASE_SERVICE_ROLE_KEY (Vercel) and
-- was redeployed. Replace PASTE_THE_SECRET_HERE (3 places) with the same value as MARKET_FEEDS_SECRET in Vercel.
-- Safe to run again: each job is removed first and created anew.
--
-- Jobs (times in UTC):
--   market-feeds           every 10 minutes   — Fed, ECB, White House, BEA news; BLS figures after a release
--   market-feeds-releases  every 2 minutes, 12:00–15:59 on weekdays — only BEA and BLS figures (8:30 / 10:00 ET)
--   market-feeds-daily     once a day, 05:00  — the calendar (FOMC, ECB, BLS, BEA) and the 90-day clean-up

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

DO $$
BEGIN
  PERFORM cron.unschedule(jobname) FROM cron.job WHERE jobname IN ('market-feeds', 'market-feeds-releases', 'market-feeds-daily');
END $$;

SELECT cron.schedule('market-feeds', '*/10 * * * *', $job$
  SELECT net.http_post(
    url := 'https://ayra-trading.vercel.app/api/market-feeds/collect?scope=news',
    headers := jsonb_build_object('Authorization', 'Bearer PASTE_THE_SECRET_HERE'),
    timeout_milliseconds := 60000
  );
$job$);

SELECT cron.schedule('market-feeds-releases', '*/2 12-15 * * 1-5', $job$
  SELECT net.http_post(
    url := 'https://ayra-trading.vercel.app/api/market-feeds/collect?scope=releases',
    headers := jsonb_build_object('Authorization', 'Bearer PASTE_THE_SECRET_HERE'),
    timeout_milliseconds := 60000
  );
$job$);

SELECT cron.schedule('market-feeds-daily', '0 5 * * *', $job$
  SELECT net.http_post(
    url := 'https://ayra-trading.vercel.app/api/market-feeds/collect?scope=schedules&prune=1',
    headers := jsonb_build_object('Authorization', 'Bearer PASTE_THE_SECRET_HERE'),
    timeout_milliseconds := 60000
  );
$job$);

-- What is scheduled now (three rows expected):
SELECT jobname, schedule, active FROM cron.job WHERE jobname LIKE 'market-feeds%' ORDER BY jobname;

-- To stop the collector at any time (nothing is deleted):
--   SELECT cron.unschedule('market-feeds'); SELECT cron.unschedule('market-feeds-releases'); SELECT cron.unschedule('market-feeds-daily');
