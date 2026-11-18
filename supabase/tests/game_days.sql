-- AYRA Trading — tests for 0015 (server game day, Q4.3). Run on a TEST database after 0014 + 0015; everything is
-- rolled back. Times are given to the owner-only «_at» variants (the API uses now()); every check raises when it fails.
BEGIN;

INSERT INTO auth.users (id, email) VALUES
  ('00000000-0000-0000-0000-0000000da701', 'day-a@example.com'),
  ('00000000-0000-0000-0000-0000000da702', 'day-b@example.com'),
  ('00000000-0000-0000-0000-0000000da703', 'day-c@example.com')
ON CONFLICT (id) DO NOTHING;
UPDATE public.profiles SET timezone = 'UTC' WHERE id = '00000000-0000-0000-0000-0000000da701';
UPDATE public.profiles SET timezone = 'Asia/Tbilisi' WHERE id = '00000000-0000-0000-0000-0000000da702';
GRANT SELECT ON public.journal_notes, public.journal_day_plans, public.journal_trades TO service_role;

-- Journal evidence (written in the past: the 0004 trigger refuses records from the future)
INSERT INTO public.journal_notes (user_id, id, data) VALUES
  ('00000000-0000-0000-0000-0000000da701', 'n1', '{"id":"n1","templateKey":"lesson","body":"Урок один.","createdAt":"2026-11-01T10:00:00Z","updatedAt":"2026-11-01T10:00:00Z"}'),
  ('00000000-0000-0000-0000-0000000da701', 'n2', '{"id":"n2","templateKey":"idea","body":"Наблюдение.","createdAt":"2026-11-01T11:00:00Z","updatedAt":"2026-11-01T11:00:00Z"}'),
  ('00000000-0000-0000-0000-0000000da701', 'n3', '{"id":"n3","templateKey":"lesson","body":"Урок три.","createdAt":"2026-11-01T12:00:00Z","updatedAt":"2026-11-01T12:00:00Z"}'),
  ('00000000-0000-0000-0000-0000000da701', 'n4', '{"id":"n4","templateKey":"lesson","body":"Урок четыре.","createdAt":"2026-11-01T13:00:00Z","updatedAt":"2026-11-01T13:00:00Z"}');
INSERT INTO public.journal_day_plans (user_id, id, data) VALUES
  ('00000000-0000-0000-0000-0000000da701', '2026-11-20', '{"date":"2026-11-20","createdAt":"2026-11-01T07:00:00Z","updatedAt":"2026-11-01T07:00:00Z"}');
-- B has a trade written before the days tested: its study day starts with «Trade review»
INSERT INTO public.journal_trades (user_id, id, data) VALUES
  ('00000000-0000-0000-0000-0000000da702', 't1', '{"id":"t1","accountId":"acc1","instrument":"EURUSD","direction":"long","result":"win","createdAt":"2026-11-01T09:00:00Z","openedAt":"2026-11-01T09:00:00Z","updatedAt":"2026-11-01T09:00:00Z"}');

CREATE OR REPLACE FUNCTION pg_temp.ev(p_table TEXT, p_user UUID, p_id TEXT) RETURNS JSONB AS $$
DECLARE v JSONB;
BEGIN
  EXECUTE format('SELECT jsonb_build_array(jsonb_build_object(''table'', %L, ''id'', id, ''version'', client_updated_at, ''fp'', md5(data::text))) FROM public.%I WHERE user_id = $1 AND id = $2', p_table, p_table)
    INTO v USING p_user, p_id;
  RETURN v;
END $$ LANGUAGE plpgsql;
-- the error text of a call (or 'ok')
CREATE OR REPLACE FUNCTION pg_temp.err(p_sql TEXT) RETURNS TEXT AS $$
BEGIN
  EXECUTE p_sql;
  RETURN 'ok';
EXCEPTION WHEN OTHERS THEN
  RETURN SQLERRM;
END $$ LANGUAGE plpgsql;

