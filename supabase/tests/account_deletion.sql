-- AYRA Trading — tests for 0023 (Q4.7-Б1: deleting one's own account, files included) on top of 0001–0005 and 0014–0022.
-- Run on a TEST database with the storage stand-in (supabase/tests/stub/storage_stub.sql); everything is rolled back.
-- Synthetic users and files only. «The Storage API removes a file» is simulated by deleting its storage.objects row (what
-- the Storage server does after removing the file itself).
--   A — cloud journal, 3 screenshots with rows, 1 file without a row, 300 more files; migration_pending with an open review.
--   B — 1200 files (more than one page), cloud_active (activated through the real path).
--   C — its id is A's with another last character; an object whose folder starts like A's; nothing of C is ever touched.
--   F — a file in its folder that it did not upload: the procedure stops for the owner.
BEGIN;

INSERT INTO auth.users (id, email) VALUES
  ('00000000-0000-0000-0000-00000023d00a', 'del-a@example.com'),
  ('00000000-0000-0000-0000-00000023d00b', 'del-b@example.com'),
  ('00000000-0000-0000-0000-00000023d00c', 'del-c@example.com'),
  ('00000000-0000-0000-0000-00000023d00f', 'del-f@example.com')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.user_features (user_id, cloud_sync) VALUES
  ('00000000-0000-0000-0000-00000023d00a', TRUE), ('00000000-0000-0000-0000-00000023d00b', TRUE), ('00000000-0000-0000-0000-00000023d00c', TRUE)
ON CONFLICT (user_id) DO UPDATE SET cloud_sync = TRUE;

CREATE OR REPLACE FUNCTION pg_temp.err(p_sql TEXT) RETURNS TEXT AS $$
BEGIN
  EXECUTE p_sql;
  RETURN 'ok';
EXCEPTION WHEN OTHERS THEN
  RETURN SQLERRM;
END $$ LANGUAGE plpgsql;
GRANT EXECUTE ON FUNCTION pg_temp.err(TEXT) TO PUBLIC;
-- a file as the Storage server keeps it (owner_id = the uploader)
CREATE OR REPLACE FUNCTION pg_temp.file(p_owner UUID, p_name TEXT) RETURNS VOID AS $$
  INSERT INTO storage.objects (bucket_id, name, owner_id, metadata) VALUES ('journal-attachments', p_name, p_owner::text, '{"size": 100, "mimetype": "image/webp"}')
$$ LANGUAGE sql;
CREATE OR REPLACE FUNCTION pg_temp.files_of(p_user UUID) RETURNS BIGINT AS $$
  SELECT count(*) FROM storage.objects WHERE bucket_id = 'journal-attachments' AND (storage.foldername(name))[1] = p_user::text $$ LANGUAGE sql;
-- the route's loop: the manifest, the Storage API removes the listed files (except p_keep), the manifest again
CREATE OR REPLACE FUNCTION pg_temp.remove_listed(p_user UUID, p_keep INT DEFAULT 0) RETURNS INT AS $$
DECLARE
  m JSONB;
  n INT := 0;
BEGIN
  LOOP
    SET LOCAL ROLE service_role;
    m := public.account_deletion_manifest(p_user);
    RESET ROLE;
    EXIT WHEN (m ->> 'pendingCount')::int <= p_keep;
    DELETE FROM storage.objects o USING jsonb_array_elements(m -> 'pending') x
    WHERE o.bucket_id = x ->> 'bucket' AND o.name = x ->> 'name'
      AND (SELECT count(*) FROM jsonb_array_elements(m -> 'pending') y WHERE (y ->> 'name') COLLATE "C" <= (x ->> 'name') COLLATE "C")
          <= (m ->> 'pendingCount')::int - p_keep;
    n := n + 1;
    EXIT WHEN n > 10;
  END LOOP;
  RETURN n;
END $$ LANGUAGE plpgsql;
-- every row of an account left anywhere in public (any table with a user_id column, or profiles.id)
CREATE OR REPLACE FUNCTION pg_temp.rows_left(p_user UUID) RETURNS JSONB AS $$
DECLARE
  t RECORD;
  n BIGINT;
  out JSONB := '{}';
BEGIN
  FOR t IN SELECT c.table_name, c.column_name FROM information_schema.columns c JOIN information_schema.tables tb
             ON tb.table_schema = c.table_schema AND tb.table_name = c.table_name AND tb.table_type = 'BASE TABLE'
           WHERE c.table_schema = 'public' AND (c.column_name = 'user_id' OR (c.table_name = 'profiles' AND c.column_name = 'id')) LOOP
    EXECUTE format('SELECT count(*) FROM public.%I WHERE %I::text = $1', t.table_name, t.column_name) INTO n USING p_user::text;
    IF n > 0 THEN out := out || jsonb_build_object(t.table_name, n); END IF;
  END LOOP;
  RETURN out;
END $$ LANGUAGE plpgsql;

--------------------------------------------------------------------------------
-- Setup: files, journal rows, economy state
--------------------------------------------------------------------------------
DO $$
DECLARE
  c_a CONSTANT UUID := '00000000-0000-0000-0000-00000023d00a';
  c_b CONSTANT UUID := '00000000-0000-0000-0000-00000023d00b';
  c_c CONSTANT UUID := '00000000-0000-0000-0000-00000023d00c';
  c_f CONSTANT UUID := '00000000-0000-0000-0000-00000023d00f';
  i INT;
BEGIN
  FOR i IN 1..3 LOOP
    PERFORM pg_temp.file(c_a, c_a || '/shot' || i || '.webp');
    INSERT INTO public.journal_attachments (user_id, id, data, trade_id, mime, bytes, client_updated_at)
    VALUES (c_a, 'shot' || i, jsonb_build_object('id', 'shot' || i, 'tradeId', 't1', 'mime', 'image/webp', 'bytes', 100,
      'createdAt', '2026-11-01T09:00:00Z', 'updatedAt', '2026-11-01T09:00:00Z'), 't1', 'image/webp', 100, now());
  END LOOP;
  PERFORM pg_temp.file(c_a, c_a || '/orphan.webp');                    -- an upload whose row never arrived
  FOR i IN 1..300 LOOP PERFORM pg_temp.file(c_a, c_a || '/bulk' || i || '.webp'); END LOOP;
  FOR i IN 1..1200 LOOP PERFORM pg_temp.file(c_b, c_b || '/b' || i || '.webp'); END LOOP;
  PERFORM pg_temp.file(c_c, c_c || '/mine.webp');
  PERFORM pg_temp.file(c_c, c_a || '0/lookalike.webp');                 -- a folder that starts like A's (not A's)
  PERFORM pg_temp.file(c_f, c_f || '/own.webp');
  PERFORM pg_temp.file(c_c, c_f || '/planted.webp');                    -- in F's folder, uploaded by someone else
  INSERT INTO public.journal_notes (user_id, id, data, client_updated_at) VALUES
    (c_a, 'n1', '{"id":"n1","body":"a private note","createdAt":"2026-11-01T08:00:00Z"}', now()),
    (c_c, 'n1', '{"id":"n1","body":"C keeps this","createdAt":"2026-11-01T08:00:00Z"}', now());
  -- A in the transfer window with a snapshot whose remainder waits for a person
  PERFORM public.game_economy_transition(c_a, 'local', 'migration_pending');
  PERFORM public.game_import_snapshot(c_a, '00000000-0000-0000-0000-0000000005e5', floor(extract(epoch FROM now()))::bigint, 'migration_pending',
    '10000000-0000-0000-0000-00000023d0a1', '20000000-0000-0000-0000-00000023d0a1', 1, '{"level":3,"xp":10,"coins":99,"achievements":{"author":true}}');
  SET LOCAL ROLE game_migration_admin;
  PERFORM public.game_mig_save_reconciliation(c_a, public.game_mig_reconcile(c_a), 'owner');
  RESET ROLE;
  IF NOT EXISTS (SELECT 1 FROM public.game_legacy_reviews WHERE user_id = c_a AND status = 'pending_review') THEN
    RAISE EXCEPTION 'S0: setup — A has an open review';
  END IF;
  -- B activated (cloud_active, a ledger, achievements)
  PERFORM public.game_economy_transition(c_b, 'local', 'migration_pending');
  PERFORM public.game_import_snapshot(c_b, '00000000-0000-0000-0000-0000000005e5', floor(extract(epoch FROM now()))::bigint, 'migration_pending',
    '10000000-0000-0000-0000-00000023d0b1', '20000000-0000-0000-0000-00000023d0b1', 1,
    '{"level":1,"xp":40,"coins":10,"history":[{"questId":"q_bias","xp":40,"coins":10,"completedAt":"2026-11-01"}],"achievements":{"firstQuest":true,"author":true}}');
  SET LOCAL ROLE game_migration_admin;
  PERFORM public.game_mig_save_reconciliation(c_b, public.game_mig_reconcile(c_b), 'owner');
  PERFORM public.game_mig_decide_legacy(c_b, r.snapshot_id, 'rejected', NULL, NULL, 'owner', 'nothing beyond the records')
  FROM public.game_legacy_reviews r WHERE r.user_id = c_b AND r.status = 'pending_review';
  RESET ROLE;
  SET LOCAL ROLE game_economy_owner;
  INSERT INTO public.game_migration_windows (user_id, closes_at, changed_by, reason) VALUES (c_b, now(), 'test clock', 'simulated: 7 days passed')
  ON CONFLICT (user_id) DO UPDATE SET closes_at = now();
  RESET ROLE;
  SET LOCAL ROLE game_migration_admin;
  PERFORM public.game_mig_activate(c_b, (SELECT id FROM public.game_reconciliations WHERE user_id = c_b AND status = 'draft'), 'owner', 'test');
  RESET ROLE;
  IF (SELECT state FROM public.game_accounts WHERE user_id = c_b) <> 'cloud_active' OR NOT EXISTS (SELECT 1 FROM public.game_achievements WHERE user_id = c_b) THEN
    RAISE EXCEPTION 'S0b: setup — B activated with achievements';
  END IF;
