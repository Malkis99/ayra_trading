-- AYRA Trading — tests for 0018 (server economy safety, Q4.5-2: Custom Access Token Hook) on top of 0014–0016. Run on a
-- TEST database; everything is rolled back. Users: A, B, D (0014 entry points), E, F (never moved).
BEGIN;

INSERT INTO auth.users (id, email) VALUES
  ('00000000-0000-0000-0000-0000000e5a01', 'sess-a@example.com'),
  ('00000000-0000-0000-0000-0000000e5a02', 'sess-b@example.com'),
  ('00000000-0000-0000-0000-0000000e5a04', 'sess-d@example.com'),
  ('00000000-0000-0000-0000-0000000e5a05', 'sess-e@example.com'),
  ('00000000-0000-0000-0000-0000000e5a06', 'sess-f@example.com')
ON CONFLICT (id) DO NOTHING;
INSERT INTO auth.sessions (id, user_id, not_after) VALUES
  ('00000000-0000-0000-0000-00000005e5a1', '00000000-0000-0000-0000-0000000e5a01', NULL),
  ('00000000-0000-0000-0000-00000005e5b1', '00000000-0000-0000-0000-0000000e5a02', NULL),
  ('00000000-0000-0000-0000-00000005e5a9', '00000000-0000-0000-0000-0000000e5a01', now() - interval '1 minute'),
  ('00000000-0000-0000-0000-00000005e5f1', '00000000-0000-0000-0000-0000000e5a06', NULL);

CREATE OR REPLACE FUNCTION pg_temp.err(p_sql TEXT) RETURNS TEXT AS $$
BEGIN
  EXECUTE p_sql;
  RETURN 'ok';
EXCEPTION WHEN OTHERS THEN
  RETURN SQLERRM;
END $$ LANGUAGE plpgsql;
CREATE OR REPLACE FUNCTION pg_temp.state(p_user UUID) RETURNS TEXT AS $$
  SELECT state FROM public.game_accounts WHERE user_id = p_user $$ LANGUAGE sql;
-- the event the auth server sends to the hook (claims as Supabase issues them)
CREATE OR REPLACE FUNCTION pg_temp.event(p_user TEXT, p_extra JSONB DEFAULT '{}') RETURNS JSONB AS $$
  SELECT jsonb_build_object('user_id', p_user, 'authentication_method', 'password', 'claims',
    jsonb_build_object('iss', 'http://127.0.0.1:54321/auth/v1', 'aud', 'authenticated', 'exp', 1900000000, 'iat', 1800000000,
      'sub', p_user, 'email', 'x@example.com', 'phone', '', 'role', 'authenticated', 'aal', 'aal1', 'is_anonymous', false,
      'session_id', '00000000-0000-0000-0000-00000005e5a1', 'app_metadata', jsonb_build_object('provider', 'email'),
      'user_metadata', '{}'::jsonb, 'amr', '[{"method":"password","timestamp":1800000000}]'::jsonb) || p_extra) $$ LANGUAGE sql;

--------------------------------------------------------------------------------
-- 1. Transitions: one way, from the state the caller saw, atomic in PostgreSQL
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
  v := public.game_economy_transition(c_a, 'local', 'migration_scheduled');
  IF (v ->> 'changed')::boolean OR v ->> 'state' <> 'migration_scheduled' THEN RAISE EXCEPTION 'T3: the same target again is a replay: %', v; END IF;
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
  IF v ->> 'state' <> 'migration_pending' THEN RAISE EXCEPTION 'T7: → pending'; END IF;
  IF pg_temp.err(format($q$SELECT public.game_economy_transition(%L, 'migration_pending', 'migration_scheduled')$q$, c_a)) <> 'game_state_one_way' THEN
    RAISE EXCEPTION 'T8: pending never goes back to scheduled';
  END IF;
  v := public.game_economy_transition(c_a, 'migration_pending', 'cloud_active');
  IF v ->> 'state' <> 'cloud_active' OR (SELECT activated_at FROM public.game_accounts WHERE user_id = c_a) IS NULL
     OR NOT EXISTS (SELECT 1 FROM public.game_profile WHERE user_id = c_a) THEN
    RAISE EXCEPTION 'T9: → cloud_active: activation time, an empty projection';
  END IF;
  IF (SELECT xp_total + coins FROM public.game_profile WHERE user_id = c_a) <> 0 THEN RAISE EXCEPTION 'T10: nothing is carried over'; END IF;
  IF pg_temp.err(format($q$SELECT public.game_economy_transition(%L, 'cloud_active', 'migration_pending')$q$, c_a)) <> 'game_state_one_way' THEN
    RAISE EXCEPTION 'T11: cloud_active is final';
  END IF;
  IF pg_temp.err($q$SELECT public.game_economy_transition('00000000-0000-0000-0000-0000000e5aff', 'local', 'migration_pending')$q$) = 'ok'
     OR EXISTS (SELECT 1 FROM public.game_accounts WHERE user_id = '00000000-0000-0000-0000-0000000e5aff') THEN
    RAISE EXCEPTION 'T12: an unknown account is refused';
  END IF;
  -- nothing in the auth schema is written by any transition
  IF EXISTS (SELECT 1 FROM auth.users WHERE raw_app_meta_data ? 'ayra_economy') THEN RAISE EXCEPTION 'T13: no write to auth.users'; END IF;
