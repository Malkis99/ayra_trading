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
--                                        transaction; an audit entry per achievement and one for the operation; a rerun of the
--                                        SAME request (account, reconciliation, achievements and versions, author, reason) under
--                                        its operation id is a replay; anything else under that id is refused. Never verified,
--                                        never rejected, never a conflict between devices, never XP or Coins.
--   game_mig_bulk_operation(operation) — read only: the request stored with an operation id (a retry resends exactly it).
--   game_mig_decide_achievement        — 0020's single decision, REDEFINED with the same policy (game_mig_achievement_refusal):
--                                        only from pending_review; legacy_accepted never with a conflict between devices; a decided,
--                                        rejected or verified row never changes through it (re-reviewing a rejected one is a separate,
--                                        future procedure). Every path that changes an achievement row goes through this policy.
-- Nothing else changes: the tables, the plan (0021), the economy.
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

-- ONE policy for every person's decision on an achievement (the single command and the bulk operation): the reason it
-- cannot be decided now, or NULL. Only a pending_review row can be decided; legacy_accepted never when the devices disagree
-- (several ranks, several bosses — nothing is chosen for the person); rejecting is allowed (it chooses no value).
CREATE OR REPLACE FUNCTION public.game_mig_achievement_refusal(a public.game_achievements, p_target TEXT)
RETURNS TEXT AS $$
  SELECT CASE
    WHEN p_target IS NULL OR p_target NOT IN ('legacy_accepted', 'rejected') THEN 'game_bad_request'
    WHEN a.status = 'verified' THEN 'game_mig_achievement_verified'
    WHEN a.status = 'rejected' THEN 'game_mig_achievement_rejected'
    WHEN a.status <> 'pending_review' THEN 'game_mig_achievement_decided'
    WHEN p_target = 'legacy_accepted' AND public.game_mig_achievement_conflict(a) <> '[]'::jsonb THEN 'game_mig_achievement_conflict'
  END
$$ LANGUAGE sql STABLE SET search_path = public;

-- one bulk operation per operation id, whatever runs at the same time (the replay check holds the id's lock; this is the
-- last guard)
CREATE UNIQUE INDEX IF NOT EXISTS game_migration_audit_bulk_operation
  ON public.game_migration_audit ((details ->> 'operation')) WHERE action = 'achievements_bulk_accepted';

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
                   WHERE i ->> 'status' = 'pending_review' AND i -> 'conflict' = '[]'::jsonb AND v_why IS NULL),  -- = no refusal
    -- what the activation WOULD record (migration_pending): information only, nothing can be decided on it
    'plan', CASE WHEN v_state = 'migration_pending' THEN public.game_mig_achievement_plan(p_user, public.game_mig_reconcile(p_user), NULL) END);
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public;

