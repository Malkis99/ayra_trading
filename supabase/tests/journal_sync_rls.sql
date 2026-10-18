-- AYRA Trading — test for migration 0004 (run on a TEST project; everything is rolled back at the end).
-- Every check raises an exception when it fails, so a clean run means all passed.
BEGIN;

-- Users: A and B have cloud sync on, C has it off (no flag row at all)
INSERT INTO auth.users (id, email) VALUES
  ('00000000-0000-0000-0000-0000000000a1', 'sync-a@example.com'),
  ('00000000-0000-0000-0000-0000000000b1', 'sync-b@example.com'),
  ('00000000-0000-0000-0000-0000000000c2', 'sync-c@example.com')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.user_features (user_id, cloud_sync) VALUES
  ('00000000-0000-0000-0000-0000000000a1', TRUE),
  ('00000000-0000-0000-0000-0000000000b1', TRUE)
ON CONFLICT (user_id) DO UPDATE SET cloud_sync = EXCLUDED.cloud_sync;

-- B already has a trade in the cloud
INSERT INTO public.journal_trades (user_id, id, data) VALUES ('00000000-0000-0000-0000-0000000000b1', 'tr_b1',
  '{"id":"tr_b1","accountId":"acc_b","instrument":"EURUSD","direction":"long","result":"win","openedAt":"2026-10-01T10:00:00Z","updatedAt":"2026-10-01T10:00:00Z","schemaVersion":6}');

SET LOCAL ROLE authenticated;

