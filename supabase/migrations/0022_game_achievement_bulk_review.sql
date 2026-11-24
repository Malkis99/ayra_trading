-- AYRA Trading — 0022: reviewing the unproven achievements of ONE account in one operation (Q4.7-Б3,
-- docs/q4-7-b3-bulk-achievement-review.md). On top of 0020 and 0021.
--
-- The owner's tool (game_migration_admin, never an API role) can:
--   game_mig_achievement_review(user)  — read only: the account, its activated reconciliation, every server achievement with
--                                        its rule, evidence, the snapshots that claimed it (and what each claimed), conflicts
--                                        between devices, decisions taken, and a version of each row. Before the activation
--                                        there are no rows yet: the plan the activation would record is shown, nothing more.
--   game_mig_bulk_accept_achievements(user, reconciliation, items, operation, actor, reason)
--                                      — pending_review → legacy_accepted for exactly the listed achievements of that one
--                                        account, each with the version the person reviewed; all or nothing, in one
--                                        transaction; an audit entry per achievement and one for the operation; a rerun with
--                                        the same operation id is a replay. Never verified, never rejected, never a conflict
--                                        between devices, never XP or Coins.
-- Nothing else changes: the tables, 0020's single decision, the plan (0021), the economy.
--
-- Idempotent: safe to run twice.

BEGIN;

GRANT CREATE ON SCHEMA public TO game_economy_owner;

-- The version of an achievement row as the person reviewed it: any change of the row (a decision, a re-recorded claim)
-- changes it, so a decision on an old preview is refused
CREATE OR REPLACE FUNCTION public.game_mig_achievement_version(a public.game_achievements)
RETURNS TEXT AS $$
  SELECT md5(jsonb_build_array(a.user_id, a.achievement_id, a.family, a.status, a.source, a.detail, a.evidence, to_jsonb(a.claimed_by),
    a.rules_version, a.reconciliation_id, a.recorded_at, a.decided_by, a.decided_at, a.reason)::text)
$$ LANGUAGE sql STABLE SET search_path = public;

-- What one claiming snapshot said about an achievement (profile: its flag; category: rank, run, day; week: the boss)
CREATE OR REPLACE FUNCTION public.game_mig_achievement_claim(p_content JSONB, p_id TEXT)
RETURNS JSONB AS $$
  SELECT CASE
    WHEN p_id LIKE 'category:%' THEN public.game_mig_obj(public.game_mig_obj(p_content -> 'personalAchievements') -> substr(p_id, 10))
    WHEN p_id LIKE 'week:%' THEN COALESCE((SELECT jsonb_build_object('boss', w -> 'boss') FROM jsonb_array_elements(public.game_mig_arr(p_content -> 'weekTrophies')) w
                                           WHERE w ->> 'week' = substr(p_id, 6) LIMIT 1), '{}'::jsonb)
    ELSE jsonb_build_object('flag', public.game_mig_obj(p_content -> 'achievements') -> p_id)
  END
$$ LANGUAGE sql STABLE SET search_path = public;

-- The values the devices disagree on (several ranks of one path, several bosses of one week), from the snapshots that
-- still exist and from what the activation recorded; empty when they agree
CREATE OR REPLACE FUNCTION public.game_mig_achievement_conflict(a public.game_achievements)
RETURNS JSONB AS $$
  SELECT COALESCE((SELECT jsonb_agg(DISTINCT v ORDER BY v) FROM (
      SELECT jsonb_array_elements_text(COALESCE(a.evidence -> 'ranksClaimed', a.evidence -> 'bossesClaimed', '[]'::jsonb)) AS v
      UNION
      SELECT public.game_mig_achievement_claim(i.content, a.achievement_id) ->> CASE WHEN a.family = 'category' THEN 'rank' ELSE 'boss' END
      FROM public.game_imports i
      WHERE a.family IN ('category', 'week') AND i.user_id = a.user_id AND i.snapshot_id::text = ANY (a.claimed_by)
    ) q WHERE v IS NOT NULL HAVING count(DISTINCT v) > 1), '[]'::jsonb)
$$ LANGUAGE sql STABLE SET search_path = public;

--------------------------------------------------------------------------------
-- 1. Preview (read only)
--------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.game_mig_achievement_review(p_user UUID)
RETURNS JSONB AS $$
DECLARE
  v_state TEXT;
  v_rec public.game_reconciliations%ROWTYPE;
  v_items JSONB;
  v_why TEXT;
