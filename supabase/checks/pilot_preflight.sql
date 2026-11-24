-- Q4.7 hosted pilot, step P0 (docs/q4-7-hosted-pilot-plan.md). READ ONLY — run before any migration on the PILOT project.
-- One row of JSON: what this hosted project allows the migration role, and that it holds nothing of AYRA yet.
SELECT jsonb_build_object(
  'server_version', current_setting('server_version'),
  'current_user', current_user,
  'is_superuser', (SELECT rolsuper FROM pg_roles WHERE rolname = current_user),
  -- 0005 / 0023 need these on storage.objects
  'storage_objects_owner', (SELECT pg_get_userbyid(relowner) FROM pg_class WHERE oid = to_regclass('storage.objects')),
  'storage_objects_trigger_privilege', CASE WHEN to_regclass('storage.objects') IS NULL THEN NULL
    ELSE has_table_privilege(current_user, 'storage.objects', 'TRIGGER') END,
  'storage_objects_select_privilege', CASE WHEN to_regclass('storage.objects') IS NULL THEN NULL
    ELSE has_table_privilege(current_user, 'storage.objects', 'SELECT') END,
  'storage_objects_owner_id', EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'storage' AND table_name = 'objects' AND column_name = 'owner_id'),
  'storage_objects_owner_id_type', (SELECT data_type FROM information_schema.columns
    WHERE table_schema = 'storage' AND table_name = 'objects' AND column_name = 'owner_id'),
  'storage_foldername', to_regprocedure('storage.foldername(text)') IS NOT NULL,
  'storage_buckets_insert_privilege', CASE WHEN to_regclass('storage.buckets') IS NULL THEN NULL
    ELSE has_table_privilege(current_user, 'storage.buckets', 'INSERT') END,
  'storage_objects_triggers', (SELECT coalesce(jsonb_agg(tgname ORDER BY tgname), '[]') FROM pg_trigger
    WHERE tgrelid = to_regclass('storage.objects') AND NOT tgisinternal),
  'storage_objects_policies', (SELECT coalesce(jsonb_agg(policyname ORDER BY policyname), '[]') FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'),
  -- 0001: auth.users must be referable (foreign keys); 0018 grants to the auth server's role (the hook is NOT turned on)
  'auth_users_references_privilege', CASE WHEN to_regclass('auth.users') IS NULL THEN NULL
    ELSE has_table_privilege(current_user, 'auth.users', 'REFERENCES') END,
  'roles', (SELECT jsonb_object_agg(r, EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r))
    FROM unnest(ARRAY['anon', 'authenticated', 'service_role', 'supabase_auth_admin', 'supabase_storage_admin']) r),
  'uuid_ossp_available', EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'uuid-ossp'),
  -- an empty project: no AYRA table, no user except the pilot's own test accounts
  'public_tables', (SELECT count(*) FROM pg_tables WHERE schemaname = 'public'),
  'pilot_marker', to_regclass('public.ayra_pilot_marker') IS NOT NULL,
  'auth_users', (SELECT count(*) FROM auth.users),
  'auth_users_not_pilot', (SELECT count(*) FROM auth.users WHERE email IS NULL OR email NOT LIKE 'ayra-pilot-%@example.com'),
  'storage_buckets', (SELECT coalesce(jsonb_agg(id ORDER BY id), '[]') FROM storage.buckets),
  'storage_objects', (SELECT count(*) FROM storage.objects),
  'audit_log_entries_table', to_regclass('auth.audit_log_entries') IS NOT NULL
) AS preflight;