--------------------------------------------------------------------------------
-- 1. Only accounts on the server economy have a server day
--------------------------------------------------------------------------------
DO $$
BEGIN
  IF pg_temp.err($q$SELECT public.game_day_open_at('00000000-0000-0000-0000-0000000da701', 'study', '{}', '2026-11-20T10:00:00Z')$q$) <> 'game_account_not_active' THEN
    RAISE EXCEPTION 'A1: a local account has no server day';
  END IF;
  PERFORM public.game_begin_migration('00000000-0000-0000-0000-0000000da701');
  IF pg_temp.err($q$SELECT public.game_day_open_at('00000000-0000-0000-0000-0000000da701', 'study', '{}', '2026-11-20T10:00:00Z')$q$) <> 'game_account_not_active' THEN
    RAISE EXCEPTION 'A2: a migrating account has no server day';
  END IF;
  PERFORM public.game_activate_cloud('00000000-0000-0000-0000-0000000da701');
  PERFORM public.game_begin_migration('00000000-0000-0000-0000-0000000da702');
  PERFORM public.game_activate_cloud('00000000-0000-0000-0000-0000000da702');
  PERFORM public.game_begin_migration('00000000-0000-0000-0000-0000000da703');
  PERFORM public.game_activate_cloud('00000000-0000-0000-0000-0000000da703');
END $$;
SET LOCAL ROLE game_economy_owner;
UPDATE public.game_award_kinds SET enabled = TRUE WHERE kind = 'mission';
RESET ROLE;
INSERT INTO public.user_features (user_id, game_sync) VALUES
  ('00000000-0000-0000-0000-0000000da701', TRUE), ('00000000-0000-0000-0000-0000000da702', TRUE), ('00000000-0000-0000-0000-0000000da703', TRUE)
ON CONFLICT (user_id) DO UPDATE SET game_sync = TRUE;

--------------------------------------------------------------------------------
-- 2. Opening the day: one row whatever the devices; the set of the mode; the study choice made once
--------------------------------------------------------------------------------
DO $$
DECLARE
  c_a CONSTANT UUID := '00000000-0000-0000-0000-0000000da701';
  c_b CONSTANT UUID := '00000000-0000-0000-0000-0000000da702';
  v JSONB;
  v2 JSONB;
BEGIN
  v := public.game_day_open_at(c_a, 'study', '{q_read_pages,q_walk}', '2026-11-20T10:00:00Z');
  IF NOT (v ->> 'opened')::boolean OR v ->> 'game_day' <> '2026-11-20' OR v -> 'core' <> '["m_observation","m_backtest","m_lesson"]'::jsonb
     OR v ->> 'study_first' <> 'm_observation' OR v -> 'bonus' <> '["q_read_pages","q_walk"]'::jsonb THEN
    RAISE EXCEPTION 'O1: study day without trades: %', v;
  END IF;
  -- a second device opens the same day (other mode, other extras): the day already exists and does not change
  v2 := public.game_day_open_at(c_a, 'trading', '{q_meditate}', '2026-11-20T10:01:00Z');
  IF (v2 ->> 'opened')::boolean OR v2 -> 'core' <> v -> 'core' OR v2 ->> 'mode' <> 'study' OR v2 -> 'bonus' <> v -> 'bonus' THEN
    RAISE EXCEPTION 'O2: the second device gets the same day: %', v2;
  END IF;
  IF (SELECT count(*) FROM public.game_days WHERE user_id = c_a) <> 1 THEN RAISE EXCEPTION 'O3: one row'; END IF;
  -- B wrote a trade before: «Trade review» (21:30 UTC is already the 21st in Tbilisi)
  v := public.game_day_open_at(c_b, 'study', '{}', '2026-11-20T21:30:00Z');
  IF v ->> 'game_day' <> '2026-11-21' OR v ->> 'study_first' <> 'm_trade_review' OR v -> 'core' ->> 0 <> 'm_trade_review' THEN
    RAISE EXCEPTION 'O4: study choice from the cloud journal, day in the account zone: %', v;
  END IF;
  -- bad requests: a mode that cannot start a day, a mission given as an extra, a repeated extra, too many extras, no time
  IF pg_temp.err(format($q$SELECT public.game_day_open_at(%L, 'rest', '{}', '2026-11-20T10:00:00Z')$q$, c_a)) <> 'game_bad_request'
     OR pg_temp.err(format($q$SELECT public.game_day_open_at(%L, 'study', '{m_lesson}', '2026-11-20T10:00:00Z')$q$, c_a)) <> 'game_bad_request'
     OR pg_temp.err(format($q$SELECT public.game_day_open_at(%L, 'study', '{q_walk,q_walk}', '2026-11-20T10:00:00Z')$q$, c_a)) <> 'game_bad_request'
     OR pg_temp.err(format($q$SELECT public.game_day_open_at(%L, 'study', '{q_a1,q_a2,q_a3,q_a4,q_a5}', '2026-11-20T10:00:00Z')$q$, c_a)) <> 'game_bad_request'
     OR pg_temp.err(format($q$SELECT public.game_day_open_at(%L, 'study', '{}', NULL)$q$, c_a)) <> 'game_bad_request' THEN
    RAISE EXCEPTION 'O5: bad opening requests must be refused';
  END IF;
