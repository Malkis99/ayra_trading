-- AYRA Trading — 0018: server economy safety (Q4.5-2, docs/q4-5-2-server-economy-safety.md). NOT APPLIED TO PRODUCTION.
--
-- The account's economy state is decided ONLY here, one way, and every change of it is one transaction with the mark the
-- session carries (auth.users.raw_app_meta_data.ayra_economy, Q4.5-1) and, when asked, the end of the account's sessions:
--
--   local ──▶ migration_scheduled ──▶ migration_pending ──▶ cloud_active        (and local ──▶ migration_pending)
--
--   * game_economy_transition(user, from, to, revoke) — compare-and-set on the locked account row: the change happens only
--     from the state the caller saw; the same target again is a replay (the mark is re-written, nothing else); anything
--     else is refused. state_changed_at is set by the 0014 guard. Only service_role, never a client.
--   * The mark and the sessions are written by game_auth_mark(), owned by a separate NOLOGIN role «game_auth_marker» —
--     the only holder of UPDATE (raw_app_meta_data) on auth.users and DELETE on auth.sessions / auth.refresh_tokens.
--     It runs only from the owner's transition, and refuses a mark that is not the account's state at that moment.
--     The economy owner itself still has no right on the auth schema.
--   * A session is fresh for the economy when its session still exists, the mark in its token is the account's state now
--     and it was issued no earlier than the second of the last change (game_session_check). The mark is written in the
--     same transaction as the state, so a token carrying the current mark was issued after that change.
--   * Awards go only through game_apply_reward_for_session(): it locks the account row (a transition waits for it, or it
--     waits for the transition), checks the session and only then calls game_apply_reward(), which service_role can no
--     longer call directly.
--   * game_begin_migration() and game_activate_cloud() (0014) now go through the transition, so no state change can skip
--     the mark.
--
-- A deleted session does not end an access token already issued: it stays valid at the auth server and PostgREST until
-- its exp. The cut-off for the economy is the check above, made by the database for every economy call.
--
-- Idempotent: safe to run twice.

BEGIN;

--------------------------------------------------------------------------------
-- 0. The mark writer role (no login, no member)
--------------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'game_auth_marker') THEN
    CREATE ROLE game_auth_marker NOLOGIN NOINHERIT;
  END IF;
END $$;
-- the role running the migration may hand the function over to it (as for game_economy_owner in 0014)
GRANT game_auth_marker TO CURRENT_USER;
GRANT USAGE ON SCHEMA public TO game_auth_marker;
GRANT USAGE ON SCHEMA auth TO game_auth_marker;
-- exactly what it needs on the auth schema (Supabase: the role running the migration must be able to grant these —
-- checked on a Supabase branch before production, docs section 7)
GRANT SELECT (id, raw_app_meta_data), UPDATE (raw_app_meta_data) ON auth.users TO game_auth_marker;
GRANT SELECT (id, user_id, not_after), DELETE ON auth.sessions TO game_auth_marker;
GRANT SELECT (user_id), DELETE ON auth.refresh_tokens TO game_auth_marker;
-- it reads the account's state to refuse a mark that is not the state (no write: the owner guard of 0014 stays)
GRANT SELECT (user_id, state) ON public.game_accounts TO game_auth_marker;
DROP POLICY IF EXISTS game_accounts_marker_read ON public.game_accounts;
CREATE POLICY game_accounts_marker_read ON public.game_accounts FOR SELECT TO game_auth_marker USING (TRUE);

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
-- 2. The mark and the sessions (auth schema) — only from the transition
--------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.game_auth_mark(p_user UUID, p_state TEXT, p_revoke BOOLEAN)
RETURNS INTEGER AS $$
DECLARE
  v_state TEXT;
  v_revoked INTEGER := 0;
BEGIN
  -- never a mark the account does not have now (the caller holds the row: this is the state being committed)
  SELECT state INTO v_state FROM public.game_accounts WHERE user_id = p_user;
  IF v_state IS DISTINCT FROM p_state THEN
    RAISE EXCEPTION 'game_mark_not_state' USING ERRCODE = '22023';
  END IF;
  UPDATE auth.users SET raw_app_meta_data = COALESCE(raw_app_meta_data, '{}'::jsonb) || jsonb_build_object('ayra_economy', p_state)
  WHERE id = p_user;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'game_user_missing' USING ERRCODE = '22023';
  END IF;
  IF p_revoke THEN
    -- refresh tokens first (also those without a session row), then the sessions; an access token already issued is
    -- NOT ended by this — game_session_check() refuses it for the economy
    DELETE FROM auth.refresh_tokens WHERE user_id = p_user::text;
    DELETE FROM auth.sessions WHERE user_id = p_user;
    GET DIAGNOSTICS v_revoked = ROW_COUNT;
  END IF;
  RETURN v_revoked;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Is this session of this account still alive at the auth server's table?
