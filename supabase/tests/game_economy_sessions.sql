-- AYRA Trading — tests for 0018 (server economy safety, Q4.5-2) on top of 0014–0016. Run on a TEST database; everything
-- is rolled back. Users: A, B (two sessions), C (the auth write fails), D (0014 entry points), E (never moved).
BEGIN;

INSERT INTO auth.users (id, email, raw_app_meta_data) VALUES
  ('00000000-0000-0000-0000-0000000e5a01', 'sess-a@example.com', '{"provider":"email","providers":["email"]}'),
  ('00000000-0000-0000-0000-0000000e5a02', 'sess-b@example.com', '{"provider":"email","providers":["email"]}'),
  ('00000000-0000-0000-0000-0000000e5a03', 'sess-c@example.com', '{"provider":"email"}'),
  ('00000000-0000-0000-0000-0000000e5a04', 'sess-d@example.com', '{"provider":"email"}'),
  ('00000000-0000-0000-0000-0000000e5a05', 'sess-e@example.com', '{"provider":"email"}')
ON CONFLICT (id) DO NOTHING;
INSERT INTO auth.sessions (id, user_id, not_after) VALUES
  ('00000000-0000-0000-0000-00000005e5a1', '00000000-0000-0000-0000-0000000e5a01', NULL),
  ('00000000-0000-0000-0000-00000005e5b1', '00000000-0000-0000-0000-0000000e5a02', NULL),
  ('00000000-0000-0000-0000-00000005e5b2', '00000000-0000-0000-0000-0000000e5a02', NULL),
  ('00000000-0000-0000-0000-00000005e5a9', '00000000-0000-0000-0000-0000000e5a01', now() - interval '1 minute'),
  ('00000000-0000-0000-0000-00000005e5e1', '00000000-0000-0000-0000-0000000e5a05', NULL);
INSERT INTO auth.refresh_tokens (token, user_id, session_id) VALUES
  ('rt-a1', '00000000-0000-0000-0000-0000000e5a01', '00000000-0000-0000-0000-00000005e5a1'),
  ('rt-b1', '00000000-0000-0000-0000-0000000e5a02', '00000000-0000-0000-0000-00000005e5b1'),
  ('rt-b2', '00000000-0000-0000-0000-0000000e5a02', '00000000-0000-0000-0000-00000005e5b2'),
  ('rt-b-legacy', '00000000-0000-0000-0000-0000000e5a02', NULL);

CREATE OR REPLACE FUNCTION pg_temp.err(p_sql TEXT) RETURNS TEXT AS $$
BEGIN
  EXECUTE p_sql;
  RETURN 'ok';
EXCEPTION WHEN OTHERS THEN
  RETURN SQLERRM;
END $$ LANGUAGE plpgsql;
CREATE OR REPLACE FUNCTION pg_temp.mark(p_user UUID) RETURNS TEXT AS $$
  SELECT raw_app_meta_data ->> 'ayra_economy' FROM auth.users WHERE id = p_user $$ LANGUAGE sql;
CREATE OR REPLACE FUNCTION pg_temp.state(p_user UUID) RETURNS TEXT AS $$
  SELECT state FROM public.game_accounts WHERE user_id = p_user $$ LANGUAGE sql;

--------------------------------------------------------------------------------
-- 1. Transitions: one way, from the state the caller saw, the mark in the same transaction
--------------------------------------------------------------------------------
DO $$
DECLARE
  c_a CONSTANT UUID := '00000000-0000-0000-0000-0000000e5a01';
  v JSONB;
