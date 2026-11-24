-- AYRA Trading — rollback of 0022 (Q4.7-Б3). Removes the preview and the bulk decision. Decisions already taken stay as
-- they are (legacy_accepted rows and their audit entries are valid without 0022: they are what 0020's single decision
-- records too); nothing is deleted or rewritten.

BEGIN;

DROP FUNCTION IF EXISTS public.game_mig_bulk_accept_achievements(UUID, BIGINT, JSONB, UUID, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.game_mig_achievement_review(UUID);
DROP FUNCTION IF EXISTS public.game_mig_achievement_conflict(public.game_achievements);
DROP FUNCTION IF EXISTS public.game_mig_achievement_claim(JSONB, TEXT);
DROP FUNCTION IF EXISTS public.game_mig_achievement_version(public.game_achievements);

COMMIT;
