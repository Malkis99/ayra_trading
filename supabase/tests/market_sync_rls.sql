-- AYRA Trading — test for migration 0008 (run on a TEST project; everything is rolled back at the end).
-- Every check raises an exception when it fails, so a clean run means all passed.
BEGIN;

-- Users: A and B have cloud sync on, C has it off
INSERT INTO auth.users (id, email) VALUES
  ('00000000-0000-0000-0000-0000000008a1', 'market-a@example.com'),
  ('00000000-0000-0000-0000-0000000008b1', 'market-b@example.com'),
  ('00000000-0000-0000-0000-0000000008c1', 'market-c@example.com')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.user_features (user_id, cloud_sync) VALUES
  ('00000000-0000-0000-0000-0000000008a1', TRUE),
  ('00000000-0000-0000-0000-0000000008b1', TRUE)
ON CONFLICT (user_id) DO UPDATE SET cloud_sync = EXCLUDED.cloud_sync;

-- B already has a Watchlist in the cloud
INSERT INTO public.market_user_data (user_id, id, data) VALUES ('00000000-0000-0000-0000-0000000008b1', 'watchlist',
  '{"id":"watchlist","ids":["btc"],"updatedAt":"2026-10-01T10:00:00Z"}');

SET LOCAL ROLE authenticated;

