-- AYRA Trading — Rollback of 0014 (server economy schema, Q4.1). DATA LOSS: the ledger, projections and account states
-- in the cloud are deleted. Only for a test project or before any account was activated: while game_sync is off and
-- every account is «local», nothing was awarded by the server.
BEGIN;
DROP FUNCTION IF EXISTS public.game_account_status();
DROP FUNCTION IF EXISTS public.game_activate_cloud(UUID, TEXT);
DROP FUNCTION IF EXISTS public.game_begin_migration(UUID);
DROP FUNCTION IF EXISTS public.game_rebuild_profile(UUID);
DROP FUNCTION IF EXISTS public.game_apply_reward(UUID, TEXT, TEXT, JSONB, DATE);
DROP FUNCTION IF EXISTS public.game_day_for(UUID, TIMESTAMPTZ);
DROP TABLE IF EXISTS public.game_source_claims;
DROP TABLE IF EXISTS public.game_profile;
DROP TABLE IF EXISTS public.game_ledger;
DROP TABLE IF EXISTS public.game_limits;
DROP TABLE IF EXISTS public.game_reward_rules;
DROP TABLE IF EXISTS public.game_accounts;
DROP FUNCTION IF EXISTS public.game_level_for_xp(BIGINT);
DROP FUNCTION IF EXISTS public.game_writer_only();
DROP FUNCTION IF EXISTS public.game_ledger_immutable();
DROP FUNCTION IF EXISTS public.game_account_state_guard();
ALTER TABLE public.user_features DROP COLUMN IF EXISTS game_sync;
COMMIT;
