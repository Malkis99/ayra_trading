-- AYRA Trading — tests for 0014 (server economy schema, Q4.1 + security review). Run on a TEST database; everything is
-- rolled back. Every check raises an exception when it fails, so a clean run means all passed.
BEGIN;

-- Users: A (Tbilisi), B (UTC). Profiles come from the sign-up trigger (0001/0002).
INSERT INTO auth.users (id, email) VALUES
  ('00000000-0000-0000-0000-00000000ec01', 'eco-a@example.com'),
  ('00000000-0000-0000-0000-00000000ec02', 'eco-b@example.com')
ON CONFLICT (id) DO NOTHING;
UPDATE public.profiles SET timezone = 'Asia/Tbilisi' WHERE id = '00000000-0000-0000-0000-00000000ec01';
-- As in Supabase, the service role (the server route) may read the Journal to build the evidence it checked; the PGlite
-- stub has no such default grants. Rolled back with the test.
GRANT SELECT ON public.journal_notes, public.journal_day_plans, public.journal_trades TO service_role;

-- Journal rows in the cloud (evidence for missions)
INSERT INTO public.journal_notes (user_id, id, data) VALUES
  ('00000000-0000-0000-0000-00000000ec01', 'n_a1', '{"id":"n_a1","templateKey":"lesson","body":"Урок: жду закрытия свечи над уровнем.","createdAt":"2026-11-01T10:00:00Z","updatedAt":"2026-11-01T10:00:00Z"}'),
  ('00000000-0000-0000-0000-00000000ec01', 'n_a2', '{"id":"n_a2","templateKey":"lesson","body":"Урок два.","createdAt":"2026-11-01T11:00:00Z","updatedAt":"2026-11-01T11:00:00Z"}'),
  ('00000000-0000-0000-0000-00000000ec02', 'n_b1', '{"id":"n_b1","templateKey":"lesson","body":"Урок B.","createdAt":"2026-11-01T10:00:00Z","updatedAt":"2026-11-01T10:00:00Z"}'),
  ('00000000-0000-0000-0000-00000000ec02', 'n_b2', '{"id":"n_b2","templateKey":"lesson","body":"Урок B два.","createdAt":"2026-11-01T11:00:00Z","updatedAt":"2026-11-01T11:00:00Z"}');
INSERT INTO public.journal_day_plans (user_id, id, data) VALUES
  ('00000000-0000-0000-0000-00000000ec01', '2026-11-01', '{"date":"2026-11-01","bias":[],"levels":[],"createdAt":"2026-11-01T07:00:00Z","updatedAt":"2026-11-01T07:00:00Z"}'),
  ('00000000-0000-0000-0000-00000000ec02', '2026-11-01', '{"date":"2026-11-01","bias":[],"levels":[],"createdAt":"2026-11-01T07:00:00Z","updatedAt":"2026-11-01T07:00:00Z"}');

-- The evidence the route would pass for a row it read
CREATE OR REPLACE FUNCTION pg_temp.ev(p_table TEXT, p_user UUID, p_id TEXT) RETURNS JSONB AS $$
DECLARE v JSONB;
BEGIN
  EXECUTE format('SELECT jsonb_build_array(jsonb_build_object(''table'', %L, ''id'', id, ''version'', client_updated_at, ''fp'', md5(data::text))) FROM public.%I WHERE user_id = $1 AND id = $2', p_table, p_table)
    INTO v USING p_user, p_id;
  RETURN v;
END $$ LANGUAGE plpgsql;
GRANT EXECUTE ON FUNCTION pg_temp.ev(TEXT, UUID, TEXT) TO service_role;