DO $$
DECLARE
  c_a CONSTANT TEXT := '00000000-0000-0000-0000-0000000008a1';
  c_c CONSTANT TEXT := '00000000-0000-0000-0000-0000000008c1';
  v_row public.market_user_data%ROWTYPE;
  v_n INT;
  v_blocked BOOLEAN;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', c_a, true);

  -- 1. A writes own Watchlist, view and a note; client_updated_at comes from data.updatedAt
  INSERT INTO public.market_user_data (id, data, device_id) VALUES
    ('watchlist', '{"id":"watchlist","ids":["eurusd","gold"],"updatedAt":"2026-10-02T09:00:00Z"}', 'dev_1'),
    ('chart_view', '{"id":"chart_view","clock":"bottom","updatedAt":"2026-10-02T09:00:00Z"}', 'dev_1'),
    ('note:btc', '{"id":"note:btc","text":"76 000","updatedAt":"2026-10-02T09:00:00Z"}', 'dev_1');
  SELECT * INTO v_row FROM public.market_user_data WHERE id = 'watchlist';
  IF v_row.user_id::text <> c_a OR v_row.client_updated_at <> '2026-10-02T09:00:00Z'::timestamptz OR v_row.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'M1: row wrong: %', row_to_json(v_row);
  END IF;

  -- 2. A sees only own rows
  SELECT count(*) INTO v_n FROM public.market_user_data;
  IF v_n <> 3 THEN RAISE EXCEPTION 'M2: A must see only own 3 rows, sees %', v_n; END IF;

  -- 3. A cannot write for B, cannot change B's rows
  v_blocked := FALSE;
  BEGIN
    INSERT INTO public.market_user_data (user_id, id, data) VALUES ('00000000-0000-0000-0000-0000000008b1', 'chart_view',
      '{"id":"chart_view","updatedAt":"2026-10-02T09:00:00Z"}');
  EXCEPTION WHEN insufficient_privilege THEN v_blocked := TRUE;
  END;
  IF NOT v_blocked THEN RAISE EXCEPTION 'M3: insert for another user must fail'; END IF;
  UPDATE public.market_user_data SET device_id = 'hacked' WHERE user_id = '00000000-0000-0000-0000-0000000008b1';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 0 THEN RAISE EXCEPTION 'M3: update of another user''s row must affect 0 rows'; END IF;

  -- 4. Last write wins: an older version is skipped, a newer one replaces
  UPDATE public.market_user_data SET data = '{"id":"watchlist","ids":["old"],"updatedAt":"2026-10-02T08:00:00Z"}' WHERE id = 'watchlist';
  SELECT * INTO v_row FROM public.market_user_data WHERE id = 'watchlist';
  IF v_row.data -> 'ids' <> '["eurusd","gold"]'::jsonb THEN RAISE EXCEPTION 'M4: an older version must not overwrite'; END IF;
  UPDATE public.market_user_data SET data = '{"id":"watchlist","ids":["gold"],"updatedAt":"2026-10-02T10:00:00Z"}' WHERE id = 'watchlist';
  SELECT * INTO v_row FROM public.market_user_data WHERE id = 'watchlist';
  IF v_row.data -> 'ids' <> '["gold"]'::jsonb THEN RAISE EXCEPTION 'M4: a newer version must replace'; END IF;

  -- 5. A cleared note is a tombstone
  UPDATE public.market_user_data SET data = '{"id":"note:btc","text":"","deletedAt":"2026-10-02T11:00:00Z","updatedAt":"2026-10-02T11:00:00Z"}' WHERE id = 'note:btc';
  SELECT * INTO v_row FROM public.market_user_data WHERE id = 'note:btc';
  IF v_row.deleted_at IS NULL THEN RAISE EXCEPTION 'M5: deleted_at must be filled from data.deletedAt'; END IF;

  -- 6. No DELETE; wrong ids, id mismatch, reward keys, the future are refused
  v_blocked := FALSE;
  BEGIN DELETE FROM public.market_user_data WHERE id = 'note:btc'; EXCEPTION WHEN insufficient_privilege THEN v_blocked := TRUE; END;
  IF NOT v_blocked THEN RAISE EXCEPTION 'M6: DELETE must be forbidden'; END IF;
  v_blocked := FALSE;
  BEGIN INSERT INTO public.market_user_data (id, data) VALUES ('anything', '{"id":"anything","updatedAt":"2026-10-02T09:00:00Z"}');
  EXCEPTION WHEN check_violation THEN v_blocked := TRUE; END;
  IF NOT v_blocked THEN RAISE EXCEPTION 'M6: an unknown id must be refused'; END IF;
  v_blocked := FALSE;
  BEGIN INSERT INTO public.market_user_data (id, data) VALUES ('note:eth', '{"id":"note:btc","updatedAt":"2026-10-02T09:00:00Z"}');
  EXCEPTION WHEN raise_exception THEN v_blocked := TRUE; END;
  IF NOT v_blocked THEN RAISE EXCEPTION 'M6: id mismatch must be refused'; END IF;
  v_blocked := FALSE;
  BEGIN INSERT INTO public.market_user_data (id, data) VALUES ('note:eth', '{"id":"note:eth","xp":10,"updatedAt":"2026-10-02T09:00:00Z"}');
  EXCEPTION WHEN check_violation THEN v_blocked := TRUE; END;
  IF NOT v_blocked THEN RAISE EXCEPTION 'M6: reward keys must be refused'; END IF;
  v_blocked := FALSE;
  BEGIN INSERT INTO public.market_user_data (id, data) VALUES ('note:eth', '{"id":"note:eth","updatedAt":"2999-01-01T00:00:00Z"}');
  EXCEPTION WHEN raise_exception THEN v_blocked := TRUE; END;
  IF NOT v_blocked THEN RAISE EXCEPTION 'M6: a version from the future must be refused'; END IF;

  -- 7. C (sync off) cannot write, but can read (own rows: none)
  PERFORM set_config('request.jwt.claim.sub', c_c, true);
  v_blocked := FALSE;
  BEGIN INSERT INTO public.market_user_data (id, data) VALUES ('watchlist', '{"id":"watchlist","ids":[],"updatedAt":"2026-10-02T09:00:00Z"}');
  EXCEPTION WHEN insufficient_privilege THEN v_blocked := TRUE; END;
  IF NOT v_blocked THEN RAISE EXCEPTION 'M7: writes with sync off must fail'; END IF;
  SELECT count(*) INTO v_n FROM public.market_user_data;
  IF v_n <> 0 THEN RAISE EXCEPTION 'M7: C must see nothing, sees %', v_n; END IF;
END $$;

ROLLBACK;
