-- AYRA Trading — Rollback of 0005: removes the Storage rules, journal_attachments, journal_limits and the bucket.
-- Files are never deleted here. If the bucket already holds files, the rollback stops with an error and changes
-- nothing (everything is in one transaction). Journal tables, profiles and the cloud flag are not touched.
BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id = 'journal-attachments') THEN
    RAISE EXCEPTION 'journal-attachments bucket is not empty: rollback stopped, nothing changed. Files are removed only by a separate owner decision.';
  END IF;
END $$;

DROP POLICY IF EXISTS journal_attachments_files_select ON storage.objects;
DROP POLICY IF EXISTS journal_attachments_files_insert ON storage.objects;
DROP POLICY IF EXISTS journal_attachments_files_delete ON storage.objects;

DROP FUNCTION IF EXISTS public.journal_attachment_space_ok(BIGINT);
DROP FUNCTION IF EXISTS public.journal_attachment_delete_ok(TEXT, TIMESTAMPTZ);

DROP TABLE IF EXISTS public.journal_attachments;
DROP FUNCTION IF EXISTS public.journal_attachment_before_write();
DROP TABLE IF EXISTS public.journal_limits;

-- The bucket is empty here. Newer Supabase projects may forbid deleting Storage rows with SQL: then the rest of the
-- rollback still applies and the empty bucket is removed in the dashboard (Storage → journal-attachments → Delete).
DO $$
BEGIN
  DELETE FROM storage.buckets WHERE id = 'journal-attachments';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Empty bucket journal-attachments was not removed by SQL (%). Delete it in the dashboard: Storage → journal-attachments → Delete bucket.', SQLERRM;
END $$;

COMMIT;