--------------------------------------------------------------------------------
-- 1. Anonymous: sees nothing, writes nothing, calls nothing
--------------------------------------------------------------------------------
SET LOCAL ROLE anon;
DO $$
DECLARE v_blocked BOOLEAN;
BEGIN
  v_blocked := FALSE;
  BEGIN PERFORM 1 FROM public.game_ledger; EXCEPTION WHEN insufficient_privilege THEN v_blocked := TRUE; END;
  IF NOT v_blocked THEN RAISE EXCEPTION 'AN1: anon must not read the ledger'; END IF;
  v_blocked := FALSE;
  BEGIN PERFORM 1 FROM public.game_profile; EXCEPTION WHEN insufficient_privilege THEN v_blocked := TRUE; END;
  IF NOT v_blocked THEN RAISE EXCEPTION 'AN2: anon must not read projections'; END IF;
  v_blocked := FALSE;
  BEGIN PERFORM public.game_apply_reward('00000000-0000-0000-0000-00000000ec01', 'mission', 'm_lesson');
  EXCEPTION WHEN insufficient_privilege THEN v_blocked := TRUE; END;
  IF NOT v_blocked THEN RAISE EXCEPTION 'AN3: anon must not call the award'; END IF;
  v_blocked := FALSE;
  BEGIN PERFORM public.game_account_status(); EXCEPTION WHEN insufficient_privilege THEN v_blocked := TRUE; END;
  IF NOT v_blocked THEN RAISE EXCEPTION 'AN4: anon has no status'; END IF;
END $$;
RESET ROLE;

--------------------------------------------------------------------------------
-- 2. Fail-closed: as installed, nothing can be awarded; unimplemented kinds stay refused even when «enabled»
--------------------------------------------------------------------------------
SET LOCAL ROLE service_role;
DO $$
DECLARE v_err TEXT;
BEGIN
  BEGIN PERFORM public.game_apply_reward('00000000-0000-0000-0000-00000000ec01', 'mission', 'm_lesson'); v_err := 'none';
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM; END;
  IF v_err <> 'game_kind_disabled' THEN RAISE EXCEPTION 'F1: mission is off as installed, got %', v_err; END IF;
END $$;
RESET ROLE;
-- the owner (admin, SET ROLE) turns every kind on — the unimplemented ones must still be refused
SET LOCAL ROLE game_economy_owner;
UPDATE public.game_award_kinds SET enabled = TRUE;
RESET ROLE;
SET LOCAL ROLE service_role;
DO $$
DECLARE
  k TEXT;
  v_err TEXT;
BEGIN
  FOREACH k IN ARRAY ARRAY['personal_quest', 'self_report', 'daily_reward', 'first_action', 'journal_xp', 'achievement'] LOOP
    BEGIN PERFORM public.game_apply_reward('00000000-0000-0000-0000-00000000ec01', k, 'anything'); v_err := 'none';
    EXCEPTION WHEN OTHERS THEN v_err := SQLERRM; END;
    IF v_err <> 'game_kind_not_implemented' THEN RAISE EXCEPTION 'F2: % must stay refused until its server validation exists, got %', k, v_err; END IF;
  END LOOP;
  BEGIN PERFORM public.game_apply_reward('00000000-0000-0000-0000-00000000ec01', 'xp_boost', 'x'); v_err := 'none';
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM; END;
  IF v_err <> 'game_unknown_kind' THEN RAISE EXCEPTION 'F3: unknown kind, got %', v_err; END IF;
END $$;
RESET ROLE;

--------------------------------------------------------------------------------
-- 3. The state machine: «local» and «migration_pending» get nothing; flag off = paused; cloud_active is one way
--------------------------------------------------------------------------------
SET LOCAL ROLE service_role;
DO $$
DECLARE
  c_a CONSTANT UUID := '00000000-0000-0000-0000-00000000ec01';
  c_b CONSTANT UUID := '00000000-0000-0000-0000-00000000ec02';
  v_err TEXT;
BEGIN
  BEGIN PERFORM public.game_apply_reward(c_a, 'mission', 'm_lesson', pg_temp.ev('journal_notes', c_a, 'n_a1')); v_err := 'none';
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM; END;
  IF v_err <> 'game_account_not_active' THEN RAISE EXCEPTION 'S1: local account must get nothing, got %', v_err; END IF;
  IF public.game_begin_migration(c_a) <> 'migration_pending' THEN RAISE EXCEPTION 'S2: begin migration'; END IF;
  BEGIN PERFORM public.game_apply_reward(c_a, 'mission', 'm_lesson', pg_temp.ev('journal_notes', c_a, 'n_a1')); v_err := 'none';
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM; END;
  IF v_err <> 'game_account_not_active' THEN RAISE EXCEPTION 'S3: pending account must get nothing, got %', v_err; END IF;
  IF public.game_activate_cloud(c_a) <> 'cloud_active' THEN RAISE EXCEPTION 'S4: activate'; END IF;
  IF public.game_activate_cloud(c_a) <> 'cloud_active' THEN RAISE EXCEPTION 'S5: activate is idempotent'; END IF;
  BEGIN PERFORM public.game_apply_reward(c_a, 'mission', 'm_lesson', pg_temp.ev('journal_notes', c_a, 'n_a1')); v_err := 'none';
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM; END;
  IF v_err <> 'game_sync_paused' THEN RAISE EXCEPTION 'S6: flag off must pause, got %', v_err; END IF;
  IF public.game_begin_migration(c_a) <> 'cloud_active' THEN RAISE EXCEPTION 'S7: begin on an active account must keep it'; END IF;
  PERFORM public.game_begin_migration(c_b);
  PERFORM public.game_activate_cloud(c_b);
