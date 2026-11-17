-- AYRA Trading — tests for 0014 (server economy schema, Q4.1). Run on a TEST database; everything is rolled back.
-- Every check raises an exception when it fails, so a clean run means all passed.
BEGIN;

-- Users: A (Tbilisi), B (UTC). Profiles come from the sign-up trigger (0001/0002).
INSERT INTO auth.users (id, email) VALUES
  ('00000000-0000-0000-0000-00000000ec01', 'eco-a@example.com'),
  ('00000000-0000-0000-0000-00000000ec02', 'eco-b@example.com')
ON CONFLICT (id) DO NOTHING;
UPDATE public.profiles SET timezone = 'Asia/Tbilisi' WHERE id = '00000000-0000-0000-0000-00000000ec01';
-- As in Supabase, the service role (the server route) may read the Journal to build the evidence it checked; the PGlite
-- stub has no such default grants. Rolled back with the test.
GRANT SELECT ON public.journal_notes TO service_role;

-- Journal notes in the cloud: A has two, B has one (evidence for missions)
INSERT INTO public.journal_notes (user_id, id, data) VALUES
  ('00000000-0000-0000-0000-00000000ec01', 'n_a1', '{"id":"n_a1","templateKey":"lesson","body":"Урок: жду закрытия свечи над уровнем и только потом вхожу по плану.","createdAt":"2026-11-01T10:00:00Z","updatedAt":"2026-11-01T10:00:00Z"}'),
  ('00000000-0000-0000-0000-00000000ec01', 'n_a2', '{"id":"n_a2","templateKey":"lesson","body":"Урок два: стоп за структурой, размер позиции от стопа.","createdAt":"2026-11-01T11:00:00Z","updatedAt":"2026-11-01T11:00:00Z"}'),
  ('00000000-0000-0000-0000-00000000ec02', 'n_b1', '{"id":"n_b1","templateKey":"lesson","body":"Урок B.","createdAt":"2026-11-01T10:00:00Z","updatedAt":"2026-11-01T10:00:00Z"}');

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
  BEGIN PERFORM public.game_apply_reward('00000000-0000-0000-0000-00000000ec01', 'mission:2026-11-20:q_bias', 'mission');
  EXCEPTION WHEN insufficient_privilege THEN v_blocked := TRUE; END;
  IF NOT v_blocked THEN RAISE EXCEPTION 'AN3: anon must not call the award'; END IF;
  v_blocked := FALSE;
  BEGIN PERFORM public.game_account_status(); EXCEPTION WHEN insufficient_privilege THEN v_blocked := TRUE; END;
  IF NOT v_blocked THEN RAISE EXCEPTION 'AN4: anon has no status'; END IF;
END $$;
RESET ROLE;

--------------------------------------------------------------------------------
-- 2. Service: the state machine. «local» gets nothing; migration_pending gets nothing; cloud_active + flag gets awards
--------------------------------------------------------------------------------
SET LOCAL ROLE service_role;
DO $$
DECLARE
  c_a CONSTANT UUID := '00000000-0000-0000-0000-00000000ec01';
  c_b CONSTANT UUID := '00000000-0000-0000-0000-00000000ec02';
  v_err TEXT;
