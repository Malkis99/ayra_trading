-- AYRA Trading — Migration 0005: trade screenshots in the cloud (private Storage bucket + journal_attachments)
-- Requires 0001–0004. Safe to run more than once (idempotent). Apply in the Supabase SQL Editor.
-- Plan: docs/t7b-0005-attachments-plan.md (owner decisions 2026-10-26).
--
-- * Files live in the private bucket `journal-attachments` at `<user id>/<attachment id>.<webp|png|jpg>`.
-- * `journal_attachments` links a file to a trade. Same rules as the journal tables of 0004 (last-write-wins,
--   soft delete only, own rows only, writes only with the cloud flag). Its file path is set by the server.
-- * Limits live in `journal_limits` (one row, changed by the owner with UPDATE, no migration):
--   5 MB per file, 200 MB per account (files of deleted screenshots not counted), hard cap 400 MB for all files
--   of the account (files of deleted screenshots included, until the cleanup removes them).
-- * A file is never removed right away: its row must be deleted for 30 days (server time). A file without a row
--   (upload interrupted) may be removed after 24 hours. Only in the user's own folder. Files are never replaced.
-- * Nothing existing is changed: journal tables, profiles and the cloud flag stay as they are.

BEGIN;

--------------------------------------------------------------------------------
-- 1. Limits (one row)
--------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.journal_limits (
  id INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  attachment_file_bytes BIGINT NOT NULL CHECK (attachment_file_bytes > 0),
  attachment_quota_bytes BIGINT NOT NULL CHECK (attachment_quota_bytes >= 0),
  attachment_hard_cap_bytes BIGINT NOT NULL CHECK (attachment_hard_cap_bytes >= 0),
  attachment_delete_after_days INT NOT NULL CHECK (attachment_delete_after_days >= 0),
  orphan_min_age_hours INT NOT NULL CHECK (orphan_min_age_hours >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Re-running keeps values the owner may have changed
INSERT INTO public.journal_limits (id, attachment_file_bytes, attachment_quota_bytes, attachment_hard_cap_bytes,
  attachment_delete_after_days, orphan_min_age_hours)
VALUES (1, 5242880, 209715200, 419430400, 30, 24)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.journal_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.journal_limits FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.journal_limits TO authenticated;

DROP POLICY IF EXISTS journal_limits_select ON public.journal_limits;
CREATE POLICY journal_limits_select ON public.journal_limits FOR SELECT USING (auth.uid() IS NOT NULL);

DROP TRIGGER IF EXISTS tr_journal_limits_updated_at ON public.journal_limits;
CREATE TRIGGER tr_journal_limits_updated_at
  BEFORE UPDATE ON public.journal_limits
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

--------------------------------------------------------------------------------
-- 2. Screenshot rows
--------------------------------------------------------------------------------
-- data = the app's attachment metadata (id, tradeId, kind, width, height, bytes, mime, hash, caption, createdAt,
-- updatedAt, deletedAt). No image data in the row. trade_id, mime, bytes, file_path, deleted_at and
-- deleted_server_at are filled by the server.
CREATE TABLE IF NOT EXISTS public.journal_attachments (
  user_id UUID NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  id TEXT NOT NULL CHECK (id ~ '^[A-Za-z0-9_-]{1,64}$'),
  data JSONB NOT NULL,
  trade_id TEXT NOT NULL,
  mime TEXT NOT NULL CHECK (mime IN ('image/webp', 'image/png', 'image/jpeg')),
  bytes BIGINT NOT NULL CHECK (bytes > 0),
  file_path TEXT NOT NULL,
  client_updated_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  deleted_server_at TIMESTAMPTZ,
  device_id TEXT CHECK (device_id IS NULL OR char_length(device_id) <= 64),
  PRIMARY KEY (user_id, id)
);

CREATE INDEX IF NOT EXISTS journal_attachments_user_trade_idx ON public.journal_attachments (user_id, trade_id);
CREATE INDEX IF NOT EXISTS journal_attachments_user_path_idx ON public.journal_attachments (user_id, file_path);

-- Runs after the common journal trigger (tr_journal_attachments_before_write < tr_journal_attachments_files).
CREATE OR REPLACE FUNCTION public.journal_attachment_before_write()
RETURNS TRIGGER AS $$
DECLARE
  v_limits public.journal_limits%ROWTYPE;
  v_live BIGINT;
BEGIN
  SELECT * INTO v_limits FROM public.journal_limits WHERE id = 1;

  NEW.trade_id := NEW.data ->> 'tradeId';
  IF NEW.trade_id IS NULL OR NEW.trade_id = '' THEN
    RAISE EXCEPTION 'journal_attachment_missing_trade';
  END IF;

  NEW.mime := NEW.data ->> 'mime';
  IF NEW.mime IS NULL OR NEW.mime NOT IN ('image/webp', 'image/png', 'image/jpeg') THEN
    RAISE EXCEPTION 'journal_attachment_bad_type';
  END IF;

  NEW.bytes := (NEW.data ->> 'bytes')::bigint;
  IF NEW.bytes IS NULL OR NEW.bytes <= 0 OR NEW.bytes > v_limits.attachment_file_bytes THEN
    RAISE EXCEPTION 'journal_attachment_too_big';
  END IF;

  NEW.file_path := NEW.user_id::text || '/' || NEW.id || CASE NEW.mime
    WHEN 'image/webp' THEN '.webp' WHEN 'image/png' THEN '.png' ELSE '.jpg' END;

  -- 30 days are counted from the moment the server saw the deletion (the client clock cannot shorten them)
  IF NEW.deleted_at IS NULL THEN
    NEW.deleted_server_at := NULL;
  ELSIF TG_OP = 'INSERT' OR OLD.deleted_at IS NULL THEN
    NEW.deleted_server_at := now();
  ELSE
    NEW.deleted_server_at := OLD.deleted_server_at;
  END IF;

  -- 200 MB: live rows of this user, this one included (one at a time per user)
  IF NEW.deleted_at IS NULL THEN
    PERFORM pg_advisory_xact_lock(hashtext('journal_attachments:' || NEW.user_id::text));
    SELECT COALESCE(sum(bytes), 0) INTO v_live FROM public.journal_attachments
      WHERE user_id = NEW.user_id AND id <> NEW.id AND deleted_at IS NULL;
    IF v_live + NEW.bytes > v_limits.attachment_quota_bytes THEN
      RAISE EXCEPTION 'journal_attachment_quota_exceeded';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- Same rules as the journal tables of 0004: data check, common trigger, pull index, grants, RLS
ALTER TABLE public.journal_attachments DROP CONSTRAINT IF EXISTS journal_attachments_data_check;
ALTER TABLE public.journal_attachments ADD CONSTRAINT journal_attachments_data_check CHECK (
  jsonb_typeof(data) = 'object'
  AND octet_length(data::text) <= 16384
  AND NOT (data ?| ARRAY['xp', 'coins', 'xpAwarded', 'coinsAwarded', 'reward', 'rewards'])
);

DROP TRIGGER IF EXISTS tr_journal_attachments_before_write ON public.journal_attachments;
CREATE TRIGGER tr_journal_attachments_before_write BEFORE INSERT OR UPDATE ON public.journal_attachments
  FOR EACH ROW EXECUTE FUNCTION public.journal_row_before_write();

DROP TRIGGER IF EXISTS tr_journal_attachments_files ON public.journal_attachments;
CREATE TRIGGER tr_journal_attachments_files BEFORE INSERT OR UPDATE ON public.journal_attachments
  FOR EACH ROW EXECUTE FUNCTION public.journal_attachment_before_write();

CREATE INDEX IF NOT EXISTS journal_attachments_user_updated_idx ON public.journal_attachments (user_id, updated_at);

ALTER TABLE public.journal_attachments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.journal_attachments FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.journal_attachments TO authenticated;
GRANT INSERT (user_id, id, data, device_id) ON public.journal_attachments TO authenticated;
GRANT UPDATE (user_id, id, data, device_id) ON public.journal_attachments TO authenticated;

DROP POLICY IF EXISTS journal_attachments_select_own ON public.journal_attachments;
CREATE POLICY journal_attachments_select_own ON public.journal_attachments
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS journal_attachments_insert_own ON public.journal_attachments;
CREATE POLICY journal_attachments_insert_own ON public.journal_attachments
  FOR INSERT WITH CHECK (auth.uid() = user_id AND public.cloud_sync_enabled());

DROP POLICY IF EXISTS journal_attachments_update_own ON public.journal_attachments;
CREATE POLICY journal_attachments_update_own ON public.journal_attachments
  FOR UPDATE USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id AND public.cloud_sync_enabled());

