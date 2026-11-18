-- AYRA Trading — 0016: the server game day API (Q4.4, docs/q4-4-server-day-api.md). NOT APPLIED TO SUPABASE.
-- Needs 0014 and 0015 (also not applied). Nothing is switched on: no account is activated, game_sync stays off, the
-- mission award kind stays disabled. Rollback: 0016_game_day_api.down.sql (restores the 0015 day functions).
--
--   * The server keeps the person's trading days (effective from the next game day: a change never re-makes today) and
--     opens a day in the mode those days give — the app no longer names the opening mode.
--   * Extras come only from the catalog (game_extra_quests, generated from lib/quests.ts and parity-tested): the extras of
--     the mode, at most two, no repeats; a replacement is a self-reported quest of the mode's pool with no more XP.
--   * Every Journal row gets first_seen_at: the server time it first reached the server. Set by a trigger, kept on every
--     update (a client, the service key or the owner cannot change it); rows that existed before 0016 have NULL
--     («unknown»: they never count as made today on the server).
--   * game_day_status: the day as the API shows it; game_journal_for_check: the rows a mission check reads, with the
--     version and the md5 fingerprint computed by Postgres (the same the award compares).
--
-- Idempotent: safe to run twice.

BEGIN;

--------------------------------------------------------------------------------
-- 1. Trading days on the server (0 = Monday … 6 = Sunday, lib/quest-engine.ts ALL_DAYS)
--------------------------------------------------------------------------------
ALTER TABLE public.game_accounts ADD COLUMN IF NOT EXISTS trading_days SMALLINT[];
ALTER TABLE public.game_accounts ADD COLUMN IF NOT EXISTS trading_days_next SMALLINT[];
ALTER TABLE public.game_accounts ADD COLUMN IF NOT EXISTS trading_days_next_from DATE;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'game_accounts_trading_days_check') THEN
    ALTER TABLE public.game_accounts ADD CONSTRAINT game_accounts_trading_days_check CHECK (
      (trading_days IS NULL OR (cardinality(trading_days) BETWEEN 1 AND 7 AND trading_days <@ ARRAY[0,1,2,3,4,5,6]::smallint[]))
      AND (trading_days_next IS NULL OR (cardinality(trading_days_next) BETWEEN 1 AND 7 AND trading_days_next <@ ARRAY[0,1,2,3,4,5,6]::smallint[]))
      AND ((trading_days_next IS NULL) = (trading_days_next_from IS NULL)));
  END IF;
END $$;

--------------------------------------------------------------------------------
-- 2. The quest catalog of extras (lib/quests.ts QUEST_POOL, lib/quest-engine.ts extrasForMode / poolForMode)
--------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.game_extra_quests (
  id TEXT PRIMARY KEY CHECK (id ~ '^[a-z0-9_]{2,40}$'),
  -- what replacing it allows at most (questReward(q).xp) and what it counts as a replacement (q.xpReward)
  reward_xp INTEGER NOT NULL CHECK (reward_xp BETWEEN 0 AND 1000),
  xp_reward INTEGER NOT NULL CHECK (xp_reward BETWEEN 0 AND 1000),
  extra_modes TEXT[] NOT NULL,
  pool_modes TEXT[] NOT NULL,
  -- a self-reported quest (not closed by the Journal): only those may be replaced or come in as a replacement
  replaceable BOOLEAN NOT NULL
);
ALTER TABLE public.game_extra_quests OWNER TO game_economy_owner;
DROP TRIGGER IF EXISTS tr_game_extra_quests_owner_only ON public.game_extra_quests;
CREATE TRIGGER tr_game_extra_quests_owner_only BEFORE INSERT OR UPDATE OR DELETE ON public.game_extra_quests
  FOR EACH ROW EXECUTE FUNCTION public.game_owner_only();
