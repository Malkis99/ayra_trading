-- Read-only status. No writes or automatic migration execution.
SELECT
  (SELECT count(*)::int FROM pg_tables WHERE schemaname='public' AND tablename IN ('notifications','notification_settings','notification_preferences')) AS tables,
  (SELECT count(*)::int FROM pg_tables WHERE schemaname='public' AND tablename IN ('notifications','notification_settings','notification_preferences') AND rowsecurity) AS rls_enabled,
  to_regprocedure('public.save_notification_settings(uuid,jsonb,jsonb)') IS NOT NULL AS save_function,
  has_table_privilege('authenticated', 'public.notifications', 'INSERT') AS client_can_forge_notification,
  has_column_privilege('authenticated','public.notifications','payload','UPDATE') AS client_can_change_payload,
  has_column_privilege('authenticated','public.notifications','read_at','UPDATE') AS client_can_mark_read,
  has_table_privilege('anon','public.notifications','SELECT') AS anon_can_read;
