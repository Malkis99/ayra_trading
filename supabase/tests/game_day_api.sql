-- AYRA Trading — tests for 0016 (server game day API, Q4.4) on top of 0014 + 0015. Everything is rolled back.
-- Times go to the owner-only «_at» variants (the API uses now()).
BEGIN;

INSERT INTO auth.users (id, email) VALUES
  ('00000000-0000-0000-0000-0000000a9101', 'api-a@example.com'),
  ('00000000-0000-0000-0000-0000000a9102', 'api-b@example.com')
ON CONFLICT (id) DO NOTHING;
UPDATE public.profiles SET timezone = 'UTC' WHERE id IN ('00000000-0000-0000-0000-0000000a9101', '00000000-0000-0000-0000-0000000a9102');

CREATE OR REPLACE FUNCTION pg_temp.err(p_sql TEXT) RETURNS TEXT AS $$
BEGIN
  EXECUTE p_sql;
  RETURN 'ok';
EXCEPTION WHEN OTHERS THEN
  RETURN SQLERRM;
END $$ LANGUAGE plpgsql;

DO $$
BEGIN
  PERFORM public.game_begin_migration('00000000-0000-0000-0000-0000000a9101');
  PERFORM public.game_activate_cloud('00000000-0000-0000-0000-0000000a9101');
END $$;

--------------------------------------------------------------------------------
-- 1. The opening mode comes from the saved trading days, never from the app; a change applies from the next day
--------------------------------------------------------------------------------
DO $$
DECLARE
  c_a CONSTANT UUID := '00000000-0000-0000-0000-0000000a9101';
  v JSONB;
BEGIN
  -- nothing saved: every day is a trading day (Friday 2026-11-20)
  v := public.game_day_open_at(c_a, '{q_walk,q_screenplan}', '2026-11-20T08:00:00Z');
  IF v ->> 'mode' <> 'trading' OR v -> 'core' <> '["q_bias","q_riskcheck","q_reflect"]'::jsonb THEN RAISE EXCEPTION 'T1: trading by default: %', v; END IF;
  -- Monday–Thursday only, saved on Friday: Friday stays as it is, Saturday is a study day
  v := public.game_set_trading_days_at(c_a, '{3,0,1,2,2}', '2026-11-20T09:00:00Z');
  IF v -> 'next' <> '[0,1,2,3]'::jsonb OR v ->> 'from' <> '2026-11-21' OR v -> 'trading_days' <> '[0,1,2,3,4,5,6]'::jsonb THEN
    RAISE EXCEPTION 'T2: saved for the next day, cleaned: %', v;
  END IF;
  v := public.game_day_open_at(c_a, '{}', '2026-11-20T10:00:00Z');
  IF v ->> 'mode' <> 'trading' OR (v ->> 'opened')::boolean THEN RAISE EXCEPTION 'T3: today is never re-made: %', v; END IF;
  v := public.game_day_open_at(c_a, '{q_logic_puzzle}', '2026-11-21T08:00:00Z');
  IF v ->> 'mode' <> 'study' OR v ->> 'game_day' <> '2026-11-21' THEN RAISE EXCEPTION 'T4: Saturday is a study day now: %', v; END IF;
  IF (SELECT trading_days FROM public.game_accounts WHERE user_id = c_a) <> '{0,1,2,3}'::smallint[]
     OR (SELECT trading_days_next FROM public.game_accounts WHERE user_id = c_a) IS NOT NULL THEN
    RAISE EXCEPTION 'T5: the new days came into force';
  END IF;
  IF pg_temp.err(format($q$SELECT public.game_set_trading_days_at(%L, '{}', '2026-11-21T09:00:00Z')$q$, c_a)) <> 'game_bad_request'
     OR pg_temp.err(format($q$SELECT public.game_set_trading_days_at(%L, '{7}', '2026-11-21T09:00:00Z')$q$, c_a)) <> 'game_bad_request' THEN
    RAISE EXCEPTION 'T6: bad trading days are refused';
  END IF;
