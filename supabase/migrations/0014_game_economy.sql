-- AYRA Trading — 0014: server economy schema (Q4.1 design, docs/q4-1-server-economy.md). NOT APPLIED TO PRODUCTION.
-- This is the «0007 server economy» of the earlier plans; 0006 and 0007 stay unused because 0008–0013 are applied.
--
-- Nothing is switched on: game_sync stays FALSE for everyone, no account leaves «local», and every award kind is
-- disabled (fail-closed) until its server validation exists (docs, section 3).
--
-- AUTHORITY MODEL (security review of #201):
--   * A dedicated NOLOGIN role «game_economy_owner» owns the game tables and the award functions. Nobody logs in as it
--     and no API role is a member of it, so it cannot be taken with SET ROLE.
--   * Writes are refused by PRIVILEGES: anon/authenticated get SELECT on their own rows only; service_role (the server
--     route) gets SELECT and EXECUTE on the few API functions — no INSERT/UPDATE/DELETE on any game table.
--   * Defence in depth: a trigger refuses every write whose current_user is not the owner (current_user cannot be
--     changed by SET/set_config; only SET ROLE to a role one is a member of). No GUC is trusted for authority.
--   * The ledger is never updated. Rows are deleted only in the owner context, which arises only from the account
--     deletion cascade (Postgres runs referential actions as the owner of the referencing table) — no function here
--     deletes, and no other trigger chain runs as the owner.
--   * The award function takes the KIND and the item (a mission id), never a key, a rule or an amount: the key, the rule
--     and the source keys are built here; the evidence must be of a type the mission accepts.
--
-- TOCTOU: the route checks the rules on Journal rows it read and passes each row's version (client_updated_at) and its
-- fingerprint (md5 of data::text, computed by Postgres when the route read it). game_apply_reward() locks those rows
-- (FOR SHARE) and refuses when any of them changed, was deleted or belongs to someone else.
--
-- Idempotent: safe to run twice.

BEGIN;

--------------------------------------------------------------------------------
-- 0. The owner role and the feature flag
--------------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'game_economy_owner') THEN
    CREATE ROLE game_economy_owner NOLOGIN NOINHERIT;
  END IF;
END $$;
-- the role running the migration may hand objects over to it (needed on a non-superuser admin such as Supabase postgres)
GRANT game_economy_owner TO CURRENT_USER;
GRANT USAGE ON SCHEMA public TO game_economy_owner;

ALTER TABLE public.user_features ADD COLUMN IF NOT EXISTS game_sync BOOLEAN NOT NULL DEFAULT FALSE;

-- What the owner reads (and locks) outside its own tables: time zone, the flag, the Journal evidence
GRANT SELECT ON public.profiles, public.user_features TO game_economy_owner;
GRANT SELECT, UPDATE (device_id) ON public.journal_trades, public.journal_day_plans, public.journal_week_plans,
  public.journal_notes, public.journal_no_trades TO game_economy_owner;  -- UPDATE(device_id) only for FOR SHARE locks
DROP POLICY IF EXISTS profiles_game_owner_read ON public.profiles;
CREATE POLICY profiles_game_owner_read ON public.profiles FOR SELECT TO game_economy_owner USING (TRUE);
DROP POLICY IF EXISTS user_features_game_owner_read ON public.user_features;
CREATE POLICY user_features_game_owner_read ON public.user_features FOR SELECT TO game_economy_owner USING (TRUE);
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['journal_trades', 'journal_day_plans', 'journal_week_plans', 'journal_notes', 'journal_no_trades'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_game_owner_read', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO game_economy_owner USING (TRUE)', t || '_game_owner_read', t);
    -- a row lock also needs an UPDATE policy; WITH CHECK (FALSE): the owner can lock, never change a Journal row
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_game_owner_lock', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR UPDATE TO game_economy_owner USING (TRUE) WITH CHECK (FALSE)', t || '_game_owner_lock', t);
  END LOOP;
END $$;

