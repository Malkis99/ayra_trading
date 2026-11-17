-- AYRA Trading — 0014: server economy schema (Q4.1 design, docs/q4-1-server-economy.md). NOT APPLIED TO PRODUCTION.
-- This is the «0007 server economy» of the earlier plans; 0006 and 0007 stay unused because 0008–0013 are applied.
--
-- What it adds (nothing is switched on: game_sync stays FALSE for everyone, no account leaves «local»):
--   * game_accounts        — the account's economy state: local → migration_pending → cloud_active (one way).
--   * game_reward_rules    — the amounts and caps; the request never carries an amount.
--   * game_ledger          — append-only ledger of awards; UNIQUE (user_id, idempotency_key).
--   * game_source_claims   — one Journal record pays one mission a day / one personal quest a day (В-24), for all devices.
--   * game_profile         — projection (XP total, level, Coins); rebuilt from the ledger.
--   * game_apply_reward()  — the ONLY way to award: one transaction, server time and game day, evidence re-checked.
--   * game_rebuild_profile(), game_account_status(), state transitions.
--
-- Trust: clients (anon, authenticated) can only READ their own rows and their own status. They cannot insert, change or
-- delete ledger rows, projections, claims, rules or states, and cannot execute the award functions. The award functions
-- are executable by service_role only (the Next.js route, after it verified the session and the rules). Even service_role
-- cannot UPDATE a ledger row or DELETE one directly (only the account deletion cascade removes them).
--
-- TOCTOU: the route checks the rules on Journal rows it read, and passes each row's version (client_updated_at) and its
-- fingerprint (md5 of data::text, computed by Postgres when the route read it). game_apply_reward() locks those rows
-- (FOR SHARE) and refuses when any of them changed, was deleted or belongs to someone else — so what is paid is exactly
-- what was checked, and nobody can change it until the award is committed.
--
-- Idempotent: safe to run twice.

BEGIN;

--------------------------------------------------------------------------------
-- 0. Feature flag (rollout owner → beta → everyone). OFF by default; turning it off pauses server awards.
--------------------------------------------------------------------------------
ALTER TABLE public.user_features ADD COLUMN IF NOT EXISTS game_sync BOOLEAN NOT NULL DEFAULT FALSE;

--------------------------------------------------------------------------------
-- 1. Account economy state
--------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.game_accounts (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  state TEXT NOT NULL DEFAULT 'local' CHECK (state IN ('local', 'migration_pending', 'cloud_active')),
  state_changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  activated_at TIMESTAMPTZ,
  rules_version TEXT
);

-- One way: cloud_active never goes back; migration_pending may go on or back to local (before activation only)
CREATE OR REPLACE FUNCTION public.game_account_state_guard()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.state IS DISTINCT FROM OLD.state THEN
    IF OLD.state = 'cloud_active' THEN
      RAISE EXCEPTION 'game_state_one_way' USING ERRCODE = '42501';
    END IF;
    IF OLD.state = 'local' AND NEW.state <> 'migration_pending' THEN
      RAISE EXCEPTION 'game_state_invalid_transition' USING ERRCODE = '22023';
    END IF;
    NEW.state_changed_at := now();
    IF NEW.state = 'cloud_active' THEN NEW.activated_at := now(); END IF;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.activated_at IS NOT NULL AND NEW.activated_at IS DISTINCT FROM OLD.activated_at THEN
    RAISE EXCEPTION 'game_state_one_way' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

DROP TRIGGER IF EXISTS tr_game_account_state_guard ON public.game_accounts;
CREATE TRIGGER tr_game_account_state_guard BEFORE UPDATE ON public.game_accounts
  FOR EACH ROW EXECUTE FUNCTION public.game_account_state_guard();