--------------------------------------------------------------------------------
-- 2. The decision on the listed achievements of one account
--------------------------------------------------------------------------------
-- p_items: [{"id": "<achievement id>", "version": "<the version shown by the preview>"}, …] — exactly what the person
-- chose (nothing is added: an achievement not listed stays as it is). p_operation: the operation's own id. One id is ONE
-- request: its fingerprint (account, reconciliation, the ids with their reviewed versions, author, reason) is stored with
-- the operation; the same request again is a replay (nothing changes, nothing is logged — the rows have changed since, the
-- fingerprint has not); any other request under that id is refused.
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
  v_request TEXT;
  v_prior_user UUID;
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

  -- the request's fingerprint: everything the person confirmed
  v_request := md5(jsonb_build_object('account', p_user, 'reconciliation', p_reconciliation, 'actor', btrim(p_actor), 'reason', p_reason,
    'items', (SELECT jsonb_agg(jsonb_build_object('id', x ->> 'id', 'version', x ->> 'version') ORDER BY x ->> 'id' COLLATE "C")
              FROM jsonb_array_elements(p_items) x))::text);

  -- one call per operation id at a time (the same id from two sessions: the second sees the first one's result), then one
  -- decision on an account at a time (the single command takes the same account lock); always in this order
  PERFORM pg_advisory_xact_lock(hashtextextended('game_mig_operation:' || p_operation::text, 0));
  PERFORM pg_advisory_xact_lock(hashtextextended('game_mig_achievements:' || p_user::text, 0));

  -- an operation that was done: the same request → the same answer, nothing changes again; another request → refused
  SELECT user_id, details INTO v_prior_user, v_prior FROM public.game_migration_audit
  WHERE action = 'achievements_bulk_accepted' AND details ->> 'operation' = p_operation::text;
  IF FOUND THEN
    IF v_prior_user IS DISTINCT FROM p_user OR v_prior ->> 'request' IS DISTINCT FROM v_request THEN
      RAISE EXCEPTION 'game_mig_operation_mismatch' USING ERRCODE = '22023', DETAIL = 'this operation id belongs to another request: review again under a new one';
    END IF;
    RETURN jsonb_build_object('operation', p_operation, 'replay', TRUE, 'accepted', v_prior -> 'ids', 'count', v_prior -> 'count');
  END IF;

  -- the operation's own entry FIRST: it takes the account's user row the way a deletion does (no deadlock with a deletion;
  -- a deleted account has no user row and is refused here)
  BEGIN
    PERFORM public.game_mig_audit(p_actor, 'achievements_bulk_accepted', p_user, jsonb_build_object('operation', p_operation,
      'reconciliation', p_reconciliation, 'ids', to_jsonb(v_ids), 'count', v_n, 'reason', p_reason, 'request', v_request,
      'items', (SELECT jsonb_agg(jsonb_build_object('id', x ->> 'id', 'version', x ->> 'version') ORDER BY x ->> 'id' COLLATE "C")
                FROM jsonb_array_elements(p_items) x)));
  EXCEPTION
    WHEN foreign_key_violation THEN
      RAISE EXCEPTION 'game_mig_no_such_account' USING ERRCODE = '22023';
    WHEN unique_violation THEN
      RAISE EXCEPTION 'game_mig_operation_mismatch' USING ERRCODE = '22023', DETAIL = 'this operation id belongs to another request';
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
  FOR r IN SELECT a.*, public.game_mig_achievement_version(a) AS version, public.game_mig_achievement_refusal(a, 'legacy_accepted') AS refusal,
                  public.game_mig_achievement_conflict(a) AS conflict
           FROM public.game_achievements a WHERE a.user_id = p_user AND a.achievement_id = ANY (v_ids)
           ORDER BY a.achievement_id COLLATE "C" FOR UPDATE LOOP
    -- the policy of every decision (verified / rejected / decided / devices disagree — never the best one picked), then the
    -- version the person reviewed
    IF r.refusal IS NOT NULL THEN
      v_bad := v_bad || jsonb_build_object('id', r.achievement_id, 'why', r.refusal, 'values', r.conflict);
    ELSIF r.version <> (SELECT x ->> 'version' FROM jsonb_array_elements(p_items) x WHERE x ->> 'id' = r.achievement_id) THEN
      v_bad := v_bad || jsonb_build_object('id', r.achievement_id, 'why', 'game_mig_review_stale');
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

-- The request stored with an operation id (read only): a retry sends exactly this request again — the rows have changed
-- since the decision (status, version), the request has not. NULL when the id was never used (or its account was deleted).
CREATE OR REPLACE FUNCTION public.game_mig_bulk_operation(p_operation UUID)
RETURNS JSONB AS $$
  SELECT jsonb_build_object('operation', p_operation, 'account', user_id, 'actor', actor, 'at', at,
    'reconciliation', details -> 'reconciliation', 'items', details -> 'items', 'reason', details -> 'reason', 'count', details -> 'count')
  FROM public.game_migration_audit WHERE action = 'achievements_bulk_accepted' AND details ->> 'operation' = p_operation::text
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

--------------------------------------------------------------------------------
-- 3. 0020's single decision under the same policy
--------------------------------------------------------------------------------
-- The same signature and grant as in 0020 (the owner's tool keeps working); what changed: the policy above (only from
-- pending_review, legacy_accepted never with a conflict, nothing decided changes), a reason of at least 10 characters, the
-- same account lock as the bulk operation, and the deletion-safe order (the audit entry first, then the row).
CREATE OR REPLACE FUNCTION public.game_mig_decide_achievement(p_user UUID, p_achievement TEXT, p_status TEXT, p_actor TEXT, p_reason TEXT)
RETURNS JSONB AS $$
DECLARE
  c_reason_min CONSTANT INT := 10;     -- the same threshold as the bulk operation
  v_seen public.game_achievements%ROWTYPE;
  v_old public.game_achievements%ROWTYPE;
  v_new public.game_achievements%ROWTYPE;
  v_refusal TEXT;
BEGIN
  IF p_actor IS NULL OR length(btrim(p_actor)) = 0 THEN
    RAISE EXCEPTION 'game_mig_actor_required' USING ERRCODE = '22023';
  END IF;
  IF p_reason IS NULL OR length(btrim(p_reason)) = 0 THEN
    RAISE EXCEPTION 'game_mig_reason_required' USING ERRCODE = '22023';
  END IF;
  IF p_status IS NULL OR p_status NOT IN ('legacy_accepted', 'rejected') THEN
    -- pending_review back, or verified by hand: never through this command
    RAISE EXCEPTION 'game_bad_request' USING ERRCODE = '22023', DETAIL = 'a decision is legacy_accepted or rejected';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('game_mig_achievements:' || p_user::text, 0));
  SELECT * INTO v_seen FROM public.game_achievements WHERE user_id = p_user AND achievement_id = p_achievement;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'game_mig_no_such_achievement' USING ERRCODE = '22023';
  END IF;
  v_refusal := public.game_mig_achievement_refusal(v_seen, p_status);
  IF v_refusal IS NOT NULL THEN
    RAISE EXCEPTION '%', v_refusal USING ERRCODE = '22023', DETAIL = public.game_mig_achievement_conflict(v_seen)::text;
  END IF;
  IF length(btrim(p_reason)) < c_reason_min THEN
    RAISE EXCEPTION 'game_mig_reason_required' USING ERRCODE = '22023', DETAIL = format('a reason of at least %s characters', c_reason_min);
  END IF;
  -- the entry first (it takes the user row the way a deletion does), then the row; a change in between → refused
  BEGIN
    PERFORM public.game_mig_audit(p_actor, 'achievement_decided', p_user, jsonb_build_object('achievement', p_achievement,
      'before', v_seen.status, 'after', p_status, 'reason', p_reason, 'reviewedVersion', public.game_mig_achievement_version(v_seen)));
  EXCEPTION WHEN foreign_key_violation THEN
    RAISE EXCEPTION 'game_mig_no_such_account' USING ERRCODE = '22023';
  END;
  SELECT * INTO v_old FROM public.game_achievements WHERE user_id = p_user AND achievement_id = p_achievement FOR UPDATE;
  IF NOT FOUND OR public.game_mig_achievement_version(v_old) <> public.game_mig_achievement_version(v_seen) THEN
    RAISE EXCEPTION 'game_mig_review_stale' USING ERRCODE = '22023';
  END IF;
  UPDATE public.game_achievements SET status = p_status, decided_by = p_actor, decided_at = now(), reason = p_reason
  WHERE user_id = p_user AND achievement_id = p_achievement RETURNING * INTO v_new;
  RETURN to_jsonb(v_new);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

