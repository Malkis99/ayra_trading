-- AYRA Trading — test for migration 0005 (PGlite with a minimal Storage stub, see scripts/test-migrations.mjs;
-- not for a live project: there files go through the Storage server, see the manual check in the PR).
-- Every check raises an exception when it fails, so a clean run means all passed. Everything is rolled back.
BEGIN;

-- Users: A and B have cloud sync on, C has it off
INSERT INTO auth.users (id, email) VALUES
  ('00000000-0000-0000-0000-0000000000a5', 'att-a@example.com'),
  ('00000000-0000-0000-0000-0000000000b5', 'att-b@example.com'),
  ('00000000-0000-0000-0000-0000000000c5', 'att-c@example.com')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.user_features (user_id, cloud_sync) VALUES
  ('00000000-0000-0000-0000-0000000000a5', TRUE),
  ('00000000-0000-0000-0000-0000000000b5', TRUE)
ON CONFLICT (user_id) DO UPDATE SET cloud_sync = EXCLUDED.cloud_sync;

-- Small limits to test with: 5 MB per file stays, 3000 bytes per account, hard cap 3500 bytes
UPDATE public.journal_limits SET attachment_quota_bytes = 3000, attachment_hard_cap_bytes = 3500 WHERE id = 1;

CREATE FUNCTION pg_temp.att(p_id TEXT, p_bytes BIGINT, p_mime TEXT DEFAULT 'image/webp',
  p_updated TEXT DEFAULT '2026-10-01T10:00:00Z', p_deleted TEXT DEFAULT NULL) RETURNS JSONB LANGUAGE sql AS $$
  SELECT jsonb_strip_nulls(jsonb_build_object('id', p_id, 'tradeId', 'tr_1', 'kind', 'before', 'width', 10,
    'height', 10, 'bytes', p_bytes, 'mime', p_mime, 'hash', 'h', 'createdAt', '2026-10-01T10:00:00Z',
    'updatedAt', p_updated, 'deletedAt', p_deleted)) $$;

-- Tries an upload; TRUE when the Storage rules let it in (the file is taken back right away)
CREATE FUNCTION pg_temp.upload_ok(p_name TEXT, p_size BIGINT, p_mime TEXT) RETURNS BOOLEAN LANGUAGE plpgsql AS $f$
BEGIN
  INSERT INTO storage.objects (bucket_id, name, metadata)
    VALUES ('journal-attachments', p_name, jsonb_build_object('size', p_size, 'mimetype', p_mime));
  RAISE EXCEPTION 'undo_upload';
EXCEPTION
  WHEN insufficient_privilege THEN RETURN FALSE;
  WHEN raise_exception THEN
    IF SQLERRM = 'undo_upload' THEN RETURN TRUE; END IF;
    RAISE;
END $f$;

-- Tries to remove a file; TRUE when it was removed
CREATE FUNCTION pg_temp.remove(p_name TEXT) RETURNS BOOLEAN LANGUAGE plpgsql AS $f$
DECLARE v_n INT;
BEGIN
  DELETE FROM storage.objects WHERE bucket_id = 'journal-attachments' AND name = p_name;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n = 1;
END $f$;

SET LOCAL ROLE authenticated;

