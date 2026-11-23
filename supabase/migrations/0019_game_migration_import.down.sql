-- AYRA Trading — rollback of 0019 (Q4.5-4). Restores the 0018 transition and the 0018 access of service_role.
-- Refuses while any snapshot, reconciliation or review exists (they are the users' progress under review: nothing is
-- deleted by a rollback — export or decide them first). Ledger rows written by an activation stay: XP and Coins of
-- an activated account are never taken back by a rollback (their rules stay too, so the rows keep their references).

BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.game_imports) OR EXISTS (SELECT 1 FROM public.game_reconciliations)
     OR EXISTS (SELECT 1 FROM public.game_legacy_reviews) OR EXISTS (SELECT 1 FROM public.game_migration_audit) THEN
    RAISE EXCEPTION 'game_rollback_migration_data: snapshots or decisions exist — export and keep them before rolling back 0019';
  END IF;
END $$;

GRANT CREATE ON SCHEMA public TO game_economy_owner;

DROP FUNCTION IF EXISTS public.game_mig_activate(UUID, BIGINT, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.game_mig_decide_legacy(UUID, UUID, TEXT, INTEGER, INTEGER, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.game_mig_save_reconciliation(UUID, JSONB, TEXT);
DROP FUNCTION IF EXISTS public.game_mig_transition(UUID, TEXT, TEXT, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.game_mig_inputs(UUID);
DROP FUNCTION IF EXISTS public.game_mig_journal_days(UUID, TEXT);
DROP FUNCTION IF EXISTS public.game_mig_timezone(UUID);
DROP FUNCTION IF EXISTS public.game_mig_audit(TEXT, TEXT, UUID, JSONB);
DROP FUNCTION IF EXISTS public.game_import_snapshot(UUID, UUID, BIGINT, TEXT, UUID, UUID, INTEGER, JSONB);

-- 0018 transition (no snapshot check)
CREATE OR REPLACE FUNCTION public.game_economy_transition(p_user UUID, p_from TEXT, p_to TEXT)
RETURNS JSONB AS $$
DECLARE
  v_row public.game_accounts%ROWTYPE;
BEGIN
  IF p_user IS NULL OR public.game_state_rank(p_from) IS NULL OR public.game_state_rank(p_to) IS NULL OR p_to = 'local' THEN
    RAISE EXCEPTION 'game_bad_request' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.game_accounts (user_id) VALUES (p_user) ON CONFLICT (user_id) DO NOTHING;
  SELECT * INTO v_row FROM public.game_accounts WHERE user_id = p_user FOR UPDATE;
  IF v_row.state = p_to THEN
    RETURN jsonb_build_object('state', p_to, 'changed', FALSE, 'state_changed_at', v_row.state_changed_at);
  END IF;
  IF v_row.state <> p_from THEN
    RAISE EXCEPTION 'game_state_conflict' USING ERRCODE = '40001';
  END IF;
  IF p_to = 'cloud_active' THEN
    INSERT INTO public.game_profile (user_id) VALUES (p_user) ON CONFLICT (user_id) DO NOTHING;
  END IF;
  UPDATE public.game_accounts SET state = p_to WHERE user_id = p_user RETURNING * INTO v_row;
  RETURN jsonb_build_object('state', p_to, 'changed', TRUE, 'state_changed_at', v_row.state_changed_at);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
ALTER FUNCTION public.game_economy_transition(UUID, TEXT, TEXT) OWNER TO game_economy_owner;
REVOKE ALL ON FUNCTION public.game_economy_transition(UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.game_economy_transition(UUID, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.game_begin_migration(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.game_activate_cloud(UUID, TEXT) TO service_role;

DROP TABLE IF EXISTS public.game_legacy_reviews;
DROP TABLE IF EXISTS public.game_reconciliations;
DROP TABLE IF EXISTS public.game_imports;
DROP TABLE IF EXISTS public.game_migration_audit;
DROP FUNCTION IF EXISTS public.game_import_immutable();

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'game_migration_admin') THEN
    EXECUTE 'REVOKE SELECT ON public.game_accounts, public.game_ledger, public.game_profile FROM game_migration_admin';
    EXECUTE 'DROP POLICY IF EXISTS game_accounts_mig_admin_read ON public.game_accounts';
    EXECUTE 'DROP POLICY IF EXISTS game_ledger_mig_admin_read ON public.game_ledger';
    EXECUTE 'DROP POLICY IF EXISTS game_profile_mig_admin_read ON public.game_profile';
    EXECUTE 'REVOKE USAGE ON SCHEMA public FROM game_migration_admin';
    EXECUTE 'DROP ROLE game_migration_admin';
  END IF;
END $$;

REVOKE CREATE ON SCHEMA public FROM game_economy_owner;

COMMIT;