BEGIN
  SELECT state INTO v_state FROM public.game_accounts WHERE user_id = p_user;
  SELECT * INTO v_rec FROM public.game_reconciliations WHERE user_id = p_user AND status = 'activated';
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', a.achievement_id, 'family', a.family, 'status', a.status, 'source', a.source,
      'proof', c.proof, 'rule', COALESCE(c.rule, CASE a.family WHEN 'category' THEN 'the best rank of a personal path (proven only by a paid run)'
                                                               ELSE 'a week challenge won (checked on the device only)' END),
      'detail', a.detail, 'evidence', a.evidence, 'rulesVersion', a.rules_version,
      'claimedBy', (SELECT COALESCE(jsonb_agg(jsonb_build_object('snapshot', s.snap,
                      'present', i.snapshot_id IS NOT NULL, 'status', i.status, 'receivedAt', i.received_at, 'install', i.install_id,
                      'claimed', CASE WHEN i.snapshot_id IS NULL THEN NULL ELSE public.game_mig_achievement_claim(i.content, a.achievement_id) END)
                      ORDER BY s.snap COLLATE "C"), '[]'::jsonb)
                    FROM unnest(a.claimed_by) AS s(snap)
                    LEFT JOIN public.game_imports i ON i.user_id = a.user_id AND i.snapshot_id::text = s.snap),
      'conflict', public.game_mig_achievement_conflict(a),
      'decidedBy', a.decided_by, 'decidedAt', a.decided_at, 'reason', a.reason,
      'version', public.game_mig_achievement_version(a)) ORDER BY a.achievement_id COLLATE "C"), '[]'::jsonb)
  INTO v_items
  FROM public.game_achievements a LEFT JOIN public.game_achievement_catalog c ON c.id = a.achievement_id
  WHERE a.user_id = p_user;

  v_why := CASE
    WHEN v_state IS NULL THEN 'no_account'
    WHEN v_state <> 'cloud_active' THEN 'not_active'
    WHEN v_rec.id IS NULL OR v_rec.achievements_transferred_at IS NULL THEN 'achievements_not_transferred'
  END;
  RETURN jsonb_build_object(
    'account', p_user, 'state', COALESCE(v_state, 'local'),
    'reconciliation', CASE WHEN v_rec.id IS NULL THEN NULL ELSE jsonb_build_object('id', v_rec.id, 'activatedAt', v_rec.activated_at,
                        'achievementsTransferredAt', v_rec.achievements_transferred_at) END,
    -- a decision is possible only on recorded rows of an activated account (before that, nothing is recorded yet)
    'decidable', v_why IS NULL, 'notDecidableBecause', v_why,
    'items', v_items,
    'acceptable', (SELECT COALESCE(jsonb_agg(i ->> 'id' ORDER BY i ->> 'id' COLLATE "C"), '[]'::jsonb) FROM jsonb_array_elements(v_items) i
                   WHERE i ->> 'status' = 'pending_review' AND i -> 'conflict' = '[]'::jsonb AND v_why IS NULL),
    -- what the activation WOULD record (migration_pending): information only, nothing can be decided on it
    'plan', CASE WHEN v_state = 'migration_pending' THEN public.game_mig_achievement_plan(p_user, public.game_mig_reconcile(p_user), NULL) END);
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public;

--------------------------------------------------------------------------------
-- 2. The decision on the listed achievements of one account
--------------------------------------------------------------------------------
-- p_items: [{"id": "<achievement id>", "version": "<the version shown by the preview>"}, …] — exactly what the person
-- chose (nothing is added: an achievement not listed stays as it is). p_operation: the operation's own id (a rerun with
-- the same id and the same list is a replay; another list under that id is refused).
CREATE OR REPLACE FUNCTION public.game_mig_bulk_accept_achievements(p_user UUID, p_reconciliation BIGINT, p_items JSONB, p_operation UUID,
  p_actor TEXT, p_reason TEXT)
RETURNS JSONB AS $$
DECLARE
  c_max CONSTANT INT := 64;            -- PLACEHOLDER: at most this many achievements in one operation
  c_reason_min CONSTANT INT := 10;     -- PLACEHOLDER: a reason is a sentence, not a word
  v_ids TEXT[];
  v_n INT;
  v_prior JSONB;
  v_state TEXT;
  v_rec public.game_reconciliations%ROWTYPE;
  r RECORD;
  v_bad JSONB := '[]';
  v_missing TEXT[];
  v_before JSONB := '[]';