BEGIN
  -- no account row = local: refused
  BEGIN PERFORM public.game_apply_reward(c_a, 'daily:2026-11-20', 'daily_reward_1'); v_err := 'none';
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM; END;
  IF v_err <> 'game_account_not_active' THEN RAISE EXCEPTION 'S1: local account must get nothing, got %', v_err; END IF;

  IF public.game_begin_migration(c_a) <> 'migration_pending' THEN RAISE EXCEPTION 'S2: begin migration'; END IF;
  BEGIN PERFORM public.game_apply_reward(c_a, 'daily:2026-11-20', 'daily_reward_1'); v_err := 'none';
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM; END;
  IF v_err <> 'game_account_not_active' THEN RAISE EXCEPTION 'S3: pending account must get nothing, got %', v_err; END IF;

  IF public.game_activate_cloud(c_a) <> 'cloud_active' THEN RAISE EXCEPTION 'S4: activate'; END IF;
  IF public.game_activate_cloud(c_a) <> 'cloud_active' THEN RAISE EXCEPTION 'S5: activate is idempotent'; END IF;
  -- flag off: paused, never back to local
  BEGIN PERFORM public.game_apply_reward(c_a, 'daily:2026-11-20', 'daily_reward_1'); v_err := 'none';
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM; END;
  IF v_err <> 'game_sync_paused' THEN RAISE EXCEPTION 'S6: flag off must pause, got %', v_err; END IF;

  -- one way: cloud_active never goes back (even for the service)
  BEGIN UPDATE public.game_accounts SET state = 'local' WHERE user_id = c_a; v_err := 'none';
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM; END;
  IF v_err <> 'game_state_one_way' THEN RAISE EXCEPTION 'S7: cloud_active must be one way, got %', v_err; END IF;
  -- begin migration on an active account changes nothing
  IF public.game_begin_migration(c_a) <> 'cloud_active' THEN RAISE EXCEPTION 'S8: begin on active must keep it'; END IF;

  -- B: activated too (for cross-user checks); both flags on
  PERFORM public.game_begin_migration(c_b);
  PERFORM public.game_activate_cloud(c_b);
END $$;
RESET ROLE;
INSERT INTO public.user_features (user_id, game_sync) VALUES
  ('00000000-0000-0000-0000-00000000ec01', TRUE), ('00000000-0000-0000-0000-00000000ec02', TRUE)
ON CONFLICT (user_id) DO UPDATE SET game_sync = TRUE;

--------------------------------------------------------------------------------
-- 3. Service: awards — amounts from the rules, repeats, evidence (TOCTOU), sources, caps, days
--------------------------------------------------------------------------------
SET LOCAL ROLE service_role;
DO $$
DECLARE
  c_a CONSTANT UUID := '00000000-0000-0000-0000-00000000ec01';
  c_b CONSTANT UUID := '00000000-0000-0000-0000-00000000ec02';
  v_day DATE := public.game_day_for('00000000-0000-0000-0000-00000000ec01');
  v_ev1 JSONB;
  v_ev2 JSONB;
  v_r JSONB;
  v_r2 JSONB;
  v_err TEXT;
  v_n INT;
  v_p public.game_profile%ROWTYPE;
