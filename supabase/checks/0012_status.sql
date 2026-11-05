SELECT (SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='market_events'
 AND column_name IN ('identity_key','source_uid','reference_period','release_stage','schedule_meta','result_meta')) = 6 AS columns_ready,
 to_regprocedure('public.market_events_apply(jsonb,text)') IS NOT NULL AS writer_ready,
 (SELECT relrowsecurity FROM pg_class WHERE oid='public.market_events'::regclass) AS rls_enabled,
 has_function_privilege('service_role','public.market_events_apply(jsonb,text)','EXECUTE') AS server_can_write,
 has_function_privilege('anon','public.market_events_apply(jsonb,text)','EXECUTE') OR has_function_privilege('authenticated','public.market_events_apply(jsonb,text)','EXECUTE') AS client_can_write;