--------------------------------------------------------------------------------
-- Rows: journal_attachments
--------------------------------------------------------------------------------
DO $$
DECLARE
  c_a CONSTANT TEXT := '00000000-0000-0000-0000-0000000000a5';
  v_row public.journal_attachments%ROWTYPE;
  v_n INT;
  v_err TEXT;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', c_a, true);

  -- R1. Own row; server fills trade_id, mime, bytes and the file path
  INSERT INTO public.journal_attachments (id, data) VALUES ('att_1', pg_temp.att('att_1', 1000));
  SELECT * INTO v_row FROM public.journal_attachments WHERE id = 'att_1';
  IF v_row.trade_id <> 'tr_1' OR v_row.mime <> 'image/webp' OR v_row.bytes <> 1000
     OR v_row.file_path <> c_a || '/att_1.webp' OR v_row.deleted_at IS NOT NULL OR v_row.deleted_server_at IS NOT NULL THEN
    RAISE EXCEPTION 'R1: server columns wrong: %', row_to_json(v_row);
  END IF;

  -- R2. Other type, too big, over the account limit: refused by the server
  v_err := NULL;
  BEGIN INSERT INTO public.journal_attachments (id, data) VALUES ('att_g', pg_temp.att('att_g', 100, 'image/gif'));
  EXCEPTION WHEN raise_exception THEN v_err := SQLERRM; END;
  IF v_err IS DISTINCT FROM 'journal_attachment_bad_type' THEN RAISE EXCEPTION 'R2: gif row must fail, got %', v_err; END IF;

  v_err := NULL;
  BEGIN INSERT INTO public.journal_attachments (id, data) VALUES ('att_big', pg_temp.att('att_big', 5242881));
  EXCEPTION WHEN raise_exception THEN v_err := SQLERRM; END;
  IF v_err IS DISTINCT FROM 'journal_attachment_too_big' THEN RAISE EXCEPTION 'R2: >5 MB row must fail, got %', v_err; END IF;

  v_err := NULL;
  BEGIN INSERT INTO public.journal_attachments (id, data) VALUES ('att_2', pg_temp.att('att_2', 2500));
  EXCEPTION WHEN raise_exception THEN v_err := SQLERRM; END;
  IF v_err IS DISTINCT FROM 'journal_attachment_quota_exceeded' THEN RAISE EXCEPTION 'R2: over the limit must fail, got %', v_err; END IF;

  -- R3. Within the limit is fine (1000 + 2000 = 3000)
  INSERT INTO public.journal_attachments (id, data) VALUES ('att_3', pg_temp.att('att_3', 2000));

  -- R4. Soft delete: server stamps its own time; the space is free at once
  UPDATE public.journal_attachments SET data = pg_temp.att('att_3', 2000, 'image/webp', '2026-10-02T10:00:00Z', '2026-10-02T10:00:00Z')
    WHERE id = 'att_3';
  SELECT * INTO v_row FROM public.journal_attachments WHERE id = 'att_3';
  IF v_row.deleted_at IS NULL OR v_row.deleted_server_at IS NULL THEN RAISE EXCEPTION 'R4: soft delete not stamped'; END IF;
  INSERT INTO public.journal_attachments (id, data) VALUES ('att_4', pg_temp.att('att_4', 1500));

  -- R5. Undo of a deletion that would exceed the limit is refused; the deletion itself stays
  v_err := NULL;
  BEGIN UPDATE public.journal_attachments SET data = pg_temp.att('att_3', 2000, 'image/webp', '2026-10-03T10:00:00Z') WHERE id = 'att_3';
  EXCEPTION WHEN raise_exception THEN v_err := SQLERRM; END;
  IF v_err IS DISTINCT FROM 'journal_attachment_quota_exceeded' THEN RAISE EXCEPTION 'R5: restore over the limit must fail, got %', v_err; END IF;

  -- R6. No hard DELETE of rows
  v_err := NULL;
  BEGIN DELETE FROM public.journal_attachments WHERE id = 'att_1';
  EXCEPTION WHEN insufficient_privilege THEN v_err := 'blocked'; END;
  IF v_err IS NULL THEN RAISE EXCEPTION 'R6: DELETE must be forbidden'; END IF;

  -- R7. Server columns are not writable
  v_err := NULL;
  BEGIN UPDATE public.journal_attachments SET file_path = '00000000-0000-0000-0000-0000000000b5/x.webp' WHERE id = 'att_1';
  EXCEPTION WHEN insufficient_privilege THEN v_err := 'blocked'; END;
  IF v_err IS NULL THEN RAISE EXCEPTION 'R7: file_path must not be writable'; END IF;

  -- R8. Last-write-wins: an older version is skipped
  UPDATE public.journal_attachments SET data = pg_temp.att('att_1', 1000, 'image/webp', '2026-09-01T10:00:00Z', '2026-09-01T10:00:00Z')
    WHERE id = 'att_1';
  SELECT * INTO v_row FROM public.journal_attachments WHERE id = 'att_1';
  IF v_row.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'R8: older version overwrote a newer one'; END IF;

  -- R9. Limits are readable, not writable
  SELECT count(*) INTO v_n FROM public.journal_limits;
  IF v_n <> 1 THEN RAISE EXCEPTION 'R9: limits must be readable'; END IF;
  v_err := NULL;
  BEGIN UPDATE public.journal_limits SET attachment_quota_bytes = 999999999;
  EXCEPTION WHEN insufficient_privilege THEN v_err := 'blocked'; END;
  IF v_err IS NULL THEN RAISE EXCEPTION 'R9: limits must not be writable by users'; END IF;

  -- R10. Without the cloud flag: no rows; other users' rows: not visible, not writable
  PERFORM set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000c5', true);
  v_err := NULL;
  BEGIN INSERT INTO public.journal_attachments (id, data) VALUES ('att_c', pg_temp.att('att_c', 100));
  EXCEPTION WHEN insufficient_privilege THEN v_err := 'blocked'; END;
  IF v_err IS NULL THEN RAISE EXCEPTION 'R10: insert without the flag must fail'; END IF;
  SELECT count(*) INTO v_n FROM public.journal_attachments;
  IF v_n <> 0 THEN RAISE EXCEPTION 'R10: C must not see A''s rows, sees %', v_n; END IF;