BEGIN
  v := public.game_economy_transition(c_a, 'local', 'migration_scheduled');
  IF NOT (v ->> 'changed')::boolean OR v ->> 'state' <> 'migration_scheduled' OR pg_temp.state(c_a) <> 'migration_scheduled' THEN
    RAISE EXCEPTION 'T1: local → migration_scheduled: %', v;
  END IF;
  IF pg_temp.mark(c_a) IS DISTINCT FROM 'migration_scheduled'
     OR (SELECT raw_app_meta_data ->> 'provider' FROM auth.users WHERE id = c_a) <> 'email'
     OR (SELECT raw_app_meta_data -> 'providers' FROM auth.users WHERE id = c_a) <> '["email"]'::jsonb THEN
    RAISE EXCEPTION 'T2: the mark is written and the other app_metadata stays';
  END IF;
  v := public.game_economy_transition(c_a, 'local', 'migration_scheduled');
  IF (v ->> 'changed')::boolean OR v ->> 'state' <> 'migration_scheduled' THEN RAISE EXCEPTION 'T3: the same target again is a replay: %', v; END IF;
  -- a caller who still thinks the account is local, asking for another target: refused, nothing changes
  IF pg_temp.err(format($q$SELECT public.game_economy_transition(%L, 'local', 'migration_pending')$q$, c_a)) <> 'game_state_conflict'
     OR pg_temp.state(c_a) <> 'migration_scheduled' THEN
    RAISE EXCEPTION 'T4: compare-and-set refuses a stale «from»';
  END IF;
  IF pg_temp.err(format($q$SELECT public.game_economy_transition(%L, 'migration_scheduled', 'cloud_active')$q$, c_a)) <> 'game_state_invalid_transition' THEN
    RAISE EXCEPTION 'T5: a stage cannot be skipped to cloud_active';
  END IF;
  IF pg_temp.err(format($q$SELECT public.game_economy_transition(%L, 'migration_scheduled', 'local')$q$, c_a)) <> 'game_bad_request'
     OR pg_temp.err(format($q$SELECT public.game_economy_transition(%L, 'migration_scheduled', 'cloud')$q$, c_a)) <> 'game_bad_request'
     OR pg_temp.err(format($q$SELECT public.game_economy_transition(%L, 'nonsense', 'migration_pending')$q$, c_a)) <> 'game_bad_request'
     OR pg_temp.err($q$SELECT public.game_economy_transition(NULL, 'local', 'migration_pending')$q$) <> 'game_bad_request' THEN
    RAISE EXCEPTION 'T6: no way back to local; unknown states and no account are refused';
  END IF;
  v := public.game_economy_transition(c_a, 'migration_scheduled', 'migration_pending');
  IF v ->> 'state' <> 'migration_pending' OR pg_temp.mark(c_a) <> 'migration_pending' THEN RAISE EXCEPTION 'T7: → pending with its mark'; END IF;
  IF pg_temp.err(format($q$SELECT public.game_economy_transition(%L, 'migration_pending', 'migration_scheduled')$q$, c_a)) <> 'game_state_one_way' THEN
    RAISE EXCEPTION 'T8: pending never goes back to scheduled';
  END IF;
  v := public.game_economy_transition(c_a, 'migration_pending', 'cloud_active');
  IF v ->> 'state' <> 'cloud_active' OR pg_temp.mark(c_a) <> 'cloud_active'
     OR (SELECT activated_at FROM public.game_accounts WHERE user_id = c_a) IS NULL
     OR NOT EXISTS (SELECT 1 FROM public.game_profile WHERE user_id = c_a) THEN
    RAISE EXCEPTION 'T9: → cloud_active: mark, activation time, an empty projection';
  END IF;
  IF (SELECT xp_total + coins FROM public.game_profile WHERE user_id = c_a) <> 0 THEN RAISE EXCEPTION 'T10: nothing is carried over'; END IF;
  IF pg_temp.err(format($q$SELECT public.game_economy_transition(%L, 'cloud_active', 'migration_pending')$q$, c_a)) <> 'game_state_one_way' THEN
    RAISE EXCEPTION 'T11: cloud_active is final';
  END IF;
  -- an account that does not exist: refused, nothing written
  IF pg_temp.err($q$SELECT public.game_economy_transition('00000000-0000-0000-0000-0000000e5aff', 'local', 'migration_pending')$q$) = 'ok'
     OR EXISTS (SELECT 1 FROM public.game_accounts WHERE user_id = '00000000-0000-0000-0000-0000000e5aff') THEN
    RAISE EXCEPTION 'T12: an unknown account is refused';
  END IF;
