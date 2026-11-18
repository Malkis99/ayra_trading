-- AYRA Trading — rollback of 0016 (server game day API). Restores the 0015 day functions exactly as 0015 defined them,
-- removes the trading days, the extras catalog, the first-seen trace and the API helpers. 0015, 0014 and the Journal
-- tables (with their rows) stay.
BEGIN;

DO $$
DECLARE f TEXT;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'game_day_open(uuid,text[])', 'game_day_set_mode(uuid,text,text[])', 'game_set_trading_days(uuid,smallint[])',
    'game_day_status(uuid)', 'game_day_today(uuid)', 'game_journal_for_check(uuid,date)',
    'game_day_open_at(uuid,text[],timestamptz)', 'game_day_set_mode_at(uuid,text,text[],timestamptz)',
    'game_set_trading_days_at(uuid,smallint[],timestamptz)', 'game_day_status_at(uuid,timestamptz)',
    'game_check_extras(text,text[],text[])', 'game_default_mode(uuid,date)', 'game_trading_days_on(uuid,date)'] LOOP
    EXECUTE format('DROP FUNCTION IF EXISTS public.%s', f);
  END LOOP;
END $$;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['journal_trades', 'journal_day_plans', 'journal_week_plans', 'journal_notes', 'journal_no_trades'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS tr_%s_first_seen ON public.%I', t, t);
    EXECUTE format('ALTER TABLE public.%I DROP COLUMN IF EXISTS first_seen_at', t);
  END LOOP;
END $$;
DROP FUNCTION IF EXISTS public.journal_row_first_seen();
DROP TABLE IF EXISTS public.game_extra_quests;
ALTER TABLE public.game_accounts DROP CONSTRAINT IF EXISTS game_accounts_trading_days_check;
ALTER TABLE public.game_accounts DROP COLUMN IF EXISTS trading_days_next_from;
ALTER TABLE public.game_accounts DROP COLUMN IF EXISTS trading_days_next;
ALTER TABLE public.game_accounts DROP COLUMN IF EXISTS trading_days;

-- the 0015 day functions, as 0015 defined them
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

CREATE OR REPLACE FUNCTION public.game_day_open(p_user UUID, p_mode TEXT, p_bonus TEXT[] DEFAULT '{}')
RETURNS JSONB AS $$ SELECT public.game_day_open_at(p_user, p_mode, p_bonus, now()); $$ LANGUAGE sql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION public.game_day_set_mode(p_user UUID, p_mode TEXT)
RETURNS JSONB AS $$ SELECT public.game_day_set_mode_at(p_user, p_mode, now()); $$ LANGUAGE sql SECURITY DEFINER SET search_path = public;

DO $$
DECLARE f TEXT;
BEGIN
  FOREACH f IN ARRAY ARRAY['game_day_open_at(uuid,text,text[],timestamptz)', 'game_day_set_mode_at(uuid,text,timestamptz)',
    'game_day_replace_at(uuid,text,text,timestamptz)', 'game_day_open(uuid,text,text[])', 'game_day_set_mode(uuid,text)'] LOOP
    EXECUTE format('ALTER FUNCTION public.%s OWNER TO game_economy_owner', f);
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated, service_role', f);
  END LOOP;
  GRANT EXECUTE ON FUNCTION public.game_day_open(uuid,text,text[]) TO service_role;
  GRANT EXECUTE ON FUNCTION public.game_day_set_mode(uuid,text) TO service_role;
END $$;

COMMIT;