END $$;

--------------------------------------------------------------------------------
-- 3. Acceptance and the award: assigned, accepted, once; a repeat changes nothing
--------------------------------------------------------------------------------
DO $$
DECLARE
  c_a CONSTANT UUID := '00000000-0000-0000-0000-0000000da701';
  v JSONB;
  v2 JSONB;
BEGIN
  IF pg_temp.err(format($q$SELECT public.game_day_accept_at(%L, 'q_bias', '2026-11-20T10:02:00Z')$q$, c_a)) <> 'game_mission_not_assigned' THEN
    RAISE EXCEPTION 'M1: a mission of another mode cannot be accepted';
  END IF;
  v := public.game_day_accept_at(c_a, 'm_lesson', '2026-11-20T10:03:00Z');
  v2 := public.game_day_accept_at(c_a, 'm_lesson', '2026-11-20T10:09:00Z');
  IF (v ->> 'repeat')::boolean OR NOT (v2 ->> 'repeat')::boolean OR v2 ->> 'accepted_at' <> v ->> 'accepted_at' THEN
    RAISE EXCEPTION 'M2: accepting again keeps the first time: % %', v, v2;
  END IF;
  -- the award needs the mission accepted and in today's set
  IF pg_temp.err(format($q$SELECT public.game_apply_reward_at(%L, 'mission', 'm_observation', pg_temp.ev('journal_notes', %L, 'n2'), '2026-11-20T10:10:00Z')$q$, c_a, c_a)) <> 'game_mission_not_accepted' THEN
    RAISE EXCEPTION 'M3: not accepted';
  END IF;
  IF pg_temp.err(format($q$SELECT public.game_apply_reward_at(%L, 'mission', 'q_bias', pg_temp.ev('journal_day_plans', %L, '2026-11-20'), '2026-11-20T10:10:00Z')$q$, c_a, c_a)) <> 'game_mission_not_assigned' THEN
    RAISE EXCEPTION 'M4: not in the set';
  END IF;
  v := public.game_apply_reward_at(c_a, 'mission', 'm_lesson', pg_temp.ev('journal_notes', c_a, 'n1'), '2026-11-20T10:11:00Z');
  IF (v ->> 'xp')::int <> 40 OR v ->> 'game_day' <> '2026-11-20' THEN RAISE EXCEPTION 'M5: paid: %', v; END IF;
  -- the same mission from a second device: the saved result, nothing more
  v2 := public.game_apply_reward_at(c_a, 'mission', 'm_lesson', pg_temp.ev('journal_notes', c_a, 'n3'), '2026-11-20T10:12:00Z');
  IF NOT (v2 ->> 'replay')::boolean OR (SELECT xp_total FROM public.game_profile WHERE user_id = c_a) <> 40 THEN
    RAISE EXCEPTION 'M6: one mission on two devices pays once: %', v2;
  END IF;
  IF pg_temp.err(format($q$SELECT public.game_day_accept_at(%L, 'm_lesson', '2026-11-20T10:13:00Z')$q$, c_a)) <> 'game_mission_paid' THEN
    RAISE EXCEPTION 'M7: a paid mission is not accepted again';
  END IF;
  v := public.game_mission_status_at(c_a, 'm_lesson', '2026-11-20T10:14:00Z');
  IF NOT (v ->> 'paid')::boolean OR NOT (v ->> 'assigned')::boolean OR NOT (v ->> 'accepted')::boolean OR (v ->> 'day_full')::boolean THEN
    RAISE EXCEPTION 'M8: status after payment: %', v;
  END IF;
  -- a refused award (the record changed meanwhile) changes nothing in the day
  UPDATE public.journal_notes SET data = jsonb_set(data, '{body}', '"Другое."') WHERE user_id = c_a AND id = 'n2';
  PERFORM public.game_day_accept_at(c_a, 'm_observation', '2026-11-20T10:15:00Z');
  v := (SELECT to_jsonb(d) FROM public.game_days d WHERE user_id = c_a AND game_day = '2026-11-20');
  IF pg_temp.err(format($q$SELECT public.game_apply_reward_at(%L, 'mission', 'm_observation', '[{"table":"journal_notes","id":"n2","version":"2026-11-01T11:00:00Z","fp":"stale"}]', '2026-11-20T10:16:00Z')$q$, c_a)) <> 'game_evidence_changed'
     OR (SELECT to_jsonb(d) FROM public.game_days d WHERE user_id = c_a AND game_day = '2026-11-20') <> v
     OR (SELECT count(*) FROM public.game_ledger WHERE user_id = c_a) <> 1 THEN
    RAISE EXCEPTION 'M9: a failed award leaves the day and the ledger as they were';
  END IF;
