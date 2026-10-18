-- AYRA Trading — is migration 0004 applied? (read-only)
-- Expected after applying: journal_tables = 9, rls_enabled = 9, client_delete_grants = 0, all other columns true.
SELECT
  (SELECT count(*) FROM pg_tables
    WHERE schemaname = 'public' AND tablename IN ('journal_accounts', 'journal_trades', 'journal_strategies',
      'journal_no_trades', 'journal_day_plans', 'journal_week_plans', 'journal_notes', 'journal_import_batches',
      'journal_settings'))::int AS journal_tables,
  (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname LIKE 'journal\_%' AND c.relkind = 'r' AND c.relrowsecurity)::int AS rls_enabled,
  (SELECT count(*) FROM information_schema.role_table_grants
    WHERE table_schema = 'public' AND table_name LIKE 'journal\_%'
      AND grantee IN ('anon', 'authenticated') AND privilege_type IN ('DELETE', 'TRUNCATE'))::int AS client_delete_grants,
  EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'journal_row_before_write') AS write_trigger_function,
  EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'user_features') AS user_features_table,
  EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'cloud_sync_enabled') AS cloud_sync_function;