END $$;

--------------------------------------------------------------------------------
-- 2. Extras only from the catalog of the mode: at most two, no repeats, never a mission
--------------------------------------------------------------------------------
DO $$
DECLARE
  c_a CONSTANT UUID := '00000000-0000-0000-0000-0000000a9101';
  v JSONB;
BEGIN
  -- the 22nd (Sunday, study): checks of the opening extras (each refused opening leaves no day)
  IF pg_temp.err(format($q$SELECT public.game_day_open_at(%L, '{m_lesson}', '2026-11-22T08:00:00Z')$q$, c_a)) <> 'game_bad_extras'
     OR pg_temp.err(format($q$SELECT public.game_day_open_at(%L, '{q_free_xp}', '2026-11-22T08:00:00Z')$q$, c_a)) <> 'game_bad_extras'
     OR pg_temp.err(format($q$SELECT public.game_day_open_at(%L, '{q_workout}', '2026-11-22T08:00:00Z')$q$, c_a)) <> 'game_bad_extras'
     OR pg_temp.err(format($q$SELECT public.game_day_open_at(%L, '{q_backtest}', '2026-11-22T08:00:00Z')$q$, c_a)) <> 'game_bad_extras'
     OR pg_temp.err(format($q$SELECT public.game_day_open_at(%L, '{q_read_pages,q_read_pages}', '2026-11-22T08:00:00Z')$q$, c_a)) <> 'game_bad_extras'
     OR pg_temp.err(format($q$SELECT public.game_day_open_at(%L, '{q_read_pages,q_lang_10m,q_logic_puzzle}', '2026-11-22T08:00:00Z')$q$, c_a)) <> 'game_bad_extras' THEN
    RAISE EXCEPTION 'E1: a mission, an unknown quest, a quest of another mode, a mission''s twin, a repeat, a third extra are refused';
  END IF;
  IF EXISTS (SELECT 1 FROM public.game_days WHERE user_id = c_a AND game_day = '2026-11-22') THEN RAISE EXCEPTION 'E2: no day from a refused opening'; END IF;
  v := public.game_day_open_at(c_a, '{q_read_pages,q_lang_10m}', '2026-11-22T08:00:00Z');
  IF v -> 'bonus' <> '["q_read_pages","q_lang_10m"]'::jsonb THEN RAISE EXCEPTION 'E3: %', v; END IF;
  -- a mode change may keep the day's extras and take extras of the new mode, nothing else
  IF pg_temp.err(format($q$SELECT public.game_day_set_mode_at(%L, 'recovery', '{q_read_pages,q_gym}', '2026-11-22T09:00:00Z')$q$, c_a)) <> 'game_bad_extras' THEN
    RAISE EXCEPTION 'E4: a trading-only extra on a recovery day';
  END IF;
  v := public.game_day_set_mode_at(c_a, 'recovery', '{q_lang_10m,q_walk}', '2026-11-22T09:01:00Z');
  IF v ->> 'mode' <> 'recovery' OR v -> 'bonus' <> '["q_lang_10m","q_walk"]'::jsonb THEN RAISE EXCEPTION 'E5: kept + new: %', v; END IF;
  v := public.game_day_set_mode_at(c_a, 'study', NULL, '2026-11-22T09:02:00Z');
  IF v -> 'bonus' <> '["q_lang_10m","q_walk"]'::jsonb THEN RAISE EXCEPTION 'E6: NULL keeps the extras: %', v; END IF;
END $$;

--------------------------------------------------------------------------------
-- 3. Replacements: a self-reported quest of the mode's pool, not shown, with no more XP
--------------------------------------------------------------------------------
DO $$
DECLARE
  c_a CONSTANT UUID := '00000000-0000-0000-0000-0000000a9101';
  v JSONB;
