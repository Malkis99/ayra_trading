-- AYRA Trading — read-only check of migration 0009 (Market calendar and official news). Changes nothing.
SELECT
  (SELECT count(*)::int FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name IN ('market_events', 'market_news', 'market_feed_runs')) AS feed_tables,
  (SELECT count(*)::int FROM pg_class
     WHERE oid IN (to_regclass('public.market_events'), to_regclass('public.market_news'), to_regclass('public.market_feed_runs'))
       AND relrowsecurity) AS rls_enabled,
  EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'market_feeds_prune') AS prune_function,
  (SELECT count(*)::int FROM information_schema.role_table_grants
     WHERE table_schema = 'public' AND table_name IN ('market_events', 'market_news', 'market_feed_runs')
       AND grantee IN ('anon', 'authenticated') AND privilege_type IN ('INSERT', 'UPDATE', 'DELETE')) AS client_write_grants,
  (SELECT count(*)::int FROM information_schema.role_table_grants
     WHERE table_schema = 'public' AND table_name = 'market_feed_runs' AND grantee IN ('anon', 'authenticated')) AS client_log_grants,
  (SELECT count(*)::int FROM pg_policies WHERE schemaname = 'public' AND tablename IN ('market_events', 'market_news')) AS read_policies;
-- Expected after 0009: feed_tables 3, rls_enabled 3, prune_function true, client_write_grants 0,
-- client_log_grants 0, read_policies 2.