END $$;

--------------------------------------------------------------------------------
-- 2. 0014's entry points go through the transition
--------------------------------------------------------------------------------
DO $$
DECLARE
  c_d CONSTANT UUID := '00000000-0000-0000-0000-0000000e5a04';
BEGIN
  IF public.game_begin_migration(c_d) <> 'migration_pending' THEN RAISE EXCEPTION 'B1: begin'; END IF;
  IF public.game_begin_migration(c_d) <> 'migration_pending' THEN RAISE EXCEPTION 'B2: begin again is a replay'; END IF;
  IF public.game_activate_cloud(c_d, 'q4.5') <> 'cloud_active' OR (SELECT rules_version FROM public.game_accounts WHERE user_id = c_d) <> 'q4.5' THEN
    RAISE EXCEPTION 'B3: activate and the rules version';
  END IF;
  IF public.game_begin_migration(c_d) <> 'cloud_active' THEN RAISE EXCEPTION 'B4: begin never moves cloud_active back'; END IF;
  PERFORM public.game_economy_transition('00000000-0000-0000-0000-0000000e5a05', 'local', 'migration_scheduled');
  IF public.game_begin_migration('00000000-0000-0000-0000-0000000e5a05') <> 'migration_pending' THEN RAISE EXCEPTION 'B5: begin from scheduled'; END IF;
END $$;

--------------------------------------------------------------------------------
-- 3. The Custom Access Token Hook
--------------------------------------------------------------------------------
DO $$
DECLARE
  v JSONB;
  e JSONB;
  k TEXT;