BEGIN
  -- the request itself
  IF p_actor IS NULL OR length(btrim(p_actor)) = 0 THEN
    RAISE EXCEPTION 'game_mig_actor_required' USING ERRCODE = '22023';
  END IF;
  IF p_reason IS NULL OR length(btrim(p_reason)) < c_reason_min THEN
    RAISE EXCEPTION 'game_mig_reason_required' USING ERRCODE = '22023', DETAIL = format('a reason of at least %s characters', c_reason_min);
  END IF;
  IF p_operation IS NULL OR p_reconciliation IS NULL THEN
    RAISE EXCEPTION 'game_bad_request' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(p_items) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'game_bad_request' USING ERRCODE = '22023';
  END IF;
  v_n := jsonb_array_length(p_items);
  IF v_n = 0 THEN
    RAISE EXCEPTION 'game_mig_empty_selection' USING ERRCODE = '22023';
  END IF;
  IF v_n > c_max OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_items) x
       WHERE jsonb_typeof(x) <> 'object' OR NOT COALESCE((x ->> 'id') ~ '^[A-Za-z0-9:-]{1,60}$', FALSE)
          OR NOT COALESCE((x ->> 'version') ~ '^[0-9a-f]{32}$', FALSE)) THEN
    RAISE EXCEPTION 'game_bad_request' USING ERRCODE = '22023';
  END IF;
  SELECT array_agg(x ->> 'id' ORDER BY x ->> 'id' COLLATE "C") INTO v_ids FROM jsonb_array_elements(p_items) x;
  IF (SELECT count(DISTINCT u) FROM unnest(v_ids) u) <> v_n THEN
    RAISE EXCEPTION 'game_bad_request' USING ERRCODE = '22023', DETAIL = 'an achievement is listed twice';
  END IF;

  -- one operation on an account at a time (two people reviewing the same account wait for each other)
  PERFORM pg_advisory_xact_lock(hashtextextended('game_mig_bulk_accept:' || p_user::text, 0));

  -- a rerun of an operation that was done: the same answer, nothing changes again
  SELECT details INTO v_prior FROM public.game_migration_audit
  WHERE action = 'achievements_bulk_accepted' AND details ->> 'operation' = p_operation::text LIMIT 1;
  IF FOUND THEN
    IF (SELECT user_id FROM public.game_migration_audit WHERE action = 'achievements_bulk_accepted' AND details ->> 'operation' = p_operation::text LIMIT 1)
         IS DISTINCT FROM p_user
       OR v_prior -> 'ids' IS DISTINCT FROM to_jsonb(v_ids) THEN
      RAISE EXCEPTION 'game_mig_operation_mismatch' USING ERRCODE = '22023', DETAIL = 'this operation id was used for another decision';
    END IF;
    RETURN jsonb_build_object('operation', p_operation, 'replay', TRUE, 'accepted', v_prior -> 'ids', 'count', v_prior -> 'count');
  END IF;

  -- the operation's own entry FIRST: it takes the account's user row the way a deletion does (no deadlock with a deletion;
  -- a deleted account has no user row and is refused here)
  BEGIN
    PERFORM public.game_mig_audit(p_actor, 'achievements_bulk_accepted', p_user, jsonb_build_object('operation', p_operation,
      'reconciliation', p_reconciliation, 'ids', to_jsonb(v_ids), 'count', v_n, 'reason', p_reason));
  EXCEPTION WHEN foreign_key_violation THEN
    RAISE EXCEPTION 'game_mig_no_such_account' USING ERRCODE = '22023';
  END;

  -- the account: activated, its achievements recorded, the reconciliation the person reviewed
  SELECT state INTO v_state FROM public.game_accounts WHERE user_id = p_user FOR UPDATE;
  IF v_state IS DISTINCT FROM 'cloud_active' THEN
    RAISE EXCEPTION 'game_mig_not_active' USING ERRCODE = '22023',
      DETAIL = 'decisions are taken on the recorded achievements of an activated account (before the activation nothing is recorded yet)';
  END IF;
  SELECT * INTO v_rec FROM public.game_reconciliations WHERE user_id = p_user AND status = 'activated';
  IF v_rec.id IS NULL OR v_rec.achievements_transferred_at IS NULL THEN
    RAISE EXCEPTION 'game_mig_achievements_not_transferred' USING ERRCODE = '22023';
  END IF;
  IF v_rec.id <> p_reconciliation THEN
    RAISE EXCEPTION 'game_mig_review_stale' USING ERRCODE = '22023', DETAIL = 'another reconciliation is activated: review again';
  END IF;

  -- the listed rows, locked in one order (two operations never wait on each other in a cycle)
  SELECT array_agg(u ORDER BY u COLLATE "C") INTO v_missing FROM unnest(v_ids) u
  WHERE NOT EXISTS (SELECT 1 FROM public.game_achievements a WHERE a.user_id = p_user AND a.achievement_id = u);
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'game_mig_no_such_achievement' USING ERRCODE = '22023', DETAIL = array_to_string(v_missing, ', ');
  END IF;
  FOR r IN SELECT a.*, public.game_mig_achievement_version(a) AS version, public.game_mig_achievement_conflict(a) AS conflict
           FROM public.game_achievements a WHERE a.user_id = p_user AND a.achievement_id = ANY (v_ids)
           ORDER BY a.achievement_id COLLATE "C" FOR UPDATE LOOP
    IF r.status = 'verified' THEN
      v_bad := v_bad || jsonb_build_object('id', r.achievement_id, 'why', 'game_mig_achievement_verified');
    ELSIF r.status = 'rejected' THEN
      v_bad := v_bad || jsonb_build_object('id', r.achievement_id, 'why', 'game_mig_achievement_rejected');
    ELSIF r.status <> 'pending_review' THEN
      v_bad := v_bad || jsonb_build_object('id', r.achievement_id, 'why', 'game_mig_achievement_decided');
    ELSIF r.version <> (SELECT x ->> 'version' FROM jsonb_array_elements(p_items) x WHERE x ->> 'id' = r.achievement_id) THEN
      v_bad := v_bad || jsonb_build_object('id', r.achievement_id, 'why', 'game_mig_review_stale');
    ELSIF r.conflict <> '[]'::jsonb THEN
      -- the devices disagree (several ranks, several bosses): never the best one picked for the person
      v_bad := v_bad || jsonb_build_object('id', r.achievement_id, 'why', 'game_mig_achievement_conflict', 'values', r.conflict);
    END IF;
    v_before := v_before || jsonb_build_object('id', r.achievement_id, 'status', r.status, 'version', r.version);
  END LOOP;
  IF jsonb_array_length(v_bad) > 0 THEN
    -- nothing is accepted when anything in the list cannot be (no partial decision)
    RAISE EXCEPTION '%', v_bad -> 0 ->> 'why' USING ERRCODE = '22023', DETAIL = v_bad::text;
  END IF;

  UPDATE public.game_achievements SET status = 'legacy_accepted', decided_by = p_actor, decided_at = now(), reason = p_reason
  WHERE user_id = p_user AND achievement_id = ANY (v_ids);
  FOR r IN SELECT b ->> 'id' AS id, b ->> 'version' AS version FROM jsonb_array_elements(v_before) b LOOP
    PERFORM public.game_mig_audit(p_actor, 'achievement_decided', p_user, jsonb_build_object('achievement', r.id,
      'before', 'pending_review', 'after', 'legacy_accepted', 'reason', p_reason, 'operation', p_operation, 'reviewedVersion', r.version));
  END LOOP;
  RETURN jsonb_build_object('operation', p_operation, 'replay', FALSE, 'accepted', to_jsonb(v_ids), 'count', v_n);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

