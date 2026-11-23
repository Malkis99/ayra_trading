-- AYRA Trading — 0018: server economy safety (Q4.5-2, docs/q4-5-2-server-economy-safety.md). NOT APPLIED TO PRODUCTION.
--
-- The account's economy state is decided ONLY here, one way, and committed atomically in PostgreSQL:
--
--   local ──▶ migration_scheduled ──▶ migration_pending ──▶ cloud_active        (and local ──▶ migration_pending)
--
--   * game_economy_transition(user, from, to) — compare-and-set on the locked account row: the change happens only from
--     the state the caller saw; the same target again is a replay; anything else is refused. state_changed_at is set by
--     the guard. Only service_role, never a client.
--   * The session learns the state from Supabase's Custom Access Token Hook: game_access_token_hook(event) runs whenever
--     the auth server issues a token and puts the state, read from game_accounts at that moment, in the top-level
--     claim «ayra_economy». Nothing is written to the auth schema; the hook is the economy owner's, the auth server only
--     executes it. It never raises for a lookup problem (sign-in keeps working): the token then has no mark and
--     «ayra_economy_status: unavailable», and every economy call for a non-local account refuses it (fail-closed).
--   * Tokens issued before a change keep the old mark until they expire (a JWT cannot be recalled). A token is fresh for
--     the economy when it names its session, its mark is the state now and it was issued no earlier than the second of
--     the last change (game_session_check). That the session still exists is the auth server's check: the route asks it
--     with exactly this token (getUser), and it refuses the token of an ended session (403 session_not_found — checked
--     on the official local stack, docs section 7).
--   * Awards go only through game_apply_reward_for_session(): it locks the account row (a transition waits for it, or it
--     waits for the transition), checks the session and only then calls game_apply_reward(), which service_role can no
--     longer call directly.
--   * game_begin_migration() and game_activate_cloud() (0014) go through the transition.
--
-- Supabase (checked on the official local stack, docs section 7): the new owner of a function needs CREATE on public —
-- granted to game_economy_owner for this transaction only and taken back at its end. Nothing is granted on the auth
-- schema (postgres may not pass USAGE on it on): no role of ours reads or writes it.
--
-- Idempotent: safe to run twice.

BEGIN;

-- the owner of the new functions needs CREATE on public while they are handed over (taken back at the end, section 7)
GRANT CREATE ON SCHEMA public TO game_economy_owner;

--------------------------------------------------------------------------------
-- 1. The fourth state and the one-way order
--------------------------------------------------------------------------------
ALTER TABLE public.game_accounts DROP CONSTRAINT IF EXISTS game_accounts_state_check;
ALTER TABLE public.game_accounts ADD CONSTRAINT game_accounts_state_check
  CHECK (state IN ('local', 'migration_scheduled', 'migration_pending', 'cloud_active'));

CREATE OR REPLACE FUNCTION public.game_state_rank(p_state TEXT)
RETURNS INTEGER AS $$
  SELECT CASE p_state WHEN 'local' THEN 0 WHEN 'migration_scheduled' THEN 1 WHEN 'migration_pending' THEN 2
                      WHEN 'cloud_active' THEN 3 END;
$$ LANGUAGE sql IMMUTABLE SET search_path = public;