END $$;
RESET ROLE;
-- one way even for the owner role (an admin trying to roll an account back)
SET LOCAL ROLE game_economy_owner;
DO $$
DECLARE v_err TEXT;
BEGIN
  BEGIN UPDATE public.game_accounts SET state = 'local' WHERE user_id = '00000000-0000-0000-0000-00000000ec01'; v_err := 'none';
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM; END;
  IF v_err <> 'game_state_one_way' THEN RAISE EXCEPTION 'S8: cloud_active must be one way, got %', v_err; END IF;
END $$;
RESET ROLE;
INSERT INTO public.user_features (user_id, game_sync) VALUES
  ('00000000-0000-0000-0000-00000000ec01', TRUE), ('00000000-0000-0000-0000-00000000ec02', TRUE)
ON CONFLICT (user_id) DO UPDATE SET game_sync = TRUE;

--------------------------------------------------------------------------------
-- 4. Mission awards: the server builds the key and the rule; evidence is required, of an accepted type, once
--------------------------------------------------------------------------------
SET LOCAL ROLE service_role;
DO $$
DECLARE
  c_a CONSTANT UUID := '00000000-0000-0000-0000-00000000ec01';
  c_b CONSTANT UUID := '00000000-0000-0000-0000-00000000ec02';
  v_r JSONB;
  v_r2 JSONB;
  v_err TEXT;
  v_n INT;
  v_p public.game_profile%ROWTYPE;