END $$;

--------------------------------------------------------------------------------
-- 2. Atomic: when the mark cannot be written, the state does not change either
--------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION pg_temp.auth_down() RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'auth_write_failed';
END $$ LANGUAGE plpgsql;
CREATE TRIGGER tr_test_auth_down BEFORE UPDATE ON auth.users FOR EACH ROW
  WHEN (OLD.id = '00000000-0000-0000-0000-0000000e5a03') EXECUTE FUNCTION pg_temp.auth_down();
DO $$
DECLARE
  c_c CONSTANT UUID := '00000000-0000-0000-0000-0000000e5a03';
BEGIN
  IF pg_temp.err(format($q$SELECT public.game_economy_transition(%L, 'local', 'migration_pending')$q$, c_c)) <> 'auth_write_failed' THEN
    RAISE EXCEPTION 'A1: the failing auth write fails the transition';
  END IF;
  IF COALESCE(pg_temp.state(c_c), 'local') <> 'local' OR pg_temp.mark(c_c) IS NOT NULL THEN
    RAISE EXCEPTION 'A2: neither the state nor the mark changed';
  END IF;
END $$;
DROP TRIGGER tr_test_auth_down ON auth.users;

-- The mark writer never writes a mark that is not the account's state (even for its only caller, the owner)
SET LOCAL ROLE game_economy_owner;
DO $$
BEGIN
  IF pg_temp.err($q$SELECT public.game_auth_mark('00000000-0000-0000-0000-0000000e5a05', 'cloud_active', TRUE)$q$) <> 'game_mark_not_state' THEN
    RAISE EXCEPTION 'A3: a mark other than the state is refused';
  END IF;
  -- and the economy owner itself has no right on the auth schema
  IF pg_temp.err($q$UPDATE auth.users SET raw_app_meta_data = '{}' WHERE id = '00000000-0000-0000-0000-0000000e5a05'$q$) NOT LIKE 'permission denied%' THEN
    RAISE EXCEPTION 'A4: the economy owner cannot write auth.users';
  END IF;
END $$;
RESET ROLE;
DO $$
BEGIN
  IF pg_temp.mark('00000000-0000-0000-0000-0000000e5a05') IS NOT NULL
     OR (SELECT count(*) FROM auth.sessions WHERE user_id = '00000000-0000-0000-0000-0000000e5a05') <> 1 THEN
    RAISE EXCEPTION 'A5: the refused mark changed nothing';
  END IF;
END $$;