SET LOCAL ROLE game_economy_owner;
INSERT INTO public.game_extra_quests (id, reward_xp, xp_reward, extra_modes, pool_modes, replaceable) VALUES
  ('q_bias', 40, 40, '{}', '{trading}', false),
  ('q_tradelog', 40, 40, '{}', '{}', false),
  ('q_reflect', 40, 40, '{}', '{trading,study,recovery}', false),
  ('q_walk', 30, 30, '{trading,recovery}', '{trading,recovery}', true),
  ('q_meditate', 30, 30, '{trading,recovery}', '{trading,recovery}', true),
  ('q_riskcheck', 40, 30, '{}', '{trading}', false),
  ('q_screenplan', 40, 40, '{trading,study}', '{trading,study}', true),
  ('q_nosocial', 35, 35, '{trading}', '{trading}', true),
  ('q_community_post', 35, 35, '{trading,study}', '{trading,study}', true),
  ('q_review_mistake', 50, 50, '{}', '{trading,study,recovery}', true),
  ('q_sleep_prep', 25, 25, '{trading,recovery}', '{trading,recovery}', true),
  ('q_backtest', 50, 50, '{}', '{trading,study}', true),
  ('q_logic_puzzle', 35, 35, '{trading,study}', '{trading,study}', true),
  ('q_lang_study', 35, 35, '{trading,study}', '{trading,study}', true),
  ('q_workout', 40, 40, '{trading}', '{trading}', true),
  ('q_stretching', 30, 30, '{trading,recovery}', '{trading,recovery}', true),
  ('q_read_pages', 30, 30, '{trading,study,recovery}', '{trading,study,recovery}', true),
  ('q_lang_10m', 30, 30, '{trading,study}', '{trading,study}', true),
  ('q_running', 35, 35, '{trading}', '{trading}', true),
  ('q_swimming', 40, 40, '{trading}', '{trading}', true),
  ('q_gym', 45, 45, '{trading}', '{trading}', true)
ON CONFLICT (id) DO NOTHING;
RESET ROLE;

--------------------------------------------------------------------------------
-- 3. The first server trace of a Journal row
--------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.journal_row_first_seen()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.first_seen_at := now();            -- server time; whatever the writer sent is replaced
  ELSE
    NEW.first_seen_at := OLD.first_seen_at; -- never changes afterwards (updates, tombstones, re-syncs, imports)
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['journal_trades', 'journal_day_plans', 'journal_week_plans', 'journal_notes', 'journal_no_trades'] LOOP
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS first_seen_at TIMESTAMPTZ', t);
    -- runs after tr_<t>_before_write (names fire in order): a row the last-write-wins rule skips never reaches it
    EXECUTE format('DROP TRIGGER IF EXISTS tr_%s_first_seen ON public.%I', t, t);
    EXECUTE format('CREATE TRIGGER tr_%s_first_seen BEFORE INSERT OR UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.journal_row_first_seen()', t, t);
  END LOOP;
END $$;

--------------------------------------------------------------------------------
-- 4. Helpers
--------------------------------------------------------------------------------
-- The trading days in force on a day (the next set applies from its day on; none saved = every day)
CREATE OR REPLACE FUNCTION public.game_trading_days_on(p_user UUID, p_day DATE)
RETURNS SMALLINT[] AS $$
  SELECT COALESCE(
    CASE WHEN a.trading_days_next_from IS NOT NULL AND p_day >= a.trading_days_next_from THEN a.trading_days_next ELSE a.trading_days END,
    ARRAY[0,1,2,3,4,5,6]::smallint[])
  FROM public.game_accounts a WHERE a.user_id = p_user;
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

-- The mode a day starts in (lib/quest-engine.ts defaultModeFor): trading on a trading day, study on the others
CREATE OR REPLACE FUNCTION public.game_default_mode(p_user UUID, p_day DATE)
RETURNS TEXT AS $$
  SELECT CASE WHEN (EXTRACT(ISODOW FROM p_day)::int - 1)::smallint = ANY(public.game_trading_days_on(p_user, p_day)) THEN 'trading' ELSE 'study' END;
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

