-- AYRA Trading — Migration 0009: Market calendar and official news (plan: docs/market-feeds-plan.md)
-- Requires 0001. Safe to run more than once (idempotent). Apply in the Supabase SQL Editor.
-- Numbers 0006 (profile and character) and 0007 (server economy) stay reserved.
--
-- Shared market data, the same for everyone — nothing personal is stored here:
-- * market_events   — calendar events from official schedules (BLS, BEA, Fed, ECB): time in UTC, importance,
--                     the actual value once it is published.
-- * market_news     — official news (Fed, ECB, White House, BLS, BEA): title, the source's own short description,
--                     time in UTC, link to the original. Never the full text of an article.
-- * market_feed_runs — what the collector did and when (for the owner's checks; not visible to the site).
-- Reading: everyone (signed in or not) reads events and news that are not hidden. Writing: only the server's
-- collector (service role) — no browser can add, change or delete a row. Old rows are removed after 90 days.
-- No XP / coins here.

BEGIN;

-- ---- Calendar events ----
CREATE TABLE IF NOT EXISTS public.market_events (
  -- stable key from the source, e.g. 'bls:empsit:2026-11-06' or 'fed:fomc:2026-12-09:decision'
  id TEXT PRIMARY KEY CHECK (id ~ '^[a-z]+:[A-Za-z0-9_.:-]{1,120}$'),
  source TEXT NOT NULL CHECK (source IN ('fed', 'ecb', 'whitehouse', 'bls', 'bea')),
  -- what kind of event: a data release, a central bank meeting / decision / press conference, a speech, minutes
  kind TEXT NOT NULL CHECK (kind IN ('release', 'meeting', 'decision', 'press_conference', 'speech', 'testimony', 'minutes', 'statement')),
  -- known events have a code the site translates (e.g. 'us_cpi', 'us_nfp', 'fomc_decision'); null = show the title
  code TEXT CHECK (code IS NULL OR code ~ '^[a-z0-9_]{2,40}$'),
  country TEXT NOT NULL CHECK (country IN ('us', 'eu')),
  title TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 300),
  importance SMALLINT NOT NULL CHECK (importance BETWEEN 1 AND 3), -- 1 low, 2 medium, 3 high
  starts_at TIMESTAMPTZ NOT NULL,                                  -- UTC
  -- the source gives the day but not the hour yet (shown as «time to be announced»)
  time_tbd BOOLEAN NOT NULL DEFAULT FALSE,
  status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'released', 'cancelled')),
  -- the published figure as the source writes it (e.g. '+29,000', '4.2%', '+3.4'); forecasts are not stored
  actual TEXT CHECK (actual IS NULL OR char_length(actual) <= 60),
  previous TEXT CHECK (previous IS NULL OR char_length(previous) <= 60),
  -- the source's own one-paragraph summary of the release, if it gives one
  summary TEXT CHECK (summary IS NULL OR char_length(summary) <= 1000),
  url TEXT CHECK (url IS NULL OR (url ~ '^https://' AND char_length(url) <= 600)),
  hidden BOOLEAN NOT NULL DEFAULT FALSE,                           -- the owner can hide a wrong row
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS market_events_starts_idx ON public.market_events (starts_at);
CREATE INDEX IF NOT EXISTS market_events_important_idx ON public.market_events (starts_at) WHERE importance = 3 AND NOT hidden;

-- ---- Official news ----
CREATE TABLE IF NOT EXISTS public.market_news (
  -- 'source:' + the source's own id (guid or link)
  id TEXT PRIMARY KEY CHECK (id ~ '^[a-z]+:.+$' AND char_length(id) <= 310),
  source TEXT NOT NULL CHECK (source IN ('fed', 'ecb', 'whitehouse', 'bls', 'bea')),
  -- trust level shown on every item: 'official' (central banks, government, statistics). Others may come later.
  trust TEXT NOT NULL DEFAULT 'official' CHECK (trust IN ('official', 'agency')),
  kind TEXT NOT NULL CHECK (kind IN ('decision', 'statement', 'speech', 'testimony', 'press_conference', 'minutes', 'data', 'presidential_action', 'press_release')),
  country TEXT NOT NULL CHECK (country IN ('us', 'eu')),
  title TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 300),
  -- only what the source itself gives as a description; never the article body
  summary TEXT CHECK (summary IS NULL OR char_length(summary) <= 1000),
  url TEXT NOT NULL CHECK (url ~ '^https://' AND char_length(url) <= 600),
  published_at TIMESTAMPTZ NOT NULL,                               -- UTC
  importance SMALLINT NOT NULL CHECK (importance BETWEEN 1 AND 3),
  -- the same news from two places (e.g. a decision and its statement) share this key and show once
  dedupe_key TEXT NOT NULL CHECK (char_length(dedupe_key) BETWEEN 1 AND 200),
  -- linked calendar event (a decision, a release), if any
  event_id TEXT REFERENCES public.market_events(id) ON DELETE SET NULL,
  hidden BOOLEAN NOT NULL DEFAULT FALSE,                           -- noise filter or the owner hid it
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS market_news_published_idx ON public.market_news (published_at DESC);
CREATE INDEX IF NOT EXISTS market_news_dedupe_idx ON public.market_news (dedupe_key);

