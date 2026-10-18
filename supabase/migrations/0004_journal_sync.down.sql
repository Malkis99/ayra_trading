-- AYRA Trading — Rollback of 0004: removes the cloud journal tables and the sync flag.
-- DATA LOSS: every journal record stored in the cloud is deleted (copies on devices stay in the browser).
-- To pause sync without losing anything, turn the flag off instead:
--   UPDATE public.user_features SET cloud_sync = FALSE;
BEGIN;
DROP TABLE IF EXISTS public.journal_accounts;
DROP TABLE IF EXISTS public.journal_trades;
DROP TABLE IF EXISTS public.journal_strategies;
DROP TABLE IF EXISTS public.journal_no_trades;
DROP TABLE IF EXISTS public.journal_day_plans;
DROP TABLE IF EXISTS public.journal_week_plans;
DROP TABLE IF EXISTS public.journal_notes;
DROP TABLE IF EXISTS public.journal_import_batches;
DROP TABLE IF EXISTS public.journal_settings;
DROP FUNCTION IF EXISTS public.journal_row_before_write();
DROP FUNCTION IF EXISTS public.cloud_sync_enabled();
DROP TABLE IF EXISTS public.user_features;
COMMIT;