END $$;

--------------------------------------------------------------------------------
-- 4. Replacements of extras: never a mission, the limit, after a reward too
--------------------------------------------------------------------------------
DO $$
DECLARE
  c_a CONSTANT UUID := '00000000-0000-0000-0000-0000000da701';
  v JSONB;
BEGIN
  IF pg_temp.err(format($q$SELECT public.game_day_replace_at(%L, 'm_backtest', 'q_meditate', '2026-11-20T11:00:00Z')$q$, c_a)) <> 'game_not_replaceable'
     OR pg_temp.err(format($q$SELECT public.game_day_replace_at(%L, 'q_walk', 'm_mistake', '2026-11-20T11:00:00Z')$q$, c_a)) <> 'game_not_replaceable' THEN
    RAISE EXCEPTION 'R1: a mission is never replaced and never comes in as an extra';
  END IF;
  -- after the first reward of the day (m_lesson paid above) an extra can still be replaced
  v := public.game_day_replace_at(c_a, 'q_read_pages', 'q_lang_10m', '2026-11-20T11:01:00Z');
  IF v -> 'bonus' <> '["q_lang_10m","q_walk"]'::jsonb THEN RAISE EXCEPTION 'R2: replaced in place: %', v; END IF;
  IF pg_temp.err(format($q$SELECT public.game_day_replace_at(%L, 'q_meditate', 'q_stretching', '2026-11-20T11:02:00Z')$q$, c_a)) <> 'game_not_offered' THEN
    RAISE EXCEPTION 'R3: only an extra of the day';
  END IF;
  IF pg_temp.err(format($q$SELECT public.game_day_replace_at(%L, 'q_lang_10m', 'q_read_pages', '2026-11-20T11:03:00Z')$q$, c_a)) <> 'game_not_replaceable'
     OR pg_temp.err(format($q$SELECT public.game_day_replace_at(%L, 'q_walk', 'q_lang_10m', '2026-11-20T11:03:00Z')$q$, c_a)) <> 'game_not_replaceable' THEN
    RAISE EXCEPTION 'R4: no way back to a replaced extra, no extra shown twice';
  END IF;
  PERFORM public.game_day_replace_at(c_a, 'q_walk', 'q_meditate', '2026-11-20T11:04:00Z');
  IF pg_temp.err(format($q$SELECT public.game_day_replace_at(%L, 'q_meditate', 'q_stretching', '2026-11-20T11:05:00Z')$q$, c_a)) <> 'game_replacement_limit' THEN
    RAISE EXCEPTION 'R5: two replacements a day';
  END IF;
END $$;

--------------------------------------------------------------------------------
-- 5. Modes: a paid mission keeps its slot; a mode change never opens a fourth payment; rest; «not today»
--------------------------------------------------------------------------------
DO $$
DECLARE
  c_a CONSTANT UUID := '00000000-0000-0000-0000-0000000da701';
  v JSONB;
