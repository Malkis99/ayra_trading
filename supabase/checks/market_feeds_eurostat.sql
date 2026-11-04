-- AYRA Trading — read-only check of Eurostat in the Market calendar (plan section 9, PR 2). Changes nothing.
-- Run each query on its own in the SQL Editor.

-- 1. The dates came from Eurostat's iCal: one row per release, how many, and the nearest one (UTC; 11:00 Luxembourg
--    time = 10:00 UTC in winter, 09:00 in summer). Expected after the daily run (05:00 UTC) or a manual «scope=schedules»
--    run: 5 rows — eu_gdp_flash, eu_gdp_prelim, eu_hicp_flash, eu_retail_sales, eu_unemployment.
SELECT code, count(*) AS events, min(starts_at) FILTER (WHERE starts_at > now()) AS next_utc
FROM public.market_events
WHERE source = 'eurostat'
GROUP BY code
ORDER BY code;

-- 2. The figures came: Eurostat releases of the last 14 days (status released, the figure and the one before; usually
--    within ten minutes after 10:00 / 09:00 UTC).
SELECT starts_at, code, status, actual, previous, updated_at
FROM public.market_events
WHERE source = 'eurostat' AND starts_at BETWEEN now() - INTERVAL '14 days' AND now()
ORDER BY starts_at DESC;

-- 3. What the collector said the last time (ok = true is good; the error says what went wrong).
SELECT DISTINCT ON (source) source, ok, items, error, started_at
FROM public.market_feed_runs
WHERE source IN ('eurostat-schedule', 'eurostat-api')
ORDER BY source, started_at DESC;