ALTER FUNCTION public.game_mig_achievement_refusal(public.game_achievements, TEXT) OWNER TO game_economy_owner;
ALTER FUNCTION public.game_mig_bulk_operation(UUID) OWNER TO game_economy_owner;
ALTER FUNCTION public.game_mig_decide_achievement(UUID, TEXT, TEXT, TEXT, TEXT) OWNER TO game_economy_owner;
ALTER FUNCTION public.game_mig_achievement_version(public.game_achievements) OWNER TO game_economy_owner;
ALTER FUNCTION public.game_mig_achievement_claim(JSONB, TEXT) OWNER TO game_economy_owner;
ALTER FUNCTION public.game_mig_achievement_conflict(public.game_achievements) OWNER TO game_economy_owner;
ALTER FUNCTION public.game_mig_achievement_review(UUID) OWNER TO game_economy_owner;
ALTER FUNCTION public.game_mig_bulk_accept_achievements(UUID, BIGINT, JSONB, UUID, TEXT, TEXT) OWNER TO game_economy_owner;

DO $$
DECLARE f TEXT;
BEGIN
  FOREACH f IN ARRAY ARRAY['game_mig_achievement_version(public.game_achievements)', 'game_mig_achievement_claim(JSONB, TEXT)',
    'game_mig_achievement_refusal(public.game_achievements, TEXT)', 'game_mig_decide_achievement(UUID, TEXT, TEXT, TEXT, TEXT)',
    'game_mig_bulk_operation(UUID)',
    'game_mig_achievement_conflict(public.game_achievements)', 'game_mig_achievement_review(UUID)',
    'game_mig_bulk_accept_achievements(UUID, BIGINT, JSONB, UUID, TEXT, TEXT)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated, service_role', f);
  END LOOP;
END $$;
-- the owner's tool only: the preview and the decision (the helpers run inside them)
GRANT EXECUTE ON FUNCTION public.game_mig_achievement_review(UUID) TO game_migration_admin;
GRANT EXECUTE ON FUNCTION public.game_mig_bulk_accept_achievements(UUID, BIGINT, JSONB, UUID, TEXT, TEXT) TO game_migration_admin;
GRANT EXECUTE ON FUNCTION public.game_mig_decide_achievement(UUID, TEXT, TEXT, TEXT, TEXT) TO game_migration_admin;
GRANT EXECUTE ON FUNCTION public.game_mig_bulk_operation(UUID) TO game_migration_admin;

REVOKE CREATE ON SCHEMA public FROM game_economy_owner;

COMMIT;