ALTER FUNCTION public.game_mig_achievement_version(public.game_achievements) OWNER TO game_economy_owner;
ALTER FUNCTION public.game_mig_achievement_claim(JSONB, TEXT) OWNER TO game_economy_owner;
ALTER FUNCTION public.game_mig_achievement_conflict(public.game_achievements) OWNER TO game_economy_owner;
ALTER FUNCTION public.game_mig_achievement_review(UUID) OWNER TO game_economy_owner;
ALTER FUNCTION public.game_mig_bulk_accept_achievements(UUID, BIGINT, JSONB, UUID, TEXT, TEXT) OWNER TO game_economy_owner;

DO $$
DECLARE f TEXT;
BEGIN
  FOREACH f IN ARRAY ARRAY['game_mig_achievement_version(public.game_achievements)', 'game_mig_achievement_claim(JSONB, TEXT)',
    'game_mig_achievement_conflict(public.game_achievements)', 'game_mig_achievement_review(UUID)',
    'game_mig_bulk_accept_achievements(UUID, BIGINT, JSONB, UUID, TEXT, TEXT)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated, service_role', f);
  END LOOP;
END $$;
-- the owner's tool only: the preview and the decision (the helpers run inside them)
GRANT EXECUTE ON FUNCTION public.game_mig_achievement_review(UUID) TO game_migration_admin;
GRANT EXECUTE ON FUNCTION public.game_mig_bulk_accept_achievements(UUID, BIGINT, JSONB, UUID, TEXT, TEXT) TO game_migration_admin;

REVOKE CREATE ON SCHEMA public FROM game_economy_owner;

COMMIT;