BEGIN
  SELECT jsonb_build_array(jsonb_build_object('table', 'journal_notes', 'id', id, 'version', client_updated_at, 'fp', md5(data::text), 'source_key', 'note:' || id))
    INTO v_ev1 FROM public.journal_notes WHERE user_id = c_a AND id = 'n_a1';
  SELECT jsonb_build_array(jsonb_build_object('table', 'journal_notes', 'id', id, 'version', client_updated_at, 'fp', md5(data::text), 'source_key', 'note:' || id))
    INTO v_ev2 FROM public.journal_notes WHERE user_id = c_a AND id = 'n_a2';

  -- 3.1 a mission: 40 XP + 10 Coins from the rule
  v_r := public.game_apply_reward(c_a, 'mission:' || v_day || ':m_lesson', 'mission', v_ev1);
  IF (v_r ->> 'xp')::int <> 40 OR (v_r ->> 'coins')::int <> 10 OR (v_r ->> 'replay')::boolean THEN
    RAISE EXCEPTION 'T1: mission must pay 40/10 once: %', v_r;
  END IF;

  -- 3.2 the same key again (second tab, device, retry): the saved result, nothing more
  v_r2 := public.game_apply_reward(c_a, 'mission:' || v_day || ':m_lesson', 'mission', v_ev1);
  IF NOT (v_r2 ->> 'replay')::boolean OR (v_r2 - 'replay') <> (v_r - 'replay') THEN RAISE EXCEPTION 'T2: repeat must return the saved result: %', v_r2; END IF;
  SELECT count(*) INTO v_n FROM public.game_ledger WHERE user_id = c_a;
  SELECT * INTO v_p FROM public.game_profile WHERE user_id = c_a;
  IF v_n <> 1 OR v_p.xp_total <> 40 OR v_p.coins <> 10 OR v_p.version <> 1 THEN
    RAISE EXCEPTION 'T3: one ledger row and one projection update: rows % xp % coins % version %', v_n, v_p.xp_total, v_p.coins, v_p.version;
  END IF;

  -- 3.3 the same key with another rule (a client trying a bigger reward under a paid key): refused
  BEGIN PERFORM public.game_apply_reward(c_a, 'mission:' || v_day || ':m_lesson', 'pq_gold_app', v_ev1); v_err := 'none';
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM; END;
  IF v_err <> 'game_key_conflict' THEN RAISE EXCEPTION 'T4: key reuse with another rule, got %', v_err; END IF;

  -- 3.4 an amount that is not a rule: refused (there is no «xp» parameter at all)
  BEGIN PERFORM public.game_apply_reward(c_a, 'mission:' || v_day || ':x', 'mission_9999', v_ev2); v_err := 'none';
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM; END;
  IF v_err <> 'game_unknown_rule' THEN RAISE EXCEPTION 'T5: unknown rule, got %', v_err; END IF;

  -- 3.5 one record pays one mission a day, whatever key a device invents
  BEGIN PERFORM public.game_apply_reward(c_a, 'mission:' || v_day || ':m_observation', 'mission', v_ev1); v_err := 'none';
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM; END;
  IF v_err <> 'game_source_used' THEN RAISE EXCEPTION 'T6: a record must pay once, got %', v_err; END IF;

  -- 3.6 evidence of another user: not found for this user
  BEGIN PERFORM public.game_apply_reward(c_a, 'mission:' || v_day || ':m_b',
      'mission', (SELECT jsonb_build_array(jsonb_build_object('table','journal_notes','id',id,'version',client_updated_at,'fp',md5(data::text))) FROM public.journal_notes WHERE id = 'n_b1'));
    v_err := 'none';
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM; END;
  IF v_err <> 'game_evidence_missing' THEN RAISE EXCEPTION 'T7: another user''s record must not count, got %', v_err; END IF;

  -- 3.7 evidence of a table outside the list: refused
  BEGIN PERFORM public.game_apply_reward(c_a, 'mission:' || v_day || ':m_p', 'mission', '[{"table":"profiles","id":"x","version":"2026-11-01T10:00:00Z","fp":"x"}]'); v_err := 'none';
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM; END;
  IF v_err <> 'game_bad_evidence' THEN RAISE EXCEPTION 'T8: evidence table outside the list, got %', v_err; END IF;

  -- 3.8 a level-up in the same transaction: Gold app 250 → total 290 → level 3 (120 to reach 2, 160 more to reach 3)
  v_r := public.game_apply_reward(c_a, 'pq:run_gold_1', 'pq_gold_app');
  IF (v_r ->> 'level_before')::int <> 1 OR (v_r ->> 'level_after')::int <> 3 OR (v_r ->> 'xp_total')::int <> 290 THEN
    RAISE EXCEPTION 'T9: level-up in the award: %', v_r;
  END IF;
  -- paid once per run: the same run again is a replay
  IF NOT (public.game_apply_reward(c_a, 'pq:run_gold_1', 'pq_gold_app') ->> 'replay')::boolean THEN RAISE EXCEPTION 'T10: a run pays once'; END IF;

  -- 3.9 self-reports: 45 + 45 reach the 90 XP cap; the next one gives 0 XP (cut, not refused)
  PERFORM public.game_apply_reward(c_a, 'self:' || v_day || ':q_gym', 'self_report_45');
  PERFORM public.game_apply_reward(c_a, 'self:' || v_day || ':q_walk', 'self_report_45');
  v_r := public.game_apply_reward(c_a, 'self:' || v_day || ':q_sleep', 'self_report_25');
  IF (v_r ->> 'xp')::int <> 0 THEN RAISE EXCEPTION 'T11: self-report cap 90 XP a day: %', v_r; END IF;

  -- 3.10 a game day in the future or in the past (window 0): refused
  BEGIN PERFORM public.game_apply_reward(c_a, 'daily:' || (v_day + 1), 'daily_reward_1', '[]', v_day + 1); v_err := 'none';
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM; END;
  IF v_err <> 'game_day_not_open' THEN RAISE EXCEPTION 'T12: tomorrow must be refused, got %', v_err; END IF;
  BEGIN PERFORM public.game_apply_reward(c_a, 'daily:' || (v_day - 1), 'daily_reward_1', '[]', v_day - 1); v_err := 'none';
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM; END;
  IF v_err <> 'game_day_not_open' THEN RAISE EXCEPTION 'T13: yesterday outside the window must be refused, got %', v_err; END IF;

  -- 3.11 the daily reward once a day (count cap), whatever key
  PERFORM public.game_apply_reward(c_a, 'daily:' || v_day, 'daily_reward_7');
  BEGIN PERFORM public.game_apply_reward(c_a, 'daily:' || v_day || ':again', 'daily_reward_7'); v_err := 'none';
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM; END;
  IF v_err <> 'game_day_cap' THEN RAISE EXCEPTION 'T14: daily reward once a day, got %', v_err; END IF;
