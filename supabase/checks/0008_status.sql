-- AYRA Trading — read-only check of migration 0008 (Market data in the account). Changes nothing.
SELECT
  EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'market_user_data') AS market_table,
  COALESCE((SELECT relrowsecurity FROM pg_class WHERE oid = to_regclass('public.market_user_data')), FALSE) AS rls_enabled,
  EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'market_row_before_write') AS write_trigger_function,
  (SELECT count(*)::int FROM information_schema.role_table_grants
     WHERE table_schema = 'public' AND table_name = 'market_user_data' AND grantee = 'authenticated' AND privilege_type = 'DELETE') AS client_delete_grants,
  (SELECT count(*)::int FROM pg_policies WHERE schemaname = 'public' AND tablename = 'market_user_data') AS policies;