BEGIN
  PERFORM public.game_day_pass_at(c_a, 'm_backtest', '2026-11-20T12:00:00Z');
  v := public.game_day_set_mode_at(c_a, 'trading', '2026-11-20T12:01:00Z');
  IF v -> 'core' <> '["q_bias","q_riskcheck","m_lesson"]'::jsonb OR v -> 'carried' <> '{"m_lesson":"study"}'::jsonb THEN
    RAISE EXCEPTION 'S1: the paid lesson keeps its slot: %', v;
  END IF;
  -- acceptances are kept; trading missions must be accepted themselves
  PERFORM public.game_day_accept_at(c_a, 'q_bias', '2026-11-20T12:02:00Z');
  PERFORM public.game_day_accept_at(c_a, 'q_riskcheck', '2026-11-20T12:02:00Z');
  PERFORM public.game_apply_reward_at(c_a, 'mission', 'q_bias', pg_temp.ev('journal_day_plans', c_a, '2026-11-20'), '2026-11-20T12:03:00Z');
  -- back to study: the passed backtest is not offered again; observation takes its place
  v := public.game_day_set_mode_at(c_a, 'study', '2026-11-20T12:04:00Z');
  IF v -> 'core' <> '["q_bias","m_observation","m_lesson"]'::jsonb THEN RAISE EXCEPTION 'S2: compose with paid and passed: %', v; END IF;
  PERFORM public.game_apply_reward_at(c_a, 'mission', 'm_observation', pg_temp.ev('journal_notes', c_a, 'n4'), '2026-11-20T12:05:00Z');
  -- three paid: every slot is taken by a paid mission, so no mode offers a fourth
  v := public.game_day_set_mode_at(c_a, 'recovery', '2026-11-20T12:06:00Z');
  IF v -> 'core' <> '["q_bias","m_observation","m_lesson"]'::jsonb THEN RAISE EXCEPTION 'S3: a full day keeps its three: %', v; END IF;
  IF pg_temp.err(format($q$SELECT public.game_day_accept_at(%L, 'm_mistake', '2026-11-20T12:07:00Z')$q$, c_a)) <> 'game_mission_not_assigned' THEN
    RAISE EXCEPTION 'S4: no fourth mission through a mode change';
  END IF;
  v := public.game_mission_status_at(c_a, 'm_mistake', '2026-11-20T12:08:00Z');
  IF NOT (v ->> 'day_full')::boolean OR (v ->> 'assigned')::boolean THEN RAISE EXCEPTION 'S5: status of a full day: %', v; END IF;
  -- rest: no mission can be accepted or paid; back to the mode before rest gives the same set
  PERFORM public.game_day_set_mode_at(c_a, 'rest', '2026-11-20T12:09:00Z');
  IF pg_temp.err(format($q$SELECT public.game_day_accept_at(%L, 'q_bias', '2026-11-20T12:10:00Z')$q$, c_a)) <> 'game_day_rest' THEN
    RAISE EXCEPTION 'S6: rest asks for nothing';
  END IF;
  v := public.game_day_set_mode_at(c_a, 'recovery', '2026-11-20T12:11:00Z');
  IF v ->> 'mode' <> 'recovery' OR v -> 'core' <> '["q_bias","m_observation","m_lesson"]'::jsonb OR v ->> 'mode_before_rest' IS NOT NULL THEN
    RAISE EXCEPTION 'S7: back from rest: %', v;
  END IF;
  IF jsonb_array_length(v -> 'mode_changes') <> 5 THEN RAISE EXCEPTION 'S8: mode changes tracked: %', v -> 'mode_changes'; END IF;
END $$;

--------------------------------------------------------------------------------
-- 6. Midnight: the day closes when the next one opens, frozen; no late payment for yesterday
--------------------------------------------------------------------------------
DO $$
DECLARE
  c_c CONSTANT UUID := '00000000-0000-0000-0000-0000000da703';
  v JSONB;
  v_snap JSONB;
BEGIN
  INSERT INTO public.journal_notes (user_id, id, data) VALUES
    (c_c, 'c1', '{"id":"c1","templateKey":"lesson","body":"Урок C.","createdAt":"2026-11-01T10:00:00Z","updatedAt":"2026-11-01T10:00:00Z"}'),
    (c_c, 'c2', '{"id":"c2","templateKey":"idea","body":"Идея C.","createdAt":"2026-11-01T10:00:00Z","updatedAt":"2026-11-01T10:00:00Z"}');
  PERFORM public.game_day_open_at(c_c, 'study', '{}', '2026-11-20T23:50:00Z');
  PERFORM public.game_day_accept_at(c_c, 'm_lesson', '2026-11-20T23:51:00Z');
  PERFORM public.game_day_accept_at(c_c, 'm_observation', '2026-11-20T23:52:00Z');
  PERFORM public.game_apply_reward_at(c_c, 'mission', 'm_lesson', pg_temp.ev('journal_notes', c_c, 'c1'), '2026-11-20T23:59:59Z');
  -- 00:00:30: the new day is not open yet; yesterday's accepted observation cannot be paid any more
  IF pg_temp.err(format($q$SELECT public.game_apply_reward_at(%L, 'mission', 'm_observation', pg_temp.ev('journal_notes', %L, 'c2'), '2026-11-21T00:00:30Z')$q$, c_c, c_c)) <> 'game_day_not_open'
     OR pg_temp.err(format($q$SELECT public.game_day_accept_at(%L, 'm_observation', '2026-11-21T00:00:30Z')$q$, c_c)) <> 'game_day_not_open' THEN
    RAISE EXCEPTION 'N1: after midnight nothing of yesterday is paid or accepted';
  END IF;
  v := public.game_day_open_at(c_c, 'study', '{}', '2026-11-21T00:01:00Z');
  IF v ->> 'game_day' <> '2026-11-21' OR (v ->> 'closed_days')::int <> 1 OR v -> 'accepted' <> '{}'::jsonb THEN
    RAISE EXCEPTION 'N2: a new day, nothing accepted: %', v;
  END IF;
  SELECT snapshot INTO v_snap FROM public.game_days WHERE user_id = c_c AND game_day = '2026-11-20' AND status = 'closed';
  IF v_snap -> 'paid' <> '["m_lesson"]'::jsonb OR (v_snap ->> 'xp')::int <> 40 OR NOT (v_snap -> 'accepted' ? 'm_observation') THEN
    RAISE EXCEPTION 'N3: yesterday kept as it was: %', v_snap;
  END IF;
  -- yesterday's acceptance does not carry over: today's observation must be accepted again
  IF pg_temp.err(format($q$SELECT public.game_apply_reward_at(%L, 'mission', 'm_observation', pg_temp.ev('journal_notes', %L, 'c2'), '2026-11-21T00:03:00Z')$q$, c_c, c_c)) <> 'game_mission_not_accepted' THEN
    RAISE EXCEPTION 'N4: acceptance is per day';
  END IF;