--------------------------------------------------------------------------------
-- 3. Ending the sessions (only when asked; only the account's own)
--------------------------------------------------------------------------------
DO $$
DECLARE
  c_b CONSTANT UUID := '00000000-0000-0000-0000-0000000e5a02';
  v JSONB;
BEGIN
  v := public.game_economy_transition(c_b, 'local', 'migration_pending', TRUE);
  IF (v ->> 'revoked')::int <> 2 OR EXISTS (SELECT 1 FROM auth.sessions WHERE user_id = c_b)
     OR EXISTS (SELECT 1 FROM auth.refresh_tokens WHERE user_id = c_b::text) THEN
    RAISE EXCEPTION 'R1: both sessions and every refresh token of B (one without a session) are gone: %', v;
  END IF;
  IF (SELECT count(*) FROM auth.sessions WHERE user_id = '00000000-0000-0000-0000-0000000e5a01') <> 2
     OR NOT EXISTS (SELECT 1 FROM auth.refresh_tokens WHERE token = 'rt-a1') THEN
    RAISE EXCEPTION 'R2: other accounts keep their sessions';
  END IF;
  -- not asked: nothing is ended (the default)
  v := public.game_economy_transition('00000000-0000-0000-0000-0000000e5a05', 'local', 'migration_scheduled');
  IF (v ->> 'revoked')::int <> 0 OR (SELECT count(*) FROM auth.sessions WHERE user_id = '00000000-0000-0000-0000-0000000e5a05') <> 1 THEN
    RAISE EXCEPTION 'R3: sessions are kept unless asked';
  END IF;
END $$;

--------------------------------------------------------------------------------
-- 4. 0014's entry points go through the transition (no change without the mark)
--------------------------------------------------------------------------------
DO $$
DECLARE
  c_d CONSTANT UUID := '00000000-0000-0000-0000-0000000e5a04';
BEGIN
  IF public.game_begin_migration(c_d) <> 'migration_pending' OR pg_temp.mark(c_d) <> 'migration_pending' THEN RAISE EXCEPTION 'B1: begin writes the mark'; END IF;
  IF public.game_begin_migration(c_d) <> 'migration_pending' THEN RAISE EXCEPTION 'B2: begin again is a replay'; END IF;
  IF public.game_activate_cloud(c_d, 'q4.5') <> 'cloud_active' OR pg_temp.mark(c_d) <> 'cloud_active'
     OR (SELECT rules_version FROM public.game_accounts WHERE user_id = c_d) <> 'q4.5' THEN
    RAISE EXCEPTION 'B3: activate writes the mark and the rules version';
  END IF;
  IF public.game_begin_migration(c_d) <> 'cloud_active' THEN RAISE EXCEPTION 'B4: begin never moves cloud_active back'; END IF;
  -- scheduled → begin → pending
  IF public.game_begin_migration('00000000-0000-0000-0000-0000000e5a05') <> 'migration_pending'
     OR pg_temp.mark('00000000-0000-0000-0000-0000000e5a05') <> 'migration_pending' THEN
    RAISE EXCEPTION 'B5: begin from scheduled';
  END IF;
END $$;

--------------------------------------------------------------------------------
-- 5. Is the session fresh? (session alive, the token's mark is the state now, issued no earlier than the change)
--------------------------------------------------------------------------------
DO $$
DECLARE
  c_a CONSTANT UUID := '00000000-0000-0000-0000-0000000e5a01';
  s_a CONSTANT UUID := '00000000-0000-0000-0000-00000005e5a1';
  v_now BIGINT := floor(extract(epoch FROM now()))::bigint;
  v JSONB;
BEGIN
  v := public.game_session_check(c_a, s_a, v_now, 'cloud_active');
  IF NOT (v ->> 'fresh')::boolean OR v ->> 'state' <> 'cloud_active' THEN RAISE EXCEPTION 'C1: a token with the current mark is fresh: %', v; END IF;
  IF public.game_session_check(c_a, s_a, v_now, 'migration_pending') ->> 'reason' <> 'mark_changed'
     OR public.game_session_check(c_a, s_a, v_now, NULL) ->> 'reason' <> 'mark_changed'
     OR public.game_session_check(c_a, s_a, v_now, 'forged') ->> 'reason' <> 'mark_changed' THEN
    RAISE EXCEPTION 'C2: an older mark, none or a forged one is stale';
  END IF;
  IF public.game_session_check(c_a, s_a, v_now - 1, 'cloud_active') ->> 'reason' <> 'issued_before_change'
     OR public.game_session_check(c_a, s_a, NULL, 'cloud_active') ->> 'reason' <> 'issued_before_change' THEN
    RAISE EXCEPTION 'C3: a token issued before the change is stale';
  END IF;
  IF public.game_session_check(c_a, '00000000-0000-0000-0000-00000005e5b1', v_now, 'cloud_active') ->> 'reason' <> 'session_revoked'
     OR public.game_session_check(c_a, '00000000-0000-0000-0000-00000005e5a9', v_now, 'cloud_active') ->> 'reason' <> 'session_revoked'
     OR public.game_session_check(c_a, gen_random_uuid(), v_now, 'cloud_active') ->> 'reason' <> 'session_revoked'
     OR public.game_session_check(c_a, NULL, v_now, 'cloud_active') ->> 'reason' <> 'session_revoked' THEN
    RAISE EXCEPTION 'C4: another account''s session, an expired one, an unknown one, none — all stale';
  END IF;
  -- B's sessions were ended by its transition: B's old token is stale whatever it carries
  IF public.game_session_check('00000000-0000-0000-0000-0000000e5a02', '00000000-0000-0000-0000-00000005e5b1', v_now, 'migration_pending') ->> 'reason' <> 'session_revoked' THEN
    RAISE EXCEPTION 'C5: an ended session is stale';
  END IF;
  -- an account never moved: local, fresh without a mark, whatever the iat
  INSERT INTO auth.users (id, email) VALUES ('00000000-0000-0000-0000-0000000e5a06', 'sess-f@example.com');
  INSERT INTO auth.sessions (id, user_id) VALUES ('00000000-0000-0000-0000-00000005e5f1', '00000000-0000-0000-0000-0000000e5a06');
  v := public.game_session_check('00000000-0000-0000-0000-0000000e5a06', '00000000-0000-0000-0000-00000005e5f1', 1, NULL);
  IF NOT (v ->> 'fresh')::boolean OR v ->> 'state' <> 'local' THEN RAISE EXCEPTION 'C6: a local account is fresh without a mark: %', v; END IF;
  IF EXISTS (SELECT 1 FROM public.game_accounts WHERE user_id = '00000000-0000-0000-0000-0000000e5a06') THEN
    RAISE EXCEPTION 'C7: a check writes nothing';
  END IF;
END $$;

--------------------------------------------------------------------------------
-- 6. Awards only through a fresh session
--------------------------------------------------------------------------------
DO $$
DECLARE
  c_a CONSTANT UUID := '00000000-0000-0000-0000-0000000e5a01';
  s_a CONSTANT UUID := '00000000-0000-0000-0000-00000005e5a1';
  v_now BIGINT := floor(extract(epoch FROM now()))::bigint;
  v_err TEXT;
BEGIN
  IF pg_temp.err(format($q$SELECT public.game_apply_reward_for_session(%L, %L, %s, 'migration_pending', 'mission', 'm_lesson', '[]')$q$, c_a, s_a, v_now)) <> 'game_session_stale'
     OR pg_temp.err(format($q$SELECT public.game_apply_reward_for_session(%L, %L, %s, 'cloud_active', 'mission', 'm_lesson', '[]')$q$, c_a, '00000000-0000-0000-0000-00000005e5b1', v_now)) <> 'game_session_stale' THEN
    RAISE EXCEPTION 'P1: a stale session never reaches the award';
  END IF;
  -- a fresh one reaches it (and meets the award's own checks: the kind is off, nothing is paid)
  v_err := pg_temp.err(format($q$SELECT public.game_apply_reward_for_session(%L, %L, %s, 'cloud_active', 'mission', 'm_lesson', '[]')$q$, c_a, s_a, v_now));
  IF v_err = 'game_session_stale' OR v_err NOT LIKE 'game_%' THEN RAISE EXCEPTION 'P2: a fresh session reaches the award: %', v_err; END IF;
  IF EXISTS (SELECT 1 FROM public.game_ledger WHERE user_id = c_a) THEN RAISE EXCEPTION 'P3: nothing paid'; END IF;
END $$;

--------------------------------------------------------------------------------
-- 7. Who may do what
--------------------------------------------------------------------------------
DO $$
DECLARE
  r TEXT;
  f TEXT;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    FOREACH f IN ARRAY ARRAY['public.game_economy_transition(uuid,text,text,boolean)', 'public.game_session_check(uuid,uuid,bigint,text)',
                             'public.game_apply_reward_for_session(uuid,uuid,bigint,text,text,text,jsonb)', 'public.game_auth_mark(uuid,text,boolean)',
                             'public.game_auth_session_alive(uuid,uuid)', 'public.game_apply_reward(uuid,text,text,jsonb)'] LOOP
      IF has_function_privilege(r, f, 'EXECUTE') THEN RAISE EXCEPTION 'G1: % must not execute %', r, f; END IF;
    END LOOP;
  END LOOP;
  IF has_function_privilege('service_role', 'public.game_apply_reward(uuid,text,text,jsonb)', 'EXECUTE')
     OR has_function_privilege('service_role', 'public.game_auth_mark(uuid,text,boolean)', 'EXECUTE')
     OR has_function_privilege('service_role', 'public.game_auth_session_alive(uuid,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'G2: the server cannot award without the session check, nor write the mark itself';
  END IF;
  IF NOT has_function_privilege('service_role', 'public.game_economy_transition(uuid,text,text,boolean)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.game_session_check(uuid,uuid,bigint,text)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.game_apply_reward_for_session(uuid,uuid,bigint,text,text,text,jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'G3: the server keeps its three entry points';
  END IF;
  IF has_table_privilege('game_auth_marker', 'public.game_accounts', 'UPDATE') OR has_table_privilege('game_auth_marker', 'public.game_accounts', 'INSERT')
     OR has_table_privilege('game_economy_owner', 'auth.users', 'UPDATE') OR has_table_privilege('game_economy_owner', 'auth.sessions', 'DELETE') THEN
    RAISE EXCEPTION 'G4: each role holds only its own side';
  END IF;
  IF (SELECT rolcanlogin FROM pg_roles WHERE rolname = 'game_auth_marker')
     OR pg_has_role('service_role', 'game_auth_marker', 'MEMBER') OR pg_has_role('authenticated', 'game_auth_marker', 'MEMBER') THEN
    RAISE EXCEPTION 'G5: nobody logs in as the mark writer and no API role is a member';
  END IF;
END $$;
SET LOCAL ROLE service_role;
DO $$
BEGIN
  IF pg_temp.err($q$SELECT public.game_apply_reward('00000000-0000-0000-0000-0000000e5a01', 'mission', 'm_lesson', '[]')$q$) NOT LIKE 'permission denied%' THEN
    RAISE EXCEPTION 'G6: the bare award is refused to the server';
  END IF;
  IF pg_temp.err($q$SELECT public.game_auth_mark('00000000-0000-0000-0000-0000000e5a05', 'migration_pending', TRUE)$q$) NOT LIKE 'permission denied%' THEN
    RAISE EXCEPTION 'G7: the server cannot write a mark or end sessions on its own';
  END IF;
  -- G8 (the server cannot SET ROLE to the mark writer) needs a non-superuser login: scripts/test-concurrency.sh, PG-K6
END $$;
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000e5a01', true);
DO $$
BEGIN
  IF pg_temp.err($q$SELECT public.game_economy_transition('00000000-0000-0000-0000-0000000e5a01', 'cloud_active', 'cloud_active')$q$) NOT LIKE 'permission denied%' THEN
    RAISE EXCEPTION 'G9: a signed-in person cannot move any account, even their own';
  END IF;
  IF (SELECT state FROM public.game_accounts WHERE user_id = '00000000-0000-0000-0000-0000000e5a01') <> 'cloud_active'
     OR EXISTS (SELECT 1 FROM public.game_accounts WHERE user_id <> '00000000-0000-0000-0000-0000000e5a01') THEN
    RAISE EXCEPTION 'G10: the person reads only their own state';
  END IF;
END $$;
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '', true);

--------------------------------------------------------------------------------
-- 8. The guard stops an admin's ad-hoc SQL too (as the owner)
--------------------------------------------------------------------------------
SET LOCAL ROLE game_economy_owner;
DO $$
BEGIN
  IF pg_temp.err($q$UPDATE public.game_accounts SET state = 'local' WHERE user_id = '00000000-0000-0000-0000-0000000e5a04'$q$) <> 'game_state_one_way'
     OR pg_temp.err($q$UPDATE public.game_accounts SET state = 'migration_scheduled' WHERE user_id = '00000000-0000-0000-0000-0000000e5a05'$q$) <> 'game_state_one_way'
     OR pg_temp.err($q$UPDATE public.game_accounts SET state_changed_at = now() - interval '1 day' WHERE user_id = '00000000-0000-0000-0000-0000000e5a01'$q$) <> 'game_state_one_way' THEN
    RAISE EXCEPTION 'H1: never back, and the time of a change cannot be moved';
  END IF;
END $$;
RESET ROLE;

ROLLBACK;