-- Extras for a mode: from the catalog, at most two, no repeats (p_keep: extras already in the day, kept on a mode change)
CREATE OR REPLACE FUNCTION public.game_check_extras(p_mode TEXT, p_bonus TEXT[], p_keep TEXT[] DEFAULT '{}')
RETURNS VOID AS $$
DECLARE
  v_max INTEGER := (CASE WHEN p_mode = 'rest' THEN 0 ELSE 2 END);  -- a rest day offers no extras
BEGIN
  IF cardinality(COALESCE(p_bonus, '{}')) > v_max
     OR cardinality(COALESCE(p_bonus, '{}')) <> (SELECT count(DISTINCT b) FROM unnest(COALESCE(p_bonus, '{}')) b)
     OR EXISTS (SELECT 1 FROM unnest(COALESCE(p_bonus, '{}')) b
                WHERE NOT (b = ANY(COALESCE(p_keep, '{}')))
                  AND NOT EXISTS (SELECT 1 FROM public.game_extra_quests q WHERE q.id = b AND p_mode = ANY(q.extra_modes))) THEN
    RAISE EXCEPTION 'game_bad_extras' USING ERRCODE = '22023';
  END IF;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public;

--------------------------------------------------------------------------------
-- 5. Day functions (0015 versions replaced; «_at» = time given: tests and the owner only)
--------------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.game_day_open(UUID, TEXT, TEXT[]);
DROP FUNCTION IF EXISTS public.game_day_open_at(UUID, TEXT, TEXT[], TIMESTAMPTZ);
DROP FUNCTION IF EXISTS public.game_day_set_mode(UUID, TEXT);
DROP FUNCTION IF EXISTS public.game_day_set_mode_at(UUID, TEXT, TIMESTAMPTZ);

-- Opens the game day of «now» in the mode the saved trading days give (or returns it)
CREATE OR REPLACE FUNCTION public.game_day_open_at(p_user UUID, p_bonus TEXT[], p_now TIMESTAMPTZ)
RETURNS JSONB AS $$
DECLARE
  v_day DATE;
  v_zone TEXT;
  v_first TEXT;
  v_mode TEXT;
  r public.game_days%ROWTYPE;
  v_closed INTEGER;