--------------------------------------------------------------------------------
-- 3. Private bucket: images only, 5 MB per file (checked by the Storage server before the file is accepted)
--------------------------------------------------------------------------------
-- Re-running keeps privacy and types; the size limit is kept if the owner changed it in the dashboard.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('journal-attachments', 'journal-attachments', FALSE, 5242880, ARRAY['image/webp', 'image/png', 'image/jpeg'])
ON CONFLICT (id) DO UPDATE SET public = FALSE, allowed_mime_types = EXCLUDED.allowed_mime_types;

--------------------------------------------------------------------------------
-- 4. Helpers for the Storage rules. SECURITY DEFINER: a rule on storage.objects cannot read storage.objects
--    itself (recursion), so the sums are read here, always for auth.uid() only.
--------------------------------------------------------------------------------
-- Room for a new file of p_new_bytes in the caller's folder:
--   used (all files except those of deleted screenshots) + new <= 200 MB, and all files + new <= 400 MB.
CREATE OR REPLACE FUNCTION public.journal_attachment_space_ok(p_new_bytes BIGINT)
RETURNS BOOLEAN AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_limits public.journal_limits%ROWTYPE;
  v_all BIGINT;
  v_used BIGINT;
BEGIN
  IF v_uid IS NULL THEN RETURN FALSE; END IF;
  SELECT * INTO v_limits FROM public.journal_limits WHERE id = 1;
  SELECT
    COALESCE(sum(COALESCE((o.metadata ->> 'size')::bigint, 0)), 0),
    COALESCE(sum(COALESCE((o.metadata ->> 'size')::bigint, 0)) FILTER (WHERE NOT EXISTS (
      SELECT 1 FROM public.journal_attachments a
      WHERE a.user_id = v_uid AND a.file_path = o.name AND a.deleted_at IS NOT NULL)), 0)
  INTO v_all, v_used
  FROM storage.objects o
  WHERE o.bucket_id = 'journal-attachments' AND o.name LIKE v_uid::text || '/%';
  RETURN v_used + COALESCE(p_new_bytes, 0) <= v_limits.attachment_quota_bytes
     AND v_all + COALESCE(p_new_bytes, 0) <= v_limits.attachment_hard_cap_bytes;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, storage;