END $$;

--------------------------------------------------------------------------------
-- D1. Who may: the server route (service role) only; the tables are nobody's to read
--------------------------------------------------------------------------------
DO $$
DECLARE r TEXT;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF has_function_privilege(r, 'public.account_deletion_begin(uuid)', 'EXECUTE') OR has_function_privilege(r, 'public.account_deletion_manifest(uuid)', 'EXECUTE')
       OR has_function_privilege(r, 'public.account_deletion_ready(uuid)', 'EXECUTE') OR has_function_privilege(r, 'public.account_deletion_status(uuid)', 'EXECUTE')
       OR has_table_privilege(r, 'public.account_deletions', 'SELECT') OR has_table_privilege(r, 'public.account_deletion_objects', 'SELECT')
       OR has_table_privilege(r, 'public.account_deletion_stats', 'SELECT') THEN
      RAISE EXCEPTION 'D1: % reaches the deletion', r;
    END IF;
  END LOOP;
  IF NOT has_function_privilege('service_role', 'public.account_deletion_begin(uuid)', 'EXECUTE')
     OR has_function_privilege('service_role', 'public.account_deletion_count(text,bigint)', 'EXECUTE')
     OR has_table_privilege('service_role', 'public.account_deletions', 'SELECT') THEN
    RAISE EXCEPTION 'D1b: the route calls the steps; nobody writes the counts or reads the tables directly';
  END IF;
