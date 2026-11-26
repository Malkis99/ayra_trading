-- Q4.7 hosted pilot, step P1 (docs/q4-7-hosted-pilot-plan.md). READ ONLY — after 0001–0023 were applied to the PILOT.
-- One row of JSON; every «*_ok» must be true, every «*_missing» list empty.
WITH user_tables AS (
  SELECT c.relname
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind = 'r'
    AND c.relname NOT IN ('account_deletions', 'account_deletion_objects', 'account_deletion_challenges')
    AND (EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attname = 'user_id' AND NOT a.attisdropped)
         OR c.relname = 'profiles')
), guarded AS (
  SELECT c.relname FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND t.tgname = 'tr_' || c.relname || '_account_deletion' AND t.tgenabled = 'O'
), fns AS (
  SELECT p.proname, p.prosecdef, pg_get_userbyid(p.proowner) AS owner, p.oid
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname LIKE 'account_delet%'
)
SELECT jsonb_build_object(
  'storage_trigger_ok', EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'storage.objects'::regclass
    AND tgname = 'tr_objects_account_deletion' AND tgenabled = 'O'),
  'user_tables', (SELECT count(*) FROM user_tables),
  'guard_missing', (SELECT coalesce(jsonb_agg(relname ORDER BY relname), '[]') FROM user_tables WHERE relname NOT IN (SELECT relname FROM guarded)),
  -- the guards read the deletion tables and storage.objects as their owner, whoever writes (the Storage server's role too)
  'guards_security_definer_ok', (SELECT bool_and(prosecdef) FROM fns
    WHERE proname IN ('account_deletion_guard', 'account_deletion_storage_guard', 'account_deleting')),
  'function_owners', (SELECT jsonb_object_agg(proname, owner) FROM fns),
  'owner_reads_storage_objects_ok', (SELECT bool_and(has_table_privilege(owner, 'storage.objects', 'SELECT')) FROM fns),
  -- only the server route (service role) calls the steps; nobody else calls anything of 0023
  'service_role_steps_ok', (SELECT bool_and(has_function_privilege('service_role', oid, 'EXECUTE')) FROM fns
    WHERE proname IN ('account_deletion_status', 'account_deletion_begin', 'account_deletion_manifest', 'account_deletion_failed', 'account_deletion_ready')),
  'api_roles_no_execute_ok', NOT EXISTS (SELECT 1 FROM fns, unnest(ARRAY['anon', 'authenticated']) r WHERE has_function_privilege(r, oid, 'EXECUTE')),
  'tables_closed_ok', NOT EXISTS (SELECT 1 FROM unnest(ARRAY['account_deletions', 'account_deletion_objects', 'account_deletion_stats']) t,
      unnest(ARRAY['anon', 'authenticated', 'service_role']) r, unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE']) p
    WHERE has_table_privilege(r, 'public.' || t, p)),
  'cloud_sync_closes_ok', position('account_deletions' IN pg_get_functiondef('public.cloud_sync_enabled()'::regprocedure)) > 0,
  'storage_policies_0005', (SELECT coalesce(jsonb_agg(policyname ORDER BY policyname), '[]') FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname LIKE 'journal_attachments_files_%'),
  'bucket_ok', EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'journal-attachments' AND NOT public),
  -- 0018 created the hook function; the hook itself stays OFF in the dashboard (nothing here turns it on)
  'hook_function_present', to_regprocedure('public.game_access_token_hook(jsonb)') IS NOT NULL
) AS after_0023;
