-- AYRA Trading — rollback of 0018 (Q4.5-2). Restores the 0014 state model, entry points and award access.
-- Refuses while an account is «migration_scheduled» (0014 has no such state): nothing is changed then.
-- Deletes no ledger row, projection, claim or state: XP, Coins and the history stay (docs section 9).
-- Switch the Custom Access Token Hook OFF in the project first (docs section 8): with the hook function gone the auth
-- server could not issue tokens while the hook is still on.

BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.game_accounts WHERE state = 'migration_scheduled') THEN
    RAISE EXCEPTION 'game_rollback_scheduled_accounts: move or keep them before rolling back 0018';
  END IF;
END $$;

-- the owner of the restored functions needs CREATE on public while they are handed over (taken back at the end)
GRANT CREATE ON SCHEMA public TO game_economy_owner;

DROP FUNCTION IF EXISTS public.game_apply_reward_for_session(UUID, UUID, BIGINT, TEXT, TEXT, TEXT, JSONB);
DROP FUNCTION IF EXISTS public.game_session_check(UUID, UUID, BIGINT, TEXT);
DROP FUNCTION IF EXISTS public.game_access_token_hook(JSONB);
DROP FUNCTION IF EXISTS public.game_economy_transition(UUID, TEXT, TEXT);

ALTER TABLE public.game_accounts DROP CONSTRAINT IF EXISTS game_accounts_state_check;
ALTER TABLE public.game_accounts ADD CONSTRAINT game_accounts_state_check CHECK (state IN ('local', 'migration_pending', 'cloud_active'));

-- 0014 guard
CREATE OR REPLACE FUNCTION public.game_account_state_guard()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.state IS DISTINCT FROM OLD.state THEN
    IF OLD.state = 'cloud_active' THEN
      RAISE EXCEPTION 'game_state_one_way' USING ERRCODE = '42501';
    END IF;
    IF OLD.state = 'local' AND NEW.state <> 'migration_pending' THEN
      RAISE EXCEPTION 'game_state_invalid_transition' USING ERRCODE = '22023';
    END IF;
    NEW.state_changed_at := now();
    IF NEW.state = 'cloud_active' THEN NEW.activated_at := now(); END IF;
  END IF;
  IF OLD.activated_at IS NOT NULL AND NEW.activated_at IS DISTINCT FROM OLD.activated_at THEN
    RAISE EXCEPTION 'game_state_one_way' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;
DROP FUNCTION IF EXISTS public.game_state_rank(TEXT);

-- 0014 entry points
CREATE OR REPLACE FUNCTION public.game_begin_migration(p_user UUID)
RETURNS TEXT AS $$
BEGIN
  INSERT INTO public.game_accounts (user_id, state) VALUES (p_user, 'migration_pending')
  ON CONFLICT (user_id) DO UPDATE SET state = 'migration_pending' WHERE public.game_accounts.state = 'local';
  RETURN (SELECT state FROM public.game_accounts WHERE user_id = p_user);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION public.game_activate_cloud(p_user UUID, p_rules_version TEXT DEFAULT 'q4.1')
RETURNS TEXT AS $$
DECLARE
  v_state TEXT;
BEGIN
  SELECT state INTO v_state FROM public.game_accounts WHERE user_id = p_user FOR UPDATE;
  IF v_state = 'cloud_active' THEN RETURN v_state; END IF;
  IF v_state IS DISTINCT FROM 'migration_pending' THEN
    RAISE EXCEPTION 'game_state_invalid_transition' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.game_profile (user_id) VALUES (p_user) ON CONFLICT (user_id) DO NOTHING;
  UPDATE public.game_accounts SET state = 'cloud_active', rules_version = p_rules_version WHERE user_id = p_user;
  RETURN 'cloud_active';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
ALTER FUNCTION public.game_begin_migration(UUID) OWNER TO game_economy_owner;
ALTER FUNCTION public.game_activate_cloud(UUID, TEXT) OWNER TO game_economy_owner;

GRANT EXECUTE ON FUNCTION public.game_apply_reward(UUID, TEXT, TEXT, JSONB) TO service_role;

-- (USAGE on public for supabase_auth_admin is left as it was: Supabase grants it itself)

REVOKE CREATE ON SCHEMA public FROM game_economy_owner;

COMMIT;