END $$;
RESET ROLE;

--------------------------------------------------------------------------------
-- 4. TOCTOU: the Journal record changes between the route's check and the award
--------------------------------------------------------------------------------
DO $$
DECLARE
  c_a CONSTANT UUID := '00000000-0000-0000-0000-00000000ec01';
  v_day DATE := public.game_day_for('00000000-0000-0000-0000-00000000ec01');
  v_ev JSONB;
  v_err TEXT;
BEGIN
  -- the route read n_a2 and checked it …
  SELECT jsonb_build_array(jsonb_build_object('table','journal_notes','id',id,'version',client_updated_at,'fp',md5(data::text),'source_key','note:'||id))
    INTO v_ev FROM public.journal_notes WHERE user_id = c_a AND id = 'n_a2';
  -- … then the text is cut short with the SAME updatedAt (the Journal accepts it as a retry)
  UPDATE public.journal_notes SET data = jsonb_set(data, '{body}', '"x"') WHERE user_id = c_a AND id = 'n_a2';
  SET LOCAL ROLE service_role;
  BEGIN PERFORM public.game_apply_reward(c_a, 'mission:' || v_day || ':m_lesson2', 'mission', v_ev); v_err := 'none';
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM; END;
  RESET ROLE;
  IF v_err <> 'game_evidence_changed' THEN RAISE EXCEPTION 'X1: same version, other content must be refused, got %', v_err; END IF;

  -- a newer version (edited later): refused
  SELECT jsonb_build_array(jsonb_build_object('table','journal_notes','id',id,'version',client_updated_at,'fp',md5(data::text)))
    INTO v_ev FROM public.journal_notes WHERE user_id = c_a AND id = 'n_a2';
  UPDATE public.journal_notes SET data = data || '{"updatedAt":"2026-11-01T12:00:00Z"}' WHERE user_id = c_a AND id = 'n_a2';
  SET LOCAL ROLE service_role;
  BEGIN PERFORM public.game_apply_reward(c_a, 'mission:' || v_day || ':m_lesson2', 'mission', v_ev); v_err := 'none';
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM; END;
  RESET ROLE;
  IF v_err <> 'game_evidence_changed' THEN RAISE EXCEPTION 'X2: a newer version must be refused, got %', v_err; END IF;

  -- deleted (tombstone): refused
  SELECT jsonb_build_array(jsonb_build_object('table','journal_notes','id',id,'version',client_updated_at,'fp',md5(data::text)))
    INTO v_ev FROM public.journal_notes WHERE user_id = c_a AND id = 'n_a2';
  UPDATE public.journal_notes SET data = data || '{"deletedAt":"2026-11-01T12:00:00Z"}' WHERE user_id = c_a AND id = 'n_a2';
  SET LOCAL ROLE service_role;
  BEGIN PERFORM public.game_apply_reward(c_a, 'mission:' || v_day || ':m_lesson2', 'mission', v_ev); v_err := 'none';
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM; END;
  RESET ROLE;
  IF v_err NOT IN ('game_evidence_changed') THEN RAISE EXCEPTION 'X3: a deleted record must be refused, got %', v_err; END IF;
  -- nothing was written by the refused calls
  IF EXISTS (SELECT 1 FROM public.game_ledger WHERE user_id = c_a AND idempotency_key LIKE '%m_lesson2') THEN
    RAISE EXCEPTION 'X4: a refused award must leave nothing';
  END IF;