BEGIN
  -- study day with extras q_lang_10m (30 XP) and q_walk (30 XP)
  IF pg_temp.err(format($q$SELECT public.game_day_replace_at(%L, 'q_lang_10m', 'q_reflect', '2026-11-22T10:00:00Z')$q$, c_a)) <> 'game_not_replaceable'
     OR pg_temp.err(format($q$SELECT public.game_day_replace_at(%L, 'q_lang_10m', 'q_screenplan', '2026-11-22T10:00:00Z')$q$, c_a)) <> 'game_not_replaceable'
     OR pg_temp.err(format($q$SELECT public.game_day_replace_at(%L, 'q_lang_10m', 'q_meditate', '2026-11-22T10:00:00Z')$q$, c_a)) <> 'game_not_replaceable'
     OR pg_temp.err(format($q$SELECT public.game_day_replace_at(%L, 'q_lang_10m', 'q_free_xp', '2026-11-22T10:00:00Z')$q$, c_a)) <> 'game_not_replaceable'
     OR pg_temp.err(format($q$SELECT public.game_day_replace_at(%L, 'q_lang_10m', 'q_walk', '2026-11-22T10:00:00Z')$q$, c_a)) <> 'game_not_replaceable' THEN
    RAISE EXCEPTION 'R1: a Journal quest, more XP (40), another mode''s pool, an unknown quest, a shown quest are refused';
  END IF;
  v := public.game_day_replace_at(c_a, 'q_lang_10m', 'q_read_pages', '2026-11-22T10:01:00Z');
  IF v -> 'bonus' <> '["q_read_pages","q_walk"]'::jsonb THEN RAISE EXCEPTION 'R2: an allowed replacement: %', v; END IF;
END $$;

--------------------------------------------------------------------------------
-- 4. The first server trace of a Journal row: server time, set once, never changed by anyone
--------------------------------------------------------------------------------
DO $$
DECLARE
  c_a CONSTANT UUID := '00000000-0000-0000-0000-0000000a9101';
  v_first TIMESTAMPTZ;
BEGIN
  -- a value sent with the row is replaced by the server time
  INSERT INTO public.journal_notes (user_id, id, data, first_seen_at) VALUES
    (c_a, 'f1', '{"id":"f1","templateKey":"lesson","body":"Урок.","createdAt":"2026-11-01T10:00:00Z","updatedAt":"2026-11-01T10:00:00Z"}', '2000-01-01T00:00:00Z');
  SELECT first_seen_at INTO v_first FROM public.journal_notes WHERE user_id = c_a AND id = 'f1';
  IF v_first IS NULL OR v_first <> now() THEN RAISE EXCEPTION 'F1: first trace = server time of the insert, got %', v_first; END IF;
  -- a newer version, the same version again (a re-sync), a tombstone, an older version (skipped): the first time stays
  UPDATE public.journal_notes SET data = data || '{"updatedAt":"2026-11-02T10:00:00Z","body":"Урок 2."}' WHERE user_id = c_a AND id = 'f1';
  INSERT INTO public.journal_notes (user_id, id, data) VALUES
    (c_a, 'f1', '{"id":"f1","templateKey":"lesson","body":"Урок 2.","createdAt":"2026-11-01T10:00:00Z","updatedAt":"2026-11-02T10:00:00Z"}')
    ON CONFLICT (user_id, id) DO UPDATE SET data = EXCLUDED.data;
  UPDATE public.journal_notes SET data = data || '{"updatedAt":"2026-11-03T10:00:00Z","deletedAt":"2026-11-03T10:00:00Z"}' WHERE user_id = c_a AND id = 'f1';
  UPDATE public.journal_notes SET data = data || '{"updatedAt":"2026-10-01T10:00:00Z"}' WHERE user_id = c_a AND id = 'f1';
  UPDATE public.journal_notes SET first_seen_at = '2030-01-01T00:00:00Z' WHERE user_id = c_a AND id = 'f1';
  IF (SELECT first_seen_at FROM public.journal_notes WHERE user_id = c_a AND id = 'f1') <> v_first THEN
    RAISE EXCEPTION 'F2: the first trace never changes';
  END IF;
  -- an imported note (from a file) gets its own first trace like any record; the import mark keeps it out of missions
  INSERT INTO public.journal_notes (user_id, id, data) VALUES
    (c_a, 'f2', '{"id":"f2","templateKey":"lesson","body":"Импорт.","importBatchId":"imp_1","createdAt":"2025-01-01T10:00:00Z","updatedAt":"2025-01-01T10:00:00Z"}');
  IF (SELECT first_seen_at FROM public.journal_notes WHERE user_id = c_a AND id = 'f2') <> now() THEN RAISE EXCEPTION 'F3: imported row traced'; END IF;