BEGIN
  -- a never-moved account: «local»; every standard claim kept exactly as it came
  e := pg_temp.event('00000000-0000-0000-0000-0000000e5a06');
  v := public.game_access_token_hook(e);
  IF v -> 'claims' ->> 'ayra_economy' <> 'local' OR v -> 'claims' ? 'ayra_economy_status' THEN RAISE EXCEPTION 'K1: local: %', v; END IF;
  FOREACH k IN ARRAY ARRAY['iss', 'aud', 'exp', 'iat', 'sub', 'email', 'phone', 'role', 'aal', 'is_anonymous', 'session_id', 'app_metadata', 'user_metadata', 'amr'] LOOP
    IF (v -> 'claims' -> k) IS DISTINCT FROM (e -> 'claims' -> k) THEN RAISE EXCEPTION 'K2: claim % changed: %', k, v; END IF;
  END LOOP;
  IF (SELECT count(*) FROM jsonb_object_keys(v -> 'claims')) <> (SELECT count(*) FROM jsonb_object_keys(e -> 'claims')) + 1 THEN
    RAISE EXCEPTION 'K3: exactly one claim added: %', v;
  END IF;
  -- each state as it is now in the database
  IF public.game_access_token_hook(pg_temp.event('00000000-0000-0000-0000-0000000e5a01')) -> 'claims' ->> 'ayra_economy' <> 'cloud_active'
     OR public.game_access_token_hook(pg_temp.event('00000000-0000-0000-0000-0000000e5a05')) -> 'claims' ->> 'ayra_economy' <> 'migration_pending' THEN
    RAISE EXCEPTION 'K4: the state now';
  END IF;
  -- whatever the claims already said (a forged or old mark, a status) is not kept; app_metadata is left alone
  v := public.game_access_token_hook(pg_temp.event('00000000-0000-0000-0000-0000000e5a01',
    '{"ayra_economy":"local","ayra_economy_status":"unavailable","app_metadata":{"provider":"email","ayra_economy":"local"}}'));
  IF v -> 'claims' ->> 'ayra_economy' <> 'cloud_active' OR v -> 'claims' ? 'ayra_economy_status' THEN RAISE EXCEPTION 'K5: only the database speaks: %', v; END IF;
  IF v -> 'claims' -> 'app_metadata' <> '{"provider":"email","ayra_economy":"local"}'::jsonb THEN RAISE EXCEPTION 'K6: app_metadata untouched (it is not the mark)'; END IF;
  -- a broken event (no or bad user id): no mark, «unavailable», the token is still issued with its claims
  FOREACH k IN ARRAY ARRAY['not-a-uuid', ''] LOOP
    v := public.game_access_token_hook(pg_temp.event(k));
    IF v -> 'claims' ? 'ayra_economy' OR v -> 'claims' ->> 'ayra_economy_status' <> 'unavailable' OR v -> 'claims' ->> 'role' <> 'authenticated' THEN
      RAISE EXCEPTION 'K7: a bad user id: %', v;
    END IF;
  END LOOP;
  v := public.game_access_token_hook('{}');
  IF v -> 'claims' ->> 'ayra_economy_status' <> 'unavailable' THEN RAISE EXCEPTION 'K8: an empty event: %', v; END IF;
END $$;

-- the state cannot be read (a PostgreSQL error inside the hook): no mark, «unavailable», sign-in still works
ALTER TABLE public.game_accounts RENAME TO game_accounts_away;
DO $$
DECLARE
  v JSONB;
BEGIN
  v := public.game_access_token_hook(pg_temp.event('00000000-0000-0000-0000-0000000e5a01'));
  IF v -> 'claims' ? 'ayra_economy' OR v -> 'claims' ->> 'ayra_economy_status' <> 'unavailable' OR v -> 'claims' ->> 'sub' IS NULL THEN
    RAISE EXCEPTION 'K9: a database error is not a mark: %', v;
  END IF;
END $$;
ALTER TABLE public.game_accounts_away RENAME TO game_accounts;

-- the auth server's role runs the hook (and reads the state only through it)
SET LOCAL ROLE supabase_auth_admin;
DO $$
BEGIN
  IF public.game_access_token_hook(pg_temp.event('00000000-0000-0000-0000-0000000e5a01')) -> 'claims' ->> 'ayra_economy' <> 'cloud_active' THEN
    RAISE EXCEPTION 'K10: the auth server gets the state through the hook';
  END IF;
  IF pg_temp.err($q$SELECT state FROM public.game_accounts LIMIT 1$q$) NOT LIKE 'permission denied%' THEN
    RAISE EXCEPTION 'K11: the auth server reads no game table directly';
  END IF;
  IF pg_temp.err($q$SELECT public.game_economy_transition('00000000-0000-0000-0000-0000000e5a06', 'local', 'migration_pending')$q$) NOT LIKE 'permission denied%' THEN
    RAISE EXCEPTION 'K12: the auth server cannot move an account';
  END IF;
END $$;
RESET ROLE;