END $$;

--------------------------------------------------------------------------------
-- 5. Authenticated user A: reads only own rows, cannot write or call anything that gives
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

  -- direct INSERT of a paid row (XP, Coins, a mission, an achievement, a paid personal quest): refused
  v_blocked := FALSE;
  BEGIN INSERT INTO public.game_ledger (user_id, idempotency_key, kind, rule_code, game_day, xp, coins, rules_version, result)
        VALUES (c_a::uuid, 'pq:forged', 'personal_quest', 'pq_gold_app', current_date, 250, 0, 'q4.1', '{}');
  EXCEPTION WHEN insufficient_privilege THEN v_blocked := TRUE; END;
  IF NOT v_blocked THEN RAISE EXCEPTION 'U4: direct ledger insert must fail'; END IF;
  -- … with another user's id: refused
  v_blocked := FALSE;
  BEGIN INSERT INTO public.game_ledger (user_id, idempotency_key, kind, rule_code, game_day, xp, coins, rules_version, result)
        VALUES (c_b, 'mission:forged', 'mission', 'mission', current_date, 40, 10, 'q4.1', '{}');
  EXCEPTION WHEN insufficient_privilege THEN v_blocked := TRUE; END;
  IF NOT v_blocked THEN RAISE EXCEPTION 'U5: insert for another user must fail'; END IF;
  -- UPDATE XP / Coins / level / state; DELETE ledger: refused
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
  BEGIN INSERT INTO public.game_source_claims (user_id, scope, source_key, game_day, ledger_id) VALUES (c_a::uuid, 'mission', 'note:x', current_date, 1);
  EXCEPTION WHEN insufficient_privilege THEN v_blocked := TRUE; END;
  IF NOT v_blocked THEN RAISE EXCEPTION 'U10: claim insert must fail'; END IF;
  v_blocked := FALSE;
  BEGIN UPDATE public.game_reward_rules SET xp = 1000 WHERE code = 'mission'; EXCEPTION WHEN insufficient_privilege THEN v_blocked := TRUE; END;
  IF NOT v_blocked THEN RAISE EXCEPTION 'U11: rules update must fail'; END IF;
  -- the award functions are not callable by a signed-in user (only the server route)
  v_blocked := FALSE;
  BEGIN PERFORM public.game_apply_reward(c_a::uuid, 'daily:x', 'daily_reward_7'); EXCEPTION WHEN insufficient_privilege THEN v_blocked := TRUE; END;
  IF NOT v_blocked THEN RAISE EXCEPTION 'U12: user must not call the award'; END IF;
  v_blocked := FALSE;
  BEGIN PERFORM public.game_activate_cloud(c_a::uuid); EXCEPTION WHEN insufficient_privilege THEN v_blocked := TRUE; END;
  IF NOT v_blocked THEN RAISE EXCEPTION 'U13: user must not change the state'; END IF;
  v_blocked := FALSE;
  BEGIN PERFORM public.game_rebuild_profile(c_a::uuid); EXCEPTION WHEN insufficient_privilege THEN v_blocked := TRUE; END;
  IF NOT v_blocked THEN RAISE EXCEPTION 'U14: user must not rebuild'; END IF;
