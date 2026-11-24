-- AYRA Trading — tests for 0022 (Q4.7-Б3: the bulk review of one account's unproven achievements) on top of 0014–0016,
-- 0018–0021. Run on a TEST database; everything is rolled back. Synthetic users only.
--   K1 — activated through the real path, two devices: a proven quest, device-only achievements, a path rank and a week
--        trophy the devices disagree on, a trophy they agree on.
--   K2 — another activated account (its achievements are never reachable from K1's operations).
--   K3 — still migration_pending (nothing recorded yet: the preview shows the plan, no decision is possible).
BEGIN;

INSERT INTO auth.users (id, email) VALUES
  ('00000000-0000-0000-0000-00000022c001', 'bulk-1@example.com'),
  ('00000000-0000-0000-0000-00000022c002', 'bulk-2@example.com'),
  ('00000000-0000-0000-0000-00000022c003', 'bulk-3@example.com')
ON CONFLICT (id) DO NOTHING;

CREATE OR REPLACE FUNCTION pg_temp.err(p_sql TEXT) RETURNS TEXT AS $$
BEGIN
  EXECUTE p_sql;
  RETURN 'ok';
EXCEPTION WHEN OTHERS THEN
  RETURN SQLERRM;
END $$ LANGUAGE plpgsql;
GRANT EXECUTE ON FUNCTION pg_temp.err(TEXT) TO PUBLIC;
CREATE OR REPLACE FUNCTION pg_temp.imp(p_user UUID, p_snap TEXT, p_install TEXT, p_content JSONB)
RETURNS JSONB AS $$
  SELECT public.game_import_snapshot(p_user, '00000000-0000-0000-0000-0000000005e5', floor(extract(epoch FROM now()))::bigint,
    (SELECT state FROM public.game_accounts WHERE user_id = p_user), p_snap::uuid, p_install::uuid, 1, p_content) $$ LANGUAGE sql;
-- the owner's path to an activation (reconciliation saved, every remainder decided, the window closed, activated)
CREATE OR REPLACE FUNCTION pg_temp.activate(p_user UUID) RETURNS BIGINT AS $$
DECLARE
  v_id BIGINT;
  r RECORD;
BEGIN
  SET LOCAL ROLE game_migration_admin;
  v_id := (public.game_mig_save_reconciliation(p_user, public.game_mig_reconcile(p_user), 'owner') ->> 'id')::BIGINT;
  FOR r IN SELECT snapshot_id FROM public.game_legacy_reviews WHERE user_id = p_user AND status = 'pending_review' LOOP
    PERFORM public.game_mig_decide_legacy(p_user, r.snapshot_id, 'rejected', NULL, NULL, 'owner', 'nothing beyond the records');
  END LOOP;
  RESET ROLE;
  SET LOCAL ROLE game_economy_owner;
  INSERT INTO public.game_migration_windows (user_id, closes_at, changed_by, reason) VALUES (p_user, now(), 'test clock', 'simulated: 7 days passed')
  ON CONFLICT (user_id) DO UPDATE SET closes_at = now();
  RESET ROLE;
  SET LOCAL ROLE game_migration_admin;
  PERFORM public.game_mig_activate(p_user, v_id, 'owner', 'test');
  RESET ROLE;
  RETURN v_id;
END $$ LANGUAGE plpgsql;
-- the preview as the owner's tool reads it; one item; «id=version» pairs for a request
CREATE OR REPLACE FUNCTION pg_temp.review(p_user UUID) RETURNS JSONB AS $$ SELECT public.game_mig_achievement_review(p_user) $$ LANGUAGE sql;
CREATE OR REPLACE FUNCTION pg_temp.item(p JSONB, p_id TEXT) RETURNS JSONB AS $$
  SELECT i FROM jsonb_array_elements(p -> 'items') i WHERE i ->> 'id' = p_id $$ LANGUAGE sql;
CREATE OR REPLACE FUNCTION pg_temp.req(p JSONB, p_ids TEXT[]) RETURNS JSONB AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', u, 'version', COALESCE(pg_temp.item(p, u) ->> 'version', repeat('0', 32)))), '[]'::jsonb)
  FROM unnest(p_ids) u $$ LANGUAGE sql;
-- everything a decision could touch, as one fingerprint (rows of the achievements, ledger, profile)
CREATE OR REPLACE FUNCTION pg_temp.money(p_user UUID) RETURNS TEXT AS $$
  SELECT md5(COALESCE((SELECT jsonb_agg(to_jsonb(l) ORDER BY l.id)::text FROM public.game_ledger l WHERE l.user_id = p_user), '')
    || COALESCE((SELECT to_jsonb(p)::text FROM public.game_profile p WHERE p.user_id = p_user), '')) $$ LANGUAGE sql;
CREATE OR REPLACE FUNCTION pg_temp.rows(p_user UUID) RETURNS TEXT AS $$
  SELECT md5(COALESCE((SELECT jsonb_agg(to_jsonb(a) ORDER BY a.achievement_id)::text FROM public.game_achievements a WHERE a.user_id = p_user), '')) $$ LANGUAGE sql;
CREATE OR REPLACE FUNCTION pg_temp.st(p_user UUID, p_id TEXT) RETURNS TEXT AS $$
  SELECT status FROM public.game_achievements WHERE user_id = p_user AND achievement_id = p_id $$ LANGUAGE sql;
GRANT EXECUTE ON FUNCTION pg_temp.review(UUID), pg_temp.item(JSONB, TEXT), pg_temp.req(JSONB, TEXT[]), pg_temp.money(UUID), pg_temp.rows(UUID),
  pg_temp.st(UUID, TEXT) TO game_migration_admin;

--------------------------------------------------------------------------------
-- Setup: K1 and K2 activated through the real path; K3 waits in its window
--------------------------------------------------------------------------------
DO $$
DECLARE
  c_k1 CONSTANT UUID := '00000000-0000-0000-0000-00000022c001';
  c_k2 CONSTANT UUID := '00000000-0000-0000-0000-00000022c002';
  c_k3 CONSTANT UUID := '00000000-0000-0000-0000-00000022c003';
BEGIN
  PERFORM public.game_economy_transition(c_k1, 'local', 'migration_pending');
  PERFORM pg_temp.imp(c_k1, '10000000-0000-0000-0000-00000022c011', '20000000-0000-0000-0000-00000022c011', '{
    "level": 1, "xp": 40, "coins": 10,
    "history": [{"questId":"q_bias","xp":40,"coins":10,"completedAt":"2026-11-01"}],
    "personalAchievements": {"trading": {"rank":"silver","runId":"r1","day":"2026-11-10"}},
    "weekTrophies": [{"week":"2026-11-09","boss":"calm"}, {"week":"2026-11-16","boss":"focus"}],
    "achievements": {"firstQuest":true,"author":true,"firstPlan":true,"plans7":true,"firstScreenshot":true,"propDisciplined5":true}
  }');
  PERFORM pg_temp.imp(c_k1, '10000000-0000-0000-0000-00000022c012', '20000000-0000-0000-0000-00000022c012', '{
    "level": 1, "xp": 0, "coins": 0,
    "personalAchievements": {"trading": {"rank":"gold","runId":"r9","day":"2026-11-12"}},
    "weekTrophies": [{"week":"2026-11-09","boss":"focus"}, {"week":"2026-11-16","boss":"focus"}],
    "achievements": {"firstQuest":true,"author":true,"firstReview":true}
  }');
  PERFORM pg_temp.activate(c_k1);

  PERFORM public.game_economy_transition(c_k2, 'local', 'migration_pending');
  PERFORM pg_temp.imp(c_k2, '10000000-0000-0000-0000-00000022c021', '20000000-0000-0000-0000-00000022c021', '{
    "level": 1, "xp": 0, "coins": 0, "achievements": {"author":true,"plans7":true}
  }');
  PERFORM pg_temp.activate(c_k2);

  PERFORM public.game_economy_transition(c_k3, 'local', 'migration_pending');
  PERFORM pg_temp.imp(c_k3, '10000000-0000-0000-0000-00000022c031', '20000000-0000-0000-0000-00000022c031', '{
    "level": 1, "xp": 0, "coins": 0, "achievements": {"author":true}
  }');

  IF (SELECT string_agg(achievement_id || '=' || status, ',' ORDER BY achievement_id) FROM public.game_achievements WHERE user_id = c_k1)
     <> 'author=pending_review,category:trading=pending_review,firstPlan=pending_review,firstQuest=verified,firstReview=pending_review,'
        || 'firstScreenshot=pending_review,plans7=pending_review,propDisciplined5=pending_review,week:2026-11-09=pending_review,week:2026-11-16=pending_review' THEN
    RAISE EXCEPTION 'K0: setup — K1''s recorded achievements: %',
      (SELECT string_agg(achievement_id || '=' || status, ',' ORDER BY achievement_id) FROM public.game_achievements WHERE user_id = c_k1);
  END IF;
END $$;

--------------------------------------------------------------------------------
-- B1. The preview: everything shown, nothing changed
--------------------------------------------------------------------------------
SET LOCAL ROLE game_migration_admin;
DO $$
DECLARE
  c_k1 CONSTANT UUID := '00000000-0000-0000-0000-00000022c001';
  c_k3 CONSTANT UUID := '00000000-0000-0000-0000-00000022c003';
  v_rows TEXT := pg_temp.rows(c_k1);
  p JSONB := pg_temp.review(c_k1);
  p3 JSONB := pg_temp.review(c_k3);
BEGIN
  IF p ->> 'state' <> 'cloud_active' OR NOT (p ->> 'decidable')::boolean OR p -> 'reconciliation' ->> 'id' IS NULL THEN
    RAISE EXCEPTION 'B1: an activated account can be decided: %', p;
  END IF;
  -- the ranks and the bosses the devices disagree on are shown, never resolved: those are not acceptable in bulk
  IF pg_temp.item(p, 'category:trading') -> 'conflict' <> '["gold", "silver"]'::jsonb
     OR pg_temp.item(p, 'week:2026-11-09') -> 'conflict' <> '["calm", "focus"]'::jsonb
     OR pg_temp.item(p, 'week:2026-11-16') -> 'conflict' <> '[]'::jsonb THEN
    RAISE EXCEPTION 'B1b: conflicts between devices: %', p -> 'items';
  END IF;
  IF p -> 'acceptable' <> '["author","firstPlan","firstReview","firstScreenshot","plans7","propDisciplined5","week:2026-11-16"]'::jsonb THEN
    RAISE EXCEPTION 'B1c: acceptable = pending, no conflict: %', p -> 'acceptable';
  END IF;
  -- what each snapshot claimed, the rule, why it is not proven, a version per row
  IF jsonb_array_length(pg_temp.item(p, 'category:trading') -> 'claimedBy') <> 2
     OR (SELECT count(*) FROM jsonb_array_elements(pg_temp.item(p, 'category:trading') -> 'claimedBy') c WHERE c -> 'claimed' ->> 'rank' IN ('gold', 'silver')) <> 2
     OR pg_temp.item(p, 'author') ->> 'proof' <> 'device_only' OR pg_temp.item(p, 'author') ->> 'source' <> 'device_flag'
     OR pg_temp.item(p, 'firstPlan') ->> 'rule' NOT LIKE '%never passed%'
     OR pg_temp.item(p, 'author') ->> 'version' !~ '^[0-9a-f]{32}$' THEN
    RAISE EXCEPTION 'B1d: what the person reviews: %', pg_temp.item(p, 'category:trading');
  END IF;
  -- before the activation: nothing recorded, nothing decidable, the plan is shown as information
  IF (p3 ->> 'decidable')::boolean OR p3 ->> 'notDecidableBecause' <> 'not_active' OR p3 -> 'items' <> '[]'::jsonb
     OR (SELECT count(*) FROM jsonb_array_elements(p3 -> 'plan' -> 'items') i WHERE i ->> 'id' = 'author') <> 1 THEN
    RAISE EXCEPTION 'B1e: migration_pending: %', p3;
  END IF;
  IF pg_temp.rows(c_k1) <> v_rows THEN RAISE EXCEPTION 'B1f: the preview changes nothing'; END IF;
END $$;

--------------------------------------------------------------------------------
-- B2. Refusals: nothing is accepted, nothing changes
--------------------------------------------------------------------------------
DO $$
DECLARE
  c_k1 CONSTANT UUID := '00000000-0000-0000-0000-00000022c001';
  c_k2 CONSTANT UUID := '00000000-0000-0000-0000-00000022c002';
  c_k3 CONSTANT UUID := '00000000-0000-0000-0000-00000022c003';
  v_rec BIGINT := (SELECT id FROM public.game_reconciliations WHERE user_id = c_k1 AND status = 'activated');
  p JSONB := pg_temp.review(c_k1);
  p2 JSONB := pg_temp.review(c_k2);
  v_rows TEXT := pg_temp.rows(c_k1);
  v_rows2 TEXT := pg_temp.rows(c_k2);
  v_audit BIGINT := (SELECT count(*) FROM public.game_migration_audit);
  e TEXT;
  q TEXT := 'SELECT public.game_mig_bulk_accept_achievements(%L, %s, %L::jsonb, %L, %L, %L)';
  c_op CONSTANT TEXT := '30000000-0000-0000-0000-00000022c0b2';
  c_why CONSTANT TEXT := 'the user showed screenshots of these on a call';
BEGIN
  e := pg_temp.err(format(q, c_k1, v_rec, '[]', c_op, 'owner', c_why));
  IF e NOT LIKE '%game_mig_empty_selection%' THEN RAISE EXCEPTION 'B2a: an empty list: %', e; END IF;
  e := pg_temp.err(format(q, c_k1, v_rec, pg_temp.req(p, ARRAY['author']), c_op, 'owner', NULL));
  IF e NOT LIKE '%game_mig_reason_required%' THEN RAISE EXCEPTION 'B2b: no reason: %', e; END IF;
  e := pg_temp.err(format(q, c_k1, v_rec, pg_temp.req(p, ARRAY['author']), c_op, 'owner', 'ok'));
  IF e NOT LIKE '%game_mig_reason_required%' THEN RAISE EXCEPTION 'B2c: a one-word reason: %', e; END IF;
  e := pg_temp.err(format(q, c_k1, v_rec, pg_temp.req(p, ARRAY['author']), c_op, ' ', c_why));
  IF e NOT LIKE '%game_mig_actor_required%' THEN RAISE EXCEPTION 'B2d: no author: %', e; END IF;
  e := pg_temp.err(format(q, c_k1, v_rec, '[{"id":"author","version":"x"}]', c_op, 'owner', c_why));
  IF e NOT LIKE '%game_bad_request%' THEN RAISE EXCEPTION 'B2e: a bad version: %', e; END IF;
  e := pg_temp.err(format(q, c_k1, v_rec, pg_temp.req(p, ARRAY['author', 'author']), c_op, 'owner', c_why));
  IF e NOT LIKE '%game_bad_request%' THEN RAISE EXCEPTION 'B2f: listed twice: %', e; END IF;
  -- an id the account does not have (or the game never had), alone or with acceptable ones
  e := pg_temp.err(format(q, c_k1, v_rec, pg_temp.req(p, ARRAY['author', 'madeUpOne']), c_op, 'owner', c_why));
  IF e NOT LIKE '%game_mig_no_such_achievement%' THEN RAISE EXCEPTION 'B2g: an unknown id: %', e; END IF;
  e := pg_temp.err(format(q, c_k1, v_rec, pg_temp.req(p, ARRAY['author', 'consciousRefusal']), c_op, 'owner', c_why));
  IF e NOT LIKE '%game_mig_no_such_achievement%' THEN RAISE EXCEPTION 'B2h: an id this account never claimed: %', e; END IF;
  -- another account's row: its version under K1's id never matches; K2's own rows untouched
  e := pg_temp.err(format(q, c_k1, v_rec, pg_temp.req(p2, ARRAY['plans7']), c_op, 'owner', c_why));
  IF e NOT LIKE '%game_mig_review_stale%' THEN RAISE EXCEPTION 'B2i: another account''s version: %', e; END IF;
  e := pg_temp.err(format(q, c_k2, v_rec, pg_temp.req(p2, ARRAY['author']), c_op, 'owner', c_why));
  IF e NOT LIKE '%game_mig_review_stale%' THEN RAISE EXCEPTION 'B2j: another account''s reconciliation: %', e; END IF;
  -- verified, a conflict between devices, a stale reconciliation; with an acceptable one each time (no partial)
  e := pg_temp.err(format(q, c_k1, v_rec, pg_temp.req(p, ARRAY['author', 'firstQuest']), c_op, 'owner', c_why));
  IF e NOT LIKE '%game_mig_achievement_verified%' THEN RAISE EXCEPTION 'B2k: verified: %', e; END IF;
  e := pg_temp.err(format(q, c_k1, v_rec, pg_temp.req(p, ARRAY['author', 'category:trading']), c_op, 'owner', c_why));
  IF e NOT LIKE '%game_mig_achievement_conflict%' THEN RAISE EXCEPTION 'B2l: ranks the devices disagree on: %', e; END IF;
  e := pg_temp.err(format(q, c_k1, v_rec, pg_temp.req(p, ARRAY['week:2026-11-09']), c_op, 'owner', c_why));
  IF e NOT LIKE '%game_mig_achievement_conflict%' THEN RAISE EXCEPTION 'B2m: bosses the devices disagree on: %', e; END IF;
  e := pg_temp.err(format(q, c_k1, v_rec + 1000, pg_temp.req(p, ARRAY['author']), c_op, 'owner', c_why));
  IF e NOT LIKE '%game_mig_review_stale%' THEN RAISE EXCEPTION 'B2n: another reconciliation: %', e; END IF;
  -- before the activation: nothing to decide
  e := pg_temp.err(format(q, c_k3, v_rec, '[{"id":"author","version":"00000000000000000000000000000000"}]', c_op, 'owner', c_why));
  IF e NOT LIKE '%game_mig_not_active%' THEN RAISE EXCEPTION 'B2o: migration_pending: %', e; END IF;
  IF pg_temp.rows(c_k1) <> v_rows OR pg_temp.rows(c_k2) <> v_rows2 OR (SELECT count(*) FROM public.game_migration_audit) <> v_audit THEN
    RAISE EXCEPTION 'B2p: every refusal changed nothing and logged nothing';
  END IF;
END $$;

--------------------------------------------------------------------------------
-- B3. Accepted: one, then several; the rest untouched; replays; history; no XP or Coins
--------------------------------------------------------------------------------
DO $$
DECLARE
  c_k1 CONSTANT UUID := '00000000-0000-0000-0000-00000022c001';
  v_rec BIGINT := (SELECT id FROM public.game_reconciliations WHERE user_id = c_k1 AND status = 'activated');
  p JSONB := pg_temp.review(c_k1);
  v_money TEXT := pg_temp.money(c_k1);
  v JSONB;
  e TEXT;
  q TEXT := 'SELECT public.game_mig_bulk_accept_achievements(%L, %s, %L::jsonb, %L, %L, %L)';
  c_why CONSTANT TEXT := 'the user showed screenshots of these on a call';
BEGIN
  v := public.game_mig_bulk_accept_achievements(c_k1, v_rec, pg_temp.req(p, ARRAY['author']), '30000000-0000-0000-0000-00000022c0b3', 'owner', c_why);
  IF (v ->> 'replay')::boolean OR v -> 'accepted' <> '["author"]'::jsonb OR pg_temp.st(c_k1, 'author') <> 'legacy_accepted' THEN
    RAISE EXCEPTION 'B3a: one accepted: %', v;
  END IF;
  -- several at once — firstPlan excluded by the person: stays pending; the version of author changed (decided)
  p := pg_temp.review(c_k1);
  v := public.game_mig_bulk_accept_achievements(c_k1, v_rec, pg_temp.req(p, ARRAY['propDisciplined5', 'plans7', 'firstReview', 'week:2026-11-16']),
    '30000000-0000-0000-0000-00000022c0b4', 'owner', c_why);
  IF v -> 'accepted' <> '["firstReview","plans7","propDisciplined5","week:2026-11-16"]'::jsonb OR (v ->> 'count')::int <> 4 THEN
    RAISE EXCEPTION 'B3b: several accepted: %', v;
  END IF;
  IF (SELECT string_agg(achievement_id || '=' || status, ',' ORDER BY achievement_id) FROM public.game_achievements WHERE user_id = c_k1)
     <> 'author=legacy_accepted,category:trading=pending_review,firstPlan=pending_review,firstQuest=verified,firstReview=legacy_accepted,'
        || 'firstScreenshot=pending_review,plans7=legacy_accepted,propDisciplined5=legacy_accepted,week:2026-11-09=pending_review,week:2026-11-16=legacy_accepted' THEN
    RAISE EXCEPTION 'B3c: exactly the listed ones, nothing else: %',
      (SELECT string_agg(achievement_id || '=' || status, ',' ORDER BY achievement_id) FROM public.game_achievements WHERE user_id = c_k1);
  END IF;
  -- a rerun of the same operation: a replay, nothing changes, nothing logged again
  v := public.game_mig_bulk_accept_achievements(c_k1, v_rec, pg_temp.req(p, ARRAY['propDisciplined5', 'plans7', 'firstReview', 'week:2026-11-16']),
    '30000000-0000-0000-0000-00000022c0b4', 'owner', c_why);
  IF NOT (v ->> 'replay')::boolean OR (SELECT count(*) FROM public.game_migration_audit WHERE details ->> 'operation' = '30000000-0000-0000-0000-00000022c0b4') <> 5 THEN
    RAISE EXCEPTION 'B3d: a replay: %', v;
  END IF;
  -- the same operation id with another list; a new operation on what is decided already (an old preview)
  e := pg_temp.err(format(q, c_k1, v_rec, pg_temp.req(p, ARRAY['firstPlan']), '30000000-0000-0000-0000-00000022c0b4', 'owner', c_why));
  IF e NOT LIKE '%game_mig_operation_mismatch%' THEN RAISE EXCEPTION 'B3e: an operation id reused: %', e; END IF;
  e := pg_temp.err(format(q, c_k1, v_rec, pg_temp.req(p, ARRAY['plans7']), '30000000-0000-0000-0000-00000022c0b5', 'owner', c_why));
  IF e NOT LIKE '%game_mig_achievement_decided%' THEN RAISE EXCEPTION 'B3f: already decided: %', e; END IF;
  -- a row decided by the single decision after the preview: the old preview is refused
  PERFORM public.game_mig_decide_achievement(c_k1, 'firstScreenshot', 'rejected', 'owner', 'no screenshot was ever rewarded');
  e := pg_temp.err(format(q, c_k1, v_rec, pg_temp.req(p, ARRAY['firstScreenshot', 'firstPlan']), '30000000-0000-0000-0000-00000022c0b6', 'owner', c_why));
  IF e NOT LIKE '%game_mig_achievement_rejected%' THEN RAISE EXCEPTION 'B3g: rejected after the preview: %', e; END IF;
  IF pg_temp.st(c_k1, 'firstPlan') <> 'pending_review' THEN RAISE EXCEPTION 'B3h: nothing of a refused list accepted'; END IF;
  -- history: who, when, why, which operation, what was reviewed; the rules version stays as recorded
  IF (SELECT count(*) FROM public.game_migration_audit WHERE user_id = c_k1 AND action = 'achievement_decided' AND details ? 'operation') <> 5
     OR (SELECT count(*) FROM public.game_migration_audit WHERE user_id = c_k1 AND action = 'achievements_bulk_accepted') <> 2
     OR EXISTS (SELECT 1 FROM public.game_achievements WHERE user_id = c_k1 AND status = 'legacy_accepted'
                AND (decided_by <> 'owner' OR reason <> c_why OR decided_at IS NULL OR rules_version <> 'q4.7')) THEN
    RAISE EXCEPTION 'B3i: the history of every decision';
  END IF;
  IF pg_temp.money(c_k1) <> v_money THEN RAISE EXCEPTION 'B3j: no XP or Coins moved'; END IF;
END $$;
RESET ROLE;

--------------------------------------------------------------------------------
-- B4. Who may: only the owner's tool; nobody writes the rows directly
--------------------------------------------------------------------------------
DO $$
DECLARE
  r TEXT;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF has_function_privilege(r, 'public.game_mig_bulk_accept_achievements(uuid,bigint,jsonb,uuid,text,text)', 'EXECUTE')
       OR has_function_privilege(r, 'public.game_mig_achievement_review(uuid)', 'EXECUTE')
       OR has_function_privilege(r, 'public.game_mig_achievement_version(public.game_achievements)', 'EXECUTE') THEN
      RAISE EXCEPTION 'B4: % can call the review', r;
    END IF;
  END LOOP;
  IF NOT has_function_privilege('game_migration_admin', 'public.game_mig_bulk_accept_achievements(uuid,bigint,jsonb,uuid,text,text)', 'EXECUTE')
     OR has_function_privilege('game_migration_admin', 'public.game_mig_achievement_version(public.game_achievements)', 'EXECUTE')
     OR (SELECT pg_get_userbyid(proowner) FROM pg_proc WHERE oid = 'public.game_mig_bulk_accept_achievements(uuid,bigint,jsonb,uuid,text,text)'::regprocedure) <> 'game_economy_owner'
     OR NOT (SELECT prosecdef FROM pg_proc WHERE oid = 'public.game_mig_bulk_accept_achievements(uuid,bigint,jsonb,uuid,text,text)'::regprocedure) THEN
    RAISE EXCEPTION 'B4b: the owner''s tool calls it; it runs as the economy owner';
  END IF;
END $$;
SET LOCAL ROLE game_migration_admin;
DO $$
BEGIN
  IF pg_temp.err($q$UPDATE public.game_achievements SET status = 'legacy_accepted'$q$) NOT LIKE '%permission denied%'
     OR pg_temp.err($q$INSERT INTO public.game_migration_audit (actor, action) VALUES ('x', 'achievements_bulk_accepted')$q$) NOT LIKE '%permission denied%' THEN
    RAISE EXCEPTION 'B4c: the tool''s role never writes the rows or the log itself';
  END IF;
END $$;
RESET ROLE;
SET LOCAL ROLE authenticated;
DO $$
BEGIN
  IF pg_temp.err($q$SELECT public.game_mig_achievement_review('00000000-0000-0000-0000-00000022c001')$q$) NOT LIKE '%permission denied%' THEN
    RAISE EXCEPTION 'B4d: a signed-in person never reads the review';
  END IF;
END $$;
RESET ROLE;

--------------------------------------------------------------------------------
-- B5. A deleted account: refused, nothing of it left
--------------------------------------------------------------------------------
DO $$
DECLARE
  c_k2 CONSTANT UUID := '00000000-0000-0000-0000-00000022c002';
  v_rec BIGINT := (SELECT id FROM public.game_reconciliations WHERE user_id = c_k2 AND status = 'activated');
  p JSONB;
  e TEXT;
BEGIN
  SET LOCAL ROLE game_migration_admin;
  p := pg_temp.review(c_k2);
  RESET ROLE;
  DELETE FROM auth.users WHERE id = c_k2;
  SET LOCAL ROLE game_migration_admin;
  e := pg_temp.err(format('SELECT public.game_mig_bulk_accept_achievements(%L, %s, %L::jsonb, %L, %L, %L)', c_k2, v_rec,
    pg_temp.req(p, ARRAY['author']), '30000000-0000-0000-0000-00000022c0b7', 'owner', 'the user showed screenshots of these'));
  RESET ROLE;
  IF e NOT LIKE '%game_mig_no_such_account%' THEN RAISE EXCEPTION 'B5: a deleted account: %', e; END IF;
  IF EXISTS (SELECT 1 FROM public.game_achievements WHERE user_id = c_k2) OR EXISTS (SELECT 1 FROM public.game_migration_audit WHERE user_id = c_k2) THEN
    RAISE EXCEPTION 'B5b: nothing of the deleted account is left';
  END IF;
END $$;

ROLLBACK;
