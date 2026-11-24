-- AYRA Trading — rollback of 0022 (Q4.7-Б3). Removes the preview, the bulk decision, the shared decision policy and the
-- operation index, and restores 0020's single decision exactly as 0020 defines it. Decisions already taken stay as they
-- are (legacy_accepted / rejected rows and their audit entries are valid without 0022); nothing is deleted or rewritten.

BEGIN;

GRANT CREATE ON SCHEMA public TO game_economy_owner;

DROP FUNCTION IF EXISTS public.game_mig_bulk_accept_achievements(UUID, BIGINT, JSONB, UUID, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.game_mig_achievement_review(UUID);
DROP FUNCTION IF EXISTS public.game_mig_bulk_operation(UUID);
DROP INDEX IF EXISTS public.game_migration_audit_bulk_operation;

-- 0020's single decision, as it was
CREATE OR REPLACE FUNCTION public.game_mig_decide_achievement(p_user UUID, p_achievement TEXT, p_status TEXT, p_actor TEXT, p_reason TEXT)
RETURNS JSONB AS $$
DECLARE
  v_old public.game_achievements%ROWTYPE;
  v_new public.game_achievements%ROWTYPE;
BEGIN
  IF p_actor IS NULL OR length(btrim(p_actor)) = 0 THEN
    RAISE EXCEPTION 'game_mig_actor_required' USING ERRCODE = '22023';
  END IF;
  IF p_reason IS NULL OR length(btrim(p_reason)) = 0 THEN
    RAISE EXCEPTION 'game_mig_reason_required' USING ERRCODE = '22023';
  END IF;
  IF p_status NOT IN ('legacy_accepted', 'rejected', 'pending_review') THEN
    RAISE EXCEPTION 'game_bad_request' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_old FROM public.game_achievements WHERE user_id = p_user AND achievement_id = p_achievement FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'game_mig_no_such_achievement' USING ERRCODE = '22023';
  END IF;
  IF v_old.status = 'verified' THEN
    RAISE EXCEPTION 'game_mig_achievement_verified' USING ERRCODE = '22023';
  END IF;
  UPDATE public.game_achievements SET status = p_status, decided_by = p_actor, decided_at = now(), reason = p_reason
  WHERE user_id = p_user AND achievement_id = p_achievement RETURNING * INTO v_new;
  PERFORM public.game_mig_audit(p_actor, 'achievement_decided', p_user, jsonb_build_object('achievement', p_achievement,
    'before', v_old.status, 'after', p_status, 'reason', p_reason));
  RETURN to_jsonb(v_new);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

ALTER FUNCTION public.game_mig_decide_achievement(UUID, TEXT, TEXT, TEXT, TEXT) OWNER TO game_economy_owner;
REVOKE ALL ON FUNCTION public.game_mig_decide_achievement(UUID, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.game_mig_decide_achievement(UUID, TEXT, TEXT, TEXT, TEXT) TO game_migration_admin;

DROP FUNCTION IF EXISTS public.game_mig_achievement_refusal(public.game_achievements, TEXT);
DROP FUNCTION IF EXISTS public.game_mig_achievement_conflict(public.game_achievements);
DROP FUNCTION IF EXISTS public.game_mig_achievement_claim(JSONB, TEXT);
DROP FUNCTION IF EXISTS public.game_mig_achievement_version(public.game_achievements);

REVOKE CREATE ON SCHEMA public FROM game_economy_owner;

COMMIT;