END $$;
-- B sees nothing of A
DO $$
DECLARE v_n INT;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000ec02', true);
  SELECT count(*) INTO v_n FROM public.game_ledger WHERE user_id = '00000000-0000-0000-0000-00000000ec01';
  IF v_n <> 0 THEN RAISE EXCEPTION 'U15: B must not see A''s ledger'; END IF;
  SELECT count(*) INTO v_n FROM public.game_profile WHERE user_id = '00000000-0000-0000-0000-00000000ec01';
  IF v_n <> 0 THEN RAISE EXCEPTION 'U16: B must not see A''s projection'; END IF;
END $$;
RESET ROLE;

--------------------------------------------------------------------------------
-- 6. Even the service (RLS bypass) cannot edit history or the projection by hand
--------------------------------------------------------------------------------
SET LOCAL ROLE service_role;
DO $$
DECLARE v_err TEXT;
BEGIN
  BEGIN UPDATE public.game_ledger SET xp = 9999; v_err := 'none'; EXCEPTION WHEN OTHERS THEN v_err := SQLERRM; END;
  IF v_err <> 'game_ledger_append_only' THEN RAISE EXCEPTION 'V1: ledger update, got %', v_err; END IF;
  BEGIN DELETE FROM public.game_ledger; v_err := 'none'; EXCEPTION WHEN OTHERS THEN v_err := SQLERRM; END;
  IF v_err <> 'game_ledger_append_only' THEN RAISE EXCEPTION 'V2: ledger delete, got %', v_err; END IF;
  BEGIN INSERT INTO public.game_ledger (user_id, idempotency_key, kind, rule_code, game_day, xp, coins, rules_version, result)
        VALUES ('00000000-0000-0000-0000-00000000ec01', 'adjustment:hand', 'mission', 'mission', current_date, 40, 10, 'q4.1', '{}');
    v_err := 'none';
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM; END;
  IF v_err <> 'game_write_only_through_functions' THEN RAISE EXCEPTION 'V3: hand insert, got %', v_err; END IF;
  BEGIN UPDATE public.game_profile SET coins = 999999; v_err := 'none'; EXCEPTION WHEN OTHERS THEN v_err := SQLERRM; END;
  IF v_err <> 'game_write_only_through_functions' THEN RAISE EXCEPTION 'V4: hand projection edit, got %', v_err; END IF;
END $$;
RESET ROLE;

--------------------------------------------------------------------------------
-- 7. Rebuild: a damaged projection is restored from the ledger
--------------------------------------------------------------------------------
DO $$
DECLARE
  c_a CONSTANT UUID := '00000000-0000-0000-0000-00000000ec01';
  v_good public.game_profile%ROWTYPE;
  v_after public.game_profile%ROWTYPE;
  v_r JSONB;
BEGIN
  SELECT * INTO v_good FROM public.game_profile WHERE user_id = c_a;
  IF v_good.xp_total <> (SELECT sum(xp) FROM public.game_ledger WHERE user_id = c_a) THEN RAISE EXCEPTION 'R0: projection equals ledger'; END IF;
  -- damage it (as a broken script would, with the writer mark set)
  PERFORM set_config('ayra.game_writer', 'on', true);
  UPDATE public.game_profile SET xp_total = 7, coins = 3, level = 1 WHERE user_id = c_a;
  PERFORM set_config('ayra.game_writer', '', true);
  v_r := public.game_rebuild_profile(c_a);
  SELECT * INTO v_after FROM public.game_profile WHERE user_id = c_a;
  IF NOT (v_r ->> 'changed')::boolean OR v_after.xp_total <> v_good.xp_total OR v_after.coins <> v_good.coins OR v_after.level <> v_good.level THEN
    RAISE EXCEPTION 'R1: rebuild must restore % / % / %, got %', v_good.xp_total, v_good.coins, v_good.level, row_to_json(v_after);
  END IF;
END $$;

--------------------------------------------------------------------------------
-- 8. Game day by the account zone; account deletion removes everything (cascade passes the append-only guard)
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
     OR EXISTS (SELECT 1 FROM public.game_source_claims WHERE user_id = '00000000-0000-0000-0000-00000000ec01') THEN
    RAISE EXCEPTION 'D3: account deletion must remove the ledger, projection and claims';
  END IF;
END $$;

ROLLBACK;