END $$;


--------------------------------------------------------------------------------
-- Files: storage.objects, uploads (with the size and type the Storage server records)
-- Rows now: att_1 live 1000, att_3 deleted 2000, att_4 live 1500. Limits: 3000 per account, hard cap 3500.
--------------------------------------------------------------------------------
DO $$
DECLARE
  c_a CONSTANT TEXT := '00000000-0000-0000-0000-0000000000a5';
  c_b CONSTANT TEXT := '00000000-0000-0000-0000-0000000000b5';
  v_n INT;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', c_a, true);

  -- S1. Own folder, image, within the limits: allowed. Used 1000, all 1000.
  INSERT INTO storage.objects (bucket_id, name, metadata) VALUES
    ('journal-attachments', c_a || '/att_1.webp', '{"size":1000,"mimetype":"image/webp"}');

  -- S2. Refused: another user's folder, gif, more than 5 MB, nested path, non-image name
  IF pg_temp.upload_ok(c_b || '/x.webp', 10, 'image/webp') THEN RAISE EXCEPTION 'S2: another user''s folder must fail'; END IF;
  IF pg_temp.upload_ok(c_a || '/g.webp', 10, 'image/gif') THEN RAISE EXCEPTION 'S2: gif must fail'; END IF;
  IF pg_temp.upload_ok(c_a || '/big.webp', 5242881, 'image/webp') THEN RAISE EXCEPTION 'S2: >5 MB must fail'; END IF;
  IF pg_temp.upload_ok(c_a || '/sub/x.webp', 10, 'image/webp') THEN RAISE EXCEPTION 'S2: nested path must fail'; END IF;
  IF pg_temp.upload_ok(c_a || '/x.svg', 10, 'image/webp') THEN RAISE EXCEPTION 'S2: non-image name must fail'; END IF;
  IF NOT pg_temp.upload_ok(c_a || '/ok.png', 10, 'image/png') THEN RAISE EXCEPTION 'S2: a small png must be allowed'; END IF;

  -- S3. Over the account limit: 1000 + 2100 = 3100 > 3000 (all 3100 is under the hard cap) → refused
  IF pg_temp.upload_ok(c_a || '/o_2100.webp', 2100, 'image/webp') THEN RAISE EXCEPTION 'S3: over the limit must fail'; END IF;

  -- S4. File of the deleted att_3 (2000): used 1000 + 2000 = 3000, all 3000 → allowed.
  --     From now on it no longer counts toward the limit (its row is deleted) but still counts toward the hard cap.
  INSERT INTO storage.objects (bucket_id, name, metadata) VALUES
    ('journal-attachments', c_a || '/att_3.webp', '{"size":2000,"mimetype":"image/webp"}');

  -- S5. Hard cap: used 1000 + 1500 = 2500 is fine, but all 3000 + 1500 = 4500 > 3500 → refused
  IF pg_temp.upload_ok(c_a || '/att_4.webp', 1500, 'image/webp') THEN RAISE EXCEPTION 'S5: over the hard cap must fail'; END IF;

  -- S6. A file without a row (upload interrupted) is allowed: used 1400, all 3400; then 1700 refused
  INSERT INTO storage.objects (bucket_id, name, metadata) VALUES
    ('journal-attachments', c_a || '/o_400.webp', '{"size":400,"mimetype":"image/webp"}');
  IF pg_temp.upload_ok(c_a || '/o_1700.webp', 1700, 'image/webp') THEN RAISE EXCEPTION 'S6: files without a row must count'; END IF;

  -- S7. Files are never replaced (no UPDATE rule)
  UPDATE storage.objects SET metadata = '{"size":1,"mimetype":"image/webp"}' WHERE name = c_a || '/att_1.webp';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 0 THEN RAISE EXCEPTION 'S7: files must not be replaced'; END IF;

  -- S8. B does not see A's files; C (no cloud flag) cannot upload at all
  PERFORM set_config('request.jwt.claim.sub', c_b, true);
  SELECT count(*) INTO v_n FROM storage.objects;
  IF v_n <> 0 THEN RAISE EXCEPTION 'S8: B must not see A''s files, sees %', v_n; END IF;
  PERFORM set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000c5', true);
  IF pg_temp.upload_ok('00000000-0000-0000-0000-0000000000c5/x.webp', 10, 'image/webp') THEN RAISE EXCEPTION 'S8: upload without the flag must fail'; END IF;
