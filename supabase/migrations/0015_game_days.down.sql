-- AYRA Trading — rollback of 0015 (server game day). Restores the 0014 award exactly as 0014 defined it, removes the
-- day tables, the day functions, the diagnostics and the two added columns. 0014 and everything before stay.
BEGIN;

DO $$
DECLARE f TEXT;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'game_apply_reward_at(uuid,text,text,jsonb,timestamptz)', 'game_day_open(uuid,text,text[])', 'game_day_set_mode(uuid,text)',
    'game_day_accept(uuid,text)', 'game_day_pass(uuid,text)', 'game_day_replace(uuid,text,text)', 'game_mission_status(uuid,text)',
    'game_record_shadow(jsonb)', 'game_my_day()',
    'game_day_open_at(uuid,text,text[],timestamptz)', 'game_day_set_mode_at(uuid,text,timestamptz)',
    'game_day_accept_at(uuid,text,timestamptz)', 'game_day_pass_at(uuid,text,timestamptz)',
    'game_day_replace_at(uuid,text,text,timestamptz)', 'game_mission_status_at(uuid,text,timestamptz)',
    'game_compose_core(text[],text,jsonb,text[],text,text[],text[])', 'game_current_day(uuid,timestamptz)',
    'game_days_close_before(uuid,date,timestamptz)', 'game_day_json(public.game_days)', 'game_lock_account(uuid)',
    'game_paid_missions(uuid,date)', 'game_study_first(uuid,date,text)', 'game_mode_core(text,text)',
    'game_day_now(uuid,timestamptz)', 'game_zone_of(uuid)'] LOOP
    EXECUTE format('DROP FUNCTION IF EXISTS public.%s', f);
  END LOOP;
END $$;

DROP POLICY IF EXISTS game_source_claims_select_own ON public.game_source_claims;
REVOKE SELECT ON public.game_source_claims FROM authenticated;
DROP TABLE IF EXISTS public.game_shadow_diagnostics;
DROP TABLE IF EXISTS public.game_days;
DROP TABLE IF EXISTS public.game_mode_missions;
DROP FUNCTION IF EXISTS public.game_day_guard();

-- the two columns (the owner's guard refuses writes, not schema changes)
ALTER TABLE public.game_accounts DROP COLUMN IF EXISTS current_day;
ALTER TABLE public.game_limits DROP COLUMN IF EXISTS replacements_per_day;

-- the 0014 award, as 0014 defined it
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
ALTER FUNCTION public.game_apply_reward(UUID, TEXT, TEXT, JSONB) OWNER TO game_economy_owner;
REVOKE ALL ON FUNCTION public.game_apply_reward(UUID, TEXT, TEXT, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.game_apply_reward(UUID, TEXT, TEXT, JSONB) TO service_role;

COMMIT;
