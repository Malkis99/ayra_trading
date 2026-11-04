-- AYRA Trading — test for migration 0010 (run on a TEST project; everything is rolled back at the end).
-- Every check raises an exception when it fails, so a clean run means all passed.
BEGIN;

DO $$
DECLARE
  v_src TEXT;
  v_blocked BOOLEAN;
BEGIN
  -- 1. Every new source is accepted in both tables, with its country
  FOREACH v_src IN ARRAY ARRAY['eia', 'census', 'dol', 'eurostat', 'ons', 'boe', 'statcan', 'boc', 'abs', 'rba'] LOOP
    INSERT INTO public.market_events (id, source, kind, country, title, importance, starts_at)
      VALUES (v_src || ':t:2026-11-05', v_src, 'release',
        CASE v_src WHEN 'eurostat' THEN 'eu' WHEN 'ons' THEN 'gb' WHEN 'boe' THEN 'gb' WHEN 'statcan' THEN 'ca' WHEN 'boc' THEN 'ca'
          WHEN 'abs' THEN 'au' WHEN 'rba' THEN 'au' ELSE 'us' END, 'Test', 2, '2026-11-05T15:30:00Z');
    INSERT INTO public.market_news (id, source, kind, country, title, url, published_at, importance, dedupe_key)
      VALUES (v_src || ':t', v_src, 'data',
        CASE v_src WHEN 'eurostat' THEN 'eu' WHEN 'ons' THEN 'gb' WHEN 'boe' THEN 'gb' WHEN 'statcan' THEN 'ca' WHEN 'boc' THEN 'ca'
          WHEN 'abs' THEN 'au' WHEN 'rba' THEN 'au' ELSE 'us' END, 'Test', 'https://example.com/' || v_src, '2026-11-05T15:30:00Z', 2, 'k-' || v_src);
  END LOOP;

  -- 2. The old sources still work
  INSERT INTO public.market_events (id, source, kind, country, title, importance, starts_at)
    VALUES ('bls:t:2026-11-06', 'bls', 'release', 'us', 'Test', 3, '2026-11-06T13:30:00Z');

  -- 3. A source outside the list is still rejected (no companies or aggregators sneak in)
  FOREACH v_src IN ARRAY ARRAY['adp', 'ism', 'spglobal', 'investing'] LOOP
    v_blocked := FALSE;
    BEGIN
      INSERT INTO public.market_events (id, source, kind, country, title, importance, starts_at)
        VALUES (v_src || ':t:x', v_src, 'release', 'us', 'Test', 2, now());
    EXCEPTION WHEN check_violation THEN v_blocked := TRUE;
    END;
    IF NOT v_blocked THEN RAISE EXCEPTION 'S3: source % must be rejected', v_src; END IF;
    v_blocked := FALSE;
    BEGIN
      INSERT INTO public.market_news (id, source, kind, country, title, url, published_at, importance, dedupe_key)
        VALUES (v_src || ':t', v_src, 'data', 'us', 'Test', 'https://example.com', now(), 2, 'k');
    EXCEPTION WHEN check_violation THEN v_blocked := TRUE;
    END;
    IF NOT v_blocked THEN RAISE EXCEPTION 'S3: news source % must be rejected', v_src; END IF;
  END LOOP;

  -- 4. A country outside the list is still rejected (Japan, Germany, Switzerland, China are not in the plan)
  FOREACH v_src IN ARRAY ARRAY['jp', 'de', 'ch', 'cn'] LOOP
    v_blocked := FALSE;
    BEGIN
      INSERT INTO public.market_events (id, source, kind, country, title, importance, starts_at)
        VALUES ('eia:c:' || v_src, 'eia', 'release', v_src, 'Test', 2, now());
    EXCEPTION WHEN check_violation THEN v_blocked := TRUE;
    END;
    IF NOT v_blocked THEN RAISE EXCEPTION 'S4: country % must be rejected', v_src; END IF;
    v_blocked := FALSE;
    BEGIN
      INSERT INTO public.market_news (id, source, kind, country, title, url, published_at, importance, dedupe_key)
        VALUES ('eia:n:' || v_src, 'eia', 'data', v_src, 'Test', 'https://example.com', now(), 2, 'k');
    EXCEPTION WHEN check_violation THEN v_blocked := TRUE;
    END;
    IF NOT v_blocked THEN RAISE EXCEPTION 'S4: news country % must be rejected', v_src; END IF;
  END LOOP;

  -- 5. Access is unchanged: the site still cannot write
  IF has_table_privilege('anon', 'public.market_events', 'INSERT') OR has_table_privilege('authenticated', 'public.market_news', 'INSERT') THEN
    RAISE EXCEPTION 'S5: the site must not write';
  END IF;
END $$;

ROLLBACK;