END $$;

--------------------------------------------------------------------------------
-- Files: removal. Setup as the database owner: back-dated files and deletions.
--------------------------------------------------------------------------------
RESET ROLE;

UPDATE public.journal_limits SET attachment_hard_cap_bytes = 100000 WHERE id = 1;
-- att_31: deleted 31 days ago; att_r: deleted 31 days ago, then restored («Отменить» / «Взять из облака» с правкой)
INSERT INTO public.journal_attachments (user_id, id, data) VALUES
  ('00000000-0000-0000-0000-0000000000a5', 'att_31', pg_temp.att('att_31', 100, 'image/webp', '2026-09-20T10:00:00Z', '2026-09-20T10:00:00Z')),
  ('00000000-0000-0000-0000-0000000000a5', 'att_r', pg_temp.att('att_r', 100, 'image/webp', '2026-09-20T10:00:00Z', '2026-09-20T10:00:00Z'));
ALTER TABLE public.journal_attachments DISABLE TRIGGER tr_journal_attachments_files;
UPDATE public.journal_attachments SET deleted_server_at = now() - INTERVAL '10 days' WHERE id = 'att_3';
UPDATE public.journal_attachments SET deleted_server_at = now() - INTERVAL '31 days' WHERE id IN ('att_31', 'att_r');
ALTER TABLE public.journal_attachments ENABLE TRIGGER tr_journal_attachments_files;
UPDATE public.journal_attachments SET data = pg_temp.att('att_r', 100, 'image/webp', '2026-09-21T10:00:00Z') WHERE id = 'att_r';