--------------------------------------------------------------------------------
-- 2. Rules: amounts and caps live on the server (a request names a rule, never an amount)
--------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.game_reward_rules (
  code TEXT PRIMARY KEY CHECK (code ~ '^[a-z0-9_]{2,64}$'),
  kind TEXT NOT NULL CHECK (kind IN ('mission', 'self_report', 'daily_reward', 'first_action', 'journal_xp', 'personal_quest', 'achievement')),
  xp INTEGER NOT NULL CHECK (xp BETWEEN 0 AND 1000),
  coins INTEGER NOT NULL CHECK (coins BETWEEN 0 AND 100),
  -- a day limit on the number of awards of this group (missions: 3), NULL = none
  day_count_group TEXT,
  day_count_max INTEGER CHECK (day_count_max IS NULL OR day_count_max > 0),
  -- a day limit on the XP of this group (self-reports: 90), NULL = none; XP above it is cut, not refused
  day_xp_group TEXT,
  day_xp_max INTEGER CHECK (day_xp_max IS NULL OR day_xp_max > 0),
  -- which source scope one Journal record may pay once a day in (missions) or once at all per day for quests (В-24)
  source_scope TEXT CHECK (source_scope IS NULL OR source_scope IN ('mission', 'personal_quest')),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  rules_version TEXT NOT NULL
);

-- The day cap on Coins of all awards (DAILY_COIN_CAP); Coins above it are cut, never the XP
CREATE TABLE IF NOT EXISTS public.game_limits (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  coins_per_day INTEGER NOT NULL DEFAULT 100 CHECK (coins_per_day >= 0),
  -- an award for the game day before today is accepted only within this window after its end (В-28, decision pending:
  -- 0 = today only)
  late_window_minutes INTEGER NOT NULL DEFAULT 0 CHECK (late_window_minutes BETWEEN 0 AND 1440)
);
INSERT INTO public.game_limits (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- Rules version q4.1: today's device values (lib/game-config.ts, lib/personal-quests.ts variant C). Re-running keeps
-- any change the owner made (DO NOTHING).
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

--------------------------------------------------------------------------------
-- 3. The ledger: append-only, one row per idempotency key and user
--------------------------------------------------------------------------------
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
  -- the Journal rows the award was checked on (table, id, version, fingerprint) — for audit and disputes
  evidence JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(evidence) = 'array'),
  -- what the call returned (level before/after, totals): a repeat of the key returns exactly this
  result JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS game_ledger_user_day_idx ON public.game_ledger (user_id, game_day);

-- Never changed; deleted only by the account deletion cascade (a direct DELETE is refused even for service_role)
CREATE OR REPLACE FUNCTION public.game_ledger_immutable()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'game_ledger_append_only' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'DELETE' AND pg_trigger_depth() < 2 THEN
    RAISE EXCEPTION 'game_ledger_append_only' USING ERRCODE = '42501';
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql SET search_path = public;

DROP TRIGGER IF EXISTS tr_game_ledger_immutable ON public.game_ledger;
CREATE TRIGGER tr_game_ledger_immutable BEFORE UPDATE OR DELETE ON public.game_ledger
  FOR EACH ROW EXECUTE FUNCTION public.game_ledger_immutable();

-- Rows can only come from game_apply_reward (it sets the writer mark for its own transaction)
CREATE OR REPLACE FUNCTION public.game_writer_only()
RETURNS TRIGGER AS $$
BEGIN
  IF COALESCE(current_setting('ayra.game_writer', true), '') <> 'on' THEN
    RAISE EXCEPTION 'game_write_only_through_functions' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

DROP TRIGGER IF EXISTS tr_game_ledger_writer ON public.game_ledger;
CREATE TRIGGER tr_game_ledger_writer BEFORE INSERT ON public.game_ledger
  FOR EACH ROW EXECUTE FUNCTION public.game_writer_only();

--------------------------------------------------------------------------------
-- 4. Source claims: one Journal record pays once per scope and day, whatever device asks (missions; В-24 for quests)
--------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.game_source_claims (
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  scope TEXT NOT NULL CHECK (scope IN ('mission', 'personal_quest')),
  source_key TEXT NOT NULL CHECK (char_length(source_key) BETWEEN 3 AND 160),
  game_day DATE NOT NULL,
  ledger_id BIGINT NOT NULL REFERENCES public.game_ledger(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, scope, source_key, game_day)
);