CREATE OR REPLACE FUNCTION public.game_auth_session_alive(p_user UUID, p_session UUID)
RETURNS BOOLEAN AS $$
  SELECT p_session IS NOT NULL AND EXISTS (
    SELECT 1 FROM auth.sessions s WHERE s.id = p_session AND s.user_id = p_user AND (s.not_after IS NULL OR s.not_after > now()));
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

ALTER FUNCTION public.game_auth_mark(UUID, TEXT, BOOLEAN) OWNER TO game_auth_marker;
ALTER FUNCTION public.game_auth_session_alive(UUID, UUID) OWNER TO game_auth_marker;
REVOKE ALL ON FUNCTION public.game_auth_mark(UUID, TEXT, BOOLEAN) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.game_auth_session_alive(UUID, UUID) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.game_auth_mark(UUID, TEXT, BOOLEAN) TO game_economy_owner;
GRANT EXECUTE ON FUNCTION public.game_auth_session_alive(UUID, UUID) TO game_economy_owner;

--------------------------------------------------------------------------------
-- 3. The transition (the only way a state changes)
--------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.game_economy_transition(p_user UUID, p_from TEXT, p_to TEXT, p_revoke_sessions BOOLEAN DEFAULT FALSE)
RETURNS JSONB AS $$
DECLARE
  v_row public.game_accounts%ROWTYPE;
  v_revoked INTEGER;
BEGIN
  IF p_user IS NULL OR public.game_state_rank(p_from) IS NULL OR public.game_state_rank(p_to) IS NULL OR p_to = 'local' THEN
    RAISE EXCEPTION 'game_bad_request' USING ERRCODE = '22023';
  END IF;
  -- an unknown account: the foreign key refuses the row (the owner has no right on the auth schema at all)
  INSERT INTO public.game_accounts (user_id) VALUES (p_user) ON CONFLICT (user_id) DO NOTHING;
  SELECT * INTO v_row FROM public.game_accounts WHERE user_id = p_user FOR UPDATE;

  IF v_row.state = p_to THEN
    -- a replay (a second click, a retry, a second admin): the mark is made sure, nothing else changes
    PERFORM public.game_auth_mark(p_user, p_to, FALSE);
    RETURN jsonb_build_object('state', p_to, 'changed', FALSE, 'state_changed_at', v_row.state_changed_at, 'revoked', 0);
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
  v_revoked := public.game_auth_mark(p_user, p_to, COALESCE(p_revoke_sessions, FALSE));
  RETURN jsonb_build_object('state', p_to, 'changed', TRUE, 'state_changed_at', v_row.state_changed_at, 'revoked', v_revoked);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- 0014's entry points keep their signatures and now go through the transition (no state change without the mark)
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
-- 4. Is a session fresh for the economy?
--------------------------------------------------------------------------------
-- p_session, p_iat, p_claim come from the access token the route has just had verified by the auth server
-- (session_id, iat, app_metadata.ayra_economy); the answer is from the database alone.
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
  IF NOT public.game_auth_session_alive(p_user, p_session) THEN
    v_reason := 'session_revoked';
  ELSIF COALESCE(p_claim, 'local') IS DISTINCT FROM v_state THEN
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
ALTER FUNCTION public.game_economy_transition(UUID, TEXT, TEXT, BOOLEAN) OWNER TO game_economy_owner;
ALTER FUNCTION public.game_begin_migration(UUID) OWNER TO game_economy_owner;
ALTER FUNCTION public.game_activate_cloud(UUID, TEXT) OWNER TO game_economy_owner;
ALTER FUNCTION public.game_session_check(UUID, UUID, BIGINT, TEXT) OWNER TO game_economy_owner;
ALTER FUNCTION public.game_apply_reward_for_session(UUID, UUID, BIGINT, TEXT, TEXT, TEXT, JSONB) OWNER TO game_economy_owner;

--------------------------------------------------------------------------------
-- 6. Access: service_role only; the bare award is no longer reachable from the API
--------------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.game_economy_transition(UUID, TEXT, TEXT, BOOLEAN) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.game_session_check(UUID, UUID, BIGINT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.game_apply_reward_for_session(UUID, UUID, BIGINT, TEXT, TEXT, TEXT, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.game_economy_transition(UUID, TEXT, TEXT, BOOLEAN) TO service_role;
GRANT EXECUTE ON FUNCTION public.game_session_check(UUID, UUID, BIGINT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.game_apply_reward_for_session(UUID, UUID, BIGINT, TEXT, TEXT, TEXT, JSONB) TO service_role;
REVOKE EXECUTE ON FUNCTION public.game_apply_reward(UUID, TEXT, TEXT, JSONB) FROM service_role;

COMMIT;
