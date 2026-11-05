-- Read only. Works before and after 0012. Keep the result privately with a backup/export.
SELECT count(*) AS events, count(actual) AS actuals, count(previous) AS previous_values,
 md5(coalesce(string_agg((to_jsonb(e) - ARRAY['identity_key','source_uid','reference_period','release_stage','schedule_meta','result_meta'])::text, '|' ORDER BY id),'')) AS value_fingerprint
FROM public.market_events e;
SELECT source,country,code,title,starts_at,count(*) AS duplicates
FROM public.market_events GROUP BY source,country,code,title,starts_at HAVING count(*) > 1;
-- A keyed collision is unexpected: stop instead of deleting/merging rows to make the index pass.
SELECT to_jsonb(e)->>'identity_key' AS identity_key,count(*) FROM public.market_events e
WHERE to_jsonb(e)->>'identity_key' IS NOT NULL GROUP BY to_jsonb(e)->>'identity_key' HAVING count(*) > 1;