BEGIN
  IF p_now IS NULL THEN
    RAISE EXCEPTION 'game_bad_request' USING ERRCODE = '22023';
  END IF;
  PERFORM public.game_lock_account(p_user);
  v_day := public.game_day_now(p_user, p_now);
  v_closed := public.game_days_close_before(p_user, v_day, p_now);
  SELECT * INTO r FROM public.game_days WHERE user_id = p_user AND game_day = v_day;
  IF FOUND THEN
    RETURN public.game_day_json(r) || jsonb_build_object('opened', FALSE, 'closed_days', v_closed);
  END IF;
  v_mode := public.game_default_mode(p_user, v_day);
  PERFORM public.game_check_extras(v_mode, p_bonus);
  v_zone := public.game_zone_of(p_user);
  v_first := public.game_study_first(p_user, v_day, v_zone);
  INSERT INTO public.game_days (user_id, game_day, timezone, opened_at, mode, study_first, core, bonus, rules_version)
  VALUES (p_user, v_day, v_zone, p_now, v_mode, v_first, public.game_mode_core(v_mode, v_first), COALESCE(p_bonus, '{}'), 'q4.4')
  RETURNING * INTO r;
  -- the trading days that came into force are now the current ones
  UPDATE public.game_accounts
     SET current_day = v_day,
         trading_days = CASE WHEN trading_days_next_from IS NOT NULL AND v_day >= trading_days_next_from THEN trading_days_next ELSE trading_days END,
         trading_days_next = CASE WHEN trading_days_next_from IS NOT NULL AND v_day >= trading_days_next_from THEN NULL ELSE trading_days_next END,
         trading_days_next_from = CASE WHEN trading_days_next_from IS NOT NULL AND v_day >= trading_days_next_from THEN NULL ELSE trading_days_next_from END
   WHERE user_id = p_user;
  RETURN public.game_day_json(r) || jsonb_build_object('opened', TRUE, 'closed_days', v_closed);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- A mode change; p_bonus: the extras the app offers in the new mode (NULL = keep the day's)
CREATE OR REPLACE FUNCTION public.game_day_set_mode_at(p_user UUID, p_mode TEXT, p_bonus TEXT[], p_now TIMESTAMPTZ)
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
  IF p_bonus IS NOT NULL THEN
    PERFORM public.game_check_extras(p_mode, p_bonus, r.bonus);
  END IF;
  v_from := CASE WHEN r.mode = 'rest' THEN v_back ELSE r.mode END;
  SELECT * INTO v_new FROM public.game_compose_core(r.core, v_from, r.carried, public.game_mode_core(p_mode, r.study_first), p_mode,
    public.game_paid_missions(p_user, r.game_day), r.passed);
  UPDATE public.game_days SET mode = p_mode, mode_before_rest = NULL, core = v_new.core, carried = v_new.carried,
         bonus = COALESCE(p_bonus, bonus), mode_changes = mode_changes || v_change
   WHERE user_id = p_user AND game_day = r.game_day RETURNING * INTO r;
  RETURN public.game_day_json(r) || jsonb_build_object('changed', TRUE);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- A replacement of an extra: a self-reported quest of the mode's pool, not shown today, with no more XP (lib/quests.ts
-- pickReplacement's rules; the app's stable pick is not repeated here — any allowed quest is accepted)
CREATE OR REPLACE FUNCTION public.game_day_replace_at(p_user UUID, p_from TEXT, p_to TEXT, p_now TIMESTAMPTZ)
RETURNS JSONB AS $$
DECLARE
  r public.game_days%ROWTYPE;
  v_limit INTEGER;
  v_from public.game_extra_quests%ROWTYPE;
  v_to public.game_extra_quests%ROWTYPE;
BEGIN
  IF p_from IS NULL OR p_to IS NULL OR p_from !~ '^[a-z0-9_]{2,40}$' OR p_to !~ '^[a-z0-9_]{2,40}$' OR p_from = p_to OR p_now IS NULL THEN
    RAISE EXCEPTION 'game_bad_request' USING ERRCODE = '22023';
  END IF;
  PERFORM public.game_lock_account(p_user);
  r := public.game_current_day(p_user, p_now);
  IF r.mode = 'rest' THEN
    RAISE EXCEPTION 'game_day_rest' USING ERRCODE = '55000';
  END IF;
  SELECT * INTO v_from FROM public.game_extra_quests WHERE id = p_from;
  SELECT * INTO v_to FROM public.game_extra_quests WHERE id = p_to;
  IF v_from.id IS NULL OR v_to.id IS NULL OR NOT v_from.replaceable OR NOT v_to.replaceable
     OR p_from IN (SELECT mission_id FROM public.game_mission_sources) OR p_to IN (SELECT mission_id FROM public.game_mission_sources) THEN
    RAISE EXCEPTION 'game_not_replaceable' USING ERRCODE = '55000';
  END IF;
  IF NOT (p_from = ANY(r.bonus)) THEN
    RAISE EXCEPTION 'game_not_offered' USING ERRCODE = '55000';
  END IF;
  IF NOT (r.mode = ANY(v_to.pool_modes)) OR v_to.xp_reward > v_from.reward_xp THEN
    RAISE EXCEPTION 'game_not_replaceable' USING ERRCODE = '55000';
  END IF;
  IF p_to = ANY(r.bonus) OR p_to = ANY(r.core)
     OR EXISTS (SELECT 1 FROM jsonb_array_elements(r.replacements) x WHERE x ->> 'from' IN (p_from, p_to) OR x ->> 'to' = p_to) THEN
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