END $$;
SET LOCAL ROLE authenticated;
DO $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000023d00c', true);
  IF pg_temp.err($q$SELECT public.account_deletion_begin('00000000-0000-0000-0000-00000023d00a')$q$) NOT LIKE '%permission denied%' THEN
    RAISE EXCEPTION 'D1c: a signed-in person never starts another one''s deletion (nor their own: only the route does)';
  END IF;
END $$;
RESET ROLE;

--------------------------------------------------------------------------------
-- D2. Before the request: A writes and uploads; after it: nothing (the account is closed to writes)
--------------------------------------------------------------------------------
DO $$
DECLARE
  c_a CONSTANT UUID := '00000000-0000-0000-0000-00000023d00a';
  v JSONB;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', c_a::text, true);
  SET LOCAL ROLE authenticated;
  INSERT INTO storage.objects (bucket_id, name, owner_id, metadata) VALUES ('journal-attachments', c_a || '/before.webp', c_a::text, '{"size": 100, "mimetype": "image/webp"}');
  INSERT INTO public.journal_notes (user_id, id, data) VALUES (c_a, 'n2', '{"id":"n2","body":"x","createdAt":"2026-11-02T08:00:00Z"}');
  RESET ROLE;
  SET LOCAL ROLE service_role;
  v := public.account_deletion_begin(c_a);
  IF NOT (v ->> 'new')::boolean OR v ->> 'state' <> 'requested' THEN RAISE EXCEPTION 'D2: the request: %', v; END IF;
  v := public.account_deletion_begin(c_a);
  IF (v ->> 'new')::boolean OR (v ->> 'attempts')::int <> 1 THEN RAISE EXCEPTION 'D2b: a repeat is the same request: %', v; END IF;
  RESET ROLE;
  SET LOCAL ROLE authenticated;
  IF pg_temp.err(format($q$INSERT INTO storage.objects (bucket_id, name, owner_id, metadata) VALUES ('journal-attachments', '%s/after.webp', '%s', '{"size": 100, "mimetype": "image/webp"}')$q$, c_a, c_a)) NOT LIKE '%row-level security%'
     OR pg_temp.err(format($q$INSERT INTO public.journal_notes (user_id, id, data) VALUES ('%s', 'n3', '{"id":"n3","body":"x","createdAt":"2026-11-02T08:00:00Z"}')$q$, c_a)) NOT LIKE '%row-level security%' THEN
    RAISE EXCEPTION 'D2c: no upload and no journal write once the deletion is requested';
  END IF;
  -- another account is not closed by A's request
  PERFORM set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000023d00c', true);
  INSERT INTO public.journal_notes (user_id, id, data) VALUES ('00000000-0000-0000-0000-00000023d00c', 'n2', '{"id":"n2","body":"still mine","createdAt":"2026-11-02T08:00:00Z"}');
  RESET ROLE;
