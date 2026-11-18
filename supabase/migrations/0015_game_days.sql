-- AYRA Trading — 0015: the server game day (Q4.3, docs/q4-3-server-game-day.md). NOT APPLIED TO SUPABASE.
-- Needs 0014 (also not applied). Nothing is switched on: game_sync stays off, no account is activated, the mission
-- award kind stays disabled. Rollback: 0015_game_days.down.sql (restores the 0014 award).
--
-- The QH-6 day on the server, for accounts on the server economy (cloud_active):
--   * the game day = server time in the account zone, never earlier than the day already opened (a cursor on the
--     account): a zone change never reopens a closed day and never gives a day twice;
--   * the day's mode, its three missions (the same table as lib/missions.ts missionsForMode, parity-tested), the study
--     choice made once at opening, acceptances, put-offs, the extras the app offers and their replacements (limit);
--   * a day is closed when a later day opens: its result is frozen in an immutable snapshot;
--   * the mission award (0014) now also needs: the day open on the server, the mission in the day's set for its mode,
--     and accepted. Already paid / day full / record used stay as in 0014.
-- Every write runs as the owner inside these functions and takes the same per-user lock as the award (the projection
-- row), so two devices are served one after the other. Device time is never an input: the API functions use now();
-- the «_at» variants (time given) are for tests and the owner only — no API role may execute them.
--
-- Idempotent: safe to run twice.

BEGIN;

--------------------------------------------------------------------------------
-- 1. Settings, the day cursor, tables
--------------------------------------------------------------------------------
-- PLACEHOLDER (lib/game-config.ts QUEST_REPLACEMENTS_PER_DAY = 2): replacements of extras a day
ALTER TABLE public.game_limits ADD COLUMN IF NOT EXISTS replacements_per_day INTEGER NOT NULL DEFAULT 2
  CHECK (replacements_per_day BETWEEN 0 AND 10);
-- the latest game day opened for the account: the day never goes back (lib/game.ts gameDayKey: lastQuestDate)
ALTER TABLE public.game_accounts ADD COLUMN IF NOT EXISTS current_day DATE;

-- The three missions of each mode (lib/missions.ts missionsForMode). «$study_first» is the study choice of the day:
-- «Trade review» when the journal had a trade before the day, else «Observation» (owner decision В11/В15).
CREATE TABLE IF NOT EXISTS public.game_mode_missions (
  mode TEXT NOT NULL CHECK (mode IN ('trading', 'study', 'recovery')),
  slot INTEGER NOT NULL CHECK (slot BETWEEN 1 AND 3),
  mission_id TEXT NOT NULL CHECK (mission_id ~ '^(\$study_first|[a-z0-9_]{2,40})$'),
  PRIMARY KEY (mode, slot)
);

CREATE TABLE IF NOT EXISTS public.game_days (
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  game_day DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  timezone TEXT NOT NULL,
  opened_at TIMESTAMPTZ NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('trading', 'study', 'recovery', 'rest')),
  mode_before_rest TEXT CHECK (mode_before_rest IS NULL OR mode_before_rest IN ('trading', 'study', 'recovery')),
  study_first TEXT NOT NULL CHECK (study_first IN ('m_trade_review', 'm_observation')),
  core TEXT[] NOT NULL CHECK (cardinality(core) <= 3),
  carried JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(carried) = 'object'),
  accepted JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(accepted) = 'object'),
  passed TEXT[] NOT NULL DEFAULT '{}',
  -- the extras (self-reports) the app offered: recorded, never paid by the server (self_report stays fail-closed)
  bonus TEXT[] NOT NULL DEFAULT '{}' CHECK (cardinality(bonus) <= 4),
  replacements JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(replacements) = 'array'),
  mode_changes JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(mode_changes) = 'array'),
  version INTEGER NOT NULL DEFAULT 0,
  closed_at TIMESTAMPTZ,
  snapshot JSONB,
  rules_version TEXT NOT NULL,
  PRIMARY KEY (user_id, game_day),
  CHECK ((status = 'closed') = (closed_at IS NOT NULL AND snapshot IS NOT NULL))
);