BEGIN
  -- 4.1 40 XP + 10 Coins from the rule; the key is mission:<server day>:<id>
  v_r := public.game_apply_reward(c_a, 'mission', 'm_lesson', pg_temp.ev('journal_notes', c_a, 'n_a1'));
  IF (v_r ->> 'xp')::int <> 40 OR (v_r ->> 'coins')::int <> 10 OR (v_r ->> 'replay')::boolean
     OR v_r ->> 'key' <> 'mission:' || public.game_day_for(c_a) || ':m_lesson' THEN
    RAISE EXCEPTION 'T1: mission must pay 40/10 once under the server key: %', v_r;
  END IF;
  -- 4.2 the same mission again (tab, device, retry): the saved result
  v_r2 := public.game_apply_reward(c_a, 'mission', 'm_lesson', pg_temp.ev('journal_notes', c_a, 'n_a1'));
  IF NOT (v_r2 ->> 'replay')::boolean OR (v_r2 - 'replay') <> (v_r - 'replay') THEN RAISE EXCEPTION 'T2: repeat must return the saved result: %', v_r2; END IF;
  SELECT count(*) INTO v_n FROM public.game_ledger WHERE user_id = c_a;
  SELECT * INTO v_p FROM public.game_profile WHERE user_id = c_a;
  IF v_n <> 1 OR v_p.xp_total <> 40 OR v_p.coins <> 10 OR v_p.version <> 1 THEN
    RAISE EXCEPTION 'T3: one ledger row, one projection update: rows % xp % coins % version %', v_n, v_p.xp_total, v_p.coins, v_p.version;
  END IF;
  -- 4.3 a mission without evidence
  BEGIN PERFORM public.game_apply_reward(c_a, 'mission', 'm_observation', '[]'); v_err := 'none';
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM; END;
  IF v_err <> 'game_evidence_required' THEN RAISE EXCEPTION 'T4: a mission needs evidence, got %', v_err; END IF;
  -- 4.4 an invented mission id (an arbitrary key with an allowed rule)
  BEGIN PERFORM public.game_apply_reward(c_a, 'mission', 'm_free_xp', pg_temp.ev('journal_notes', c_a, 'n_a2')); v_err := 'none';
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM; END;
  IF v_err <> 'game_unknown_mission' THEN RAISE EXCEPTION 'T5: unknown mission, got %', v_err; END IF;
  -- 4.5 key-shaped or odd items cannot smuggle a key
  BEGIN PERFORM public.game_apply_reward(c_a, 'mission', 'm_lesson:2026-01-01', pg_temp.ev('journal_notes', c_a, 'n_a2')); v_err := 'none';
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM; END;
  IF v_err <> 'game_bad_request' THEN RAISE EXCEPTION 'T6: item with a colon, got %', v_err; END IF;
  -- 4.6 evidence of another kind of task (a note for a trade review)
  BEGIN PERFORM public.game_apply_reward(c_a, 'mission', 'm_trade_review', pg_temp.ev('journal_notes', c_a, 'n_a2')); v_err := 'none';
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM; END;
  IF v_err <> 'game_evidence_type' THEN RAISE EXCEPTION 'T7: evidence of another task type, got %', v_err; END IF;
  -- 4.7 the same record for another mission (a second payment under another key)
  BEGIN PERFORM public.game_apply_reward(c_a, 'mission', 'm_observation', pg_temp.ev('journal_notes', c_a, 'n_a1')); v_err := 'none';
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM; END;
  IF v_err <> 'game_source_used' THEN RAISE EXCEPTION 'T8: a record pays once, got %', v_err; END IF;
  -- 4.8 another user's record
  BEGIN PERFORM public.game_apply_reward(c_a, 'mission', 'm_observation',
      (SELECT jsonb_build_array(jsonb_build_object('table','journal_notes','id',id,'version',client_updated_at,'fp',md5(data::text))) FROM public.journal_notes WHERE id = 'n_b1'));
    v_err := 'none';
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM; END;
  IF v_err <> 'game_evidence_missing' THEN RAISE EXCEPTION 'T9: another user''s record must not count, got %', v_err; END IF;
  -- 4.9 one day plan, two different parts (preparation, risk): two missions; the cap of three; level-up at 120 XP
  PERFORM public.game_apply_reward(c_a, 'mission', 'q_bias', pg_temp.ev('journal_day_plans', c_a, '2026-11-01'));
  v_r := public.game_apply_reward(c_a, 'mission', 'q_riskcheck', pg_temp.ev('journal_day_plans', c_a, '2026-11-01'));
  IF (v_r ->> 'xp_total')::int <> 120 OR (v_r ->> 'level_after')::int <> 2 OR (v_r ->> 'level_before')::int <> 1 THEN
    RAISE EXCEPTION 'T10: two parts of one plan, level-up in the award: %', v_r;
  END IF;
  -- 4.10 a fourth mission (the cap is three a day), with fresh evidence
  BEGIN PERFORM public.game_apply_reward(c_a, 'mission', 'm_mistake', pg_temp.ev('journal_notes', c_a, 'n_a2')); v_err := 'none';
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM; END;
  IF v_err <> 'game_day_cap' THEN RAISE EXCEPTION 'T11: three missions a day, got %', v_err; END IF;
  -- 4.11 the same part of a record for two missions (day review: «Day summary» and «Day state»): once
  PERFORM public.game_apply_reward(c_b, 'mission', 'q_reflect', pg_temp.ev('journal_day_plans', c_b, '2026-11-01'));
  BEGIN PERFORM public.game_apply_reward(c_b, 'mission', 'm_day_state', pg_temp.ev('journal_day_plans', c_b, '2026-11-01')); v_err := 'none';
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM; END;
  IF v_err <> 'game_source_used' THEN RAISE EXCEPTION 'T12: one review pays one mission, got %', v_err; END IF;
END $$;
RESET ROLE;

--------------------------------------------------------------------------------
-- 5. TOCTOU: the Journal record changes between the route's check and the award
--------------------------------------------------------------------------------
DO $$
DECLARE
  c_b CONSTANT UUID := '00000000-0000-0000-0000-00000000ec02';
  v_ev JSONB;
  v_err TEXT;