--------------------------------------------------------------------------------
-- 4. Is the session fresh? (the token names its session, its mark is the state now, issued no earlier than the change;
--    that the session still exists is checked by the auth server for this very token — the database reads no auth table)
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
    RAISE EXCEPTION 'C2: an older mark, none (hook off or «unavailable») or a forged one is stale';
  END IF;
  IF public.game_session_check(c_a, s_a, v_now - 1, 'cloud_active') ->> 'reason' <> 'issued_before_change'
     OR public.game_session_check(c_a, s_a, NULL, 'cloud_active') ->> 'reason' <> 'issued_before_change' THEN
    RAISE EXCEPTION 'C3: a token issued before the change is stale';
  END IF;
  IF public.game_session_check(c_a, NULL, v_now, 'cloud_active') ->> 'reason' <> 'session_revoked' THEN
    RAISE EXCEPTION 'C4: a token that names no session is stale';
  END IF;
  -- the database does not look at auth.sessions at all (the auth server refuses an ended session's token itself)
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'game_session_check' AND prosrc LIKE '%auth.%') THEN
    RAISE EXCEPTION 'C5: the session check reads no auth table';
  END IF;
  -- a never-moved account: local, fresh without a mark, whatever the iat
  v := public.game_session_check('00000000-0000-0000-0000-0000000e5a06', '00000000-0000-0000-0000-00000005e5f1', 1, NULL);
  IF NOT (v ->> 'fresh')::boolean OR v ->> 'state' <> 'local' THEN RAISE EXCEPTION 'C6: a local account is fresh without a mark: %', v; END IF;
  IF EXISTS (SELECT 1 FROM public.game_accounts WHERE user_id = '00000000-0000-0000-0000-0000000e5a06') THEN RAISE EXCEPTION 'C7: a check writes nothing'; END IF;
END $$;

--------------------------------------------------------------------------------
-- 5. Awards only through a fresh session
--------------------------------------------------------------------------------
DO $$
DECLARE
  c_a CONSTANT UUID := '00000000-0000-0000-0000-0000000e5a01';
  s_a CONSTANT UUID := '00000000-0000-0000-0000-00000005e5a1';
  v_now BIGINT := floor(extract(epoch FROM now()))::bigint;
  v_err TEXT;
BEGIN
  IF pg_temp.err(format($q$SELECT public.game_apply_reward_for_session(%L, %L, %s, 'migration_pending', 'mission', 'm_lesson', '[]')$q$, c_a, s_a, v_now)) <> 'game_session_stale'
     OR pg_temp.err(format($q$SELECT public.game_apply_reward_for_session(%L, %L, %s, NULL, 'mission', 'm_lesson', '[]')$q$, c_a, s_a, v_now)) <> 'game_session_stale'
     OR pg_temp.err(format($q$SELECT public.game_apply_reward_for_session(%L, NULL, %s, 'cloud_active', 'mission', 'm_lesson', '[]')$q$, c_a, v_now)) <> 'game_session_stale' THEN
    RAISE EXCEPTION 'P1: a stale session (old mark, no mark — the hook failed —, a token naming no session) never reaches the award';
  END IF;
  v_err := pg_temp.err(format($q$SELECT public.game_apply_reward_for_session(%L, %L, %s, 'cloud_active', 'mission', 'm_lesson', '[]')$q$, c_a, s_a, v_now));
  IF v_err = 'game_session_stale' OR v_err NOT LIKE 'game_%' THEN RAISE EXCEPTION 'P2: a fresh session reaches the award: %', v_err; END IF;
  IF EXISTS (SELECT 1 FROM public.game_ledger WHERE user_id = c_a) THEN RAISE EXCEPTION 'P3: nothing paid'; END IF;
END $$;