END $$;

--------------------------------------------------------------------------------
-- D3. The manifest: exactly A's files (its folder AND uploaded by it); a failed removal; a repeat; files left → not ready
--------------------------------------------------------------------------------
DO $$
DECLARE
  c_a CONSTANT UUID := '00000000-0000-0000-0000-00000023d00a';
  c_c CONSTANT UUID := '00000000-0000-0000-0000-00000023d00c';
  m JSONB;
  e TEXT;
BEGIN
  SET LOCAL ROLE service_role;
  m := public.account_deletion_manifest(c_a);
  RESET ROLE;
  -- 3 screenshots + the orphan + 300 + the one uploaded before the request; never C's look-alike folder
  IF (m ->> 'pendingCount')::int <> 305 OR m ->> 'state' <> 'files_listed'
     OR EXISTS (SELECT 1 FROM jsonb_array_elements(m -> 'pending') x WHERE x ->> 'name' NOT LIKE c_a || '/%')
     OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements(m -> 'pending') x WHERE x ->> 'name' = c_a || '/orphan.webp') THEN
    RAISE EXCEPTION 'D3: the manifest: % files', m ->> 'pendingCount';
  END IF;
  -- the Storage API fails for 5 files (removed: all others); the manifest checks Storage itself and keeps those 5
  PERFORM pg_temp.remove_listed(c_a, 5);
  SET LOCAL ROLE service_role;
  m := public.account_deletion_manifest(c_a);
  e := pg_temp.err(format('SELECT public.account_deletion_ready(%L)', c_a));
  RESET ROLE;
  IF (m ->> 'pendingCount')::int <> 5 OR (m ->> 'gone')::int <> 300 OR e NOT LIKE '%account_deletion_files_left%' THEN
    RAISE EXCEPTION 'D3b: a partial removal is never ready: % / %', m ->> 'pendingCount', e;
  END IF;
  -- the caller cannot mark a file gone: only Storage's own rows count (a manifest call changes nothing while they exist)
  SET LOCAL ROLE service_role;
  m := public.account_deletion_manifest(c_a);
  RESET ROLE;
  IF (m ->> 'pendingCount')::int <> 5 THEN RAISE EXCEPTION 'D3c: a file is gone only when Storage no longer has it'; END IF;
  -- the retry removes the rest; ready; ready again counts nothing twice
  PERFORM pg_temp.remove_listed(c_a);
  SET LOCAL ROLE service_role;
  m := public.account_deletion_ready(c_a);
  m := public.account_deletion_ready(c_a);
  RESET ROLE;
  IF m ->> 'state' <> 'files_deleted' OR pg_temp.files_of(c_a) <> 0 THEN RAISE EXCEPTION 'D3d: ready: %', m; END IF;
  -- C keeps its files, its look-alike folder and its note
  IF pg_temp.files_of(c_c) <> 1 OR NOT EXISTS (SELECT 1 FROM storage.objects WHERE name = c_a || '0/lookalike.webp')
     OR (SELECT count(*) FROM public.journal_notes WHERE user_id = c_c) <> 2 THEN
    RAISE EXCEPTION 'D3e: nothing of another account is touched';
  END IF;
END $$;

