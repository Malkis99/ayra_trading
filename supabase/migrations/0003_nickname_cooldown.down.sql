-- AYRA Trading — Rollback of 0003: removes the 14-day nickname rule and the date column.
-- Data loss: only the stored dates of nickname changes (nicknames themselves are kept).
BEGIN;
DROP TRIGGER IF EXISTS tr_profiles_nickname_cooldown ON public.profiles;
DROP FUNCTION IF EXISTS public.enforce_nickname_cooldown();
ALTER TABLE public.profiles DROP COLUMN IF EXISTS nickname_changed_at;
COMMIT;