INSERT INTO storage.objects (bucket_id, name, metadata, created_at) VALUES
  ('journal-attachments', '00000000-0000-0000-0000-0000000000a5/att_31.webp', '{"size":100,"mimetype":"image/webp"}', now() - INTERVAL '31 days'),
  ('journal-attachments', '00000000-0000-0000-0000-0000000000a5/att_r.webp', '{"size":100,"mimetype":"image/webp"}', now() - INTERVAL '31 days'),
  ('journal-attachments', '00000000-0000-0000-0000-0000000000a5/o_old.webp', '{"size":100,"mimetype":"image/webp"}', now() - INTERVAL '25 hours'),
  ('journal-attachments', '00000000-0000-0000-0000-0000000000a5/o_new.webp', '{"size":100,"mimetype":"image/webp"}', now() - INTERVAL '1 hour'),
  ('journal-attachments', '00000000-0000-0000-0000-0000000000b5/o_b_old.webp', '{"size":100,"mimetype":"image/webp"}', now() - INTERVAL '25 hours');

SET LOCAL ROLE authenticated;

DO $$
DECLARE
  c_a CONSTANT TEXT := '00000000-0000-0000-0000-0000000000a5';
BEGIN
  PERFORM set_config('request.jwt.claim.sub', c_a, true);
  -- S9. Files without a row count toward the limit (hard cap is out of the way now). Used: att_1 1000, att_r 100,
  --     and 600 without a row (o_400, o_old, o_new) = 1700. +1250 = 2950 allowed; +1350 = 3050 refused
  --     (it would be allowed if files without a row were not counted: 2450).
  IF NOT pg_temp.upload_ok(c_a || '/o_1250.webp', 1250, 'image/webp') THEN RAISE EXCEPTION 'S9: 1250 must fit'; END IF;
  IF pg_temp.upload_ok(c_a || '/o_1350.webp', 1350, 'image/webp') THEN RAISE EXCEPTION 'S9: files without a row must count'; END IF;

  -- D1. Live screenshot: never
  IF pg_temp.remove(c_a || '/att_1.webp') THEN RAISE EXCEPTION 'D1: file of a live screenshot must stay'; END IF;
  -- D2. Deleted 10 days ago: not yet
  IF pg_temp.remove(c_a || '/att_3.webp') THEN RAISE EXCEPTION 'D2: file deleted 10 days ago must stay'; END IF;
  -- D3. Deleted 31 days ago: allowed
  IF NOT pg_temp.remove(c_a || '/att_31.webp') THEN RAISE EXCEPTION 'D3: file deleted 31 days ago must be removable'; END IF;
  -- D4. Deleted and restored: stays, even though the deletion was 31 days ago
  IF pg_temp.remove(c_a || '/att_r.webp') THEN RAISE EXCEPTION 'D4: file of a restored screenshot must stay'; END IF;
  -- D5. No row, uploaded 1 hour ago: stays (its row may still arrive); 25 hours ago: allowed
  IF pg_temp.remove(c_a || '/o_new.webp') THEN RAISE EXCEPTION 'D5: fresh file without a row must stay'; END IF;
  IF NOT pg_temp.remove(c_a || '/o_old.webp') THEN RAISE EXCEPTION 'D5: old file without a row must be removable'; END IF;
  -- D6. Another user's folder: never
  IF pg_temp.remove('00000000-0000-0000-0000-0000000000b5/o_b_old.webp') THEN RAISE EXCEPTION 'D6: another user''s file must stay'; END IF;
END $$;

RESET ROLE;
DO $$
BEGIN
  IF (SELECT count(*) FROM storage.objects WHERE name ~ '/(att_1|att_3|att_r|o_new|o_b_old)\.webp$') <> 5 THEN
    RAISE EXCEPTION 'D7: kept files are missing';
  END IF;
  IF EXISTS (SELECT 1 FROM storage.objects WHERE name ~ '/(att_31|o_old)\.webp$') THEN
    RAISE EXCEPTION 'D7: removed files are still there';
  END IF;
END $$;

ROLLBACK;