-- Shadow diagnostics (Q4.2 mismatches): category, mission, day, rules version, time. No user id, no Journal content,
-- no record ids. Nothing writes here yet (sending stays off until the owner decides).
CREATE TABLE IF NOT EXISTS public.game_shadow_diagnostics (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  category TEXT NOT NULL CHECK (category IN (
    'client_only', 'server_only', 'source_differs',
    'dayDiffers', 'sourceNotConfirmed', 'sourceUnknownForm', 'stampAfterServerWrite', 'duplicateSource', 'newerSchema', 'badRecord',
    'notAssigned', 'notAccepted', 'alreadyPaid', 'dayFull', 'sourceUsed', 'dayNotOpen')),
  mission_id TEXT NOT NULL CHECK (mission_id ~ '^[a-z0-9_]{2,40}$'),
  game_day DATE NOT NULL,
  rules_version TEXT NOT NULL CHECK (rules_version ~ '^[a-z0-9._-]{1,20}$'),
  checked_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.game_mode_missions OWNER TO game_economy_owner;
ALTER TABLE public.game_days OWNER TO game_economy_owner;
ALTER TABLE public.game_shadow_diagnostics OWNER TO game_economy_owner;

--------------------------------------------------------------------------------
-- 2. Guards
--------------------------------------------------------------------------------
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['game_mode_missions', 'game_days', 'game_shadow_diagnostics'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS tr_%s_owner_only ON public.%I', t, t);
    EXECUTE format('CREATE TRIGGER tr_%s_owner_only BEFORE INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.game_owner_only()', t, t);
  END LOOP;
END $$;

-- A closed day is frozen (its snapshot never changes); a day keeps its identity and opening
CREATE OR REPLACE FUNCTION public.game_day_guard()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.status = 'closed' THEN
    RAISE EXCEPTION 'game_day_closed' USING ERRCODE = '42501';
  END IF;
  IF NEW.user_id <> OLD.user_id OR NEW.game_day <> OLD.game_day OR NEW.opened_at <> OLD.opened_at
     OR NEW.timezone <> OLD.timezone OR NEW.study_first <> OLD.study_first OR NEW.rules_version <> OLD.rules_version THEN
    RAISE EXCEPTION 'game_day_identity' USING ERRCODE = '42501';
  END IF;
  NEW.version := OLD.version + 1;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;
DROP TRIGGER IF EXISTS tr_game_day_guard ON public.game_days;
CREATE TRIGGER tr_game_day_guard BEFORE UPDATE ON public.game_days FOR EACH ROW EXECUTE FUNCTION public.game_day_guard();

-- The diagnostics are append-only
DROP TRIGGER IF EXISTS tr_game_shadow_diagnostics_no_update ON public.game_shadow_diagnostics;
CREATE TRIGGER tr_game_shadow_diagnostics_no_update BEFORE UPDATE ON public.game_shadow_diagnostics
  FOR EACH ROW EXECUTE FUNCTION public.game_ledger_no_update();

--------------------------------------------------------------------------------
-- 3. Settings seeded as the owner
--------------------------------------------------------------------------------
SET LOCAL ROLE game_economy_owner;
INSERT INTO public.game_mode_missions (mode, slot, mission_id) VALUES
  ('trading',  1, 'q_bias'),       ('trading',  2, 'q_riskcheck'), ('trading',  3, 'q_reflect'),
  ('study',    1, '$study_first'), ('study',    2, 'm_backtest'),  ('study',    3, 'm_lesson'),
  ('recovery', 1, 'm_day_state'),  ('recovery', 2, 'm_mistake'),   ('recovery', 3, 'm_plan_tomorrow')
ON CONFLICT (mode, slot) DO NOTHING;
RESET ROLE;

--------------------------------------------------------------------------------
-- 4. Helpers (owner only)
--------------------------------------------------------------------------------
-- The account zone if Postgres knows it, else UTC (as the shadow check does)
CREATE OR REPLACE FUNCTION public.game_zone_of(p_user UUID)
RETURNS TEXT AS $$
DECLARE
  v_tz TEXT;
BEGIN
  SELECT timezone INTO v_tz FROM public.profiles WHERE id = p_user;
  IF v_tz IS NULL OR v_tz = '' THEN RETURN 'UTC'; END IF;
  BEGIN
    PERFORM now() AT TIME ZONE v_tz;
  EXCEPTION WHEN OTHERS THEN
    RETURN 'UTC';
  END;
  RETURN v_tz;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public;

-- The game day at a server time: the date in the account zone, never earlier than the day already opened
CREATE OR REPLACE FUNCTION public.game_day_now(p_user UUID, p_now TIMESTAMPTZ)
RETURNS DATE AS $$
  SELECT GREATEST((p_now AT TIME ZONE public.game_zone_of(p_user))::date,
                  (SELECT current_day FROM public.game_accounts WHERE user_id = p_user));
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

-- The missions of a mode for a study choice (rest: none)
CREATE OR REPLACE FUNCTION public.game_mode_core(p_mode TEXT, p_study_first TEXT)
RETURNS TEXT[] AS $$
  SELECT COALESCE(array_agg(CASE WHEN mission_id = '$study_first' THEN p_study_first ELSE mission_id END ORDER BY slot), '{}')
    FROM public.game_mode_missions WHERE mode = p_mode;
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

-- The study choice: the cloud journal has a live trade written (else opened) before the day, in the account zone
CREATE OR REPLACE FUNCTION public.game_study_first(p_user UUID, p_day DATE, p_zone TEXT)
RETURNS TEXT AS $$
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM public.journal_trades t
     WHERE t.user_id = p_user AND t.deleted_at IS NULL
       AND COALESCE(NULLIF(t.data ->> 'createdAt', ''), t.data ->> 'openedAt') ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$'
       AND ((COALESCE(NULLIF(t.data ->> 'createdAt', ''), t.data ->> 'openedAt'))::timestamptz AT TIME ZONE p_zone)::date < p_day)
  THEN 'm_trade_review' ELSE 'm_observation' END;
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

-- Missions paid on a day (from the ledger: the only truth for «paid»)
CREATE OR REPLACE FUNCTION public.game_paid_missions(p_user UUID, p_day DATE)
RETURNS TEXT[] AS $$
  SELECT COALESCE(array_agg(result ->> 'item' ORDER BY id), '{}')
    FROM public.game_ledger WHERE user_id = p_user AND game_day = p_day AND kind = 'mission';
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

-- The account must be on the server economy; takes the user's lock (the same row the award locks first)
CREATE OR REPLACE FUNCTION public.game_lock_account(p_user UUID)
RETURNS VOID AS $$
BEGIN
  IF p_user IS NULL OR (SELECT state FROM public.game_accounts WHERE user_id = p_user) IS DISTINCT FROM 'cloud_active' THEN
    RAISE EXCEPTION 'game_account_not_active' USING ERRCODE = '42501';
  END IF;
  PERFORM 1 FROM public.game_profile WHERE user_id = p_user FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'game_profile_missing' USING ERRCODE = '42501';
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION public.game_day_json(p_row public.game_days)
RETURNS JSONB AS $$
  SELECT (to_jsonb(p_row) - 'user_id') || jsonb_build_object('paid', to_jsonb(public.game_paid_missions(p_row.user_id, p_row.game_day)));
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

-- Closes every open day before p_day: the result is frozen (snapshot), never changed again
CREATE OR REPLACE FUNCTION public.game_days_close_before(p_user UUID, p_day DATE, p_now TIMESTAMPTZ)
RETURNS INTEGER AS $$
DECLARE
  r public.game_days%ROWTYPE;
  n INTEGER := 0;
BEGIN
  FOR r IN SELECT * FROM public.game_days WHERE user_id = p_user AND status = 'open' AND game_day < p_day ORDER BY game_day FOR UPDATE LOOP
    UPDATE public.game_days
       SET status = 'closed', closed_at = p_now,
           snapshot = jsonb_build_object(
             'game_day', r.game_day, 'mode', r.mode, 'core', to_jsonb(r.core), 'carried', r.carried, 'accepted', r.accepted,
             'passed', to_jsonb(r.passed), 'bonus', to_jsonb(r.bonus), 'replacements', r.replacements, 'mode_changes', r.mode_changes,
             'paid', to_jsonb(public.game_paid_missions(p_user, r.game_day)),
             'xp', (SELECT COALESCE(sum(xp), 0) FROM public.game_ledger WHERE user_id = p_user AND game_day = r.game_day),
             'coins', (SELECT COALESCE(sum(coins), 0) FROM public.game_ledger WHERE user_id = p_user AND game_day = r.game_day),
             'closed_at', p_now, 'rules_version', r.rules_version)
     WHERE user_id = p_user AND game_day = r.game_day;
    n := n + 1;
  END LOOP;
  RETURN n;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- The open day row of «now», locked (or an error: the app must open the day first)
CREATE OR REPLACE FUNCTION public.game_current_day(p_user UUID, p_now TIMESTAMPTZ)
RETURNS public.game_days AS $$
DECLARE
  r public.game_days%ROWTYPE;
BEGIN
  SELECT * INTO r FROM public.game_days
   WHERE user_id = p_user AND game_day = public.game_day_now(p_user, p_now) AND status = 'open' FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'game_day_not_open' USING ERRCODE = '55000';
  END IF;
  RETURN r;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

--------------------------------------------------------------------------------
-- 5. The day (the «_at» variants take the time: tests and the owner only)
--------------------------------------------------------------------------------
-- Opens the game day of «now» (closing every earlier open day) or returns it. p_mode: the mode the day starts in
-- (trading/study — the app knows the person's trading days); p_bonus: the extras the app offers (recorded only).
CREATE OR REPLACE FUNCTION public.game_day_open_at(p_user UUID, p_mode TEXT, p_bonus TEXT[], p_now TIMESTAMPTZ)
RETURNS JSONB AS $$
DECLARE
  v_day DATE;
  v_zone TEXT;
  v_first TEXT;
  r public.game_days%ROWTYPE;
  v_closed INTEGER;
BEGIN
  IF p_mode IS NULL OR p_mode NOT IN ('trading', 'study') OR p_now IS NULL THEN
    RAISE EXCEPTION 'game_bad_request' USING ERRCODE = '22023';
  END IF;
  IF cardinality(COALESCE(p_bonus, '{}')) > 4
     OR EXISTS (SELECT 1 FROM unnest(COALESCE(p_bonus, '{}')) b WHERE b !~ '^[a-z0-9_]{2,40}$'
                OR b IN (SELECT mission_id FROM public.game_mission_sources))
     OR cardinality(COALESCE(p_bonus, '{}')) <> (SELECT count(DISTINCT b) FROM unnest(COALESCE(p_bonus, '{}')) b) THEN
    RAISE EXCEPTION 'game_bad_request' USING ERRCODE = '22023';
  END IF;
  PERFORM public.game_lock_account(p_user);
  v_day := public.game_day_now(p_user, p_now);
  v_closed := public.game_days_close_before(p_user, v_day, p_now);
  SELECT * INTO r FROM public.game_days WHERE user_id = p_user AND game_day = v_day;
  IF FOUND THEN
    RETURN public.game_day_json(r) || jsonb_build_object('opened', FALSE, 'closed_days', v_closed);
  END IF;
  v_zone := public.game_zone_of(p_user);
  v_first := public.game_study_first(p_user, v_day, v_zone);
  INSERT INTO public.game_days (user_id, game_day, timezone, opened_at, mode, study_first, core, bonus, rules_version)
  VALUES (p_user, v_day, v_zone, p_now, p_mode, v_first, public.game_mode_core(p_mode, v_first), COALESCE(p_bonus, '{}'), 'q4.3')
  RETURNING * INTO r;
  UPDATE public.game_accounts SET current_day = v_day WHERE user_id = p_user AND current_day IS DISTINCT FROM v_day;
  RETURN public.game_day_json(r) || jsonb_build_object('opened', TRUE, 'closed_days', v_closed);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- The set of a new mode in the middle of the day (lib/quest-engine.ts composeSwitchedSet, catalog 3, core only): a slot
-- already paid keeps its mission; open slots take the new mode's missions; a mission put off is not offered again.
CREATE OR REPLACE FUNCTION public.game_compose_core(
  p_current TEXT[], p_from_mode TEXT, p_carried JSONB, p_fresh TEXT[], p_mode TEXT, p_done TEXT[], p_passed TEXT[],
  OUT core TEXT[], OUT carried JSONB)
AS $$
DECLARE
  v_slots INTEGER := GREATEST(COALESCE(cardinality(p_current), 0), COALESCE(cardinality(p_fresh), 0));
  v_core TEXT[] := array_fill(NULL::TEXT, ARRAY[GREATEST(v_slots, 1)]);
  v_used TEXT[] := '{}';
  v_id TEXT;
  v_from TEXT;
  v_pick TEXT;
  i INTEGER;
BEGIN
  carried := '{}'::jsonb;
  FOR i IN 1..COALESCE(cardinality(p_current), 0) LOOP
    v_id := p_current[i];
    IF v_id = ANY(p_done) THEN
      v_core[i] := v_id;
      v_used := v_used || v_id;
      v_from := COALESCE(p_carried ->> v_id, p_from_mode);
      IF v_from <> p_mode THEN carried := carried || jsonb_build_object(v_id, v_from); END IF;
    END IF;
  END LOOP;
  FOR i IN 1..v_slots LOOP
    CONTINUE WHEN v_core[i] IS NOT NULL;
    v_pick := NULL;
    FOREACH v_id IN ARRAY (ARRAY[p_fresh[i]] || p_fresh) LOOP
      IF v_id IS NOT NULL AND NOT (v_id = ANY(v_used)) AND (NOT (v_id = ANY(p_passed)) OR v_id = ANY(p_done)) THEN
        v_pick := v_id;
        EXIT;
      END IF;
    END LOOP;
    IF v_pick IS NULL THEN
      SELECT f INTO v_pick FROM unnest(p_fresh) WITH ORDINALITY AS x(f, o) WHERE NOT (f = ANY(v_used)) ORDER BY o LIMIT 1;
    END IF;
    CONTINUE WHEN v_pick IS NULL;
    v_core[i] := v_pick;
    v_used := v_used || v_pick;
  END LOOP;
  core := array_remove(v_core, NULL);
END;
$$ LANGUAGE plpgsql IMMUTABLE SET search_path = public;

CREATE OR REPLACE FUNCTION public.game_day_set_mode_at(p_user UUID, p_mode TEXT, p_now TIMESTAMPTZ)
RETURNS JSONB AS $$
DECLARE
  r public.game_days%ROWTYPE;
  v_back TEXT;
  v_from TEXT;
  v_new RECORD;
  v_change JSONB;
BEGIN
  IF p_mode IS NULL OR p_mode NOT IN ('trading', 'study', 'recovery', 'rest') OR p_now IS NULL THEN
    RAISE EXCEPTION 'game_bad_request' USING ERRCODE = '22023';
  END IF;
  PERFORM public.game_lock_account(p_user);
  r := public.game_current_day(p_user, p_now);
  IF p_mode = r.mode THEN
    RETURN public.game_day_json(r) || jsonb_build_object('changed', FALSE);
  END IF;
  v_change := jsonb_build_array(jsonb_build_object('to', p_mode, 'at', p_now));
  IF p_mode = 'rest' THEN
    UPDATE public.game_days SET mode = 'rest', mode_before_rest = r.mode, mode_changes = mode_changes || v_change
     WHERE user_id = p_user AND game_day = r.game_day RETURNING * INTO r;
    RETURN public.game_day_json(r) || jsonb_build_object('changed', TRUE);
  END IF;
  v_back := r.mode_before_rest;
  IF r.mode = 'rest' AND p_mode = v_back THEN
    UPDATE public.game_days SET mode = v_back, mode_before_rest = NULL, mode_changes = mode_changes || v_change
     WHERE user_id = p_user AND game_day = r.game_day RETURNING * INTO r;
    RETURN public.game_day_json(r) || jsonb_build_object('changed', TRUE);
  END IF;
  v_from := CASE WHEN r.mode = 'rest' THEN v_back ELSE r.mode END;
  SELECT * INTO v_new FROM public.game_compose_core(r.core, v_from, r.carried, public.game_mode_core(p_mode, r.study_first), p_mode,
    public.game_paid_missions(p_user, r.game_day), r.passed);
  UPDATE public.game_days SET mode = p_mode, mode_before_rest = NULL, core = v_new.core, carried = v_new.carried,
         mode_changes = mode_changes || v_change
   WHERE user_id = p_user AND game_day = r.game_day RETURNING * INTO r;
  RETURN public.game_day_json(r) || jsonb_build_object('changed', TRUE);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Accepting gives nothing (QH-6.6); accepting again keeps the first time
CREATE OR REPLACE FUNCTION public.game_day_accept_at(p_user UUID, p_mission TEXT, p_now TIMESTAMPTZ)
RETURNS JSONB AS $$
DECLARE
  r public.game_days%ROWTYPE;
BEGIN
  IF p_mission IS NULL OR p_mission !~ '^[a-z0-9_]{2,40}$' OR p_now IS NULL THEN
    RAISE EXCEPTION 'game_bad_request' USING ERRCODE = '22023';
  END IF;
  PERFORM public.game_lock_account(p_user);
  r := public.game_current_day(p_user, p_now);
  IF r.mode = 'rest' THEN
    RAISE EXCEPTION 'game_day_rest' USING ERRCODE = '55000';
  END IF;
  IF NOT (p_mission = ANY(r.core)) THEN
    RAISE EXCEPTION 'game_mission_not_assigned' USING ERRCODE = '55000';
  END IF;
  IF p_mission = ANY(public.game_paid_missions(p_user, r.game_day)) THEN
    RAISE EXCEPTION 'game_mission_paid' USING ERRCODE = '55000';
  END IF;
  IF r.accepted ? p_mission THEN
    RETURN jsonb_build_object('mission', p_mission, 'accepted_at', r.accepted ->> p_mission, 'repeat', TRUE, 'game_day', r.game_day);
  END IF;
  UPDATE public.game_days SET accepted = accepted || jsonb_build_object(p_mission, p_now)
   WHERE user_id = p_user AND game_day = r.game_day RETURNING * INTO r;
  RETURN jsonb_build_object('mission', p_mission, 'accepted_at', r.accepted ->> p_mission, 'repeat', FALSE, 'game_day', r.game_day);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- «Not today» for a mission of the set (a later mode change does not offer it again)
CREATE OR REPLACE FUNCTION public.game_day_pass_at(p_user UUID, p_mission TEXT, p_now TIMESTAMPTZ)
RETURNS JSONB AS $$
DECLARE
  r public.game_days%ROWTYPE;
BEGIN
  IF p_mission IS NULL OR p_mission !~ '^[a-z0-9_]{2,40}$' OR p_now IS NULL THEN
    RAISE EXCEPTION 'game_bad_request' USING ERRCODE = '22023';
  END IF;
  PERFORM public.game_lock_account(p_user);
  r := public.game_current_day(p_user, p_now);
  IF NOT (p_mission = ANY(r.core)) THEN
    RAISE EXCEPTION 'game_mission_not_assigned' USING ERRCODE = '55000';
  END IF;
  IF p_mission = ANY(public.game_paid_missions(p_user, r.game_day)) THEN
    RAISE EXCEPTION 'game_mission_paid' USING ERRCODE = '55000';
  END IF;
  IF NOT (p_mission = ANY(r.passed)) THEN
    UPDATE public.game_days SET passed = passed || p_mission WHERE user_id = p_user AND game_day = r.game_day RETURNING * INTO r;
  END IF;
  RETURN public.game_day_json(r);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Replaces an extra by another (a mission is never replaced). The app picks the new extra (its pool depends on the
-- onboarding answers, which only the app has); the server keeps the limit, the history and the rules below.
CREATE OR REPLACE FUNCTION public.game_day_replace_at(p_user UUID, p_from TEXT, p_to TEXT, p_now TIMESTAMPTZ)
RETURNS JSONB AS $$
DECLARE
  r public.game_days%ROWTYPE;
  v_limit INTEGER;
BEGIN
  IF p_from IS NULL OR p_to IS NULL OR p_from !~ '^[a-z0-9_]{2,40}$' OR p_to !~ '^[a-z0-9_]{2,40}$' OR p_from = p_to OR p_now IS NULL THEN
    RAISE EXCEPTION 'game_bad_request' USING ERRCODE = '22023';
  END IF;
  PERFORM public.game_lock_account(p_user);
  r := public.game_current_day(p_user, p_now);
  IF r.mode = 'rest' THEN
    RAISE EXCEPTION 'game_day_rest' USING ERRCODE = '55000';
  END IF;
  IF p_from IN (SELECT mission_id FROM public.game_mission_sources) OR p_to IN (SELECT mission_id FROM public.game_mission_sources) THEN
    RAISE EXCEPTION 'game_not_replaceable' USING ERRCODE = '55000';
  END IF;
  IF NOT (p_from = ANY(r.bonus)) THEN
    RAISE EXCEPTION 'game_not_offered' USING ERRCODE = '55000';
  END IF;
  IF p_to = ANY(r.bonus) OR EXISTS (SELECT 1 FROM jsonb_array_elements(r.replacements) x WHERE x ->> 'from' IN (p_from, p_to) OR x ->> 'to' = p_to) THEN
    RAISE EXCEPTION 'game_not_replaceable' USING ERRCODE = '55000';
  END IF;
  SELECT replacements_per_day INTO v_limit FROM public.game_limits WHERE id = 1;
  IF jsonb_array_length(r.replacements) >= v_limit THEN
    RAISE EXCEPTION 'game_replacement_limit' USING ERRCODE = '23514';
  END IF;
  UPDATE public.game_days
     SET bonus = array_replace(bonus, p_from, p_to),
         replacements = replacements || jsonb_build_array(jsonb_build_object('from', p_from, 'to', p_to, 'at', p_now))
   WHERE user_id = p_user AND game_day = r.game_day RETURNING * INTO r;
  RETURN public.game_day_json(r);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- What the server can say about a mission today (assigned, accepted, fits the mode, paid, day full, open)
CREATE OR REPLACE FUNCTION public.game_mission_status_at(p_user UUID, p_mission TEXT, p_now TIMESTAMPTZ)
RETURNS JSONB AS $$
DECLARE
  v_day DATE := public.game_day_now(p_user, p_now);
  r public.game_days%ROWTYPE;
  v_paid TEXT[];
BEGIN
  SELECT * INTO r FROM public.game_days WHERE user_id = p_user AND game_day = v_day;
  IF NOT FOUND OR r.status <> 'open' THEN
    RETURN jsonb_build_object('game_day', v_day, 'open', FALSE);
  END IF;
  v_paid := public.game_paid_missions(p_user, v_day);
  RETURN jsonb_build_object(
    'game_day', v_day, 'open', TRUE, 'mode', r.mode,
    'assigned', r.mode <> 'rest' AND p_mission = ANY(r.core),
    'mode_fits', p_mission = ANY(public.game_mode_core(r.mode, r.study_first)) OR (r.carried ? p_mission),
    'accepted', r.accepted ? p_mission,
    'paid', p_mission = ANY(v_paid),
    'day_full', cardinality(v_paid) >= (SELECT day_count_max FROM public.game_reward_rules WHERE code = 'mission'));
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public;

--------------------------------------------------------------------------------
-- 6. The award (0014) now needs the server day: open, the mission in its set, accepted
--------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.game_apply_reward_at(
  p_user UUID,
  p_kind TEXT,
  p_item TEXT,
  p_evidence JSONB,
  p_now TIMESTAMPTZ
)
RETURNS JSONB AS $$
DECLARE
  v_state TEXT;
  v_sync BOOLEAN;
  v_enabled BOOLEAN;
  v_profile public.game_profile%ROWTYPE;
  v_existing public.game_ledger%ROWTYPE;
  v_rule public.game_reward_rules%ROWTYPE;
  v_limits public.game_limits%ROWTYPE;
  v_dayrow public.game_days%ROWTYPE;
  v_day DATE;
  v_key TEXT;
  v_rule_code TEXT;
  v_ev JSONB;
  v_evidence JSONB := '[]'::jsonb;
  v_part TEXT;
  v_found RECORD;
  v_n INTEGER;
  v_xp INTEGER;
  v_coins INTEGER;
  v_used INTEGER;
  v_ledger_id BIGINT;
  v_total BIGINT;
  v_level_after INTEGER;
  v_result JSONB;
BEGIN
  IF p_user IS NULL OR p_kind IS NULL OR p_item IS NULL OR p_item !~ '^[A-Za-z0-9_.-]{1,80}$' OR p_now IS NULL THEN
    RAISE EXCEPTION 'game_bad_request' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(COALESCE(p_evidence, '[]'::jsonb)) <> 'array' OR jsonb_array_length(COALESCE(p_evidence, '[]'::jsonb)) > 5 THEN
    RAISE EXCEPTION 'game_bad_evidence' USING ERRCODE = '22023';
  END IF;

  -- 1. Fail-closed: the kind must exist, be implemented here, and be enabled by the owner
  SELECT enabled INTO v_enabled FROM public.game_award_kinds WHERE kind = p_kind;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'game_unknown_kind' USING ERRCODE = '22023';
  END IF;
  IF p_kind <> 'mission' THEN
    RAISE EXCEPTION 'game_kind_not_implemented' USING ERRCODE = '0A000';
  END IF;
  IF NOT v_enabled THEN
    RAISE EXCEPTION 'game_kind_disabled' USING ERRCODE = '42501';
  END IF;

  -- 2. The account must be on the server economy and the flag on (off = paused, never back to local awards)
  SELECT state INTO v_state FROM public.game_accounts WHERE user_id = p_user;
  IF v_state IS DISTINCT FROM 'cloud_active' THEN
    RAISE EXCEPTION 'game_account_not_active' USING ERRCODE = '42501';
  END IF;
  SELECT COALESCE((SELECT game_sync FROM public.user_features WHERE user_id = p_user), FALSE) INTO v_sync;
  IF NOT v_sync THEN
    RAISE EXCEPTION 'game_sync_paused' USING ERRCODE = '42501';
  END IF;

  -- 3. One change at a time per user (awards and day changes take the same lock)
  SELECT * INTO v_profile FROM public.game_profile WHERE user_id = p_user FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'game_profile_missing' USING ERRCODE = '42501';
  END IF;

  -- 4. The server game day (never earlier than the day opened) and the canonical key
  v_day := public.game_day_now(p_user, p_now);
  v_rule_code := 'mission';
  v_key := 'mission:' || v_day || ':' || p_item;

  -- 5. A repeat returns the saved result (another tab, device, retry)
  SELECT * INTO v_existing FROM public.game_ledger WHERE user_id = p_user AND idempotency_key = v_key;
  IF FOUND THEN
    RETURN v_existing.result || jsonb_build_object('replay', TRUE);
  END IF;

  -- 6. The mission must be known; the day open on the server; the mission in its set for the mode; accepted
  IF NOT EXISTS (SELECT 1 FROM public.game_mission_sources WHERE mission_id = p_item) THEN
    RAISE EXCEPTION 'game_unknown_mission' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_dayrow FROM public.game_days WHERE user_id = p_user AND game_day = v_day AND status = 'open' FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'game_day_not_open' USING ERRCODE = '55000';
  END IF;
  IF v_dayrow.mode = 'rest' OR NOT (p_item = ANY(v_dayrow.core)) THEN
    RAISE EXCEPTION 'game_mission_not_assigned' USING ERRCODE = '55000';
  END IF;
  IF NOT (v_dayrow.accepted ? p_item) THEN
    RAISE EXCEPTION 'game_mission_not_accepted' USING ERRCODE = '55000';
  END IF;
  IF jsonb_array_length(COALESCE(p_evidence, '[]'::jsonb)) = 0 THEN
    RAISE EXCEPTION 'game_evidence_required' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_rule FROM public.game_reward_rules WHERE code = v_rule_code AND active;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'game_unknown_rule' USING ERRCODE = '22023';
  END IF;

  -- 7. Evidence: exactly the rows the route checked, still unchanged, of this user, of an accepted type (locked)
  FOR v_ev IN SELECT * FROM jsonb_array_elements(p_evidence) LOOP
    IF (v_ev ->> 'id') IS NULL OR (v_ev ->> 'version') IS NULL OR (v_ev ->> 'fp') IS NULL THEN
      RAISE EXCEPTION 'game_bad_evidence' USING ERRCODE = '22023';
    END IF;
    SELECT part INTO v_part FROM public.game_mission_sources WHERE mission_id = p_item AND table_name = (v_ev ->> 'table');
    IF NOT FOUND THEN
      RAISE EXCEPTION 'game_evidence_type' USING ERRCODE = '22023';
    END IF;
    EXECUTE format('SELECT client_updated_at, deleted_at, md5(data::text) AS fp FROM public.%I WHERE user_id = $1 AND id = $2 FOR SHARE', v_ev ->> 'table')
      INTO v_found USING p_user, v_ev ->> 'id';
    IF v_found IS NULL OR v_found.client_updated_at IS NULL THEN
      RAISE EXCEPTION 'game_evidence_missing' USING ERRCODE = '40001';
    END IF;
    IF v_found.deleted_at IS NOT NULL
       OR v_found.client_updated_at <> (v_ev ->> 'version')::timestamptz
       OR v_found.fp <> (v_ev ->> 'fp') THEN
      RAISE EXCEPTION 'game_evidence_changed' USING ERRCODE = '40001';
    END IF;
    v_evidence := v_evidence || jsonb_build_array(jsonb_build_object(
      'table', v_ev ->> 'table', 'id', v_ev ->> 'id', 'version', v_ev ->> 'version', 'fp', v_ev ->> 'fp',
      'source_key', (v_ev ->> 'table') || ':' || (v_ev ->> 'id') || ':' || v_part));
  END LOOP;

  -- 8. Day caps on the locked state
  IF v_rule.day_count_group IS NOT NULL THEN
    SELECT count(*) INTO v_n FROM public.game_ledger l JOIN public.game_reward_rules r ON r.code = l.rule_code
      WHERE l.user_id = p_user AND l.game_day = v_day AND r.day_count_group = v_rule.day_count_group;
    IF v_n >= v_rule.day_count_max THEN
      RAISE EXCEPTION 'game_day_cap' USING ERRCODE = '23514';
    END IF;
  END IF;
  v_xp := v_rule.xp;
  IF v_rule.day_xp_group IS NOT NULL THEN
    SELECT COALESCE(sum(l.xp), 0) INTO v_used FROM public.game_ledger l JOIN public.game_reward_rules r ON r.code = l.rule_code
      WHERE l.user_id = p_user AND l.game_day = v_day AND r.day_xp_group = v_rule.day_xp_group;
    v_xp := GREATEST(0, LEAST(v_xp, v_rule.day_xp_max - v_used));
  END IF;
  SELECT * INTO v_limits FROM public.game_limits WHERE id = 1;
  SELECT COALESCE(sum(coins), 0) INTO v_used FROM public.game_ledger WHERE user_id = p_user AND game_day = v_day;
  v_coins := GREATEST(0, LEAST(v_rule.coins, v_limits.coins_per_day - v_used));

  -- 9. Write: ledger, source claims, projection — all or nothing (this function runs as the owner)
  v_total := v_profile.xp_total + v_xp;
  v_level_after := public.game_level_for_xp(v_total);
  v_result := jsonb_build_object(
    'key', v_key, 'kind', p_kind, 'item', p_item, 'rule', v_rule_code, 'game_day', v_day, 'xp', v_xp, 'coins', v_coins,
    'xp_total', v_total, 'coins_total', v_profile.coins + v_coins,
    'level_before', v_profile.level, 'level_after', v_level_after, 'replay', FALSE);
  INSERT INTO public.game_ledger (user_id, idempotency_key, kind, rule_code, game_day, xp, coins, rules_version, evidence, result)
  VALUES (p_user, v_key, p_kind, v_rule_code, v_day, v_xp, v_coins, v_rule.rules_version, v_evidence, v_result)
  RETURNING id INTO v_ledger_id;

  FOR v_ev IN SELECT * FROM jsonb_array_elements(v_evidence) LOOP
    BEGIN
      INSERT INTO public.game_source_claims (user_id, scope, source_key, game_day, ledger_id)
      VALUES (p_user, v_rule.source_scope, v_ev ->> 'source_key', v_day, v_ledger_id);
    EXCEPTION WHEN unique_violation THEN
      RAISE EXCEPTION 'game_source_used' USING ERRCODE = '23505';
    END;
  END LOOP;

  UPDATE public.game_profile
     SET xp_total = v_total, level = v_level_after, coins = coins + v_coins,
         last_ledger_id = v_ledger_id, version = version + 1, updated_at = now()
   WHERE user_id = p_user;
  RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- The API: server time only
CREATE OR REPLACE FUNCTION public.game_apply_reward(p_user UUID, p_kind TEXT, p_item TEXT, p_evidence JSONB DEFAULT '[]'::jsonb)
RETURNS JSONB AS $$ SELECT public.game_apply_reward_at(p_user, p_kind, p_item, p_evidence, now()); $$
LANGUAGE sql SECURITY DEFINER SET search_path = public;
CREATE OR REPLACE FUNCTION public.game_day_open(p_user UUID, p_mode TEXT, p_bonus TEXT[] DEFAULT '{}')
RETURNS JSONB AS $$ SELECT public.game_day_open_at(p_user, p_mode, p_bonus, now()); $$ LANGUAGE sql SECURITY DEFINER SET search_path = public;
CREATE OR REPLACE FUNCTION public.game_day_set_mode(p_user UUID, p_mode TEXT)
RETURNS JSONB AS $$ SELECT public.game_day_set_mode_at(p_user, p_mode, now()); $$ LANGUAGE sql SECURITY DEFINER SET search_path = public;
CREATE OR REPLACE FUNCTION public.game_day_accept(p_user UUID, p_mission TEXT)
RETURNS JSONB AS $$ SELECT public.game_day_accept_at(p_user, p_mission, now()); $$ LANGUAGE sql SECURITY DEFINER SET search_path = public;
CREATE OR REPLACE FUNCTION public.game_day_pass(p_user UUID, p_mission TEXT)
RETURNS JSONB AS $$ SELECT public.game_day_pass_at(p_user, p_mission, now()); $$ LANGUAGE sql SECURITY DEFINER SET search_path = public;
CREATE OR REPLACE FUNCTION public.game_day_replace(p_user UUID, p_from TEXT, p_to TEXT)
RETURNS JSONB AS $$ SELECT public.game_day_replace_at(p_user, p_from, p_to, now()); $$ LANGUAGE sql SECURITY DEFINER SET search_path = public;
CREATE OR REPLACE FUNCTION public.game_mission_status(p_user UUID, p_mission TEXT)
RETURNS JSONB AS $$ SELECT public.game_mission_status_at(p_user, p_mission, now()); $$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

-- The person's own day, read with the person's session (RLS): for the shadow check, nothing is written
CREATE OR REPLACE FUNCTION public.game_my_day()
RETURNS JSONB AS $$
  SELECT jsonb_build_object(
    'current_day', a.current_day,
    'day', CASE WHEN d.user_id IS NULL THEN NULL ELSE (to_jsonb(d) - 'user_id' - 'snapshot') END,
    'paid', COALESCE((SELECT jsonb_agg(l.result ->> 'item' ORDER BY l.id) FROM public.game_ledger l
                       WHERE l.user_id = a.user_id AND l.game_day = a.current_day AND l.kind = 'mission'), '[]'::jsonb),
    'claims', COALESCE((SELECT jsonb_agg(c.source_key ORDER BY c.source_key) FROM public.game_source_claims c
                         WHERE c.user_id = a.user_id AND c.game_day = a.current_day AND c.scope = 'mission'), '[]'::jsonb))
  FROM public.game_accounts a
  LEFT JOIN public.game_days d ON d.user_id = a.user_id AND d.game_day = a.current_day
  WHERE a.user_id = auth.uid();
$$ LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public;

-- Shadow diagnostics: at most 10 rows a call, codes only (sending stays off; service role only)
CREATE OR REPLACE FUNCTION public.game_record_shadow(p_rows JSONB)
RETURNS INTEGER AS $$
DECLARE
  v JSONB;
  n INTEGER := 0;
BEGIN
  IF jsonb_typeof(p_rows) <> 'array' OR jsonb_array_length(p_rows) > 10 THEN
    RAISE EXCEPTION 'game_bad_request' USING ERRCODE = '22023';
  END IF;
  FOR v IN SELECT * FROM jsonb_array_elements(p_rows) LOOP
    IF EXISTS (SELECT 1 FROM jsonb_object_keys(v) k WHERE k NOT IN ('category', 'mission_id', 'game_day', 'rules_version')) THEN
      RAISE EXCEPTION 'game_bad_request' USING ERRCODE = '22023';
    END IF;
    INSERT INTO public.game_shadow_diagnostics (category, mission_id, game_day, rules_version)
    VALUES (v ->> 'category', v ->> 'mission_id', (v ->> 'game_day')::date, v ->> 'rules_version');
    n := n + 1;
  END LOOP;
  RETURN n;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DO $$
DECLARE f TEXT;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'game_zone_of(uuid)', 'game_day_now(uuid,timestamptz)', 'game_mode_core(text,text)', 'game_study_first(uuid,date,text)',
    'game_paid_missions(uuid,date)', 'game_lock_account(uuid)', 'game_day_json(public.game_days)',
    'game_days_close_before(uuid,date,timestamptz)', 'game_current_day(uuid,timestamptz)',
    'game_compose_core(text[],text,jsonb,text[],text,text[],text[])',
    'game_day_open_at(uuid,text,text[],timestamptz)', 'game_day_set_mode_at(uuid,text,timestamptz)',
    'game_day_accept_at(uuid,text,timestamptz)', 'game_day_pass_at(uuid,text,timestamptz)',
    'game_day_replace_at(uuid,text,text,timestamptz)', 'game_mission_status_at(uuid,text,timestamptz)',
    'game_apply_reward_at(uuid,text,text,jsonb,timestamptz)',
    'game_apply_reward(uuid,text,text,jsonb)', 'game_day_open(uuid,text,text[])', 'game_day_set_mode(uuid,text)',
    'game_day_accept(uuid,text)', 'game_day_pass(uuid,text)', 'game_day_replace(uuid,text,text)', 'game_mission_status(uuid,text)',
    'game_record_shadow(jsonb)'] LOOP
    EXECUTE format('ALTER FUNCTION public.%s OWNER TO game_economy_owner', f);
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated, service_role', f);
  END LOOP;
  -- the API of the server route (service role, user from the verified session, server time)
  FOREACH f IN ARRAY ARRAY['game_apply_reward(uuid,text,text,jsonb)', 'game_day_open(uuid,text,text[])', 'game_day_set_mode(uuid,text)',
    'game_day_accept(uuid,text)', 'game_day_pass(uuid,text)', 'game_day_replace(uuid,text,text)', 'game_mission_status(uuid,text)',
    'game_record_shadow(jsonb)'] LOOP
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO service_role', f);
  END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.game_my_day() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.game_my_day() TO authenticated;

--------------------------------------------------------------------------------
-- 7. Access
--------------------------------------------------------------------------------
ALTER TABLE public.game_mode_missions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.game_days ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.game_shadow_diagnostics ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.game_mode_missions, public.game_days, public.game_shadow_diagnostics FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.game_days, public.game_source_claims TO authenticated;
GRANT SELECT ON public.game_mode_missions, public.game_days, public.game_shadow_diagnostics TO service_role;
DROP POLICY IF EXISTS game_days_select_own ON public.game_days;
CREATE POLICY game_days_select_own ON public.game_days FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id);
DROP POLICY IF EXISTS game_source_claims_select_own ON public.game_source_claims;
CREATE POLICY game_source_claims_select_own ON public.game_source_claims FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id);

COMMIT;
