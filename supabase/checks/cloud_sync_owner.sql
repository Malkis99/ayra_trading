-- AYRA Trading — how many journal records of one account are in the cloud (read-only, T7b-4f).
-- Replace ТВОЯ_ПОЧТА with the e-mail you sign in with. Nothing is changed by this query.
-- `live` must equal the counters in Settings → «Данные на этом устройстве» → «Журнал этого аккаунта на устройстве»
-- (same rows, same order). `deleted` = records deleted on a device; they stay in the cloud as deleted.
WITH me AS (SELECT id FROM auth.users WHERE email = 'ТВОЯ_ПОЧТА')
SELECT 'Счета' AS what, count(*) FILTER (WHERE deleted_at IS NULL) AS live, count(*) FILTER (WHERE deleted_at IS NOT NULL) AS deleted FROM public.journal_accounts WHERE user_id = (SELECT id FROM me)
UNION ALL SELECT 'Сделки', count(*) FILTER (WHERE deleted_at IS NULL), count(*) FILTER (WHERE deleted_at IS NOT NULL) FROM public.journal_trades WHERE user_id = (SELECT id FROM me)
UNION ALL SELECT 'Стратегии', count(*) FILTER (WHERE deleted_at IS NULL), count(*) FILTER (WHERE deleted_at IS NOT NULL) FROM public.journal_strategies WHERE user_id = (SELECT id FROM me)
UNION ALL SELECT 'Заметки', count(*) FILTER (WHERE deleted_at IS NULL), count(*) FILTER (WHERE deleted_at IS NOT NULL) FROM public.journal_notes WHERE user_id = (SELECT id FROM me)
UNION ALL SELECT 'Не вошёл', count(*) FILTER (WHERE deleted_at IS NULL), count(*) FILTER (WHERE deleted_at IS NOT NULL) FROM public.journal_no_trades WHERE user_id = (SELECT id FROM me)
UNION ALL SELECT 'Планы дня', count(*) FILTER (WHERE deleted_at IS NULL), count(*) FILTER (WHERE deleted_at IS NOT NULL) FROM public.journal_day_plans WHERE user_id = (SELECT id FROM me)
UNION ALL SELECT 'Планы недели', count(*) FILTER (WHERE deleted_at IS NULL), count(*) FILTER (WHERE deleted_at IS NOT NULL) FROM public.journal_week_plans WHERE user_id = (SELECT id FROM me);
