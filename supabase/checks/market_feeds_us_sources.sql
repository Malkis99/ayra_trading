-- AYRA Trading — read-only check of the new US sources (EIA, Census, DOL; plan section 9, PR 1). Changes nothing.
-- Run each query on its own in the SQL Editor.

-- 1. The dates are in: one row per source and event, with how many and the nearest one (UTC).
--    Expected after the daily schedule run (05:00 UTC) or a manual «scope=schedules» run: eia 2 rows, census 4, dol 1.
SELECT source, code, count(*) AS events, min(starts_at) FILTER (WHERE starts_at > now()) AS next_utc
FROM public.market_events
WHERE source IN ('eia', 'census', 'dol')
GROUP BY source, code
ORDER BY source, code;

-- 2. The figures came: released events of the last 14 days with the published value and the one before.
--    EIA: within three hours after Wednesday 10:30 / Thursday 10:30 ET; DOL: within ten minutes after Thursday 8:30 ET;
--    Census: within ten minutes after its release.
SELECT starts_at, source, code, status, actual, previous, updated_at
FROM public.market_events
WHERE source IN ('eia', 'census', 'dol') AND starts_at BETWEEN now() - INTERVAL '14 days' AND now()
ORDER BY starts_at DESC;

-- 3. What the collector said the last time it asked each source (ok = true is good; the error says what went wrong,
--    e.g. «EIA_API_KEY is not set» or «HTTP 403 Census API …»).
SELECT DISTINCT ON (source) source, ok, items, error, started_at
FROM public.market_feed_runs
WHERE source IN ('schedules-listed', 'eia-api', 'census-api', 'dol-claims')
ORDER BY source, started_at DESC;