BEGIN
  v_ev := pg_temp.ev('journal_notes', c_b, 'n_b2');
  -- the text is cut short with the SAME updatedAt (the Journal accepts it as a retry)
  UPDATE public.journal_notes SET data = jsonb_set(data, '{body}', '"x"') WHERE user_id = c_b AND id = 'n_b2';
  SET LOCAL ROLE service_role;
  BEGIN PERFORM public.game_apply_reward(c_b, 'mission', 'm_lesson', v_ev); v_err := 'none';
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM; END;
  RESET ROLE;
  IF v_err <> 'game_evidence_changed' THEN RAISE EXCEPTION 'X1: same version, other content must be refused, got %', v_err; END IF;
  v_ev := pg_temp.ev('journal_notes', c_b, 'n_b2');
  UPDATE public.journal_notes SET data = data || '{"updatedAt":"2026-11-01T12:00:00Z"}' WHERE user_id = c_b AND id = 'n_b2';
  SET LOCAL ROLE service_role;
  BEGIN PERFORM public.game_apply_reward(c_b, 'mission', 'm_lesson', v_ev); v_err := 'none';
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM; END;
  RESET ROLE;
  IF v_err <> 'game_evidence_changed' THEN RAISE EXCEPTION 'X2: a newer version must be refused, got %', v_err; END IF;
  v_ev := pg_temp.ev('journal_notes', c_b, 'n_b2');
  UPDATE public.journal_notes SET data = data || '{"deletedAt":"2026-11-01T12:00:00Z"}' WHERE user_id = c_b AND id = 'n_b2';
  SET LOCAL ROLE service_role;
  BEGIN PERFORM public.game_apply_reward(c_b, 'mission', 'm_lesson', v_ev); v_err := 'none';
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM; END;
  RESET ROLE;
  IF v_err <> 'game_evidence_changed' THEN RAISE EXCEPTION 'X3: a deleted record must be refused, got %', v_err; END IF;
  IF EXISTS (SELECT 1 FROM public.game_ledger WHERE user_id = c_b AND idempotency_key LIKE '%:m_lesson') THEN
    RAISE EXCEPTION 'X4: a refused award must leave nothing';
  END IF;
END $$;

--------------------------------------------------------------------------------
-- 6. Authenticated user A: own rows only, no writes, no award functions
--------------------------------------------------------------------------------
SET LOCAL ROLE authenticated;
DO $$
DECLARE
  c_a CONSTANT TEXT := '00000000-0000-0000-0000-00000000ec01';
  c_b CONSTANT UUID := '00000000-0000-0000-0000-00000000ec02';
  v_n INT;
  v_blocked BOOLEAN;
  v_status JSONB;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', c_a, true);
  SELECT count(*) INTO v_n FROM public.game_ledger;
  IF v_n = 0 OR EXISTS (SELECT 1 FROM public.game_ledger WHERE user_id <> c_a::uuid) THEN RAISE EXCEPTION 'U1: A must see only own ledger'; END IF;
  SELECT count(*) INTO v_n FROM public.game_profile;
  IF v_n <> 1 THEN RAISE EXCEPTION 'U2: A must see only own projection, sees %', v_n; END IF;
  v_status := public.game_account_status();
  IF v_status ->> 'state' <> 'cloud_active' OR NOT (v_status ->> 'game_sync')::boolean THEN RAISE EXCEPTION 'U3: status %', v_status; END IF;
  v_blocked := FALSE;
  BEGIN INSERT INTO public.game_ledger (user_id, idempotency_key, kind, rule_code, game_day, xp, coins, rules_version, result)
        VALUES (c_a::uuid, 'pq:forged', 'personal_quest', 'pq_gold_app', current_date, 250, 0, 'q4.1', '{}');
  EXCEPTION WHEN insufficient_privilege THEN v_blocked := TRUE; END;
  IF NOT v_blocked THEN RAISE EXCEPTION 'U4: direct ledger insert (a paid quest) must fail'; END IF;
  v_blocked := FALSE;
  BEGIN INSERT INTO public.game_ledger (user_id, idempotency_key, kind, rule_code, game_day, xp, coins, rules_version, result)
        VALUES (c_b, 'mission:forged', 'mission', 'mission', current_date, 40, 10, 'q4.1', '{}');
  EXCEPTION WHEN insufficient_privilege THEN v_blocked := TRUE; END;
  IF NOT v_blocked THEN RAISE EXCEPTION 'U5: insert for another user must fail'; END IF;
  v_blocked := FALSE;
  BEGIN UPDATE public.game_profile SET xp_total = 999999, level = 99, coins = 999999; EXCEPTION WHEN insufficient_privilege THEN v_blocked := TRUE; END;
  IF NOT v_blocked THEN RAISE EXCEPTION 'U6: projection update must fail'; END IF;
  v_blocked := FALSE;
  BEGIN UPDATE public.game_ledger SET xp = 9999; EXCEPTION WHEN insufficient_privilege THEN v_blocked := TRUE; END;
  IF NOT v_blocked THEN RAISE EXCEPTION 'U7: ledger update must fail'; END IF;
  v_blocked := FALSE;
  BEGIN DELETE FROM public.game_ledger; EXCEPTION WHEN insufficient_privilege THEN v_blocked := TRUE; END;
  IF NOT v_blocked THEN RAISE EXCEPTION 'U8: ledger delete must fail'; END IF;
  v_blocked := FALSE;
  BEGIN UPDATE public.game_accounts SET state = 'local'; EXCEPTION WHEN insufficient_privilege THEN v_blocked := TRUE; END;
  IF NOT v_blocked THEN RAISE EXCEPTION 'U9: state change must fail'; END IF;
  v_blocked := FALSE;
  BEGIN UPDATE public.game_reward_rules SET xp = 1000 WHERE code = 'mission'; EXCEPTION WHEN insufficient_privilege THEN v_blocked := TRUE; END;
  IF NOT v_blocked THEN RAISE EXCEPTION 'U10: rules update must fail'; END IF;
  v_blocked := FALSE;
  BEGIN PERFORM public.game_apply_reward(c_a::uuid, 'mission', 'm_lesson'); EXCEPTION WHEN insufficient_privilege THEN v_blocked := TRUE; END;
  IF NOT v_blocked THEN RAISE EXCEPTION 'U11: user must not call the award'; END IF;
  v_blocked := FALSE;
  BEGIN PERFORM public.game_activate_cloud(c_a::uuid); EXCEPTION WHEN insufficient_privilege THEN v_blocked := TRUE; END;
  IF NOT v_blocked THEN RAISE EXCEPTION 'U12: user must not change the state'; END IF;
  v_blocked := FALSE;
  BEGIN PERFORM public.game_rebuild_profile(c_a::uuid); EXCEPTION WHEN insufficient_privilege THEN v_blocked := TRUE; END;
  IF NOT v_blocked THEN RAISE EXCEPTION 'U13: user must not rebuild'; END IF;