-- The allowed steps (anything else, backwards included, is refused — even for the owner and an admin's SQL)
CREATE OR REPLACE FUNCTION public.game_account_state_guard()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.state IS DISTINCT FROM OLD.state THEN
    IF OLD.state = 'cloud_active' OR public.game_state_rank(NEW.state) < public.game_state_rank(OLD.state) THEN
      RAISE EXCEPTION 'game_state_one_way' USING ERRCODE = '42501';
    END IF;
    IF NOT ((OLD.state = 'local' AND NEW.state IN ('migration_scheduled', 'migration_pending'))
         OR (OLD.state = 'migration_scheduled' AND NEW.state = 'migration_pending')
         OR (OLD.state = 'migration_pending' AND NEW.state = 'cloud_active')) THEN
      RAISE EXCEPTION 'game_state_invalid_transition' USING ERRCODE = '22023';
    END IF;
    NEW.state_changed_at := now();
    IF NEW.state = 'cloud_active' THEN NEW.activated_at := now(); END IF;
  END IF;
  IF OLD.activated_at IS NOT NULL AND NEW.activated_at IS DISTINCT FROM OLD.activated_at THEN
    RAISE EXCEPTION 'game_state_one_way' USING ERRCODE = '42501';
  END IF;
  -- the time of a change is the guard's: nobody moves it
  IF NEW.state IS NOT DISTINCT FROM OLD.state AND NEW.state_changed_at IS DISTINCT FROM OLD.state_changed_at THEN
    RAISE EXCEPTION 'game_state_one_way' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

--------------------------------------------------------------------------------
-- 2. The transition (the only way a state changes)
--------------------------------------------------------------------------------
-- an earlier draft of this migration had a fourth parameter (ending sessions): never applied anywhere, removed
DROP FUNCTION IF EXISTS public.game_economy_transition(UUID, TEXT, TEXT, BOOLEAN);

CREATE OR REPLACE FUNCTION public.game_economy_transition(p_user UUID, p_from TEXT, p_to TEXT)
RETURNS JSONB AS $$
DECLARE
  v_row public.game_accounts%ROWTYPE;
BEGIN
  IF p_user IS NULL OR public.game_state_rank(p_from) IS NULL OR public.game_state_rank(p_to) IS NULL OR p_to = 'local' THEN
    RAISE EXCEPTION 'game_bad_request' USING ERRCODE = '22023';
  END IF;
  -- an unknown account: the foreign key refuses the row
  INSERT INTO public.game_accounts (user_id) VALUES (p_user) ON CONFLICT (user_id) DO NOTHING;
  SELECT * INTO v_row FROM public.game_accounts WHERE user_id = p_user FOR UPDATE;

  IF v_row.state = p_to THEN
    -- a replay (a second click, a retry, a second admin): nothing changes
    RETURN jsonb_build_object('state', p_to, 'changed', FALSE, 'state_changed_at', v_row.state_changed_at);
  END IF;
  IF v_row.state <> p_from THEN
    -- the caller decided on a state that is no longer there (someone else moved the account)
    RAISE EXCEPTION 'game_state_conflict' USING ERRCODE = '40001';
  END IF;

  IF p_to = 'cloud_active' THEN
    INSERT INTO public.game_profile (user_id) VALUES (p_user) ON CONFLICT (user_id) DO NOTHING;
  END IF;
  -- the guard (section 1) refuses every step that is not allowed and sets state_changed_at
  UPDATE public.game_accounts SET state = p_to WHERE user_id = p_user RETURNING * INTO v_row;
  RETURN jsonb_build_object('state', p_to, 'changed', TRUE, 'state_changed_at', v_row.state_changed_at);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- 0014's entry points keep their signatures and go through the transition
CREATE OR REPLACE FUNCTION public.game_begin_migration(p_user UUID)
RETURNS TEXT AS $$
DECLARE
  v_state TEXT;
BEGIN
  SELECT state INTO v_state FROM public.game_accounts WHERE user_id = p_user;
  v_state := COALESCE(v_state, 'local');
  IF v_state IN ('local', 'migration_scheduled') THEN
    RETURN public.game_economy_transition(p_user, v_state, 'migration_pending') ->> 'state';
  END IF;
  RETURN v_state;
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
  PERFORM public.game_economy_transition(p_user, 'migration_pending', 'cloud_active');
  UPDATE public.game_accounts SET rules_version = p_rules_version WHERE user_id = p_user;
  RETURN 'cloud_active';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

--------------------------------------------------------------------------------
-- 3. The Custom Access Token Hook: the state in every new token
--------------------------------------------------------------------------------
-- Called by the auth server (role supabase_auth_admin) with {user_id, claims, authentication_method}. Returns the same
-- claims plus «ayra_economy» (the account's state now) — every standard claim is kept as it came. The user's own data
-- is not read: only game_accounts, by the user id the auth server gives. Never raises for a lookup problem: the token is
-- then issued WITHOUT a mark and with «ayra_economy_status: unavailable» (sign-in works; the economy refuses it).
CREATE OR REPLACE FUNCTION public.game_access_token_hook(event JSONB)
RETURNS JSONB AS $$
DECLARE
  v_claims JSONB := COALESCE(event -> 'claims', '{}'::jsonb);
  v_user UUID;
  v_state TEXT;
BEGIN
  -- whatever was there under these names is never kept (only this hook speaks for the economy)
  v_claims := v_claims - 'ayra_economy' - 'ayra_economy_status';
  BEGIN
    v_user := (event ->> 'user_id')::UUID;
    SELECT state INTO v_state FROM public.game_accounts WHERE user_id = v_user;
    v_state := COALESCE(v_state, 'local');
    IF public.game_state_rank(v_state) IS NULL THEN
      RAISE EXCEPTION 'game_state_unknown';
    END IF;
    v_claims := v_claims || jsonb_build_object('ayra_economy', v_state);
  EXCEPTION WHEN OTHERS THEN
    v_claims := v_claims || jsonb_build_object('ayra_economy_status', 'unavailable');
  END;
  RETURN jsonb_build_object('claims', v_claims);
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public;

--------------------------------------------------------------------------------
-- 4. Is a session fresh for the economy?
--------------------------------------------------------------------------------
-- p_session, p_iat, p_claim come from the access token the route has just had verified by the auth server (session_id,
-- iat, the hook's «ayra_economy»): that verification already refused an ended session. The answer is the database's.
DROP FUNCTION IF EXISTS public.game_auth_session_alive(UUID, UUID);  -- an earlier draft of this migration
CREATE OR REPLACE FUNCTION public.game_session_check(p_user UUID, p_session UUID, p_iat BIGINT, p_claim TEXT)
RETURNS JSONB AS $$
DECLARE
  v_state TEXT;
  v_changed TIMESTAMPTZ;
  v_reason TEXT := NULL;
BEGIN
  IF p_user IS NULL THEN
    RAISE EXCEPTION 'game_bad_request' USING ERRCODE = '22023';
  END IF;
  SELECT state, state_changed_at INTO v_state, v_changed FROM public.game_accounts WHERE user_id = p_user;
  v_state := COALESCE(v_state, 'local');
  IF p_session IS NULL THEN
    -- a token that names no session is never fresh (every token the auth server issues names one)
    v_reason := 'session_revoked';
  ELSIF COALESCE(p_claim, 'local') IS DISTINCT FROM v_state THEN
    -- an older mark, none (the hook was off or could not read the state), or anything else
    v_reason := 'mark_changed';
  ELSIF v_changed IS NOT NULL AND v_state <> 'local' AND (p_iat IS NULL OR p_iat < floor(extract(epoch FROM v_changed))::BIGINT) THEN
    v_reason := 'issued_before_change';
  END IF;
  RETURN jsonb_build_object('state', v_state, 'fresh', v_reason IS NULL, 'reason', v_reason);
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public;

--------------------------------------------------------------------------------
-- 5. Awards only for a fresh session, atomically with the state
--------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.game_apply_reward_for_session(p_user UUID, p_session UUID, p_iat BIGINT, p_claim TEXT,
  p_kind TEXT, p_item TEXT, p_evidence JSONB)
RETURNS JSONB AS $$
DECLARE
  v JSONB;
BEGIN
  -- the account row is held until the award commits: a transition waits for it (or the award waits for the transition)
  PERFORM 1 FROM public.game_accounts WHERE user_id = p_user FOR SHARE;
  v := public.game_session_check(p_user, p_session, p_iat, p_claim);
  IF NOT (v ->> 'fresh')::BOOLEAN THEN
    RAISE EXCEPTION 'game_session_stale' USING ERRCODE = '42501';
  END IF;
  RETURN public.game_apply_reward(p_user, p_kind, p_item, p_evidence);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

ALTER FUNCTION public.game_state_rank(TEXT) OWNER TO game_economy_owner;  -- a pure order of the stages, callable by all
ALTER FUNCTION public.game_economy_transition(UUID, TEXT, TEXT) OWNER TO game_economy_owner;
ALTER FUNCTION public.game_begin_migration(UUID) OWNER TO game_economy_owner;
ALTER FUNCTION public.game_activate_cloud(UUID, TEXT) OWNER TO game_economy_owner;
ALTER FUNCTION public.game_access_token_hook(JSONB) OWNER TO game_economy_owner;
ALTER FUNCTION public.game_session_check(UUID, UUID, BIGINT, TEXT) OWNER TO game_economy_owner;
ALTER FUNCTION public.game_apply_reward_for_session(UUID, UUID, BIGINT, TEXT, TEXT, TEXT, JSONB) OWNER TO game_economy_owner;

--------------------------------------------------------------------------------
-- 6. Access: service_role only; the hook only for the auth server; the bare award no longer reachable from the API
--------------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.game_economy_transition(UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.game_session_check(UUID, UUID, BIGINT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.game_apply_reward_for_session(UUID, UUID, BIGINT, TEXT, TEXT, TEXT, JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.game_access_token_hook(JSONB) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.game_economy_transition(UUID, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.game_session_check(UUID, UUID, BIGINT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.game_apply_reward_for_session(UUID, UUID, BIGINT, TEXT, TEXT, TEXT, JSONB) TO service_role;
REVOKE EXECUTE ON FUNCTION public.game_apply_reward(UUID, TEXT, TEXT, JSONB) FROM service_role;
-- the auth server's role may run the hook (and nothing else here); it needs to see the schema to call it
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'supabase_auth_admin') THEN
    GRANT USAGE ON SCHEMA public TO supabase_auth_admin;
    GRANT EXECUTE ON FUNCTION public.game_access_token_hook(JSONB) TO supabase_auth_admin;
  END IF;
END $$;

-- CREATE on public was needed only to hand the functions over
REVOKE CREATE ON SCHEMA public FROM game_economy_owner;

COMMIT;