--------------------------------------------------------------------------------
-- 1. Tables
--------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.game_accounts (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  state TEXT NOT NULL DEFAULT 'local' CHECK (state IN ('local', 'migration_pending', 'cloud_active')),
  state_changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  activated_at TIMESTAMPTZ,
  rules_version TEXT
);

-- Award kinds: every kind is OFF until its server validation exists (fail-closed). Only «mission» is implemented in SQL;
-- the others are refused by game_apply_reward whatever this table says (they need Q4.3–Q4.7 server state).
CREATE TABLE IF NOT EXISTS public.game_award_kinds (
  kind TEXT PRIMARY KEY CHECK (kind IN ('mission', 'self_report', 'daily_reward', 'first_action', 'journal_xp', 'personal_quest', 'achievement')),
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  needs TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS public.game_reward_rules (
  code TEXT PRIMARY KEY CHECK (code ~ '^[a-z0-9_]{2,64}$'),
  kind TEXT NOT NULL REFERENCES public.game_award_kinds(kind),
  xp INTEGER NOT NULL CHECK (xp BETWEEN 0 AND 1000),
  coins INTEGER NOT NULL CHECK (coins BETWEEN 0 AND 100),
  day_count_group TEXT,
  day_count_max INTEGER CHECK (day_count_max IS NULL OR day_count_max > 0),
  day_xp_group TEXT,
  day_xp_max INTEGER CHECK (day_xp_max IS NULL OR day_xp_max > 0),
  source_scope TEXT CHECK (source_scope IS NULL OR source_scope IN ('mission', 'personal_quest')),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  rules_version TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS public.game_limits (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  coins_per_day INTEGER NOT NULL DEFAULT 100 CHECK (coins_per_day >= 0),
  -- an award for the game day before today only within this window after its end (В-28 pending: 0 = today only)
  late_window_minutes INTEGER NOT NULL DEFAULT 0 CHECK (late_window_minutes BETWEEN 0 AND 1440)
);

-- Rules version q4.1: today's device values (lib/game-config.ts, lib/personal-quests.ts variant C). Re-running keeps
-- any change the owner made (DO NOTHING).

-- Which Journal tables may confirm each mission, and which part of the record the mission uses (one record part pays
-- one mission a day; lib/missions.ts candidateSources). A mission id outside this table cannot be awarded.
CREATE TABLE IF NOT EXISTS public.game_mission_sources (
  mission_id TEXT NOT NULL CHECK (mission_id ~ '^[a-z0-9_]{2,40}$'),
  table_name TEXT NOT NULL CHECK (table_name IN ('journal_trades', 'journal_day_plans', 'journal_notes')),
  part TEXT NOT NULL CHECK (part ~ '^[a-z]{0,16}$'),
  PRIMARY KEY (mission_id, table_name)
);

CREATE TABLE IF NOT EXISTS public.game_ledger (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  idempotency_key TEXT NOT NULL CHECK (idempotency_key ~ '^[a-z_]{2,32}:[A-Za-z0-9:_.-]{1,160}$'),
  kind TEXT NOT NULL,
  rule_code TEXT NOT NULL REFERENCES public.game_reward_rules(code),
  game_day DATE NOT NULL,
  xp INTEGER NOT NULL CHECK (xp >= 0),
  coins INTEGER NOT NULL CHECK (coins >= 0),
  rules_version TEXT NOT NULL,
  evidence JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(evidence) = 'array'),
  result JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS game_ledger_user_day_idx ON public.game_ledger (user_id, game_day);

CREATE TABLE IF NOT EXISTS public.game_source_claims (
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  scope TEXT NOT NULL CHECK (scope IN ('mission', 'personal_quest')),
  source_key TEXT NOT NULL CHECK (char_length(source_key) BETWEEN 3 AND 160),
  game_day DATE NOT NULL,
  ledger_id BIGINT NOT NULL REFERENCES public.game_ledger(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, scope, source_key, game_day)
);

CREATE TABLE IF NOT EXISTS public.game_profile (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  xp_total BIGINT NOT NULL DEFAULT 0 CHECK (xp_total >= 0),
  level INTEGER NOT NULL DEFAULT 1 CHECK (level >= 1),
  coins BIGINT NOT NULL DEFAULT 0 CHECK (coins >= 0),
  last_ledger_id BIGINT NOT NULL DEFAULT 0,
  version BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.game_accounts OWNER TO game_economy_owner;
ALTER TABLE public.game_award_kinds OWNER TO game_economy_owner;
ALTER TABLE public.game_reward_rules OWNER TO game_economy_owner;
ALTER TABLE public.game_limits OWNER TO game_economy_owner;
ALTER TABLE public.game_mission_sources OWNER TO game_economy_owner;
ALTER TABLE public.game_ledger OWNER TO game_economy_owner;
ALTER TABLE public.game_source_claims OWNER TO game_economy_owner;
ALTER TABLE public.game_profile OWNER TO game_economy_owner;

--------------------------------------------------------------------------------
-- 2. Guards (privileges refuse first; these are defence in depth and also stop an admin's ad-hoc SQL)
--------------------------------------------------------------------------------
-- Every write must run as the owner (inside the owner's functions, or the account deletion cascade)
CREATE OR REPLACE FUNCTION public.game_owner_only()
RETURNS TRIGGER AS $$
BEGIN
  IF current_user <> 'game_economy_owner' THEN
    RAISE EXCEPTION 'game_write_only_through_functions' USING ERRCODE = '42501';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- The ledger is never changed (not even by the owner)
CREATE OR REPLACE FUNCTION public.game_ledger_no_update()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'game_ledger_append_only' USING ERRCODE = '42501';
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- One way: cloud_active never goes back; activated_at never changes
CREATE OR REPLACE FUNCTION public.game_account_state_guard()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.state IS DISTINCT FROM OLD.state THEN
    IF OLD.state = 'cloud_active' THEN
      RAISE EXCEPTION 'game_state_one_way' USING ERRCODE = '42501';
    END IF;
    IF OLD.state = 'local' AND NEW.state <> 'migration_pending' THEN
      RAISE EXCEPTION 'game_state_invalid_transition' USING ERRCODE = '22023';
    END IF;
    NEW.state_changed_at := now();
    IF NEW.state = 'cloud_active' THEN NEW.activated_at := now(); END IF;
  END IF;
  IF OLD.activated_at IS NOT NULL AND NEW.activated_at IS DISTINCT FROM OLD.activated_at THEN
    RAISE EXCEPTION 'game_state_one_way' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['game_accounts', 'game_award_kinds', 'game_reward_rules', 'game_limits', 'game_mission_sources',
                           'game_ledger', 'game_source_claims', 'game_profile'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS tr_%s_owner_only ON public.%I', t, t);
    EXECUTE format('CREATE TRIGGER tr_%s_owner_only BEFORE INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.game_owner_only()', t, t);
  END LOOP;
END $$;
-- rules, kinds, limits and mission sources are the owner's settings: the owner changes them in the SQL editor with
-- SET ROLE game_economy_owner (an admin only; docs, section 6)

DROP TRIGGER IF EXISTS tr_game_ledger_no_update ON public.game_ledger;
CREATE TRIGGER tr_game_ledger_no_update BEFORE UPDATE ON public.game_ledger
  FOR EACH ROW EXECUTE FUNCTION public.game_ledger_no_update();
DROP TRIGGER IF EXISTS tr_game_account_state_guard ON public.game_accounts;
CREATE TRIGGER tr_game_account_state_guard BEFORE UPDATE ON public.game_accounts
  FOR EACH ROW EXECUTE FUNCTION public.game_account_state_guard();

--------------------------------------------------------------------------------
-- 2b. Settings seeded AS THE OWNER (the guard refuses anyone else, even the admin running the migration; re-running
--     keeps the owner's changes: DO NOTHING)
--------------------------------------------------------------------------------
SET LOCAL ROLE game_economy_owner;
INSERT INTO public.game_award_kinds (kind, needs) VALUES
  ('mission',        'Q4.2 route rule check + Q4.3 server day set and acceptance'),
  ('self_report',    'Q4.3 server day set (the quest must be offered today) + Q4.4 catalog'),
  ('daily_reward',   'Q4.4 server streak index (which day of the series)'),
  ('first_action',   'Q4.4 Journal check that the action is really the first'),
  ('journal_xp',     'Q4.4 Journal XP rules (new records only, day caps)'),
  ('personal_quest', 'Q4.7 server runs, marks, В-24 allocation and completion'),
  ('achievement',    'Q4.6 server achievement conditions')
ON CONFLICT (kind) DO NOTHING;
INSERT INTO public.game_limits (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
INSERT INTO public.game_reward_rules (code, kind, xp, coins, day_count_group, day_count_max, day_xp_group, day_xp_max, source_scope, rules_version) VALUES
  ('mission',            'mission',        40, 10, 'mission', 3,    NULL, NULL, 'mission',        'q4.1'),
  ('daily_reward_1',     'daily_reward',    0, 10, 'daily',   1,    NULL, NULL, NULL,             'q4.1'),
  ('daily_reward_2',     'daily_reward',    0, 10, 'daily',   1,    NULL, NULL, NULL,             'q4.1'),
  ('daily_reward_3',     'daily_reward',    0, 15, 'daily',   1,    NULL, NULL, NULL,             'q4.1'),
  ('daily_reward_4',     'daily_reward',    0, 15, 'daily',   1,    NULL, NULL, NULL,             'q4.1'),
  ('daily_reward_5',     'daily_reward',    0, 20, 'daily',   1,    NULL, NULL, NULL,             'q4.1'),
  ('daily_reward_6',     'daily_reward',    0, 25, 'daily',   1,    NULL, NULL, NULL,             'q4.1'),
  ('daily_reward_7',     'daily_reward',    0, 50, 'daily',   1,    NULL, NULL, NULL,             'q4.1'),
  ('self_report_25',     'self_report',    25,  0, NULL,      NULL, 'self', 90,  NULL,             'q4.1'),
  ('self_report_45',     'self_report',    45,  0, NULL,      NULL, 'self', 90,  NULL,             'q4.1'),
  ('pq_bronze_app',      'personal_quest', 100, 0, NULL,      NULL, NULL, NULL, NULL,             'q4.1'),
  ('pq_silver_app',      'personal_quest', 180, 0, NULL,      NULL, NULL, NULL, NULL,             'q4.1'),
  ('pq_gold_app',        'personal_quest', 250, 0, NULL,      NULL, NULL, NULL, NULL,             'q4.1'),
  ('pq_bronze_self',     'personal_quest',  50, 0, NULL,      NULL, NULL, NULL, NULL,             'q4.1'),
  ('pq_silver_self',     'personal_quest',  90, 0, NULL,      NULL, NULL, NULL, NULL,             'q4.1'),
  ('pq_gold_self',       'personal_quest', 125, 0, NULL,      NULL, NULL, NULL, NULL,             'q4.1')
ON CONFLICT (code) DO NOTHING;
INSERT INTO public.game_mission_sources (mission_id, table_name, part) VALUES
  ('q_bias',          'journal_day_plans', 'prep'),
  ('q_riskcheck',     'journal_day_plans', 'risk'),
  ('q_reflect',       'journal_day_plans', 'review'),
  ('q_reflect',       'journal_notes',     ''),
  ('m_day_state',     'journal_day_plans', 'review'),
  ('m_plan_tomorrow', 'journal_day_plans', 'made'),
  ('m_trade_review',  'journal_trades',    'review'),
  ('m_observation',   'journal_notes',     ''),
  ('m_lesson',        'journal_notes',     ''),
  ('m_mistake',       'journal_notes',     ''),
  ('m_backtest',      'journal_notes',     '')
ON CONFLICT (mission_id, table_name) DO NOTHING;
RESET ROLE;

--------------------------------------------------------------------------------
-- 3. Helpers
--------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.game_level_for_xp(p_total BIGINT)
RETURNS INTEGER AS $$
DECLARE
  v_level INTEGER := 1;
  v_left BIGINT := GREATEST(p_total, 0);
BEGIN
  WHILE v_left >= 80 + v_level * 40 LOOP
    v_left := v_left - (80 + v_level * 40);
    v_level := v_level + 1;
  END LOOP;
  RETURN v_level;
END;
$$ LANGUAGE plpgsql IMMUTABLE SET search_path = public;

CREATE OR REPLACE FUNCTION public.game_day_for(p_user UUID, p_at TIMESTAMPTZ DEFAULT now())
RETURNS DATE AS $$
  SELECT (p_at AT TIME ZONE COALESCE((SELECT timezone FROM public.profiles WHERE id = p_user), 'UTC'))::date;
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

--------------------------------------------------------------------------------
-- 4. The award. The caller names the KIND and the item; the key, the rule and the source keys are built here.
--    p_evidence: [{"table":"journal_notes","id":"n1","version":"<client_updated_at>","fp":"<md5(data::text)>"}]
--------------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.game_apply_reward(UUID, TEXT, TEXT, JSONB, DATE);
CREATE OR REPLACE FUNCTION public.game_apply_reward(
  p_user UUID,
  p_kind TEXT,
  p_item TEXT,
  p_evidence JSONB DEFAULT '[]'::jsonb
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
  IF p_user IS NULL OR p_kind IS NULL OR p_item IS NULL OR p_item !~ '^[A-Za-z0-9_.-]{1,80}$' THEN
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
    -- self_report, daily_reward, first_action, journal_xp, personal_quest, achievement need server state that does not
    -- exist yet (Q4.3–Q4.7). They are refused here, whatever the kinds table says.
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

  -- 3. One award at a time per user
  SELECT * INTO v_profile FROM public.game_profile WHERE user_id = p_user FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'game_profile_missing' USING ERRCODE = '42501';
  END IF;

  -- 4. The game day and the canonical key (server time; a mission once a day)
  v_day := public.game_day_for(p_user);
  v_rule_code := 'mission';
  v_key := 'mission:' || v_day || ':' || p_item;

  -- 5. A repeat returns the saved result (another tab, device, retry)
  SELECT * INTO v_existing FROM public.game_ledger WHERE user_id = p_user AND idempotency_key = v_key;
  IF FOUND THEN
    RETURN v_existing.result || jsonb_build_object('replay', TRUE);
  END IF;

  -- 6. The mission must be known; it needs evidence, of the types it accepts
  IF NOT EXISTS (SELECT 1 FROM public.game_mission_sources WHERE mission_id = p_item) THEN
    RAISE EXCEPTION 'game_unknown_mission' USING ERRCODE = '22023';
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
    -- the source key is built here: table, row and the part of the record the mission uses
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

--------------------------------------------------------------------------------
-- 5. Rebuild, state transitions, own status
--------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.game_rebuild_profile(p_user UUID)
RETURNS JSONB AS $$
DECLARE
  v_xp BIGINT;
  v_coins BIGINT;
  v_last BIGINT;
  v_before public.game_profile%ROWTYPE;
BEGIN
  SELECT * INTO v_before FROM public.game_profile WHERE user_id = p_user FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'game_profile_missing' USING ERRCODE = '42501';
  END IF;
  SELECT COALESCE(sum(xp), 0), COALESCE(sum(coins), 0), COALESCE(max(id), 0) INTO v_xp, v_coins, v_last
    FROM public.game_ledger WHERE user_id = p_user;
  UPDATE public.game_profile
     SET xp_total = v_xp, level = public.game_level_for_xp(v_xp), coins = v_coins, last_ledger_id = v_last,
         version = version + 1, updated_at = now()
   WHERE user_id = p_user;
  RETURN jsonb_build_object('changed', v_before.xp_total <> v_xp OR v_before.coins <> v_coins,
    'xp_total', v_xp, 'coins', v_coins, 'level', public.game_level_for_xp(v_xp));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION public.game_begin_migration(p_user UUID)
RETURNS TEXT AS $$
BEGIN
  INSERT INTO public.game_accounts (user_id, state) VALUES (p_user, 'migration_pending')
  ON CONFLICT (user_id) DO UPDATE SET state = 'migration_pending' WHERE public.game_accounts.state = 'local';
  RETURN (SELECT state FROM public.game_accounts WHERE user_id = p_user);
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
  INSERT INTO public.game_profile (user_id) VALUES (p_user) ON CONFLICT (user_id) DO NOTHING;
  UPDATE public.game_accounts SET state = 'cloud_active', rules_version = p_rules_version WHERE user_id = p_user;
  RETURN 'cloud_active';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- The person's own state and flag (runs as the caller: RLS shows only own rows)
CREATE OR REPLACE FUNCTION public.game_account_status()
RETURNS JSONB AS $$
  SELECT jsonb_build_object(
    'state', COALESCE((SELECT state FROM public.game_accounts WHERE user_id = auth.uid()), 'local'),
    'game_sync', COALESCE((SELECT game_sync FROM public.user_features WHERE user_id = auth.uid()), FALSE));
$$ LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public;

ALTER FUNCTION public.game_apply_reward(UUID, TEXT, TEXT, JSONB) OWNER TO game_economy_owner;
ALTER FUNCTION public.game_rebuild_profile(UUID) OWNER TO game_economy_owner;
ALTER FUNCTION public.game_begin_migration(UUID) OWNER TO game_economy_owner;
ALTER FUNCTION public.game_activate_cloud(UUID, TEXT) OWNER TO game_economy_owner;
ALTER FUNCTION public.game_day_for(UUID, TIMESTAMPTZ) OWNER TO game_economy_owner;

--------------------------------------------------------------------------------
-- 6. Access
--------------------------------------------------------------------------------
ALTER TABLE public.game_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.game_award_kinds ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.game_reward_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.game_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.game_mission_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.game_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.game_source_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.game_profile ENABLE ROW LEVEL SECURITY;

-- No write privilege for any API role; read only
REVOKE ALL ON public.game_accounts, public.game_award_kinds, public.game_reward_rules, public.game_limits,
  public.game_mission_sources, public.game_ledger, public.game_source_claims, public.game_profile
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.game_accounts, public.game_reward_rules, public.game_ledger, public.game_profile TO authenticated;
GRANT SELECT ON public.game_accounts, public.game_award_kinds, public.game_reward_rules, public.game_limits,
  public.game_mission_sources, public.game_ledger, public.game_source_claims, public.game_profile TO service_role;

DROP POLICY IF EXISTS game_accounts_select_own ON public.game_accounts;
CREATE POLICY game_accounts_select_own ON public.game_accounts FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id);
DROP POLICY IF EXISTS game_rules_select ON public.game_reward_rules;
CREATE POLICY game_rules_select ON public.game_reward_rules FOR SELECT TO authenticated USING (TRUE);
DROP POLICY IF EXISTS game_ledger_select_own ON public.game_ledger;
CREATE POLICY game_ledger_select_own ON public.game_ledger FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id);
DROP POLICY IF EXISTS game_profile_select_own ON public.game_profile;
CREATE POLICY game_profile_select_own ON public.game_profile FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id);

REVOKE ALL ON FUNCTION public.game_apply_reward(UUID, TEXT, TEXT, JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.game_rebuild_profile(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.game_begin_migration(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.game_activate_cloud(UUID, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.game_day_for(UUID, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.game_apply_reward(UUID, TEXT, TEXT, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.game_rebuild_profile(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.game_begin_migration(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.game_activate_cloud(UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.game_day_for(UUID, TIMESTAMPTZ) TO service_role;
REVOKE ALL ON FUNCTION public.game_account_status() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.game_account_status() TO authenticated;

COMMIT;