END $$;
DO $$
DECLARE v_n INT;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000ec02', true);
  SELECT count(*) INTO v_n FROM public.game_ledger WHERE user_id = '00000000-0000-0000-0000-00000000ec01';
  IF v_n <> 0 THEN RAISE EXCEPTION 'U14: B must not see A''s ledger'; END IF;
  SELECT count(*) INTO v_n FROM public.game_profile WHERE user_id = '00000000-0000-0000-0000-00000000ec01';
  IF v_n <> 0 THEN RAISE EXCEPTION 'U15: B must not see A''s projection'; END IF;
END $$;
RESET ROLE;

--------------------------------------------------------------------------------
-- 7. Writer guard: the service role (and an admin's ad-hoc SQL) cannot write — SET / set_config change nothing
--------------------------------------------------------------------------------
-- The privilege layer on its own (the trigger raises the same SQLSTATE, so a write attempt alone cannot tell which
-- layer refused): no API role holds any write privilege on any game table
DO $$
DECLARE
  r TEXT;
  t TEXT;
  p TEXT;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    FOREACH t IN ARRAY ARRAY['game_accounts', 'game_award_kinds', 'game_reward_rules', 'game_limits', 'game_mission_sources',
                             'game_ledger', 'game_source_claims', 'game_profile'] LOOP
      FOREACH p IN ARRAY ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE'] LOOP
        IF has_table_privilege(r, 'public.' || t, p) THEN
          RAISE EXCEPTION 'W0: % must not have % on %', r, p, t;
        END IF;
      END LOOP;
    END LOOP;
  END LOOP;
  IF has_function_privilege('authenticated', 'public.game_apply_reward(uuid,text,text,jsonb)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.game_apply_reward(uuid,text,text,jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'W0: only the server may execute the award';
  END IF;
END $$;
SET LOCAL ROLE service_role;
DO $$
DECLARE
  v_err TEXT;
  v_blocked BOOLEAN;
BEGIN
  -- the old writer mark of the first draft, set by hand: it is not an authority any more
  PERFORM set_config('ayra.game_writer', 'on', true);
  v_blocked := FALSE;
  BEGIN INSERT INTO public.game_ledger (user_id, idempotency_key, kind, rule_code, game_day, xp, coins, rules_version, result)
        VALUES ('00000000-0000-0000-0000-00000000ec01', 'mission:2099-01-01:forged', 'mission', 'mission', current_date, 40, 10, 'q4.1', '{}');
  EXCEPTION WHEN insufficient_privilege THEN v_blocked := TRUE; END;
  IF NOT v_blocked THEN RAISE EXCEPTION 'W1: service role must not insert into the ledger, even with the old writer mark'; END IF;
  v_blocked := FALSE;
  BEGIN UPDATE public.game_profile SET coins = 999999; EXCEPTION WHEN insufficient_privilege THEN v_blocked := TRUE; END;
  IF NOT v_blocked THEN RAISE EXCEPTION 'W2: service role must not edit projections'; END IF;
  v_blocked := FALSE;
  BEGIN UPDATE public.game_award_kinds SET enabled = TRUE WHERE kind = 'personal_quest'; EXCEPTION WHEN insufficient_privilege THEN v_blocked := TRUE; END;
  IF NOT v_blocked THEN RAISE EXCEPTION 'W3: service role must not switch kinds on'; END IF;
  v_blocked := FALSE;
  BEGIN INSERT INTO public.game_mission_sources (mission_id, table_name, part) VALUES ('m_free_xp', 'journal_notes', ''); EXCEPTION WHEN insufficient_privilege THEN v_blocked := TRUE; END;
  IF NOT v_blocked THEN RAISE EXCEPTION 'W4: service role must not add missions'; END IF;
  v_blocked := FALSE;
  BEGIN DELETE FROM public.game_ledger; EXCEPTION WHEN insufficient_privilege THEN v_blocked := TRUE; END;
  IF NOT v_blocked THEN RAISE EXCEPTION 'W5: service role must not delete the ledger'; END IF;
  -- and it cannot become the owner: no API role is a member of it (SET ROLE is checked against the session user, so
  -- the real refusal is tested on PostgreSQL with a login role like Supabase's authenticator: scripts/test-concurrency.sh)
  IF pg_has_role('service_role', 'game_economy_owner', 'MEMBER') OR pg_has_role('authenticated', 'game_economy_owner', 'MEMBER')
     OR pg_has_role('anon', 'game_economy_owner', 'MEMBER') THEN
    RAISE EXCEPTION 'W6: no API role may be a member of the owner role';
  END IF;
END $$;
RESET ROLE;
-- an admin's ad-hoc SQL (not the owner) is refused by the guard; the owner itself cannot update the ledger
DO $$
DECLARE v_err TEXT;
BEGIN
  BEGIN INSERT INTO public.game_ledger (user_id, idempotency_key, kind, rule_code, game_day, xp, coins, rules_version, result)
        VALUES ('00000000-0000-0000-0000-00000000ec01', 'mission:2099-01-01:admin', 'mission', 'mission', current_date, 40, 10, 'q4.1', '{}');
    v_err := 'none';
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM; END;
  IF v_err <> 'game_write_only_through_functions' THEN RAISE EXCEPTION 'W7: ad-hoc insert, got %', v_err; END IF;
  BEGIN UPDATE public.game_profile SET coins = 999999; v_err := 'none'; EXCEPTION WHEN OTHERS THEN v_err := SQLERRM; END;
  IF v_err <> 'game_write_only_through_functions' THEN RAISE EXCEPTION 'W8: ad-hoc projection edit, got %', v_err; END IF;
END $$;
SET LOCAL ROLE game_economy_owner;
DO $$
DECLARE v_err TEXT;
BEGIN
  BEGIN UPDATE public.game_ledger SET xp = 9999; v_err := 'none'; EXCEPTION WHEN OTHERS THEN v_err := SQLERRM; END;
  IF v_err <> 'game_ledger_append_only' THEN RAISE EXCEPTION 'W9: even the owner cannot update the ledger, got %', v_err; END IF;
END $$;
RESET ROLE;

--------------------------------------------------------------------------------
-- 8. DELETE: an unrelated nested trigger cannot erase history; only the account deletion cascade removes it
--------------------------------------------------------------------------------
CREATE TEMP TABLE purge_probe (id INT);
CREATE OR REPLACE FUNCTION pg_temp.purge_ledger() RETURNS TRIGGER AS $$
BEGIN
  DELETE FROM public.game_ledger WHERE user_id = '00000000-0000-0000-0000-00000000ec01';
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER purge_probe_tr AFTER INSERT ON purge_probe FOR EACH ROW EXECUTE FUNCTION pg_temp.purge_ledger();
DO $$
DECLARE v_err TEXT;
BEGIN
  -- nested two levels deep (the old pg_trigger_depth rule would have let this through)
  BEGIN INSERT INTO purge_probe VALUES (1); v_err := 'none'; EXCEPTION WHEN OTHERS THEN v_err := SQLERRM; END;
  IF v_err <> 'game_write_only_through_functions' THEN RAISE EXCEPTION 'DEL1: a nested trigger must not delete history, got %', v_err; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.game_ledger WHERE user_id = '00000000-0000-0000-0000-00000000ec01') THEN
    RAISE EXCEPTION 'DEL2: history must be intact';
  END IF;
END $$;

--------------------------------------------------------------------------------
-- 9. Rebuild: a damaged projection is restored from the ledger
--------------------------------------------------------------------------------
DO $$
DECLARE
  v_good public.game_profile%ROWTYPE;
BEGIN
  SELECT * INTO v_good FROM public.game_profile WHERE user_id = '00000000-0000-0000-0000-00000000ec01';
  IF v_good.xp_total <> (SELECT sum(xp) FROM public.game_ledger WHERE user_id = '00000000-0000-0000-0000-00000000ec01') THEN
    RAISE EXCEPTION 'R0: projection equals ledger';
  END IF;
END $$;
SET LOCAL ROLE game_economy_owner;
UPDATE public.game_profile SET xp_total = 7, coins = 3, level = 1 WHERE user_id = '00000000-0000-0000-0000-00000000ec01';
RESET ROLE;
SET LOCAL ROLE service_role;
DO $$
DECLARE
  v_r JSONB;
  v_after public.game_profile%ROWTYPE;
BEGIN
  v_r := public.game_rebuild_profile('00000000-0000-0000-0000-00000000ec01');
  SELECT * INTO v_after FROM public.game_profile WHERE user_id = '00000000-0000-0000-0000-00000000ec01';
  IF NOT (v_r ->> 'changed')::boolean OR v_after.xp_total <> 120 OR v_after.coins <> 30 OR v_after.level <> 2 THEN
    RAISE EXCEPTION 'R1: rebuild must restore 120 / 30 / 2, got %', row_to_json(v_after);
  END IF;
END $$;
RESET ROLE;

--------------------------------------------------------------------------------
-- 10. Game day by the account zone; account deletion removes everything (cascade runs as the owner)
--------------------------------------------------------------------------------
DO $$
BEGIN
  IF public.game_day_for('00000000-0000-0000-0000-00000000ec01', '2026-11-20T21:30:00Z') <> '2026-11-21'::date THEN
    RAISE EXCEPTION 'D1: 21:30 UTC is the next day in Tbilisi';
  END IF;
  IF public.game_day_for('00000000-0000-0000-0000-00000000ec02', '2026-11-20T21:30:00Z') <> '2026-11-20'::date THEN
    RAISE EXCEPTION 'D2: UTC account stays on the same day';
  END IF;
  DELETE FROM auth.users WHERE id = '00000000-0000-0000-0000-00000000ec01';
  IF EXISTS (SELECT 1 FROM public.game_ledger WHERE user_id = '00000000-0000-0000-0000-00000000ec01')
     OR EXISTS (SELECT 1 FROM public.game_profile WHERE user_id = '00000000-0000-0000-0000-00000000ec01')
     OR EXISTS (SELECT 1 FROM public.game_source_claims WHERE user_id = '00000000-0000-0000-0000-00000000ec01')
     OR EXISTS (SELECT 1 FROM public.game_accounts WHERE user_id = '00000000-0000-0000-0000-00000000ec01') THEN
    RAISE EXCEPTION 'D3: account deletion must remove the ledger, projection, claims and state';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.game_ledger WHERE user_id = '00000000-0000-0000-0000-00000000ec02') THEN
    RAISE EXCEPTION 'D4: other accounts keep their history';
  END IF;
END $$;

ROLLBACK;