-- Saves the trading days; they apply from the next game day (today's set is never re-made)
CREATE OR REPLACE FUNCTION public.game_set_trading_days_at(p_user UUID, p_days SMALLINT[], p_now TIMESTAMPTZ)
RETURNS JSONB AS $$
DECLARE
  v_day DATE;
  v_clean SMALLINT[];
BEGIN
  IF p_days IS NULL OR p_now IS NULL OR cardinality(p_days) = 0 OR NOT (p_days <@ ARRAY[0,1,2,3,4,5,6]::smallint[]) THEN
    RAISE EXCEPTION 'game_bad_request' USING ERRCODE = '22023';
  END IF;
  PERFORM public.game_lock_account(p_user);
  SELECT array_agg(DISTINCT d ORDER BY d) INTO v_clean FROM unnest(p_days) d;
  v_day := public.game_day_now(p_user, p_now);
  UPDATE public.game_accounts SET trading_days_next = v_clean, trading_days_next_from = v_day + 1 WHERE user_id = p_user;
  RETURN jsonb_build_object('trading_days', to_jsonb(public.game_trading_days_on(p_user, v_day)),
                            'next', to_jsonb(v_clean), 'from', v_day + 1);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- The day as the API shows it: state, flag, server day, the open day (or none) and each mission's standing
CREATE OR REPLACE FUNCTION public.game_day_status_at(p_user UUID, p_now TIMESTAMPTZ)
RETURNS JSONB AS $$
DECLARE
  v_state TEXT;
  v_sync BOOLEAN;
  v_day DATE;
  r public.game_days%ROWTYPE;
  v_paid TEXT[];
  v_limit INTEGER;
BEGIN
  SELECT state INTO v_state FROM public.game_accounts WHERE user_id = p_user;
  v_state := COALESCE(v_state, 'local');
  v_sync := COALESCE((SELECT game_sync FROM public.user_features WHERE user_id = p_user), FALSE);
  IF v_state <> 'cloud_active' THEN
    RETURN jsonb_build_object('state', v_state, 'game_sync', v_sync, 'day', NULL);
  END IF;
  v_day := public.game_day_now(p_user, p_now);
  SELECT replacements_per_day INTO v_limit FROM public.game_limits WHERE id = 1;
  SELECT * INTO r FROM public.game_days WHERE user_id = p_user AND game_day = v_day AND status = 'open';
  IF NOT FOUND THEN
    -- not opened yet: the mode it will open in (from the trading days), so the app offers extras of that mode
    RETURN jsonb_build_object('state', v_state, 'game_sync', v_sync, 'game_day', v_day, 'day', NULL,
      'opening_mode', public.game_default_mode(p_user, v_day),
      'trading_days', to_jsonb(public.game_trading_days_on(p_user, v_day)));
  END IF;
  v_paid := public.game_paid_missions(p_user, v_day);
  RETURN jsonb_build_object(
    'state', v_state, 'game_sync', v_sync, 'game_day', v_day,
    'trading_days', to_jsonb(public.game_trading_days_on(p_user, v_day)),
    'day', public.game_day_json(r) - 'snapshot',
    'replacements_left', GREATEST(0, v_limit - jsonb_array_length(r.replacements)),
    'missions', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'id', m, 'assigned', r.mode <> 'rest', 'accepted', r.accepted ? m, 'paid', m = ANY(v_paid), 'passed', m = ANY(r.passed)) ORDER BY o), '[]'::jsonb)
      FROM unnest(r.core) WITH ORDINALITY AS x(m, o)),
    'day_full', cardinality(v_paid) >= (SELECT day_count_max FROM public.game_reward_rules WHERE code = 'mission'));
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public;