DO $$
DECLARE
  c_a CONSTANT TEXT := '00000000-0000-0000-0000-0000000000a1';
  c_c CONSTANT TEXT := '00000000-0000-0000-0000-0000000000c2';
  v_trade JSONB := '{"id":"tr_a1","accountId":"acc_a","instrument":"XAUUSD","direction":"short","result":"loss",
    "openedAt":"2026-10-02T09:30:00Z","updatedAt":"2026-10-02T12:00:00Z","schemaVersion":6,"notes":"first"}';
  v_row public.journal_trades%ROWTYPE;
  v_n INT;
  v_blocked BOOLEAN;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', c_a, true);

  -- 1. A inserts own trade (user_id defaults to auth.uid()); derived columns come from data
  INSERT INTO public.journal_trades (id, data, device_id) VALUES ('tr_a1', v_trade, 'dev_1');
  SELECT * INTO v_row FROM public.journal_trades WHERE id = 'tr_a1';
  IF v_row.user_id::text <> c_a OR v_row.account_id <> 'acc_a' OR v_row.instrument <> 'XAUUSD'
     OR v_row.direction <> 'short' OR v_row.result <> 'loss' OR v_row.opened_at <> '2026-10-02T09:30:00Z'::timestamptz
     OR v_row.client_updated_at <> '2026-10-02T12:00:00Z'::timestamptz OR v_row.deleted_at IS NOT NULL
     OR (v_row.data ->> 'schemaVersion') <> '6' THEN
    RAISE EXCEPTION 'T1: derived columns wrong: %', row_to_json(v_row);
  END IF;

  -- 2. A sees only own rows
  SELECT count(*) INTO v_n FROM public.journal_trades;
  IF v_n <> 1 THEN RAISE EXCEPTION 'T2: A must see only own trades, sees %', v_n; END IF;

  -- 3. A cannot insert a row for B
  v_blocked := FALSE;
  BEGIN
    INSERT INTO public.journal_trades (user_id, id, data) VALUES ('00000000-0000-0000-0000-0000000000b1', 'tr_x',
      '{"id":"tr_x","accountId":"acc_b","instrument":"EURUSD","direction":"long","result":"win","openedAt":"2026-10-01T10:00:00Z","updatedAt":"2026-10-01T10:00:00Z"}');
  EXCEPTION WHEN insufficient_privilege THEN v_blocked := TRUE;
  END;
  IF NOT v_blocked THEN RAISE EXCEPTION 'T3: insert for another user must fail'; END IF;

  -- 4. A cannot change B's rows (0 rows affected)
  UPDATE public.journal_trades SET device_id = 'hacked' WHERE id = 'tr_b1';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 0 THEN RAISE EXCEPTION 'T4: update of another user''s row must affect 0 rows'; END IF;

  -- 5. A cannot move own row to B
  v_blocked := FALSE;
  BEGIN
    UPDATE public.journal_trades SET user_id = '00000000-0000-0000-0000-0000000000b1' WHERE id = 'tr_a1';
  EXCEPTION WHEN insufficient_privilege OR raise_exception THEN v_blocked := TRUE;
  END;
  IF NOT v_blocked THEN RAISE EXCEPTION 'T5: moving a row to another user must fail'; END IF;

  -- 6. No hard DELETE for clients
  v_blocked := FALSE;
  BEGIN
    DELETE FROM public.journal_trades WHERE id = 'tr_a1';
  EXCEPTION WHEN insufficient_privilege THEN v_blocked := TRUE;
  END;
  IF NOT v_blocked THEN RAISE EXCEPTION 'T6: DELETE must be forbidden'; END IF;

  -- 7. Server columns are not writable by the client
  v_blocked := FALSE;
  BEGIN
    UPDATE public.journal_trades SET updated_at = now() - INTERVAL '1 year' WHERE id = 'tr_a1';
  EXCEPTION WHEN insufficient_privilege THEN v_blocked := TRUE;
  END;
  IF NOT v_blocked THEN RAISE EXCEPTION 'T7: updated_at must not be writable'; END IF;
  v_blocked := FALSE;
  BEGIN
    UPDATE public.journal_trades SET result = 'win' WHERE id = 'tr_a1';
  EXCEPTION WHEN insufficient_privilege THEN v_blocked := TRUE;
  END;
  IF NOT v_blocked THEN RAISE EXCEPTION 'T7: derived column must not be writable'; END IF;

  -- 8. XP / coins cannot be smuggled in the record
  v_blocked := FALSE;
  BEGIN
    UPDATE public.journal_trades SET data = data || '{"xp":1000,"updatedAt":"2026-10-02T13:00:00Z"}' WHERE id = 'tr_a1';
  EXCEPTION WHEN check_violation THEN v_blocked := TRUE;
  END;
  IF NOT v_blocked THEN RAISE EXCEPTION 'T8: reward keys in data must be rejected'; END IF;

  -- 9. Newer version wins; an older one is skipped (last-write-wins); updated_at moves forward
  UPDATE public.journal_trades SET data = data || '{"notes":"newer","updatedAt":"2026-10-03T08:00:00Z"}' WHERE id = 'tr_a1';
  UPDATE public.journal_trades SET data = data || '{"notes":"older","updatedAt":"2026-10-02T13:00:00Z"}' WHERE id = 'tr_a1';
  SELECT * INTO v_row FROM public.journal_trades WHERE id = 'tr_a1';
  IF v_row.data ->> 'notes' <> 'newer' OR v_row.client_updated_at <> '2026-10-03T08:00:00Z'::timestamptz THEN
    RAISE EXCEPTION 'T9: older version must not overwrite newer one (notes=%)', v_row.data ->> 'notes';
  END IF;

  -- 10. Upsert (what the app sends) works and respects last-write-wins
  INSERT INTO public.journal_trades (id, data) VALUES ('tr_a1', v_trade || '{"notes":"upsert","updatedAt":"2026-10-04T08:00:00Z"}')
  ON CONFLICT (user_id, id) DO UPDATE SET data = EXCLUDED.data;
  IF (SELECT data ->> 'notes' FROM public.journal_trades WHERE id = 'tr_a1') <> 'upsert' THEN
    RAISE EXCEPTION 'T10: upsert must update the row';
  END IF;

  -- 11. Soft delete: data.deletedAt becomes deleted_at, the row stays
  UPDATE public.journal_trades SET data = data || '{"deletedAt":"2026-10-05T08:00:00Z","updatedAt":"2026-10-05T08:00:00Z"}' WHERE id = 'tr_a1';
  IF (SELECT deleted_at FROM public.journal_trades WHERE id = 'tr_a1') <> '2026-10-05T08:00:00Z'::timestamptz THEN
    RAISE EXCEPTION 'T11: soft delete must set deleted_at';
  END IF;

  -- 12. id in the row must match id in the record; timestamps from the future are rejected
  v_blocked := FALSE;
  BEGIN
    INSERT INTO public.journal_trades (id, data) VALUES ('tr_other', v_trade);
  EXCEPTION WHEN raise_exception THEN v_blocked := (SQLERRM = 'journal_row_id_mismatch');
  END;
  IF NOT v_blocked THEN RAISE EXCEPTION 'T12: id mismatch must fail'; END IF;
  v_blocked := FALSE;
  BEGIN
    INSERT INTO public.journal_notes (id, data) VALUES ('note_f',
      jsonb_build_object('id', 'note_f', 'body', 'x', 'updatedAt', now() + INTERVAL '1 day'));
  EXCEPTION WHEN raise_exception THEN v_blocked := (SQLERRM = 'journal_row_from_future');
  END;
  IF NOT v_blocked THEN RAISE EXCEPTION 'T12: future updatedAt must fail'; END IF;

  -- 13. Plans are keyed by date; other tables accept their records
  INSERT INTO public.journal_day_plans (id, data) VALUES ('2026-10-02', '{"date":"2026-10-02","bias":[],"updatedAt":"2026-10-02T07:00:00Z"}');
  INSERT INTO public.journal_week_plans (id, data) VALUES ('2026-09-28', '{"weekStartDate":"2026-09-28","goals":[],"updatedAt":"2026-10-02T07:00:00Z"}');
  INSERT INTO public.journal_no_trades (id, data) VALUES ('nt_1', '{"id":"nt_1","date":"2026-10-02T15:00:00Z","reason":"no_setup","createdAt":"2026-10-02T15:00:00Z"}');
  INSERT INTO public.journal_accounts (id, data) VALUES ('acc_a', '{"id":"acc_a","type":"personal","updatedAt":"2026-10-01T07:00:00Z"}');
  INSERT INTO public.journal_strategies (id, data) VALUES ('str_a', '{"id":"str_a","rules":[],"updatedAt":"2026-10-01T07:00:00Z"}');
  INSERT INTO public.journal_import_batches (id, data) VALUES ('imp_a', '{"id":"imp_a","accountId":"acc_a","createdAt":"2026-10-01T07:00:00Z","undoneAt":"2026-10-01T08:00:00Z"}');
  INSERT INTO public.journal_settings (id, data) VALUES ('journal', '{"id":"journal","primaryPropAccountId":null,"updatedAt":"2026-10-01T07:00:00Z"}');
  IF (SELECT date_key FROM public.journal_no_trades WHERE id = 'nt_1') <> '2026-10-02' THEN
    RAISE EXCEPTION 'T13: no-trade date_key must be the day';
  END IF;
  IF (SELECT deleted_at FROM public.journal_import_batches WHERE id = 'imp_a') IS NULL THEN
    RAISE EXCEPTION 'T13: undone import batch must be a tombstone';
  END IF;

  -- 14. A cannot turn the flag on/off or read other users' flags
  v_blocked := FALSE;
  BEGIN
    UPDATE public.user_features SET cloud_sync = FALSE WHERE user_id = c_a::uuid;
  EXCEPTION WHEN insufficient_privilege THEN v_blocked := TRUE;
  END;
  IF NOT v_blocked THEN RAISE EXCEPTION 'T14: client must not change the flag'; END IF;
  SELECT count(*) INTO v_n FROM public.user_features;
  IF v_n <> 1 THEN RAISE EXCEPTION 'T14: A must see only own flag, sees %', v_n; END IF;

  -- 15. C (sync off) cannot write to the cloud
  PERFORM set_config('request.jwt.claim.sub', c_c, true);
  IF public.cloud_sync_enabled() THEN RAISE EXCEPTION 'T15: sync must be off for C'; END IF;
  v_blocked := FALSE;
  BEGIN
    INSERT INTO public.journal_notes (id, data) VALUES ('note_c', '{"id":"note_c","body":"x","updatedAt":"2026-10-01T07:00:00Z"}');
  EXCEPTION WHEN insufficient_privilege THEN v_blocked := TRUE;
  END;
  IF NOT v_blocked THEN RAISE EXCEPTION 'T15: writes must fail while the flag is off'; END IF;
  SELECT count(*) INTO v_n FROM public.journal_trades;
  IF v_n <> 0 THEN RAISE EXCEPTION 'T15: C must see no rows'; END IF;
END $$;

-- 16. Anonymous visitors have no access at all
RESET ROLE;
SET LOCAL ROLE anon;
DO $$
DECLARE
  v_blocked BOOLEAN := FALSE;
BEGIN
  BEGIN
    PERFORM 1 FROM public.journal_trades;
  EXCEPTION WHEN insufficient_privilege THEN v_blocked := TRUE;
  END;
  IF NOT v_blocked THEN RAISE EXCEPTION 'T16: anon must not read journal tables'; END IF;
  v_blocked := FALSE;
  BEGIN
    PERFORM 1 FROM public.user_features;
  EXCEPTION WHEN insufficient_privilege THEN v_blocked := TRUE;
  END;
  IF NOT v_blocked THEN RAISE EXCEPTION 'T16: anon must not read flags'; END IF;
END $$;
RESET ROLE;

ROLLBACK;
