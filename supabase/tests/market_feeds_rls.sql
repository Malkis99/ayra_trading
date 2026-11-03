-- AYRA Trading — test for migration 0009 (run on a TEST project; everything is rolled back at the end).
-- Every check raises an exception when it fails, so a clean run means all passed.
BEGIN;

-- The collector's rows (written here as the owner; on Supabase the collector uses the service role)
INSERT INTO public.market_events (id, source, kind, code, country, title, importance, starts_at) VALUES
  ('bls:empsit:2026-11-06', 'bls', 'release', 'us_nfp', 'us', 'Employment Situation', 3, '2026-11-06T13:30:00Z'),
  ('fed:fomc:2026-12-09:decision', 'fed', 'decision', 'fomc_decision', 'us', 'FOMC statement', 3, '2026-12-09T19:00:00Z'),
  ('bea:gdp:2026-11-25', 'bea', 'release', 'us_gdp', 'us', 'GDP (Second Estimate)', 3, '2026-11-25T13:30:00Z');
INSERT INTO public.market_events (id, source, kind, country, title, importance, starts_at, hidden) VALUES
  ('ecb:hidden:1', 'ecb', 'speech', 'eu', 'Wrong row', 1, '2026-11-05T09:00:00Z', TRUE);
INSERT INTO public.market_news (id, source, kind, country, title, summary, url, published_at, importance, dedupe_key, event_id) VALUES
  ('fed:press_monetary:20261028a', 'fed', 'decision', 'us', 'Federal Reserve issues FOMC statement', NULL,
   'https://www.federalreserve.gov/newsevents/pressreleases/monetary20261028a.htm', '2026-10-28T18:00:00Z', 3, 'fomc-statement-2026-10-28', 'fed:fomc:2026-12-09:decision'),
  ('whitehouse:53953', 'whitehouse', 'presidential_action', 'us', 'Executive order on trade', 'Short teaser from the feed.',
   'https://www.whitehouse.gov/presidential-actions/2026/10/example/', '2026-10-28T20:03:48Z', 3, 'eo-trade-2026-10-28', NULL);
INSERT INTO public.market_news (id, source, kind, country, title, url, published_at, importance, dedupe_key, hidden) VALUES
  ('whitehouse:1', 'whitehouse', 'statement', 'us', 'Noise', 'https://www.whitehouse.gov/x/', '2026-10-28T20:00:00Z', 1, 'noise', TRUE);
INSERT INTO public.market_feed_runs (source, ok, items) VALUES ('fed', TRUE, 2);

DO $$
DECLARE
  v_blocked BOOLEAN;
  v_before TIMESTAMPTZ;
  v_after TIMESTAMPTZ;
BEGIN
  -- 1. Only https links are accepted
  v_blocked := FALSE;
  BEGIN
    INSERT INTO public.market_news (id, source, kind, country, title, url, published_at, importance, dedupe_key)
      VALUES ('fed:x', 'fed', 'speech', 'us', 'T', 'http://example.com', now(), 2, 'k');
  EXCEPTION WHEN check_violation THEN v_blocked := TRUE;
  END;
  IF NOT v_blocked THEN RAISE EXCEPTION 'F1: a non-https link must be rejected'; END IF;

  -- 2. Only the source's short description: more than 1000 characters is rejected (no article bodies)
  v_blocked := FALSE;
  BEGIN
    INSERT INTO public.market_news (id, source, kind, country, title, summary, url, published_at, importance, dedupe_key)
      VALUES ('fed:y', 'fed', 'speech', 'us', 'T', repeat('a', 1001), 'https://example.com', now(), 2, 'k');
  EXCEPTION WHEN check_violation THEN v_blocked := TRUE;
  END;
  IF NOT v_blocked THEN RAISE EXCEPTION 'F2: a summary over 1000 characters must be rejected'; END IF;

  -- 3. Only the agreed sources; importance 1..3
  v_blocked := FALSE;
  BEGIN
    INSERT INTO public.market_events (id, source, kind, country, title, importance, starts_at)
      VALUES ('ff:x', 'forexfactory', 'release', 'us', 'T', 3, now());
  EXCEPTION WHEN check_violation THEN v_blocked := TRUE;
  END;
  IF NOT v_blocked THEN RAISE EXCEPTION 'F3: an unknown source must be rejected'; END IF;
  v_blocked := FALSE;
  BEGIN
    INSERT INTO public.market_events (id, source, kind, country, title, importance, starts_at)
      VALUES ('bls:x', 'bls', 'release', 'us', 'T', 4, now());
  EXCEPTION WHEN check_violation THEN v_blocked := TRUE;
  END;
  IF NOT v_blocked THEN RAISE EXCEPTION 'F3: importance 4 must be rejected'; END IF;

  -- 4. updated_at is set by the server on every change
  SELECT updated_at INTO v_before FROM public.market_events WHERE id = 'bls:empsit:2026-11-06';
  UPDATE public.market_events SET updated_at = '2000-01-01', status = 'released', actual = '+29,000' WHERE id = 'bls:empsit:2026-11-06';
  SELECT updated_at INTO v_after FROM public.market_events WHERE id = 'bls:empsit:2026-11-06';
  IF v_after < v_before OR v_after = '2000-01-01'::timestamptz THEN RAISE EXCEPTION 'F4: updated_at must be the server time'; END IF;