-- The rows a mission check reads, with the version and the fingerprint as Postgres computes them (the award compares
-- exactly these). Notes and trades: all (deleted included — the copy rules need them); plans: the day and the next.
CREATE OR REPLACE FUNCTION public.game_journal_for_check(p_user UUID, p_day DATE)
RETURNS JSONB AS $$
  SELECT jsonb_build_object(
    'notes', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', id, 'data', data, 'client_updated_at', client_updated_at,
        'deleted_at', deleted_at, 'updated_at', updated_at, 'first_seen_at', first_seen_at, 'fp', md5(data::text)) ORDER BY id)
      FROM public.journal_notes WHERE user_id = p_user), '[]'::jsonb),
    'trades', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', id, 'data', data, 'client_updated_at', client_updated_at,
        'deleted_at', deleted_at, 'updated_at', updated_at, 'first_seen_at', first_seen_at, 'fp', md5(data::text)) ORDER BY id)
      FROM public.journal_trades WHERE user_id = p_user), '[]'::jsonb),
    'plans', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', id, 'data', data, 'client_updated_at', client_updated_at,
        'deleted_at', deleted_at, 'updated_at', updated_at, 'first_seen_at', first_seen_at, 'fp', md5(data::text)) ORDER BY id)
      FROM public.journal_day_plans WHERE user_id = p_user AND id IN (p_day::text, (p_day + 1)::text)), '[]'::jsonb),
    'rows', (SELECT count(*) FROM public.journal_notes WHERE user_id = p_user) + (SELECT count(*) FROM public.journal_trades WHERE user_id = p_user));
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

-- The API: server time only
CREATE OR REPLACE FUNCTION public.game_day_open(p_user UUID, p_bonus TEXT[] DEFAULT '{}')
RETURNS JSONB AS $$ SELECT public.game_day_open_at(p_user, p_bonus, now()); $$ LANGUAGE sql SECURITY DEFINER SET search_path = public;
CREATE OR REPLACE FUNCTION public.game_day_set_mode(p_user UUID, p_mode TEXT, p_bonus TEXT[] DEFAULT NULL)
RETURNS JSONB AS $$ SELECT public.game_day_set_mode_at(p_user, p_mode, p_bonus, now()); $$ LANGUAGE sql SECURITY DEFINER SET search_path = public;
CREATE OR REPLACE FUNCTION public.game_set_trading_days(p_user UUID, p_days SMALLINT[])
RETURNS JSONB AS $$ SELECT public.game_set_trading_days_at(p_user, p_days, now()); $$ LANGUAGE sql SECURITY DEFINER SET search_path = public;
CREATE OR REPLACE FUNCTION public.game_day_status(p_user UUID)
RETURNS JSONB AS $$ SELECT public.game_day_status_at(p_user, now()); $$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;
CREATE OR REPLACE FUNCTION public.game_day_today(p_user UUID)
RETURNS DATE AS $$ SELECT public.game_day_now(p_user, now()); $$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

DO $$
DECLARE f TEXT;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'game_trading_days_on(uuid,date)', 'game_default_mode(uuid,date)', 'game_check_extras(text,text[],text[])',
    'game_day_open_at(uuid,text[],timestamptz)', 'game_day_set_mode_at(uuid,text,text[],timestamptz)',
    'game_day_replace_at(uuid,text,text,timestamptz)', 'game_set_trading_days_at(uuid,smallint[],timestamptz)',
    'game_day_status_at(uuid,timestamptz)', 'game_journal_for_check(uuid,date)',
    'game_day_open(uuid,text[])', 'game_day_set_mode(uuid,text,text[])', 'game_set_trading_days(uuid,smallint[])',
    'game_day_status(uuid)', 'game_day_today(uuid)'] LOOP
    EXECUTE format('ALTER FUNCTION public.%s OWNER TO game_economy_owner', f);
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated, service_role', f);
  END LOOP;
  FOREACH f IN ARRAY ARRAY['game_day_open(uuid,text[])', 'game_day_set_mode(uuid,text,text[])', 'game_set_trading_days(uuid,smallint[])',
    'game_day_status(uuid)', 'game_day_today(uuid)', 'game_journal_for_check(uuid,date)'] LOOP
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO service_role', f);
  END LOOP;
END $$;

ALTER TABLE public.game_extra_quests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.game_extra_quests FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.game_extra_quests TO service_role;

COMMIT;