DROP TRIGGER IF EXISTS tr_game_claims_writer ON public.game_source_claims;
CREATE TRIGGER tr_game_claims_writer BEFORE INSERT OR UPDATE ON public.game_source_claims
  FOR EACH ROW EXECUTE FUNCTION public.game_writer_only();

--------------------------------------------------------------------------------
-- 5. The projection: sums of the ledger, rebuilt by game_rebuild_profile()
--------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.game_profile (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  xp_total BIGINT NOT NULL DEFAULT 0 CHECK (xp_total >= 0),
  level INTEGER NOT NULL DEFAULT 1 CHECK (level >= 1),
  coins BIGINT NOT NULL DEFAULT 0 CHECK (coins >= 0),
  last_ledger_id BIGINT NOT NULL DEFAULT 0,
  version BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS tr_game_profile_writer ON public.game_profile;
CREATE TRIGGER tr_game_profile_writer BEFORE INSERT OR UPDATE ON public.game_profile
  FOR EACH ROW EXECUTE FUNCTION public.game_writer_only();

-- The level for a total XP: level n needs 80 + 40·n XP to reach n + 1 (lib/game.ts xpForNextLevel)
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

--------------------------------------------------------------------------------
-- 6. The game day: server time in the account's time zone (profiles.timezone)
--------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.game_day_for(p_user UUID, p_at TIMESTAMPTZ DEFAULT now())
RETURNS DATE AS $$
  SELECT (p_at AT TIME ZONE COALESCE((SELECT timezone FROM public.profiles WHERE id = p_user), 'UTC'))::date;
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

--------------------------------------------------------------------------------
-- 7. The award: one transaction, one row per key, the result returned again on a repeat
--------------------------------------------------------------------------------
-- p_evidence: [{"table":"journal_notes","id":"n1","version":"<client_updated_at>","fp":"<md5(data::text)>","source_key":"note:n1"}]
CREATE OR REPLACE FUNCTION public.game_apply_reward(
  p_user UUID,
  p_key TEXT,
  p_rule TEXT,
  p_evidence JSONB DEFAULT '[]'::jsonb,
  p_game_day DATE DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
  c_tables CONSTANT TEXT[] := ARRAY['journal_trades', 'journal_day_plans', 'journal_week_plans', 'journal_notes', 'journal_no_trades'];
  v_state TEXT;
  v_sync BOOLEAN;
  v_profile public.game_profile%ROWTYPE;
  v_existing public.game_ledger%ROWTYPE;
  v_rule public.game_reward_rules%ROWTYPE;
  v_limits public.game_limits%ROWTYPE;
  v_today DATE;
  v_day DATE;
  v_ev JSONB;
  v_found RECORD;
  v_n INTEGER;
  v_xp INTEGER;
  v_coins INTEGER;
  v_used INTEGER;
  v_ledger_id BIGINT;
  v_total BIGINT;
  v_level_before INTEGER;
  v_level_after INTEGER;
  v_result JSONB;
BEGIN
  IF p_user IS NULL OR p_key IS NULL OR p_rule IS NULL THEN
    RAISE EXCEPTION 'game_bad_request' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(COALESCE(p_evidence, '[]'::jsonb)) <> 'array' OR jsonb_array_length(COALESCE(p_evidence, '[]'::jsonb)) > 10 THEN
    RAISE EXCEPTION 'game_bad_evidence' USING ERRCODE = '22023';
  END IF;

  -- 1. The account must be on the server economy, and the flag on (off = paused, never back to local awards)
  SELECT state INTO v_state FROM public.game_accounts WHERE user_id = p_user;
  IF v_state IS DISTINCT FROM 'cloud_active' THEN
    RAISE EXCEPTION 'game_account_not_active' USING ERRCODE = '42501';
  END IF;
  SELECT COALESCE((SELECT game_sync FROM public.user_features WHERE user_id = p_user), FALSE) INTO v_sync;
  IF NOT v_sync THEN
    RAISE EXCEPTION 'game_sync_paused' USING ERRCODE = '42501';
  END IF;

  -- 2. One award at a time per user: everything below runs on the locked projection row
  SELECT * INTO v_profile FROM public.game_profile WHERE user_id = p_user FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'game_profile_missing' USING ERRCODE = '42501';
  END IF;

  -- 3. A repeat of the key returns what was saved (another tab, device, retry) — never a second award
  SELECT * INTO v_existing FROM public.game_ledger WHERE user_id = p_user AND idempotency_key = p_key;
  IF FOUND THEN
    IF v_existing.rule_code <> p_rule THEN
      RAISE EXCEPTION 'game_key_conflict' USING ERRCODE = '23505';
    END IF;
    RETURN v_existing.result || jsonb_build_object('replay', TRUE);
  END IF;

  -- 4. The amount comes from the rules, never from the request
  SELECT * INTO v_rule FROM public.game_reward_rules WHERE code = p_rule AND active;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'game_unknown_rule' USING ERRCODE = '22023';
  END IF;

  -- 5. The game day: today by server time and the account zone (a late day only within the window, В-28)
  SELECT * INTO v_limits FROM public.game_limits WHERE id = 1;
  v_today := public.game_day_for(p_user);
  v_day := COALESCE(p_game_day, v_today);
  IF v_day > v_today
     OR (v_day < v_today AND NOT (v_day = v_today - 1
         AND public.game_day_for(p_user, now() - make_interval(mins => v_limits.late_window_minutes)) = v_day)) THEN
    RAISE EXCEPTION 'game_day_not_open' USING ERRCODE = '22023';
  END IF;

  -- 6. Evidence: the Journal rows the route checked must still be exactly those rows (locked until commit)
  FOR v_ev IN SELECT * FROM jsonb_array_elements(COALESCE(p_evidence, '[]'::jsonb)) LOOP
    IF NOT ((v_ev ->> 'table') = ANY (c_tables)) OR (v_ev ->> 'id') IS NULL OR (v_ev ->> 'version') IS NULL OR (v_ev ->> 'fp') IS NULL THEN
      RAISE EXCEPTION 'game_bad_evidence' USING ERRCODE = '22023';
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
  END LOOP;

  -- 7. Day caps on the locked state
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
  SELECT COALESCE(sum(coins), 0) INTO v_used FROM public.game_ledger WHERE user_id = p_user AND game_day = v_day;
  v_coins := GREATEST(0, LEAST(v_rule.coins, v_limits.coins_per_day - v_used));

  -- 8. Write: the ledger row, the source claims, the projection — all or nothing
  PERFORM set_config('ayra.game_writer', 'on', true);
  v_total := v_profile.xp_total + v_xp;
  v_level_before := v_profile.level;
  v_level_after := public.game_level_for_xp(v_total);
  v_result := jsonb_build_object(
    'key', p_key, 'rule', p_rule, 'game_day', v_day, 'xp', v_xp, 'coins', v_coins,
    'xp_total', v_total, 'coins_total', v_profile.coins + v_coins,
    'level_before', v_level_before, 'level_after', v_level_after, 'replay', FALSE);
  INSERT INTO public.game_ledger (user_id, idempotency_key, kind, rule_code, game_day, xp, coins, rules_version, evidence, result)
  VALUES (p_user, p_key, v_rule.kind, p_rule, v_day, v_xp, v_coins, v_rule.rules_version, COALESCE(p_evidence, '[]'::jsonb),
          v_result)
  RETURNING id INTO v_ledger_id;

  IF v_rule.source_scope IS NOT NULL THEN
    FOR v_ev IN SELECT * FROM jsonb_array_elements(COALESCE(p_evidence, '[]'::jsonb)) LOOP
      BEGIN
        INSERT INTO public.game_source_claims (user_id, scope, source_key, game_day, ledger_id)
        VALUES (p_user, v_rule.source_scope, COALESCE(v_ev ->> 'source_key', (v_ev ->> 'table') || ':' || (v_ev ->> 'id')), v_day, v_ledger_id);
      EXCEPTION WHEN unique_violation THEN
        RAISE EXCEPTION 'game_source_used' USING ERRCODE = '23505';
      END;
    END LOOP;
  END IF;

  UPDATE public.game_profile
     SET xp_total = v_total, level = v_level_after, coins = coins + v_coins,
         last_ledger_id = v_ledger_id, version = version + 1, updated_at = now()
   WHERE user_id = p_user;

  -- the writer mark ends with this function, not with the transaction (a caller's later SQL cannot write by hand)
  PERFORM set_config('ayra.game_writer', '', true);
  RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

--------------------------------------------------------------------------------
-- 8. Rebuild the projection from the ledger (repair; also proves the projection is only a cache)
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
  PERFORM set_config('ayra.game_writer', 'on', true);
  UPDATE public.game_profile
     SET xp_total = v_xp, level = public.game_level_for_xp(v_xp), coins = v_coins, last_ledger_id = v_last,
         version = version + 1, updated_at = now()
   WHERE user_id = p_user;
  PERFORM set_config('ayra.game_writer', '', true);
  RETURN jsonb_build_object('changed', v_before.xp_total <> v_xp OR v_before.coins <> v_coins,
    'xp_total', v_xp, 'coins', v_coins, 'level', public.game_level_for_xp(v_xp));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

--------------------------------------------------------------------------------
-- 9. State transitions (service only). Activation creates the empty projection; no XP is moved here (Q4.5 decides how
--    a migration is reviewed; an unverifiable legacy XP is never written automatically).
--------------------------------------------------------------------------------
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
  PERFORM set_config('ayra.game_writer', 'on', true);
  INSERT INTO public.game_profile (user_id) VALUES (p_user) ON CONFLICT (user_id) DO NOTHING;
  UPDATE public.game_accounts SET state = 'cloud_active', rules_version = p_rules_version WHERE user_id = p_user;
  PERFORM set_config('ayra.game_writer', '', true);
  RETURN 'cloud_active';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- The person's own state and flag (what the app reads to decide: local awards only while «local»)
CREATE OR REPLACE FUNCTION public.game_account_status()
RETURNS JSONB AS $$
  SELECT jsonb_build_object(
    'state', COALESCE((SELECT state FROM public.game_accounts WHERE user_id = auth.uid()), 'local'),
    'game_sync', COALESCE((SELECT game_sync FROM public.user_features WHERE user_id = auth.uid()), FALSE));
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

--------------------------------------------------------------------------------
-- 10. Access: clients read their own rows only; no client writes anything; award functions are service-only
--------------------------------------------------------------------------------
ALTER TABLE public.game_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.game_reward_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.game_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.game_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.game_source_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.game_profile ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.game_accounts, public.game_reward_rules, public.game_limits, public.game_ledger,
  public.game_source_claims, public.game_profile FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.game_accounts, public.game_reward_rules, public.game_ledger, public.game_profile TO authenticated;
GRANT ALL ON public.game_accounts, public.game_reward_rules, public.game_limits, public.game_ledger,
  public.game_source_claims, public.game_profile TO service_role;

DROP POLICY IF EXISTS game_accounts_select_own ON public.game_accounts;
CREATE POLICY game_accounts_select_own ON public.game_accounts FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id);
DROP POLICY IF EXISTS game_rules_select ON public.game_reward_rules;
CREATE POLICY game_rules_select ON public.game_reward_rules FOR SELECT TO authenticated USING (TRUE);
DROP POLICY IF EXISTS game_ledger_select_own ON public.game_ledger;
CREATE POLICY game_ledger_select_own ON public.game_ledger FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id);
DROP POLICY IF EXISTS game_profile_select_own ON public.game_profile;
CREATE POLICY game_profile_select_own ON public.game_profile FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id);

REVOKE ALL ON FUNCTION public.game_apply_reward(UUID, TEXT, TEXT, JSONB, DATE) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.game_rebuild_profile(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.game_begin_migration(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.game_activate_cloud(UUID, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.game_day_for(UUID, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.game_apply_reward(UUID, TEXT, TEXT, JSONB, DATE) TO service_role;
GRANT EXECUTE ON FUNCTION public.game_rebuild_profile(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.game_begin_migration(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.game_activate_cloud(UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.game_day_for(UUID, TIMESTAMPTZ) TO service_role;
REVOKE ALL ON FUNCTION public.game_account_status() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.game_account_status() TO authenticated;

COMMIT;