END $$;

-- ---- A visitor who is not signed in ----
SET LOCAL ROLE anon;
DO $$
DECLARE
  v_n INT;
  v_blocked BOOLEAN;
BEGIN
  -- 5. Reads events and news, never hidden rows
  SELECT count(*) INTO v_n FROM public.market_events;
  IF v_n <> 3 THEN RAISE EXCEPTION 'F5: anon must see 3 events (hidden excluded), sees %', v_n; END IF;
  SELECT count(*) INTO v_n FROM public.market_news;
  IF v_n <> 2 THEN RAISE EXCEPTION 'F5: anon must see 2 news (hidden excluded), sees %', v_n; END IF;

  -- 6. Cannot write
  v_blocked := FALSE;
  BEGIN
    INSERT INTO public.market_news (id, source, kind, country, title, url, published_at, importance, dedupe_key)
      VALUES ('fed:z', 'fed', 'speech', 'us', 'Fake', 'https://example.com', now(), 3, 'fake');
  EXCEPTION WHEN insufficient_privilege THEN v_blocked := TRUE;
  END;
  IF NOT v_blocked THEN RAISE EXCEPTION 'F6: anon must not insert news'; END IF;

  -- 7. Cannot read the collector's log
  v_blocked := FALSE;
  BEGIN
    SELECT count(*) INTO v_n FROM public.market_feed_runs;
  EXCEPTION WHEN insufficient_privilege THEN v_blocked := TRUE;
  END;
  IF NOT v_blocked THEN RAISE EXCEPTION 'F7: anon must not read the collector log'; END IF;
END $$;
RESET ROLE;

-- ---- A signed-in user ----
SET LOCAL ROLE authenticated;
DO $$
DECLARE
  v_n INT;
  v_blocked BOOLEAN;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000901', true);
  SELECT count(*) INTO v_n FROM public.market_news;
  IF v_n <> 2 THEN RAISE EXCEPTION 'F8: a user must see 2 news, sees %', v_n; END IF;

  -- 9. Cannot change, hide or delete anything
  v_blocked := FALSE;
  BEGIN
    UPDATE public.market_events SET title = 'Hacked';
  EXCEPTION WHEN insufficient_privilege THEN v_blocked := TRUE;
  END;
  IF NOT v_blocked THEN RAISE EXCEPTION 'F9: a user must not update events'; END IF;
  v_blocked := FALSE;
  BEGIN
    DELETE FROM public.market_news;
  EXCEPTION WHEN insufficient_privilege THEN v_blocked := TRUE;
  END;
  IF NOT v_blocked THEN RAISE EXCEPTION 'F9: a user must not delete news'; END IF;

  -- 10. Cannot run the clean-up
  v_blocked := FALSE;
  BEGIN
    PERFORM public.market_feeds_prune();
  EXCEPTION WHEN insufficient_privilege THEN v_blocked := TRUE;
  END;
  IF NOT v_blocked THEN RAISE EXCEPTION 'F10: a user must not run the clean-up'; END IF;
END $$;
RESET ROLE;

-- ---- The clean-up ----
DO $$
DECLARE
  v_n INT;
  v_expect INT;
BEGIN
  INSERT INTO public.market_news (id, source, kind, country, title, url, published_at, importance, dedupe_key)
    VALUES ('fed:old', 'fed', 'speech', 'us', 'Old', 'https://example.com/old', now() - INTERVAL '91 days', 2, 'old');
  INSERT INTO public.market_events (id, source, kind, country, title, importance, starts_at)
    VALUES ('bls:old', 'bls', 'release', 'us', 'Old', 2, now() - INTERVAL '91 days');
  INSERT INTO public.market_feed_runs (source, started_at, ok) VALUES ('bls', now() - INTERVAL '31 days', TRUE);
  -- 11. Removes exactly what is older than 90 days (the log: 30 days); counted, so the test keeps working later
  v_expect := (SELECT count(*) FROM public.market_news WHERE published_at < now() - INTERVAL '90 days')
            + (SELECT count(*) FROM public.market_events WHERE starts_at < now() - INTERVAL '90 days')
            + (SELECT count(*) FROM public.market_feed_runs WHERE started_at < now() - INTERVAL '30 days');
  IF v_expect < 3 THEN RAISE EXCEPTION 'F11: test setup must have at least 3 old rows'; END IF;
  v_n := public.market_feeds_prune();
  IF v_n <> v_expect THEN RAISE EXCEPTION 'F11: clean-up must remove % old rows, removed %', v_expect, v_n; END IF;
  SELECT count(*) INTO v_n FROM public.market_news WHERE published_at < now() - INTERVAL '90 days';
  IF v_n <> 0 THEN RAISE EXCEPTION 'F11: no old news may stay'; END IF;

  -- 12. Removing an event keeps the news, only unlinks it
  DELETE FROM public.market_events WHERE id = 'fed:fomc:2026-12-09:decision';
  SELECT count(*) INTO v_n FROM public.market_news WHERE id = 'fed:press_monetary:20261028a' AND event_id IS NULL;
  IF v_n <> 1 THEN RAISE EXCEPTION 'F12: the news must stay, unlinked'; END IF;
END $$;

ROLLBACK;