-- ---- The collector's log (owner only) ----
CREATE TABLE IF NOT EXISTS public.market_feed_runs (
  id BIGSERIAL PRIMARY KEY,
  source TEXT NOT NULL CHECK (char_length(source) BETWEEN 1 AND 40),
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  ok BOOLEAN,
  items INT CHECK (items IS NULL OR items >= 0),
  error TEXT CHECK (error IS NULL OR char_length(error) <= 2000)
);
CREATE INDEX IF NOT EXISTS market_feed_runs_started_idx ON public.market_feed_runs (started_at DESC);

-- updated_at is set by the server on every change
CREATE OR REPLACE FUNCTION public.market_feed_touch()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

DROP TRIGGER IF EXISTS tr_market_events_touch ON public.market_events;
CREATE TRIGGER tr_market_events_touch BEFORE UPDATE ON public.market_events
  FOR EACH ROW EXECUTE FUNCTION public.market_feed_touch();
DROP TRIGGER IF EXISTS tr_market_news_touch ON public.market_news;
CREATE TRIGGER tr_market_news_touch BEFORE UPDATE ON public.market_news
  FOR EACH ROW EXECUTE FUNCTION public.market_feed_touch();

-- Old rows go after 90 days (owner's decision 2026-10-30, docs/market-plan.md 10.5); the log after 30 days.
-- Called by the collector's schedule (PR 2). Returns how many rows were removed.
CREATE OR REPLACE FUNCTION public.market_feeds_prune()
RETURNS INT AS $$
DECLARE
  v_n INT := 0;
  v_m INT;
BEGIN
  DELETE FROM public.market_news WHERE published_at < now() - INTERVAL '90 days';
  GET DIAGNOSTICS v_m = ROW_COUNT; v_n := v_n + v_m;
  DELETE FROM public.market_events WHERE starts_at < now() - INTERVAL '90 days';
  GET DIAGNOSTICS v_m = ROW_COUNT; v_n := v_n + v_m;
  DELETE FROM public.market_feed_runs WHERE started_at < now() - INTERVAL '30 days';
  GET DIAGNOSTICS v_m = ROW_COUNT; v_n := v_n + v_m;
  RETURN v_n;
END;
$$ LANGUAGE plpgsql SET search_path = public;
REVOKE ALL ON FUNCTION public.market_feeds_prune() FROM PUBLIC, anon, authenticated;

-- ---- Access ----
ALTER TABLE public.market_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.market_news ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.market_feed_runs ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.market_events, public.market_news, public.market_feed_runs FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE public.market_feed_runs_id_seq FROM PUBLIC, anon, authenticated;
-- the site only reads; the log stays closed (no policy for it = no rows for anon / authenticated)
GRANT SELECT ON public.market_events, public.market_news TO anon, authenticated;

DROP POLICY IF EXISTS market_events_read ON public.market_events;
CREATE POLICY market_events_read ON public.market_events FOR SELECT TO anon, authenticated USING (NOT hidden);
DROP POLICY IF EXISTS market_news_read ON public.market_news;
CREATE POLICY market_news_read ON public.market_news FOR SELECT TO anon, authenticated USING (NOT hidden);

-- The collector writes with the service role (it bypasses RLS). On Supabase it already has these rights;
-- granted explicitly where the role exists.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.market_events, public.market_news, public.market_feed_runs TO service_role;
    GRANT USAGE, SELECT ON SEQUENCE public.market_feed_runs_id_seq TO service_role;
    GRANT EXECUTE ON FUNCTION public.market_feeds_prune() TO service_role;
  END IF;
END $$;

COMMIT;
