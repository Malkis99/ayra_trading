-- AYRA Trading — rollback of 0020 (Q4.6). Restores the 0019 intake (1 MB) and activation (achievements not
-- transferred). Refuses while any server achievement exists (they are the users' achievements: nothing is deleted by a
-- rollback). The anonymous counts and the deletion log go with it (they hold no personal data). Ledger rows and the
-- 0019 tables are untouched.

BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.game_achievements) THEN
    RAISE EXCEPTION 'game_rollback_achievements: server achievements exist — export and keep them before rolling back 0020';
  END IF;
END $$;

GRANT CREATE ON SCHEMA public TO game_economy_owner;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['game_imports', 'game_reconciliations', 'game_legacy_reviews', 'game_migration_windows', 'game_migration_audit',
                           'game_achievements', 'game_ledger', 'game_profile', 'game_accounts'] LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('DROP TRIGGER IF EXISTS tr_%s_count_deletion ON public.%I', t, t);
    END IF;
  END LOOP;
END $$;
DROP TRIGGER IF EXISTS tr_game_migration_audit_fold ON public.game_migration_audit;

DROP FUNCTION IF EXISTS public.game_mig_purge_snapshots(UUID, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.game_achievements_for_session(UUID, UUID, BIGINT, TEXT);
DROP FUNCTION IF EXISTS public.game_mig_decide_achievement(UUID, TEXT, TEXT, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.game_mig_transfer_achievements(UUID, TEXT);
DROP FUNCTION IF EXISTS public.game_mig_record_achievements(UUID, BIGINT, JSONB);
DROP FUNCTION IF EXISTS public.game_mig_achievement_plan(UUID, JSONB, BIGINT);
DROP FUNCTION IF EXISTS public.game_privacy_fold_audit();
DROP FUNCTION IF EXISTS public.game_privacy_count_deletion();

-- 0019 intake and activation
CREATE OR REPLACE FUNCTION public.game_import_snapshot(p_user UUID, p_session UUID, p_iat BIGINT, p_claim TEXT,
  p_snapshot UUID, p_install UUID, p_schema INTEGER, p_content JSONB)
RETURNS JSONB AS $$
DECLARE
  v_state TEXT;
  v_check JSONB;
  v_md5 TEXT;
  v_size INTEGER;
  v_old public.game_imports%ROWTYPE;
  v_status TEXT;
BEGIN
  IF p_user IS NULL OR p_snapshot IS NULL OR p_install IS NULL OR p_content IS NULL OR jsonb_typeof(p_content) <> 'object' THEN
    RAISE EXCEPTION 'game_bad_request' USING ERRCODE = '22023';
  END IF;
  IF p_schema IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'game_import_schema' USING ERRCODE = '22023';
  END IF;
  v_size := octet_length(p_content::text);
  IF v_size > 1048576 THEN  -- PLACEHOLDER: 1 MB
    RAISE EXCEPTION 'game_import_too_large' USING ERRCODE = '22023';
  END IF;
  -- held until the snapshot is written: the activation (FOR UPDATE) waits for it, or it waits for the activation
  INSERT INTO public.game_accounts (user_id) VALUES (p_user) ON CONFLICT (user_id) DO NOTHING;
  SELECT state INTO v_state FROM public.game_accounts WHERE user_id = p_user FOR SHARE;
  v_check := public.game_session_check(p_user, p_session, p_iat, p_claim);
  IF NOT (v_check ->> 'fresh')::BOOLEAN THEN
    RAISE EXCEPTION 'game_session_stale' USING ERRCODE = '42501';
  END IF;
  IF v_state NOT IN ('migration_pending', 'cloud_active') THEN
    -- no window yet: nothing is stored, the device keeps its progress as it is
    RAISE EXCEPTION 'game_import_not_open' USING ERRCODE = '22023';
  END IF;
  v_md5 := md5(p_content::text);
  SELECT * INTO v_old FROM public.game_imports WHERE user_id = p_user AND snapshot_id = p_snapshot;
  IF FOUND THEN
    IF v_old.content_md5 = v_md5 AND v_old.install_id = p_install THEN
      RETURN jsonb_build_object('status', v_old.status, 'replay', TRUE, 'received_at', v_old.received_at);
    END IF;
    RAISE EXCEPTION 'game_import_conflict' USING ERRCODE = '23505';
  END IF;
  IF (SELECT count(*) FROM public.game_imports WHERE user_id = p_user) >= 20 THEN  -- PLACEHOLDER: 20 snapshots per account
    RAISE EXCEPTION 'game_import_limit' USING ERRCODE = '54000';
  END IF;
  -- after the activation, or after the window closed (no automatic activation either way): kept apart, never reconciled
  v_status := CASE WHEN v_state = 'cloud_active' OR now() >= public.game_mig_window_closes_at(p_user) THEN 'late' ELSE 'accepted' END;
  IF v_status = 'accepted' AND EXISTS (SELECT 1 FROM public.game_imports WHERE user_id = p_user AND install_id = p_install AND status = 'accepted') THEN
    v_status := 'duplicate_install';
  END IF;
  BEGIN
    INSERT INTO public.game_imports (user_id, snapshot_id, install_id, schema_version, content, content_md5, byte_size, status, account_state, session_id, token_iat)
    VALUES (p_user, p_snapshot, p_install, p_schema, p_content, v_md5, v_size, v_status, v_state, p_session, p_iat);
  EXCEPTION WHEN unique_violation THEN
    -- a concurrent request: the same snapshot (decide again from what is stored) or another one of the same install
    SELECT * INTO v_old FROM public.game_imports WHERE user_id = p_user AND snapshot_id = p_snapshot;
    IF FOUND THEN
      IF v_old.content_md5 = v_md5 AND v_old.install_id = p_install THEN
        RETURN jsonb_build_object('status', v_old.status, 'replay', TRUE, 'received_at', v_old.received_at);
      END IF;
      RAISE EXCEPTION 'game_import_conflict' USING ERRCODE = '23505';
    END IF;
    v_status := 'duplicate_install';
    INSERT INTO public.game_imports (user_id, snapshot_id, install_id, schema_version, content, content_md5, byte_size, status, account_state, session_id, token_iat)
    VALUES (p_user, p_snapshot, p_install, p_schema, p_content, v_md5, v_size, v_status, v_state, p_session, p_iat);
  END;
  RETURN jsonb_build_object('status', v_status, 'replay', FALSE, 'received_at', now());
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION public.game_mig_activate(p_user UUID, p_reconciliation BIGINT, p_actor TEXT, p_level_gap_ack TEXT)
RETURNS JSONB AS $$
DECLARE
  v_state TEXT;
  v_rec public.game_reconciliations%ROWTYPE;
  v_now JSONB;
  v_closes TIMESTAMPTZ;
  e JSONB;
  v_legacy public.game_legacy_reviews%ROWTYPE;
  v_xp BIGINT := 0;
  v_coins BIGINT := 0;
  v_level INTEGER;
  v_orig INTEGER;
BEGIN
  IF p_actor IS NULL OR length(btrim(p_actor)) = 0 THEN
    RAISE EXCEPTION 'game_mig_actor_required' USING ERRCODE = '22023';
  END IF;
  SELECT state INTO v_state FROM public.game_accounts WHERE user_id = p_user FOR UPDATE;
  SELECT * INTO v_rec FROM public.game_reconciliations WHERE id = p_reconciliation AND user_id = p_user;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'game_mig_no_such_reconciliation' USING ERRCODE = '22023';
  END IF;
  IF v_state = 'cloud_active' AND v_rec.status = 'activated' THEN
    RETURN jsonb_build_object('state', 'cloud_active', 'replay', TRUE);  -- a second click
  END IF;
  IF v_state IS DISTINCT FROM 'migration_pending' THEN
    RAISE EXCEPTION 'game_mig_not_pending' USING ERRCODE = '22023';
  END IF;
  IF v_rec.status <> 'draft' THEN
    RAISE EXCEPTION 'game_mig_reconciliation_not_current' USING ERRCODE = '40001';
  END IF;
  -- the window is closed first (owner decision: 7 days, extended only by hand): no device of the window is left out
  v_closes := public.game_mig_window_closes_at(p_user);
  IF now() < v_closes THEN
    RAISE EXCEPTION 'game_mig_window_open' USING ERRCODE = '22023', DETAIL = format('the intake window closes at %s', v_closes);
  END IF;
  -- the independent check again, right before anything is credited: the database computes the result from the stored
  -- snapshots now; it must be the saved one (a snapshot that came since, another time zone, an edited row: refused)
  v_now := public.game_mig_reconcile(p_user);
  IF v_now IS DISTINCT FROM v_rec.result OR md5(v_rec.result::text) IS DISTINCT FROM v_rec.result_md5 THEN
    PERFORM public.game_mig_audit(p_actor, 'activation_refused', p_user, jsonb_build_object('reconciliation', p_reconciliation,
      'reason', 'the database''s computation now differs from the saved reconciliation',
      'saved_md5', v_rec.result_md5, 'stored_md5', md5(v_rec.result::text), 'now_md5', md5(v_now::text),
      'now_inputs', v_now -> 'inputs', 'saved_inputs', v_rec.result -> 'inputs'));
    RETURN jsonb_build_object('state', 'migration_pending', 'activated', FALSE, 'refused', 'game_mig_result_changed');
  END IF;
  IF EXISTS (SELECT 1 FROM public.game_imports i WHERE i.user_id = p_user AND i.status = 'accepted'
             AND NOT EXISTS (SELECT 1 FROM public.game_legacy_reviews r WHERE r.user_id = p_user AND r.snapshot_id = i.snapshot_id))
     OR EXISTS (SELECT 1 FROM public.game_legacy_reviews WHERE user_id = p_user AND status IN ('pending_review', 'needs_evidence')) THEN
    RAISE EXCEPTION 'game_mig_unresolved' USING ERRCODE = '22023';  -- every remainder decided before anything is credited
  END IF;
  -- every review is about the candidate computed now (never an amount decided for another one)
  IF EXISTS (SELECT 1 FROM public.game_legacy_reviews r WHERE r.user_id = p_user AND NOT EXISTS (
       SELECT 1 FROM jsonb_array_elements(v_now -> 'legacy') l WHERE (l ->> 'snapshotId')::UUID = r.snapshot_id
         AND (l -> 'candidate' ->> 'xp')::INTEGER = r.candidate_xp AND (l -> 'candidate' ->> 'coins')::INTEGER = r.candidate_coins)
       AND EXISTS (SELECT 1 FROM public.game_imports i WHERE i.user_id = p_user AND i.snapshot_id = r.snapshot_id AND i.status = 'accepted')) THEN
    RAISE EXCEPTION 'game_mig_reviews_stale' USING ERRCODE = '40001';
  END IF;
  SELECT * INTO v_legacy FROM public.game_legacy_reviews WHERE user_id = p_user AND status = 'accepted';
  FOR e IN SELECT * FROM jsonb_array_elements(v_now -> 'events') LOOP
    v_xp := v_xp + (e ->> 'xp')::BIGINT;
    v_coins := v_coins + (e ->> 'coins')::BIGINT;
  END LOOP;
  IF v_legacy.snapshot_id IS NOT NULL THEN
    v_xp := v_xp + v_legacy.accepted_xp;
    v_coins := v_coins + v_legacy.accepted_coins;
  END IF;
  v_level := public.game_level_for_xp(v_xp);
  v_orig := (v_now -> 'proposed' ->> 'originalLevel')::INTEGER;
  IF v_level < v_orig AND (p_level_gap_ack IS NULL OR length(btrim(p_level_gap_ack)) = 0) THEN
    RAISE EXCEPTION 'game_mig_level_gap' USING ERRCODE = '22023', DETAIL = format('level %s below the original %s', v_level, v_orig);
  END IF;
  UPDATE public.game_reconciliations SET status = 'activating' WHERE id = p_reconciliation;
  FOR e IN SELECT * FROM jsonb_array_elements(v_now -> 'events') LOOP
    INSERT INTO public.game_ledger (user_id, idempotency_key, kind, rule_code, game_day, xp, coins, rules_version, evidence, result)
    VALUES (p_user, 'import:' || (e ->> 'key'), 'migration_import', 'migration_import', (e ->> 'day')::DATE, (e ->> 'xp')::INTEGER, (e ->> 'coins')::INTEGER,
            'q4.5-4', jsonb_build_array(jsonb_build_object('reconciliation', p_reconciliation, 'result_md5', v_rec.result_md5, 'sources', e -> 'sources')), e)
    ON CONFLICT (user_id, idempotency_key) DO NOTHING;
  END LOOP;
  IF v_legacy.snapshot_id IS NOT NULL AND (v_legacy.accepted_xp > 0 OR v_legacy.accepted_coins > 0) THEN
    INSERT INTO public.game_ledger (user_id, idempotency_key, kind, rule_code, game_day, xp, coins, rules_version, evidence, result)
    VALUES (p_user, 'legacy:' || p_user::text, 'migration_legacy', 'migration_legacy', CURRENT_DATE, v_legacy.accepted_xp, v_legacy.accepted_coins,
            'q4.5-4', jsonb_build_array(jsonb_build_object('snapshot', v_legacy.snapshot_id, 'decided_by', v_legacy.decided_by, 'reason', v_legacy.reason)),
            jsonb_build_object('candidate_xp', v_legacy.candidate_xp, 'candidate_coins', v_legacy.candidate_coins))
    ON CONFLICT (user_id, idempotency_key) DO NOTHING;
  END IF;
  -- the transition accepts cloud_active only inside an activation (this marker, for this account, in this transaction)
  PERFORM set_config('ayra.mig_activation', p_user::text, TRUE);
  PERFORM public.game_economy_transition(p_user, 'migration_pending', 'cloud_active');
  PERFORM set_config('ayra.mig_activation', '', TRUE);
  PERFORM public.game_rebuild_profile(p_user);
  UPDATE public.game_reconciliations SET status = 'activated', activated_by = p_actor, activated_at = now(), level_gap_ack = p_level_gap_ack WHERE id = p_reconciliation;
  -- achievements are not on the server before Q4.6: recorded here, the transfer is not complete for the person yet
  PERFORM public.game_mig_audit(p_actor, 'activated', p_user, jsonb_build_object('reconciliation', p_reconciliation, 'result_md5', v_rec.result_md5,
    'xp', v_xp, 'coins', v_coins, 'level', v_level, 'original_level', v_orig, 'level_gap_ack', p_level_gap_ack, 'legacy', v_legacy.snapshot_id,
    'achievements_on_devices', v_now -> 'achievements', 'achievements_transferred', FALSE));
  RETURN jsonb_build_object('state', 'cloud_active', 'replay', FALSE, 'xp', v_xp, 'coins', v_coins, 'level', v_level,
    'achievements_transferred', FALSE, 'achievements_on_devices', v_now -> 'achievements');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

ALTER FUNCTION public.game_import_snapshot(UUID, UUID, BIGINT, TEXT, UUID, UUID, INTEGER, JSONB) OWNER TO game_economy_owner;
ALTER FUNCTION public.game_mig_activate(UUID, BIGINT, TEXT, TEXT) OWNER TO game_economy_owner;

DROP TABLE IF EXISTS public.game_achievements;
DROP TABLE IF EXISTS public.game_achievement_catalog;
DROP TABLE IF EXISTS public.game_privacy_stats;
DROP TABLE IF EXISTS public.game_deletion_log;
ALTER TABLE public.game_reconciliations DROP COLUMN IF EXISTS achievements_transferred_at;

REVOKE CREATE ON SCHEMA public FROM game_economy_owner;

COMMIT;