--------------------------------------------------------------------------------
-- 6. Who may do what
--------------------------------------------------------------------------------
DO $$
DECLARE
  r TEXT;
  f TEXT;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    FOREACH f IN ARRAY ARRAY['public.game_economy_transition(uuid,text,text)', 'public.game_session_check(uuid,uuid,bigint,text)',
                             'public.game_apply_reward_for_session(uuid,uuid,bigint,text,text,text,jsonb)', 'public.game_access_token_hook(jsonb)',
                             'public.game_apply_reward(uuid,text,text,jsonb)'] LOOP
      IF has_function_privilege(r, f, 'EXECUTE') THEN RAISE EXCEPTION 'G1: % must not execute %', r, f; END IF;
    END LOOP;
  END LOOP;
  IF has_function_privilege('service_role', 'public.game_apply_reward(uuid,text,text,jsonb)', 'EXECUTE')
     OR has_function_privilege('service_role', 'public.game_access_token_hook(jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'G2: the server cannot award without the session check, nor run the hook';
  END IF;
  -- (0019, Q4.5-4: state changes belong to the owner's tool — with 0019 the server no longer moves accounts)
  IF has_function_privilege('service_role', 'public.game_economy_transition(uuid,text,text)', 'EXECUTE') = (to_regclass('public.game_imports') IS NOT NULL)
     OR NOT has_function_privilege('service_role', 'public.game_session_check(uuid,uuid,bigint,text)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.game_apply_reward_for_session(uuid,uuid,bigint,text,text,text,jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'G3: the server keeps its three entry points';
  END IF;
  -- the auth server's role: the hook only
  IF NOT has_function_privilege('supabase_auth_admin', 'public.game_access_token_hook(jsonb)', 'EXECUTE')
     OR has_function_privilege('supabase_auth_admin', 'public.game_economy_transition(uuid,text,text)', 'EXECUTE')
     OR has_function_privilege('supabase_auth_admin', 'public.game_session_check(uuid,uuid,bigint,text)', 'EXECUTE')
     OR has_function_privilege('supabase_auth_admin', 'public.game_apply_reward_for_session(uuid,uuid,bigint,text,text,text,jsonb)', 'EXECUTE')
     OR has_table_privilege('supabase_auth_admin', 'public.game_accounts', 'SELECT') THEN
    RAISE EXCEPTION 'G4: the auth server runs the hook and nothing else';
  END IF;
  -- the economy owner has no right at all on the auth schema
  IF has_schema_privilege('game_economy_owner', 'auth', 'USAGE')
     OR has_column_privilege('game_economy_owner', 'auth.sessions', 'user_id', 'SELECT')
     OR has_table_privilege('game_economy_owner', 'auth.users', 'UPDATE') OR has_table_privilege('game_economy_owner', 'auth.users', 'SELECT')
     OR has_table_privilege('game_economy_owner', 'auth.refresh_tokens', 'DELETE') OR has_table_privilege('game_economy_owner', 'auth.sessions', 'DELETE') THEN
    RAISE EXCEPTION 'G5: the economy owner has no right on the auth schema';
  END IF;
  -- CREATE on public is not left behind by any migration, to anyone of ours or of the API
  FOREACH r IN ARRAY ARRAY['game_economy_owner', 'anon', 'authenticated', 'service_role', 'supabase_auth_admin'] LOOP
    IF has_schema_privilege(r, 'public', 'CREATE') THEN RAISE EXCEPTION 'G6: % must not keep CREATE on public', r; END IF;
  END LOOP;
END $$;
-- Every award path, whatever its name (0014 bare, 0015 «_at» with a time, 0018 with the session): the server reaches
-- only the session-checked one; no client role reaches any; no API role is a member (even inherited) of the owner role
DO $$
DECLARE
  f RECORD;
  r TEXT;
BEGIN
  FOR f IN SELECT p.oid, p.oid::regprocedure::text AS sig, p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
           WHERE n.nspname = 'public' AND p.proname LIKE 'game\_apply\_reward%' LOOP
    FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'supabase_auth_admin'] LOOP
      IF has_function_privilege(r, f.oid, 'EXECUTE') THEN RAISE EXCEPTION 'G11: % must not execute %', r, f.sig; END IF;
    END LOOP;
    IF has_function_privilege('service_role', f.oid, 'EXECUTE') <> (f.proname = 'game_apply_reward_for_session') THEN
      RAISE EXCEPTION 'G11: service_role and % (only the session-checked award is the server''s)', f.sig;
    END IF;
  END LOOP;
  IF (SELECT count(*) FROM pg_proc WHERE proname LIKE 'game\_apply\_reward%') < 3 THEN RAISE EXCEPTION 'G11: the three award functions are there'; END IF;
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role', 'authenticator', 'supabase_auth_admin'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) AND pg_has_role(r, 'game_economy_owner', 'MEMBER') THEN
      RAISE EXCEPTION 'G12: % must not be a member of the owner role', r;
    END IF;
  END LOOP;
END $$;
SET LOCAL ROLE service_role;
DO $$
BEGIN
  IF pg_temp.err($q$SELECT public.game_apply_reward('00000000-0000-0000-0000-0000000e5a01', 'mission', 'm_lesson', '[]')$q$) NOT LIKE 'permission denied%' THEN
    RAISE EXCEPTION 'G7: the bare award is refused to the server';
  END IF;
  IF pg_temp.err($q$SELECT public.game_access_token_hook('{}')$q$) NOT LIKE 'permission denied%' THEN
    RAISE EXCEPTION 'G8: the server cannot run the hook';
  END IF;
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
-- 7. The guard stops an admin's ad-hoc SQL too (as the owner)
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