END $$;
-- the owner cannot change it either (no column privilege; the trigger would restore it anyway)
SET LOCAL ROLE game_economy_owner;
DO $$
BEGIN
  IF pg_temp.err($q$UPDATE public.journal_notes SET first_seen_at = now() - interval '1 day' WHERE id = 'f1'$q$) NOT LIKE 'permission denied%' THEN
    RAISE EXCEPTION 'F4: the owner has no right to the first trace';
  END IF;
END $$;
RESET ROLE;
SET LOCAL ROLE authenticated;
DO $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000a9101', true);
  IF pg_temp.err($q$INSERT INTO public.journal_notes (user_id, id, data, first_seen_at) VALUES ('00000000-0000-0000-0000-0000000a9101', 'f3',
      '{"id":"f3","templateKey":"lesson","body":"x","createdAt":"2026-11-01T10:00:00Z","updatedAt":"2026-11-01T10:00:00Z"}', '2000-01-01')$q$) NOT LIKE 'permission denied%' THEN
    RAISE EXCEPTION 'F5: a client cannot name the first trace';
  END IF;
END $$;
RESET ROLE;

--------------------------------------------------------------------------------
-- 5. The rows a mission check reads: own rows only, fingerprint and version from Postgres
--------------------------------------------------------------------------------
INSERT INTO public.journal_notes (user_id, id, data) VALUES
  ('00000000-0000-0000-0000-0000000a9102', 'b1', '{"id":"b1","templateKey":"lesson","body":"B.","createdAt":"2026-11-01T10:00:00Z","updatedAt":"2026-11-01T10:00:00Z"}');
INSERT INTO public.journal_day_plans (user_id, id, data) VALUES
  ('00000000-0000-0000-0000-0000000a9101', '2026-11-22', '{"date":"2026-11-22","createdAt":"2026-11-01T07:00:00Z","updatedAt":"2026-11-01T07:00:00Z"}'),
  ('00000000-0000-0000-0000-0000000a9101', '2026-11-10', '{"date":"2026-11-10","createdAt":"2026-11-01T07:00:00Z","updatedAt":"2026-11-01T07:00:00Z"}');
DO $$
DECLARE
  v JSONB;
BEGIN
  v := public.game_journal_for_check('00000000-0000-0000-0000-0000000a9101', '2026-11-22');
  IF jsonb_array_length(v -> 'notes') <> 2 OR EXISTS (SELECT 1 FROM jsonb_array_elements(v -> 'notes') n WHERE n ->> 'id' = 'b1') THEN
    RAISE EXCEPTION 'J1: own notes only (deleted included): %', v -> 'notes';
  END IF;
  IF jsonb_array_length(v -> 'plans') <> 1 OR v -> 'plans' -> 0 ->> 'id' <> '2026-11-22' THEN RAISE EXCEPTION 'J2: plans of the day and the next only'; END IF;
  IF (SELECT n ->> 'fp' FROM jsonb_array_elements(v -> 'notes') n WHERE n ->> 'id' = 'f2')
     <> (SELECT md5(data::text) FROM public.journal_notes WHERE user_id = '00000000-0000-0000-0000-0000000a9101' AND id = 'f2') THEN
    RAISE EXCEPTION 'J3: the fingerprint is the one the award compares';
  END IF;
  IF (SELECT (n ->> 'first_seen_at') IS NULL FROM jsonb_array_elements(v -> 'notes') n WHERE n ->> 'id' = 'f2') THEN RAISE EXCEPTION 'J4: first trace included'; END IF;
