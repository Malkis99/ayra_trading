-- AYRA Trading — is migration 0005 applied? (read-only)
-- Expected after applying:
--   attachments_table = true, rls_enabled = true, client_delete_grants = 0, files_trigger = true,
--   bucket_private = true, bucket_size_limit = 5242880, bucket_mime_types = {image/jpeg,image/png,image/webp},
--   storage_policies = 3, storage_update_policies = 0,
--   file_bytes = 5242880, quota_bytes = 209715200, hard_cap_bytes = 419430400,
--   delete_after_days = 30, orphan_min_age_hours = 24, helpers_bypass_rls = true.
-- (limits are read only when the table exists, so the same query works after the rollback)
-- After the rollback: attachments_table = false, bucket_private = null, storage_policies = 0.
SELECT
  EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'journal_attachments') AS attachments_table,
  COALESCE((SELECT c.relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'journal_attachments'), FALSE) AS rls_enabled,
  (SELECT count(*) FROM information_schema.role_table_grants
    WHERE table_schema = 'public' AND table_name IN ('journal_attachments', 'journal_limits')
      AND grantee IN ('anon', 'authenticated') AND privilege_type IN ('DELETE', 'TRUNCATE'))::int AS client_delete_grants,
  EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'tr_journal_attachments_files') AS files_trigger,
  (SELECT NOT public FROM storage.buckets WHERE id = 'journal-attachments') AS bucket_private,
  (SELECT file_size_limit FROM storage.buckets WHERE id = 'journal-attachments') AS bucket_size_limit,
  (SELECT array_to_string(ARRAY(SELECT unnest(allowed_mime_types) ORDER BY 1), ',')
    FROM storage.buckets WHERE id = 'journal-attachments') AS bucket_mime_types,
  (SELECT count(*) FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects'
    AND policyname LIKE 'journal\_attachments\_files\_%')::int AS storage_policies,
  (SELECT count(*) FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects'
    AND policyname LIKE 'journal\_attachments\_files\_%' AND cmd IN ('UPDATE', 'ALL'))::int AS storage_update_policies,
  (SELECT (xpath('/row/v/text()', query_to_xml('SELECT attachment_file_bytes AS v FROM public.journal_limits WHERE id = 1', false, true, '')))[1]::text
    WHERE to_regclass('public.journal_limits') IS NOT NULL) AS file_bytes,
  (SELECT (xpath('/row/v/text()', query_to_xml('SELECT attachment_quota_bytes AS v FROM public.journal_limits WHERE id = 1', false, true, '')))[1]::text
    WHERE to_regclass('public.journal_limits') IS NOT NULL) AS quota_bytes,
  (SELECT (xpath('/row/v/text()', query_to_xml('SELECT attachment_hard_cap_bytes AS v FROM public.journal_limits WHERE id = 1', false, true, '')))[1]::text
    WHERE to_regclass('public.journal_limits') IS NOT NULL) AS hard_cap_bytes,
  (SELECT (xpath('/row/v/text()', query_to_xml('SELECT attachment_delete_after_days AS v FROM public.journal_limits WHERE id = 1', false, true, '')))[1]::text
    WHERE to_regclass('public.journal_limits') IS NOT NULL) AS delete_after_days,
  (SELECT (xpath('/row/v/text()', query_to_xml('SELECT orphan_min_age_hours AS v FROM public.journal_limits WHERE id = 1', false, true, '')))[1]::text
    WHERE to_regclass('public.journal_limits') IS NOT NULL) AS orphan_min_age_hours,
  -- the helpers must see every file of the user, or the 200/400 MB checks would count nothing
  (SELECT bool_and(r.rolsuper OR r.rolbypassrls) FROM pg_proc p JOIN pg_roles r ON r.oid = p.proowner
    WHERE p.proname IN ('journal_attachment_space_ok', 'journal_attachment_delete_ok')) AS helpers_bypass_rls;
