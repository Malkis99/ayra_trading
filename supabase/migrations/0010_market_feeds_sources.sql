-- AYRA Trading — Migration 0010: more official sources for the Market calendar and news (plan: docs/market-feeds-plan.md, section 9)
-- Requires 0009. Safe to run more than once (idempotent). Apply in the Supabase SQL Editor.
--
-- Only widens two lists in market_events and market_news; no new tables, no data changes, access rules unchanged.
-- * source:  + eia, census, dol (USA), eurostat (euro area), ons, boe (UK), statcan, boc (Canada), abs, rba (Australia)
-- * country: + gb, ca, au
-- The collector starts writing these sources in later PRs (PR 1 EIA/Census/DOL, PR 2 Eurostat, PR 3 ONS/BoE,
-- PR 5 Canada/Australia). Until then nothing changes on the site.

BEGIN;

ALTER TABLE public.market_events DROP CONSTRAINT IF EXISTS market_events_source_check;
ALTER TABLE public.market_events ADD CONSTRAINT market_events_source_check CHECK (source IN (
  'fed', 'ecb', 'whitehouse', 'bls', 'bea',
  'eia', 'census', 'dol', 'eurostat', 'ons', 'boe', 'statcan', 'boc', 'abs', 'rba'));
ALTER TABLE public.market_events DROP CONSTRAINT IF EXISTS market_events_country_check;
ALTER TABLE public.market_events ADD CONSTRAINT market_events_country_check CHECK (country IN ('us', 'eu', 'gb', 'ca', 'au'));

ALTER TABLE public.market_news DROP CONSTRAINT IF EXISTS market_news_source_check;
ALTER TABLE public.market_news ADD CONSTRAINT market_news_source_check CHECK (source IN (
  'fed', 'ecb', 'whitehouse', 'bls', 'bea',
  'eia', 'census', 'dol', 'eurostat', 'ons', 'boe', 'statcan', 'boc', 'abs', 'rba'));
ALTER TABLE public.market_news DROP CONSTRAINT IF EXISTS market_news_country_check;
ALTER TABLE public.market_news ADD CONSTRAINT market_news_country_check CHECK (country IN ('us', 'eu', 'gb', 'ca', 'au'));

COMMIT;
