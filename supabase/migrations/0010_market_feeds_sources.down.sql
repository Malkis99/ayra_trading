-- AYRA Trading — Rollback of 0010: back to the 0009 lists of sources (fed, ecb, whitehouse, bls, bea) and countries (us, eu).
-- Rows from the new sources or countries are removed first: only shared market data collected from public sources
-- (the collector can fetch it again); no user data is touched. Stop the collector's new sources before running this.
BEGIN;

DELETE FROM public.market_news
  WHERE source NOT IN ('fed', 'ecb', 'whitehouse', 'bls', 'bea') OR country NOT IN ('us', 'eu');
DELETE FROM public.market_events
  WHERE source NOT IN ('fed', 'ecb', 'whitehouse', 'bls', 'bea') OR country NOT IN ('us', 'eu');

ALTER TABLE public.market_events DROP CONSTRAINT IF EXISTS market_events_source_check;
ALTER TABLE public.market_events ADD CONSTRAINT market_events_source_check CHECK (source IN ('fed', 'ecb', 'whitehouse', 'bls', 'bea'));
ALTER TABLE public.market_events DROP CONSTRAINT IF EXISTS market_events_country_check;
ALTER TABLE public.market_events ADD CONSTRAINT market_events_country_check CHECK (country IN ('us', 'eu'));

ALTER TABLE public.market_news DROP CONSTRAINT IF EXISTS market_news_source_check;
ALTER TABLE public.market_news ADD CONSTRAINT market_news_source_check CHECK (source IN ('fed', 'ecb', 'whitehouse', 'bls', 'bea'));
ALTER TABLE public.market_news DROP CONSTRAINT IF EXISTS market_news_country_check;
ALTER TABLE public.market_news ADD CONSTRAINT market_news_country_check CHECK (country IN ('us', 'eu'));

COMMIT;