END $$;

--------------------------------------------------------------------------------
-- 6. Status for the API
--------------------------------------------------------------------------------
DO $$
DECLARE v JSONB;
BEGIN
  v := public.game_day_status_at('00000000-0000-0000-0000-0000000a9102', '2026-11-22T11:00:00Z');
  IF v ->> 'state' <> 'local' OR v -> 'day' <> 'null'::jsonb THEN RAISE EXCEPTION 'S1: a local account has no server day: %', v; END IF;
  v := public.game_day_status_at('00000000-0000-0000-0000-0000000a9101', '2026-11-22T11:00:00Z');
  IF v ->> 'state' <> 'cloud_active' OR v ->> 'game_day' <> '2026-11-22' OR v -> 'day' ->> 'mode' <> 'study'
     OR (v ->> 'replacements_left')::int <> 1 OR jsonb_array_length(v -> 'missions') <> 3 OR v -> 'day' ? 'snapshot'
     OR (v ->> 'game_sync')::boolean THEN
    RAISE EXCEPTION 'S2: an open day: %', v;
  END IF;
  -- the next day is not open yet: no day, but the server day and trading days are known
  v := public.game_day_status_at('00000000-0000-0000-0000-0000000a9101', '2026-11-23T11:00:00Z');
  -- (Monday the 23rd is a trading day of Monday–Thursday)
  IF v -> 'day' <> 'null'::jsonb OR v ->> 'game_day' <> '2026-11-23' OR v ->> 'opening_mode' <> 'trading' THEN RAISE EXCEPTION 'S3: %', v; END IF;
END $$;

--------------------------------------------------------------------------------
-- 7. Who may call what
--------------------------------------------------------------------------------
DO $$
DECLARE f TEXT;
BEGIN
  FOREACH f IN ARRAY ARRAY['game_day_open_at(uuid,text[],timestamptz)', 'game_day_set_mode_at(uuid,text,text[],timestamptz)',
    'game_set_trading_days_at(uuid,smallint[],timestamptz)', 'game_day_status_at(uuid,timestamptz)'] LOOP
    IF has_function_privilege('service_role', 'public.' || f, 'EXECUTE') OR has_function_privilege('authenticated', 'public.' || f, 'EXECUTE') THEN
      RAISE EXCEPTION 'P1: % takes a time: nobody but the owner', f;
    END IF;
  END LOOP;
  FOREACH f IN ARRAY ARRAY['game_day_open(uuid,text[])', 'game_day_set_mode(uuid,text,text[])', 'game_set_trading_days(uuid,smallint[])',
    'game_day_status(uuid)', 'game_journal_for_check(uuid,date)'] LOOP
    IF NOT has_function_privilege('service_role', 'public.' || f, 'EXECUTE') OR has_function_privilege('authenticated', 'public.' || f, 'EXECUTE')
       OR has_function_privilege('anon', 'public.' || f, 'EXECUTE') THEN
      RAISE EXCEPTION 'P2: % is the server route''s only', f;
    END IF;
  END LOOP;
  IF has_table_privilege('service_role', 'public.game_extra_quests', 'INSERT') OR has_table_privilege('authenticated', 'public.game_extra_quests', 'SELECT') THEN
    RAISE EXCEPTION 'P3: the catalog is read by the server only, written by nobody';
  END IF;
  -- the old 0015 signatures are gone: nobody can open a day in a mode of their choice
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'game_day_open' AND pronargs = 3) THEN RAISE EXCEPTION 'P4: open(user, mode, extras) removed'; END IF;
END $$;

ROLLBACK;
