-- AYRA Trading — 0023: deleting one's own account, files included (Q4.7-Б1, docs/q4-7-b1-account-deletion-storage.md).
-- Requires 0001–0005 (journal, Storage bucket of 0005).
--
-- Why a procedure and not one transaction: the files of the private bucket `journal-attachments` live in Storage, not in
-- PostgreSQL. Deleting a storage.objects row by SQL leaves the file itself behind, so files are removed only through the
-- Storage API (the server route, with the service key) — outside any database transaction. The account's rows go when
-- its auth user is deleted (every table references auth.users ON DELETE CASCADE). The steps in between keep a state:
--   1. account_deletion_begin     — the request (the person confirmed in the app; the route checked it was them). From now
--                                   on cloud_sync_enabled() is FALSE for the account: no journal write, no upload.
--   2. account_deletion_manifest  — the server's list of the account's files (its own folder AND uploaded by it), kept here
--                                   before anything is deleted; files no longer in Storage are marked gone (checked here,
--                                   never taken from the caller). Anything in the folder uploaded by someone else stops
--                                   the procedure for the owner to look at (never deleted, never skipped).
--   3. (the route removes the listed files through the Storage API, then asks for the manifest again — until none is left)
--   4. account_deletion_ready     — no file of the account left in Storage: the anonymous counts are written once; the route
--                                   then deletes the auth user (the cascade removes every row, this request included).
-- Each step can be repeated after any failure; nothing is told to the person as done before step 4 succeeded.
--
-- Two guarantees (Q4.7-Б1 review):
--   * no write of the account from the request on: a trigger on EVERY table of a person's data (each public table with
--     user_id, profiles.id, storage.objects) refuses an INSERT or UPDATE of an account being deleted — whatever the path
--     (the API under RLS, SECURITY DEFINER functions, the economy's service-role routes);
--   * no file can appear after the list: an upload holds the account's lock (shared) from its row's check until its
--     commit; the request and the final check take it exclusively — the request waits for an upload already in flight
--     (whose file is then listed) and every upload after it sees the request and is refused. Rows of the other tables
--     cannot outlive the account anyway (their foreign key to auth.users).
-- Only the service key calls these (the route); no API role reads or writes the tables. Nothing of another account is read
-- or changed. Idempotent: safe to run twice.

BEGIN;

--------------------------------------------------------------------------------
-- 1. The request and its file list (both go with the account), and anonymous counts (no account, no name, no file)
--------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.account_deletions (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  state TEXT NOT NULL DEFAULT 'requested' CHECK (state IN ('requested', 'files_listed', 'files_deleted')),
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  attempts INT NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  -- a code only (never a message, a path or a name)
  last_error TEXT CHECK (last_error IS NULL OR last_error ~ '^[a-z_]{1,60}$'),
  counted_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS public.account_deletion_objects (
  user_id UUID NOT NULL REFERENCES public.account_deletions(user_id) ON DELETE CASCADE,
  bucket_id TEXT NOT NULL,
  name TEXT NOT NULL,
  listed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  gone_at TIMESTAMPTZ,
  PRIMARY KEY (user_id, bucket_id, name)
);
CREATE TABLE IF NOT EXISTS public.account_deletion_stats (
  day DATE NOT NULL,
  metric TEXT NOT NULL CHECK (metric IN ('accounts_deleted', 'files_deleted', 'requests', 'retries')),
  n BIGINT NOT NULL CHECK (n >= 0),
  PRIMARY KEY (day, metric)
);
ALTER TABLE public.account_deletions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.account_deletion_objects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.account_deletion_stats ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.account_deletions, public.account_deletion_objects, public.account_deletion_stats FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.account_deletion_count(p_metric TEXT, p_n BIGINT)
RETURNS VOID AS $$
  INSERT INTO public.account_deletion_stats (day, metric, n) VALUES (current_date, p_metric, p_n)
  ON CONFLICT (day, metric) DO UPDATE SET n = public.account_deletion_stats.n + EXCLUDED.n
$$ LANGUAGE sql SECURITY DEFINER SET search_path = public;

--------------------------------------------------------------------------------
-- 2. No journal write and no upload while the account is being deleted (the one gate both already use)
--------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cloud_sync_enabled()
RETURNS BOOLEAN AS $$
  SELECT COALESCE((SELECT cloud_sync FROM public.user_features WHERE user_id = auth.uid()), FALSE)
     AND NOT EXISTS (SELECT 1 FROM public.account_deletions WHERE user_id = auth.uid());
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

-- The account's deletion lock: uploads hold it shared until they commit; the request and the final check exclusively
CREATE OR REPLACE FUNCTION public.account_deletion_lock_key(p_user UUID)
RETURNS BIGINT AS $$ SELECT hashtextextended('account_deletion:' || p_user::text, 0) $$ LANGUAGE sql IMMUTABLE;

CREATE OR REPLACE FUNCTION public.account_deleting(p_user UUID)
RETURNS BOOLEAN AS $$ SELECT p_user IS NOT NULL AND EXISTS (SELECT 1 FROM public.account_deletions WHERE user_id = p_user) $$
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

-- Every table of a person's data: no INSERT or UPDATE once the deletion is requested (TG_ARGV[0] = the column of the account)
CREATE OR REPLACE FUNCTION public.account_deletion_guard()
RETURNS TRIGGER AS $$
DECLARE
  v_uid UUID;
BEGIN
  BEGIN
    v_uid := (to_jsonb(NEW) ->> TG_ARGV[0])::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    v_uid := NULL;
  END;
  IF public.account_deleting(v_uid) THEN
    RAISE EXCEPTION 'account_deletion_in_progress' USING ERRCODE = '42501', DETAIL = TG_TABLE_NAME;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- A file: its folder's account and its uploader (either may be the one being deleted). The shared lock is taken first and
-- held until this upload commits; the check after it reads what is committed now (a new statement)
CREATE OR REPLACE FUNCTION public.account_deletion_storage_guard()
RETURNS TRIGGER AS $$
DECLARE
  v_folder TEXT := (storage.foldername(NEW.name))[1];
  v_uid UUID;
BEGIN
  IF NOT (NEW.bucket_id = ANY (public.account_deletion_buckets())) THEN
    RETURN NEW;
  END IF;
  FOR v_uid IN SELECT DISTINCT u::uuid FROM unnest(ARRAY[v_folder, NEW.owner_id]) u
               WHERE u ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' ORDER BY 1 LOOP
    PERFORM pg_advisory_xact_lock_shared(public.account_deletion_lock_key(v_uid));
    IF public.account_deleting(v_uid) THEN
      RAISE EXCEPTION 'account_deletion_in_progress' USING ERRCODE = '42501', DETAIL = 'storage.objects';
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, storage;

DO $$
DECLARE
  t RECORD;
BEGIN
  FOR t IN SELECT c.table_name, c.column_name FROM information_schema.columns c
           JOIN information_schema.tables tb ON tb.table_schema = c.table_schema AND tb.table_name = c.table_name AND tb.table_type = 'BASE TABLE'
           WHERE c.table_schema = 'public' AND c.table_name NOT IN ('account_deletions', 'account_deletion_objects')
             AND (c.column_name = 'user_id' OR (c.table_name = 'profiles' AND c.column_name = 'id')) LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS tr_%s_account_deletion ON public.%I', t.table_name, t.table_name);
    EXECUTE format('CREATE TRIGGER tr_%s_account_deletion BEFORE INSERT OR UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.account_deletion_guard(%L)',
      t.table_name, t.table_name, t.column_name);
  END LOOP;
END $$;
DROP TRIGGER IF EXISTS tr_objects_account_deletion ON storage.objects;
CREATE TRIGGER tr_objects_account_deletion BEFORE INSERT OR UPDATE ON storage.objects
  FOR EACH ROW EXECUTE FUNCTION public.account_deletion_storage_guard();

--------------------------------------------------------------------------------
-- 3. The steps (the server route only)
--------------------------------------------------------------------------------
-- The buckets an account can have files in (0005). A new bucket is added here before it is used.
CREATE OR REPLACE FUNCTION public.account_deletion_buckets()
RETURNS TEXT[] AS $$ SELECT ARRAY['journal-attachments'] $$ LANGUAGE sql IMMUTABLE;

CREATE OR REPLACE FUNCTION public.account_deletion_status(p_user UUID)
RETURNS JSONB AS $$
  SELECT CASE WHEN d.user_id IS NULL THEN jsonb_build_object('state', NULL)
    ELSE jsonb_build_object('state', d.state, 'requestedAt', d.requested_at, 'attempts', d.attempts, 'lastError', d.last_error,
      'listed', (SELECT count(*) FROM public.account_deletion_objects o WHERE o.user_id = p_user),
      'gone', (SELECT count(*) FROM public.account_deletion_objects o WHERE o.user_id = p_user AND o.gone_at IS NOT NULL)) END
  FROM (SELECT 1) one LEFT JOIN public.account_deletions d ON d.user_id = p_user
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

-- 1. The request (a repeat returns the request as it is; a retry is counted)
CREATE OR REPLACE FUNCTION public.account_deletion_begin(p_user UUID)
RETURNS JSONB AS $$
DECLARE
  v_rows INT;
  v_new BOOLEAN;
BEGIN
  IF p_user IS NULL OR NOT EXISTS (SELECT 1 FROM auth.users WHERE id = p_user) THEN
    RAISE EXCEPTION 'account_deletion_no_user' USING ERRCODE = '22023';
  END IF;
  -- an upload already past its check holds the account's lock until it commits: wait for it (its file is then listed)
  PERFORM pg_advisory_xact_lock(public.account_deletion_lock_key(p_user));
  INSERT INTO public.account_deletions (user_id) VALUES (p_user) ON CONFLICT (user_id) DO NOTHING;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  v_new := v_rows > 0;
  IF v_new THEN
    PERFORM public.account_deletion_count('requests', 1);
  ELSE
    UPDATE public.account_deletions SET attempts = attempts + 1, updated_at = now() WHERE user_id = p_user;
    PERFORM public.account_deletion_count('retries', 1);
  END IF;
  RETURN public.account_deletion_status(p_user) || jsonb_build_object('new', v_new);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- 2. The server's list of the account's files; files already gone from Storage are marked so (checked here)
CREATE OR REPLACE FUNCTION public.account_deletion_manifest(p_user UUID)
RETURNS JSONB AS $$
DECLARE
  c_page CONSTANT INT := 1000;   -- at most this many names per answer (the route removes them, then asks again)
  v_foreign BIGINT;
  v_pending JSONB;
BEGIN
  -- one manifest at a time per account (two requests at once wait for each other)
  PERFORM 1 FROM public.account_deletions WHERE user_id = p_user FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'account_deletion_not_requested' USING ERRCODE = '22023';
  END IF;
  -- the account's folder holds only what the account uploaded (0005's insert rule); anything else there is not the
  -- account's to delete and not ours to skip: stop for the owner
  SELECT count(*) INTO v_foreign FROM storage.objects o
  WHERE o.bucket_id = ANY (public.account_deletion_buckets())
    AND (((storage.foldername(o.name))[1] = p_user::text AND o.owner_id IS DISTINCT FROM p_user::text)
      OR (o.owner_id = p_user::text AND (storage.foldername(o.name))[1] IS DISTINCT FROM p_user::text));
  IF v_foreign > 0 THEN
    RAISE EXCEPTION 'account_deletion_foreign_object' USING ERRCODE = '22023',
      DETAIL = format('%s object(s) in the account''s folder were not uploaded by it (or the other way round): the owner reviews them', v_foreign);
  END IF;
  -- owned = in the account's own folder AND uploaded by the account (owner_id, set by the Storage server)
  INSERT INTO public.account_deletion_objects (user_id, bucket_id, name)
  SELECT p_user, o.bucket_id, o.name FROM storage.objects o
  WHERE o.bucket_id = ANY (public.account_deletion_buckets())
    AND (storage.foldername(o.name))[1] = p_user::text AND o.owner_id = p_user::text
  ON CONFLICT (user_id, bucket_id, name) DO NOTHING;
  -- gone = no longer in Storage (never what a caller says)
  UPDATE public.account_deletion_objects d SET gone_at = now()
  WHERE d.user_id = p_user AND d.gone_at IS NULL
    AND NOT EXISTS (SELECT 1 FROM storage.objects o WHERE o.bucket_id = d.bucket_id AND o.name = d.name);
  SELECT COALESCE(jsonb_agg(jsonb_build_object('bucket', p.bucket_id, 'name', p.name) ORDER BY p.bucket_id, p.name), '[]'::jsonb) INTO v_pending
  FROM (SELECT bucket_id, name FROM public.account_deletion_objects WHERE user_id = p_user AND gone_at IS NULL
        ORDER BY bucket_id, name LIMIT c_page) p;
  UPDATE public.account_deletions SET state = 'files_listed', last_error = NULL, updated_at = now()
  WHERE user_id = p_user AND state = 'requested';
  RETURN public.account_deletion_status(p_user) || jsonb_build_object('pending', v_pending,
    'pendingCount', (SELECT count(*) FROM public.account_deletion_objects WHERE user_id = p_user AND gone_at IS NULL));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, storage;

-- A step that failed (a code only: the person is told to repeat; nothing is told as done)
CREATE OR REPLACE FUNCTION public.account_deletion_failed(p_user UUID, p_code TEXT)
RETURNS VOID AS $$
  UPDATE public.account_deletions SET last_error = CASE WHEN p_code ~ '^[a-z_]{1,60}$' THEN p_code ELSE 'unknown' END, updated_at = now()
  WHERE user_id = p_user
$$ LANGUAGE sql SECURITY DEFINER SET search_path = public;

-- 4. Ready for the auth user's deletion: no file of the account left; the anonymous counts written once
CREATE OR REPLACE FUNCTION public.account_deletion_ready(p_user UUID)
RETURNS JSONB AS $$
DECLARE
  v_d public.account_deletions%ROWTYPE;
  v_left BIGINT;
BEGIN
  SELECT * INTO v_d FROM public.account_deletions WHERE user_id = p_user FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'account_deletion_not_requested' USING ERRCODE = '22023';
  END IF;
  -- no upload can be in flight (they are refused since the request); the lock makes the check wait for one that is
  PERFORM pg_advisory_xact_lock(public.account_deletion_lock_key(p_user));
  -- every file of the account (its folder or uploaded by it), listed or not: none may be left
  SELECT count(*) INTO v_left FROM storage.objects o
  WHERE o.bucket_id = ANY (public.account_deletion_buckets())
    AND ((storage.foldername(o.name))[1] = p_user::text OR o.owner_id = p_user::text);
  IF v_left > 0 OR EXISTS (SELECT 1 FROM public.account_deletion_objects WHERE user_id = p_user AND gone_at IS NULL) THEN
    RAISE EXCEPTION 'account_deletion_files_left' USING ERRCODE = '22023', DETAIL = format('%s file(s) still in Storage', v_left);
  END IF;
  IF v_d.counted_at IS NULL THEN
    PERFORM public.account_deletion_count('accounts_deleted', 1);
    PERFORM public.account_deletion_count('files_deleted', (SELECT count(*) FROM public.account_deletion_objects WHERE user_id = p_user));
  END IF;
  UPDATE public.account_deletions SET state = 'files_deleted', counted_at = COALESCE(counted_at, now()), last_error = NULL, updated_at = now()
  WHERE user_id = p_user;
  RETURN public.account_deletion_status(p_user);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, storage;

--------------------------------------------------------------------------------
-- 4. Who may call: the server route (service role) only
--------------------------------------------------------------------------------
DO $$
DECLARE f TEXT;
BEGIN
  FOREACH f IN ARRAY ARRAY['account_deletion_count(TEXT, BIGINT)', 'account_deletion_buckets()', 'account_deletion_status(UUID)',
    'account_deletion_lock_key(UUID)', 'account_deleting(UUID)', 'account_deletion_guard()', 'account_deletion_storage_guard()',
    'account_deletion_begin(UUID)', 'account_deletion_manifest(UUID)', 'account_deletion_failed(UUID, TEXT)', 'account_deletion_ready(UUID)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated, service_role', f);
  END LOOP;
END $$;
GRANT EXECUTE ON FUNCTION public.account_deletion_status(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.account_deletion_begin(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.account_deletion_manifest(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.account_deletion_failed(UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.account_deletion_ready(UUID) TO service_role;

COMMIT;