END $$;
-- a closed day never changes (not even by the owner)
SET LOCAL ROLE game_economy_owner;
DO $$
BEGIN
  IF pg_temp.err($q$UPDATE public.game_days SET snapshot = '{}' WHERE user_id = '00000000-0000-0000-0000-0000000da703' AND game_day = '2026-11-20'$q$) <> 'game_day_closed'
     OR pg_temp.err($q$UPDATE public.game_days SET status = 'open', closed_at = NULL, snapshot = NULL WHERE user_id = '00000000-0000-0000-0000-0000000da703' AND game_day = '2026-11-20'$q$) <> 'game_day_closed' THEN
    RAISE EXCEPTION 'N5: a closed day is frozen';
  END IF;
END $$;
RESET ROLE;

--------------------------------------------------------------------------------
-- 7. Time zone changes: never back to a closed day, never a day twice, nothing lost
--------------------------------------------------------------------------------
DO $$
DECLARE
  c_a CONSTANT UUID := '00000000-0000-0000-0000-0000000da701';
  c_b CONSTANT UUID := '00000000-0000-0000-0000-0000000da702';
  v JSONB;
BEGIN
  -- A (UTC) is on the 20th with three paid. Moving to UTC+14 at 13:00 UTC: it is the 21st there — a new day opens
  UPDATE public.profiles SET timezone = 'Pacific/Kiritimati' WHERE id = c_a;
  v := public.game_day_open_at(c_a, 'study', '{}', '2026-11-20T13:00:00Z');
  IF v ->> 'game_day' <> '2026-11-21' OR (v ->> 'closed_days')::int <> 1 THEN RAISE EXCEPTION 'Z1: zone ahead starts the next day: %', v; END IF;
  -- back to UTC at 14:00 UTC (the 20th in UTC): the 20th does NOT reopen; the day stays the 21st
  UPDATE public.profiles SET timezone = 'UTC' WHERE id = c_a;
  v := public.game_day_open_at(c_a, 'study', '{}', '2026-11-20T14:00:00Z');
  IF v ->> 'game_day' <> '2026-11-21' OR (v ->> 'opened')::boolean THEN RAISE EXCEPTION 'Z2: the closed day never reopens: %', v; END IF;
  IF (SELECT status FROM public.game_days WHERE user_id = c_a AND game_day = '2026-11-20') <> 'closed'
     OR (SELECT snapshot -> 'paid' FROM public.game_days WHERE user_id = c_a AND game_day = '2026-11-20') <> '["m_lesson","q_bias","m_observation"]'::jsonb THEN
    RAISE EXCEPTION 'Z3: the 20th keeps its three payments';
  END IF;
  -- a mission of the 21st paid now is the same mission when the 21st really comes in UTC: paid once
  PERFORM public.game_day_accept_at(c_a, 'm_lesson', '2026-11-20T14:01:00Z');
  UPDATE public.journal_notes SET data = data || '{"updatedAt":"2026-11-03T10:00:00Z"}' WHERE user_id = c_a AND id = 'n3';
  v := public.game_apply_reward_at(c_a, 'mission', 'm_lesson', pg_temp.ev('journal_notes', c_a, 'n3'), '2026-11-20T14:02:00Z');
  IF v ->> 'game_day' <> '2026-11-21' THEN RAISE EXCEPTION 'Z4: paid on the 21st: %', v; END IF;
  v := public.game_apply_reward_at(c_a, 'mission', 'm_lesson', pg_temp.ev('journal_notes', c_a, 'n3'), '2026-11-21T09:00:00Z');
  IF NOT (v ->> 'replay')::boolean THEN RAISE EXCEPTION 'Z5: the 21st in UTC is the same day: %', v; END IF;
  -- the 22nd starts at UTC midnight (one day each real day: the jump gained no extra day)
  v := public.game_day_open_at(c_a, 'study', '{}', '2026-11-21T23:59:00Z');
  IF v ->> 'game_day' <> '2026-11-21' THEN RAISE EXCEPTION 'Z6: still the 21st before UTC midnight: %', v; END IF;
  v := public.game_day_open_at(c_a, 'study', '{}', '2026-11-22T00:01:00Z');
  IF v ->> 'game_day' <> '2026-11-22' THEN RAISE EXCEPTION 'Z7: the 22nd at UTC midnight: %', v; END IF;
  -- B (Tbilisi, on the 21st since 21:30 UTC) moves behind, to Los Angeles: still the 21st, the 20th is never opened
  UPDATE public.profiles SET timezone = 'America/Los_Angeles' WHERE id = c_b;
  v := public.game_day_open_at(c_b, 'study', '{}', '2026-11-20T22:00:00Z');
  IF v ->> 'game_day' <> '2026-11-21' OR (v ->> 'opened')::boolean THEN RAISE EXCEPTION 'Z8: zone behind keeps the day: %', v; END IF;
  IF EXISTS (SELECT 1 FROM public.game_days WHERE user_id = c_b AND game_day = '2026-11-20') THEN RAISE EXCEPTION 'Z9: no earlier day opened'; END IF;
  -- the 22nd in Los Angeles comes at 08:00 UTC on the 22nd
  v := public.game_day_open_at(c_b, 'study', '{}', '2026-11-22T07:59:00Z');
  IF v ->> 'game_day' <> '2026-11-21' THEN RAISE EXCEPTION 'Z10: %', v; END IF;
  v := public.game_day_open_at(c_b, 'study', '{}', '2026-11-22T08:01:00Z');
  IF v ->> 'game_day' <> '2026-11-22' THEN RAISE EXCEPTION 'Z11: %', v; END IF;
  -- an unknown zone counts in UTC (no error, no day from a broken zone)
  UPDATE public.profiles SET timezone = 'Mars/Olympus' WHERE id = c_b;
  IF public.game_zone_of(c_b) <> 'UTC' THEN RAISE EXCEPTION 'Z12: unknown zone → UTC'; END IF;
