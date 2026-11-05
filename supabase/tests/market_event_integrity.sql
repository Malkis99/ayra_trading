BEGIN;
DO $$
DECLARE r jsonb; row_json jsonb; before_row jsonb; meta jsonb;
BEGIN
 SELECT to_jsonb(e) INTO before_row FROM public.market_events e WHERE id='bea:legacy:2026-11-01';
 -- Existing unversioned conflicting data is not overwritten, even by an apparently current dataset.
 r := public.market_events_apply('[{"id":"bea:legacy:2026-11-01","actual":"999","previous":null,"result_meta":{"period":"2026-09","series":"test","unit":"percent","adjustment":"SA","source_updated":"2026-11-05T00:00:00Z"}}]', 'result');
 IF r->0->>'conflict' IS NULL THEN RAISE EXCEPTION 'legacy conflicting values accepted'; END IF;
 IF (SELECT actual FROM public.market_events WHERE id='bea:legacy:2026-11-01') <> '3.0' THEN RAISE EXCEPTION 'legacy actual damaged'; END IF;

 row_json := '{"id":"bea:case:2026-11-10","source":"bea","country":"us","kind":"release","code":"us_gdp","title":"GDP Q3 2026 Second Estimate","importance":3,"starts_at":"2026-11-10T13:30:00Z","time_tbd":false,"url":"https://www.bea.gov/","identity_key":"case-stable","source_uid":"case-uid","reference_period":"2026-Q3","release_stage":"second","schedule_meta":{"sequence":1,"cancelled":false}}';
 PERFORM public.market_events_apply(jsonb_build_array(row_json), 'schedule');
 PERFORM public.market_events_apply(jsonb_build_array(row_json), 'schedule');
 IF (SELECT count(*) FROM public.market_events WHERE identity_key='case-stable') <> 1 THEN RAISE EXCEPTION 'repeat created duplicate'; END IF;
 row_json := jsonb_set(jsonb_set(row_json,'{id}','"bea:case:2026-11-11"'),'{starts_at}','"2026-11-11T14:00:00Z"');
 row_json := jsonb_set(row_json,'{schedule_meta,sequence}','2');
 PERFORM public.market_events_apply(jsonb_build_array(row_json), 'schedule');
 IF (SELECT starts_at FROM public.market_events WHERE identity_key='case-stable') <> '2026-11-11T14:00:00Z'::timestamptz OR NOT EXISTS(SELECT 1 FROM public.market_events WHERE id='bea:case:2026-11-10') THEN RAISE EXCEPTION 'move lost original id'; END IF;
 meta := '{"period":"2026-Q3","series":"us_gdp","unit":"percent","adjustment":"SA","source_updated":"2026-11-11T14:00:00Z"}';
 PERFORM public.market_events_apply(jsonb_build_array(jsonb_build_object('id','bea:case:2026-11-10','actual','3.0','previous','2.0','result_meta',meta)), 'result');
 meta := jsonb_set(meta,'{source_updated}','"2026-11-12T14:00:00Z"');
 PERFORM public.market_events_apply(jsonb_build_array(jsonb_build_object('id','bea:case:2026-11-10','actual','3.1','previous','2.1','result_meta',meta)), 'result');
 meta := jsonb_set(meta,'{source_updated}','"2026-11-11T14:00:00Z"');
 r := public.market_events_apply(jsonb_build_array(jsonb_build_object('id','bea:case:2026-11-10','actual','3.0','previous','2.0','result_meta',meta)), 'result');
 IF r->0->>'conflict' IS NULL OR (SELECT actual FROM public.market_events WHERE identity_key='case-stable') <> '3.1' THEN RAISE EXCEPTION 'stale result accepted'; END IF;
 -- No data is not zero, and cannot erase already published values.
 PERFORM public.market_events_apply(jsonb_build_array(jsonb_build_object('id','bea:case:2026-11-10','actual',null,'previous',null,'result_meta',jsonb_set(meta,'{source_updated}','"2026-11-12T14:00:00Z"'))), 'result');
 IF (SELECT actual || '/' || previous FROM public.market_events WHERE identity_key='case-stable') <> '3.1/2.1' THEN RAISE EXCEPTION 'null erased result'; END IF;
 -- Different units or a different period cannot be treated as a revision.
 r := public.market_events_apply(jsonb_build_array(jsonb_build_object('id','bea:case:2026-11-10','actual','9','result_meta',jsonb_set(meta,'{period}','"2026-Q4"'))), 'result');
 IF r->0->>'conflict' IS NULL THEN RAISE EXCEPTION 'wrong reference period accepted'; END IF;
 r := public.market_events_apply(jsonb_build_array(jsonb_build_object('id','bea:case:2026-11-10','actual','9','result_meta',jsonb_set(meta,'{unit}','"USD"'))), 'result');
 IF r->0->>'conflict' IS NULL THEN RAISE EXCEPTION 'wrong units accepted'; END IF;
 PERFORM public.market_events_apply(jsonb_build_array(jsonb_build_object('id','bea:case:2026-11-10','actual','3.1','previous','2.1','result_meta',meta - 'source_updated')), 'result');
 IF (SELECT result_meta->>'source_updated' FROM public.market_events WHERE identity_key='case-stable') <> '2026-11-12T14:00:00Z' THEN RAISE EXCEPTION 'unversioned replay erased version'; END IF;
 PERFORM public.market_events_apply('[{"source":"bea","source_uid":"case-uid","schedule_meta":{"sequence":3,"cancelled":true}}]', 'cancel');
 IF (SELECT status FROM public.market_events WHERE identity_key='case-stable') <> 'cancelled' THEN RAISE EXCEPTION 'cancel not applied'; END IF;
 r := public.market_events_apply(jsonb_build_array(row_json), 'schedule');
 IF (SELECT status FROM public.market_events WHERE identity_key='case-stable') <> 'cancelled' THEN RAISE EXCEPTION 'old schedule restored cancellation'; END IF;
 row_json := jsonb_set(row_json,'{schedule_meta,sequence}','4');
 PERFORM public.market_events_apply(jsonb_build_array(row_json), 'schedule');
 IF (SELECT status FROM public.market_events WHERE identity_key='case-stable') <> 'released' THEN RAISE EXCEPTION 'restoration lost publication state'; END IF;
 -- Different stage: same country/code/date but a separate row. Never merge advance and second.
 row_json := row_json || '{"identity_key":"case-advance","source_uid":"advance-uid","release_stage":"advance","title":"GDP Q3 Advance Estimate"}';
 PERFORM public.market_events_apply(jsonb_build_array(row_json), 'schedule');
 IF (SELECT count(*) FROM public.market_events WHERE identity_key IN ('case-stable','case-advance')) <> 2 THEN RAISE EXCEPTION 'stages merged'; END IF;
 -- Ambiguous legacy duplicates are retained, unclaimed and unchanged.
 row_json := row_json || '{"id":"bea:dup-a","code":"us_pce","title":"Ambiguous","identity_key":"ambiguous-new","release_stage":"regular","reference_period":"2026-09"}';
 r := public.market_events_apply(jsonb_build_array(row_json), 'schedule');
 IF r->0->>'conflict' IS NULL OR (SELECT count(*) FROM public.market_events WHERE title='Ambiguous') <> 2 OR EXISTS(SELECT 1 FROM public.market_events WHERE identity_key='ambiguous-new') THEN RAISE EXCEPTION 'ambiguous rows merged'; END IF;
 IF (SELECT to_jsonb(e) FROM public.market_events e WHERE id='bea:legacy:2026-11-01') IS DISTINCT FROM before_row THEN RAISE EXCEPTION 'untouched legacy row changed'; END IF;
END $$;
SET LOCAL ROLE service_role;
SELECT public.market_events_apply('[]', 'schedule');
RESET ROLE;
DO $$ BEGIN
 IF has_function_privilege('anon','public.market_events_apply(jsonb,text)','EXECUTE') OR has_function_privilege('authenticated','public.market_events_apply(jsonb,text)','EXECUTE') THEN RAISE EXCEPTION 'client can execute calendar writer'; END IF;
 IF has_table_privilege('anon','public.market_events','UPDATE') OR has_table_privilege('authenticated','public.market_events','UPDATE') THEN RAISE EXCEPTION 'client write grant changed'; END IF;
END $$;
ROLLBACK;