-- May the caller remove the file p_name created at p_created_at?
--   its screenshot row was deleted at least 30 days ago (server time), or it has no row and is older than 24 hours.
CREATE OR REPLACE FUNCTION public.journal_attachment_delete_ok(p_name TEXT, p_created_at TIMESTAMPTZ)
RETURNS BOOLEAN AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_limits public.journal_limits%ROWTYPE;
  v_row public.journal_attachments%ROWTYPE;
BEGIN
  IF v_uid IS NULL OR p_name NOT LIKE v_uid::text || '/%' THEN RETURN FALSE; END IF;
  SELECT * INTO v_limits FROM public.journal_limits WHERE id = 1;
  SELECT * INTO v_row FROM public.journal_attachments WHERE user_id = v_uid AND file_path = p_name;
  IF FOUND THEN
    RETURN v_row.deleted_server_at IS NOT NULL
       AND v_row.deleted_server_at <= now() - make_interval(days => v_limits.attachment_delete_after_days);
  END IF;
  RETURN p_created_at IS NOT NULL AND p_created_at <= now() - make_interval(hours => v_limits.orphan_min_age_hours);
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION public.journal_attachment_space_ok(BIGINT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.journal_attachment_delete_ok(TEXT, TIMESTAMPTZ) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.journal_attachment_space_ok(BIGINT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.journal_attachment_delete_ok(TEXT, TIMESTAMPTZ) TO authenticated;

--------------------------------------------------------------------------------
-- 5. Storage rules for this bucket. No UPDATE rule: a file is never replaced (a new version is a new file).
--------------------------------------------------------------------------------
DROP POLICY IF EXISTS journal_attachments_files_select ON storage.objects;
CREATE POLICY journal_attachments_files_select ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'journal-attachments' AND (storage.foldername(name))[1] = auth.uid()::text);

-- While the Storage server checks permission before the upload, size and type may not be known yet (NULL):
-- then the bucket's own limits (5 MB, three image types) stop the file, and the full check runs when it is saved.
DROP POLICY IF EXISTS journal_attachments_files_insert ON storage.objects;
CREATE POLICY journal_attachments_files_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'journal-attachments'
    AND (storage.foldername(name))[1] = auth.uid()::text
    AND name ~ ('^' || auth.uid()::text || '/[A-Za-z0-9_-]{1,64}\.(webp|png|jpg)$')
    AND public.cloud_sync_enabled()
    AND COALESCE(metadata ->> 'mimetype', 'image/webp') IN ('image/webp', 'image/png', 'image/jpeg')
    AND COALESCE((metadata ->> 'size')::bigint, 0)
      <= (SELECT attachment_file_bytes FROM public.journal_limits WHERE id = 1)
    AND public.journal_attachment_space_ok(COALESCE((metadata ->> 'size')::bigint, 0))
  );

DROP POLICY IF EXISTS journal_attachments_files_delete ON storage.objects;
CREATE POLICY journal_attachments_files_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'journal-attachments'
    AND (storage.foldername(name))[1] = auth.uid()::text
    AND public.journal_attachment_delete_ok(name, created_at)
  );

COMMIT;