END $$;

--------------------------------------------------------------------------------
-- 8. Who may do what
--------------------------------------------------------------------------------
DO $$
DECLARE
  f TEXT;
BEGIN
  -- the «_at» variants (time given) are for no API role
  FOREACH f IN ARRAY ARRAY['game_day_open_at(uuid,text,text[],timestamptz)', 'game_day_accept_at(uuid,text,timestamptz)',
    'game_day_set_mode_at(uuid,text,timestamptz)', 'game_day_replace_at(uuid,text,text,timestamptz)',
    'game_apply_reward_at(uuid,text,text,jsonb,timestamptz)', 'game_mission_status_at(uuid,text,timestamptz)'] LOOP
    IF has_function_privilege('service_role', 'public.' || f, 'EXECUTE') OR has_function_privilege('authenticated', 'public.' || f, 'EXECUTE')
       OR has_function_privilege('anon', 'public.' || f, 'EXECUTE') THEN
      RAISE EXCEPTION 'P1: % must not be callable with a client time', f;
    END IF;
  END LOOP;
  -- the API is the server route's only (service role); clients only read their own day
  FOREACH f IN ARRAY ARRAY['game_day_open(uuid,text,text[])', 'game_day_accept(uuid,text)', 'game_day_set_mode(uuid,text)',
    'game_day_replace(uuid,text,text)', 'game_day_pass(uuid,text)', 'game_record_shadow(jsonb)'] LOOP
    IF NOT has_function_privilege('service_role', 'public.' || f, 'EXECUTE') OR has_function_privilege('authenticated', 'public.' || f, 'EXECUTE') THEN
      RAISE EXCEPTION 'P2: % is the server''s', f;
    END IF;
  END LOOP;
  FOREACH f IN ARRAY ARRAY['game_days', 'game_mode_missions', 'game_shadow_diagnostics'] LOOP
    IF has_table_privilege('service_role', 'public.' || f, 'INSERT') OR has_table_privilege('service_role', 'public.' || f, 'UPDATE')
       OR has_table_privilege('authenticated', 'public.' || f, 'INSERT') OR has_table_privilege('authenticated', 'public.' || f, 'UPDATE')
       OR has_table_privilege('service_role', 'public.' || f, 'DELETE') THEN
      RAISE EXCEPTION 'P3: nobody writes % directly', f;
    END IF;
  END LOOP;
  -- an admin's ad-hoc SQL is refused by the owner guard
  IF pg_temp.err($q$INSERT INTO public.game_days (user_id, game_day, timezone, opened_at, mode, study_first, core, rules_version)
                   VALUES ('00000000-0000-0000-0000-0000000da701', '2030-01-01', 'UTC', now(), 'study', 'm_observation', '{}', 'q4.3')$q$) <> 'game_write_only_through_functions' THEN
    RAISE EXCEPTION 'P4: no day row by hand';
  END IF;
