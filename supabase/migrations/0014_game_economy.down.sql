-- AYRA Trading — Rollback of 0014 (server economy schema, Q4.1). DATA LOSS: the ledger, projections and account states
-- in the cloud are deleted. Only for a test project or before any account was activated: while game_sync is off and
-- every account is «local», nothing was awarded by the server.
BEGIN;
DROP FUNCTION IF EXISTS public.game_account_status();
DROP FUNCTION IF EXISTS public.game_activate_cloud(UUID, TEXT);
DROP FUNCTION IF EXISTS public.game_begin_migration(UUID);
DROP FUNCTION IF EXISTS public.game_rebuild_profile(UUID);
DROP FUNCTION IF EXISTS public.game_apply_reward(UUID, TEXT, TEXT, JSONB);
DROP FUNCTION IF EXISTS public.game_apply_reward(UUID, TEXT, TEXT, JSONB, DATE);
DROP FUNCTION IF EXISTS public.game_day_for(UUID, TIMESTAMPTZ);
DROP TABLE IF EXISTS public.game_source_claims;
DROP TABLE IF EXISTS public.game_profile;
DROP TABLE IF EXISTS public.game_ledger;
DROP TABLE IF EXISTS public.game_mission_sources;
DROP TABLE IF EXISTS public.game_limits;
DROP TABLE IF EXISTS public.game_reward_rules;
DROP TABLE IF EXISTS public.game_award_kinds;
DROP TABLE IF EXISTS public.game_accounts;
DROP FUNCTION IF EXISTS public.game_level_for_xp(BIGINT);
DROP FUNCTION IF EXISTS public.game_owner_only();
DROP FUNCTION IF EXISTS public.game_ledger_no_update();
DROP FUNCTION IF EXISTS public.game_account_state_guard();
DROP POLICY IF EXISTS profiles_game_owner_read ON public.profiles;
DROP POLICY IF EXISTS user_features_game_owner_read ON public.user_features;
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['journal_trades', 'journal_day_plans', 'journal_week_plans', 'journal_notes', 'journal_no_trades'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_game_owner_read', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_game_owner_lock', t);
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'game_economy_owner') THEN
    -- its remaining grants (Journal, profiles, flag, schema) go with it
    EXECUTE 'DROP OWNED BY game_economy_owner';
    EXECUTE 'DROP ROLE game_economy_owner';
  END IF;
END $$;
ALTER TABLE public.user_features DROP COLUMN IF EXISTS game_sync;
COMMIT;
