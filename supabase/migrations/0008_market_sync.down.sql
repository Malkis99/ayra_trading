-- AYRA Trading — Rollback of 0008: removes the Market data in the cloud (Watchlist, notes, chart view).
-- DATA LOSS: what is stored in the cloud is deleted (copies on devices stay in the browser).
-- To pause sync without losing anything, turn the flag off instead:
--   UPDATE public.user_features SET cloud_sync = FALSE;
BEGIN;
DROP TABLE IF EXISTS public.market_user_data;
DROP FUNCTION IF EXISTS public.market_row_before_write();
COMMIT;
