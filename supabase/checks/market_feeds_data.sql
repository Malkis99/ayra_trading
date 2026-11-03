-- AYRA Trading — read-only check: did the collector fill the 0009 tables? Changes nothing.
-- 1. The last runs of each source (ok = true; an error says what went wrong)
SELECT DISTINCT ON (source) source, ok, items, error, started_at
FROM public.market_feed_runs
ORDER BY source, started_at DESC;

-- 2. How much is stored, and how fresh
SELECT
  (SELECT count(*) FROM public.market_events) AS events,
  (SELECT count(*) FROM public.market_events WHERE starts_at > now()) AS events_ahead,
  (SELECT count(*) FROM public.market_events WHERE status = 'released') AS events_with_figures,
  (SELECT count(*) FROM public.market_news) AS news,
  (SELECT count(*) FROM public.market_news WHERE NOT hidden) AS news_shown,
  (SELECT max(fetched_at) FROM public.market_news) AS last_news_fetch,
  (SELECT max(started_at) FROM public.market_feed_runs) AS last_run;

-- 3. The next important events (UTC)
SELECT starts_at, source, title, importance, status, actual, previous
FROM public.market_events
WHERE starts_at > now() - INTERVAL '1 day' AND importance = 3
ORDER BY starts_at
LIMIT 15;

-- 4. The latest shown official news
SELECT published_at, source, kind, importance, left(title, 90) AS title
FROM public.market_news
WHERE NOT hidden
ORDER BY published_at DESC
LIMIT 15;
