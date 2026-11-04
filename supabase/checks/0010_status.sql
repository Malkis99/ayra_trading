-- AYRA Trading — read-only check of migration 0010 (more sources for the Market calendar and news). Changes nothing.
-- Each of the first four columns is true when that list accepts the new sources (eia … rba) or countries (gb, ca, au).
SELECT
  COALESCE((SELECT pg_get_constraintdef(oid) LIKE '%''rba''%' AND pg_get_constraintdef(oid) LIKE '%''eurostat''%'
     FROM pg_constraint WHERE conname = 'market_events_source_check'), FALSE) AS events_sources,
  COALESCE((SELECT pg_get_constraintdef(oid) LIKE '%''au''%' AND pg_get_constraintdef(oid) LIKE '%''gb''%'
     FROM pg_constraint WHERE conname = 'market_events_country_check'), FALSE) AS events_countries,
  COALESCE((SELECT pg_get_constraintdef(oid) LIKE '%''rba''%' AND pg_get_constraintdef(oid) LIKE '%''eurostat''%'
     FROM pg_constraint WHERE conname = 'market_news_source_check'), FALSE) AS news_sources,
  COALESCE((SELECT pg_get_constraintdef(oid) LIKE '%''au''%' AND pg_get_constraintdef(oid) LIKE '%''gb''%'
     FROM pg_constraint WHERE conname = 'market_news_country_check'), FALSE) AS news_countries,
  (SELECT count(*)::int FROM pg_policies WHERE schemaname = 'public' AND tablename IN ('market_events', 'market_news')) AS read_policies,
  (SELECT count(*)::int FROM information_schema.role_table_grants
     WHERE table_schema = 'public' AND table_name IN ('market_events', 'market_news', 'market_feed_runs')
       AND grantee IN ('anon', 'authenticated') AND privilege_type IN ('INSERT', 'UPDATE', 'DELETE')) AS client_write_grants;
-- Expected after 0010: events_sources true, events_countries true, news_sources true, news_countries true,
-- read_policies 2, client_write_grants 0. Before 0010 (or after its rollback) the first four are false.