--------------------------------------------------------------------------------
-- D4. More files than one answer holds (B: 1200 → 1000 + 200), cloud_active
--------------------------------------------------------------------------------
DO $$
DECLARE
  c_b CONSTANT UUID := '00000000-0000-0000-0000-00000023d00b';
  m JSONB;
  v_rounds INT;
BEGIN
  SET LOCAL ROLE service_role;
  PERFORM public.account_deletion_begin(c_b);
  m := public.account_deletion_manifest(c_b);
  RESET ROLE;
  IF jsonb_array_length(m -> 'pending') <> 1000 OR (m ->> 'pendingCount')::int <> 1200 THEN RAISE EXCEPTION 'D4: one page: %', m ->> 'pendingCount'; END IF;
  v_rounds := pg_temp.remove_listed(c_b);
  SET LOCAL ROLE service_role;
  m := public.account_deletion_ready(c_b);
  RESET ROLE;
  IF v_rounds <> 2 OR pg_temp.files_of(c_b) <> 0 THEN RAISE EXCEPTION 'D4b: two rounds, nothing left: %', v_rounds; END IF;
END $$;

--------------------------------------------------------------------------------
-- D5. A file in the folder that the account did not upload: the procedure stops (never deleted, never skipped)
--------------------------------------------------------------------------------
DO $$
DECLARE
  c_f CONSTANT UUID := '00000000-0000-0000-0000-00000023d00f';
  e TEXT;
BEGIN
  SET LOCAL ROLE service_role;
  PERFORM public.account_deletion_begin(c_f);
  e := pg_temp.err(format('SELECT public.account_deletion_manifest(%L)', c_f));
  RESET ROLE;
  IF e NOT LIKE '%account_deletion_foreign_object%' OR pg_temp.files_of(c_f) <> 2
     OR EXISTS (SELECT 1 FROM public.account_deletion_objects WHERE user_id = c_f) THEN
    RAISE EXCEPTION 'D5: a foreign object stops it: %', e;
  END IF;
  SET LOCAL ROLE service_role;
  e := pg_temp.err(format('SELECT public.account_deletion_ready(%L)', c_f));
  RESET ROLE;
  IF e NOT LIKE '%account_deletion_files_left%' THEN RAISE EXCEPTION 'D5b: never ready with files left: %', e; END IF;
  -- not requested: nothing to list
  SET LOCAL ROLE service_role;
  e := pg_temp.err($q$SELECT public.account_deletion_manifest('00000000-0000-0000-0000-00000023d00c')$q$);
  RESET ROLE;
  IF e NOT LIKE '%account_deletion_not_requested%' THEN RAISE EXCEPTION 'D5c: no request, no manifest: %', e; END IF;
END $$;

--------------------------------------------------------------------------------
-- D6. The auth user deleted (the route's last step): no row of A or B anywhere; only anonymous counts
--------------------------------------------------------------------------------
DO $$
DECLARE
  c_a CONSTANT UUID := '00000000-0000-0000-0000-00000023d00a';
  c_b CONSTANT UUID := '00000000-0000-0000-0000-00000023d00b';
  c_c CONSTANT UUID := '00000000-0000-0000-0000-00000023d00c';
BEGIN
  DELETE FROM auth.users WHERE id IN (c_a, c_b);
  IF pg_temp.rows_left(c_a) <> '{}'::jsonb OR pg_temp.rows_left(c_b) <> '{}'::jsonb THEN
    RAISE EXCEPTION 'D6: rows left: A % B %', pg_temp.rows_left(c_a), pg_temp.rows_left(c_b);
  END IF;
  IF pg_temp.rows_left(c_c) = '{}'::jsonb THEN RAISE EXCEPTION 'D6b: C keeps everything'; END IF;
  -- the counts: day, metric, number — nothing else (A: 305 files, B: 1200; 3 requests, 1 retry; 2 accounts)
  IF (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'account_deletion_stats') <> 3
     OR (SELECT jsonb_object_agg(metric, n) FROM public.account_deletion_stats)
        <> '{"accounts_deleted": 2, "files_deleted": 1505, "requests": 3, "retries": 1}'::jsonb THEN
    RAISE EXCEPTION 'D6c: anonymous counts: %', (SELECT jsonb_object_agg(metric, n) FROM public.account_deletion_stats);
  END IF;
  IF EXISTS (SELECT 1 FROM public.account_deletions WHERE user_id IN (c_a, c_b)) THEN RAISE EXCEPTION 'D6d: the requests go with the accounts'; END IF;
END $$;

ROLLBACK;