END $$;
SET LOCAL ROLE authenticated;
DO $$
DECLARE v JSONB;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000da701', true);
  v := public.game_my_day();
  IF v ->> 'current_day' <> '2026-11-22' OR v -> 'day' ->> 'game_day' <> '2026-11-22' OR v -> 'day' ? 'snapshot' THEN
    RAISE EXCEPTION 'P5: own day: %', v;
  END IF;
  IF EXISTS (SELECT 1 FROM public.game_days WHERE user_id <> '00000000-0000-0000-0000-0000000da701') THEN
    RAISE EXCEPTION 'P6: only own days are visible';
  END IF;
  IF pg_temp.err($q$SELECT public.game_day_open('00000000-0000-0000-0000-0000000da701', 'study', '{}')$q$) NOT LIKE 'permission denied%' THEN
    RAISE EXCEPTION 'P7: a client cannot open a day';
  END IF;
END $$;
RESET ROLE;

--------------------------------------------------------------------------------
-- 9. Shadow diagnostics: codes only, append-only, nothing about the person
--------------------------------------------------------------------------------
DO $$
BEGIN
  IF public.game_record_shadow('[{"category":"client_only","mission_id":"m_lesson","game_day":"2026-11-20","rules_version":"q4.3"}]') <> 1 THEN
    RAISE EXCEPTION 'G1: a row';
  END IF;
  IF pg_temp.err($q$SELECT public.game_record_shadow('[{"category":"client_only","mission_id":"m_lesson","game_day":"2026-11-20","rules_version":"q4.3","body":"Урок"}]')$q$) <> 'game_bad_request'
     OR pg_temp.err($q$SELECT public.game_record_shadow('[{"category":"angry","mission_id":"m_lesson","game_day":"2026-11-20","rules_version":"q4.3"}]')$q$) NOT LIKE '%check constraint%'
     OR pg_temp.err($q$SELECT public.game_record_shadow((SELECT jsonb_agg('{"category":"dayFull","mission_id":"m_lesson","game_day":"2026-11-20","rules_version":"q4.3"}'::jsonb) FROM generate_series(1, 11)))$q$) <> 'game_bad_request' THEN
    RAISE EXCEPTION 'G2: unknown fields, categories and big batches are refused';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'game_shadow_diagnostics' AND column_name IN ('user_id', 'body', 'source', 'record_id')) THEN
    RAISE EXCEPTION 'G3: no person or record in diagnostics';
  END IF;
END $$;
SET LOCAL ROLE game_economy_owner;
DO $$
BEGIN
  IF pg_temp.err($q$UPDATE public.game_shadow_diagnostics SET category = 'server_only'$q$) <> 'game_ledger_append_only' THEN
    RAISE EXCEPTION 'G4: diagnostics are append-only';
  END IF;
END $$;
RESET ROLE;

--------------------------------------------------------------------------------
-- 10. Account deletion removes the days
--------------------------------------------------------------------------------
DO $$
BEGIN
  DELETE FROM auth.users WHERE id = '00000000-0000-0000-0000-0000000da703';
  IF EXISTS (SELECT 1 FROM public.game_days WHERE user_id = '00000000-0000-0000-0000-0000000da703') THEN
    RAISE EXCEPTION 'X1: days go with the account';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.game_days WHERE user_id = '00000000-0000-0000-0000-0000000da701') THEN
    RAISE EXCEPTION 'X2: other accounts keep theirs';
  END IF;
END $$;

ROLLBACK;
