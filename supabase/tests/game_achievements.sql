-- AYRA Trading — tests for 0020 (Q4.6: achievements on the server, large snapshots, privacy and retention) on top of
-- 0014–0016, 0018 and 0019. Run on a TEST database; everything is rolled back. Synthetic users only.
--   A — two devices: the same and different achievements, a conflicting rank and boss, an unknown id; activated.
--   B — level 3 only with the remainder a person accepted; later purged by retention (simulated 91 days).
--   C — the database fails during the activation (nothing is half done), then activates.
--   D — deleted in the middle of its transfer (open review, draft, window).  E — snapshot sizes and the quota.
BEGIN;

INSERT INTO auth.users (id, email) VALUES
  ('00000000-0000-0000-0000-00000020a001', 'ach-a@example.com'),
  ('00000000-0000-0000-0000-00000020a002', 'ach-b@example.com'),
  ('00000000-0000-0000-0000-00000020a003', 'ach-c@example.com'),
  ('00000000-0000-0000-0000-00000020a004', 'ach-d@example.com'),
  ('00000000-0000-0000-0000-00000020a005', 'ach-e@example.com')
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
CREATE OR REPLACE FUNCTION pg_temp.close_window(p_user UUID) RETURNS VOID AS $$
BEGIN
  SET LOCAL ROLE game_economy_owner;
  INSERT INTO public.game_migration_windows (user_id, closes_at, changed_by, reason) VALUES (p_user, now(), 'test clock', 'simulated: 7 days passed')
  ON CONFLICT (user_id) DO UPDATE SET closes_at = now();
  RESET ROLE;
END $$ LANGUAGE plpgsql;
-- the owner's path to an activation: the database's reconciliation saved, every remainder decided, the window closed
CREATE OR REPLACE FUNCTION pg_temp.prepare(p_user UUID, p_accept_xp INT DEFAULT NULL) RETURNS BIGINT AS $$
DECLARE
  v_id BIGINT;
  r RECORD;
BEGIN
  SET LOCAL ROLE game_migration_admin;
  v_id := (public.game_mig_save_reconciliation(p_user, public.game_mig_reconcile(p_user), 'owner') ->> 'id')::BIGINT;
  FOR r IN SELECT snapshot_id, candidate_xp FROM public.game_legacy_reviews WHERE user_id = p_user ORDER BY snapshot_id LOOP
    IF p_accept_xp IS NOT NULL AND r.candidate_xp >= p_accept_xp THEN
      PERFORM public.game_mig_decide_legacy(p_user, r.snapshot_id, 'accepted', p_accept_xp, 0, 'owner', 'confirmed by the user');
      p_accept_xp := NULL;
    ELSE
      PERFORM public.game_mig_decide_legacy(p_user, r.snapshot_id, 'rejected', NULL, NULL, 'owner', 'nothing beyond the records');
    END IF;
  END LOOP;
  RESET ROLE;
  PERFORM pg_temp.close_window(p_user);
  RETURN v_id;
END $$ LANGUAGE plpgsql;

--------------------------------------------------------------------------------
-- 1. Account A: two devices, what each claims, what the server can prove
--------------------------------------------------------------------------------
INSERT INTO public.journal_day_plans (user_id, id, data, client_updated_at) VALUES
  ('00000000-0000-0000-0000-00000020a001', '2026-11-02', '{"date":"2026-11-02","createdAt":"2026-11-02T08:00:00Z"}', now());
DO $$
DECLARE
  c_a CONSTANT UUID := '00000000-0000-0000-0000-00000020a001';
  p JSONB;
  v JSONB;
  v_id BIGINT;
  v_ledger_before TEXT;
BEGIN
  PERFORM public.game_economy_transition(c_a, 'local', 'migration_pending');
  -- device 1: three quests on one day (one of them the trade quest), the note first action (logged), a PAID silver run of
  -- «trading», a week trophy; XP 120 + 10 + 180 = 310 (level 3, 30 in it); Coins 30 + 5
  PERFORM pg_temp.imp(c_a, '10000000-0000-0000-0000-00000020a011', '20000000-0000-0000-0000-00000020a011', '{
    "level": 3, "xp": 30, "coins": 35,
    "history": [{"questId":"q_tradelog","xp":40,"coins":10,"completedAt":"2026-11-01"},{"questId":"q_bias","xp":40,"coins":10,"completedAt":"2026-11-01"},
                {"questId":"q_reflect","xp":40,"coins":10,"completedAt":"2026-11-01"}],
    "firstActions": {"note": "2026-11-01T08:00:00.000Z"},
    "coinLogSince": "2026-10-30T00:00:00.000Z",
    "coinLog": [{"at":"2026-11-01T08:00:00.000Z","source":"firstAction","amount":5,"kind":"note"}],
    "personalLedger": [{"runId":"r1","questId":"pq_x","category":"trading","rank":"silver","days":25,"xp":180,"day":"2026-11-10","verification":"app","paid":true}],
    "personalAchievements": {"trading": {"rank":"silver","runId":"r1","day":"2026-11-10","verification":"app"}},
    "weekTrophies": [{"v":1,"week":"2026-11-09","boss":"calm","at":"2026-11-16T00:00:00.000Z","conditions":[]}],
    "achievements": {"firstQuest":true,"streakDay":true,"firstTrade":true,"firstNote":true,"stylist":true,"author":true,"madeUpOne":true,"firstReview":false}
  }');
  -- device 2: the same first quest, a GOLD claim of «trading» that no paid run proves, another boss for the same week,
  -- level 3, a plan (a cloud Journal plan exists), seven plans (only one exists), prop discipline (device only)
  PERFORM pg_temp.imp(c_a, '10000000-0000-0000-0000-00000020a012', '20000000-0000-0000-0000-00000020a012', '{
    "level": 1, "xp": 0, "coins": 0,
    "personalAchievements": {"trading": {"rank":"gold","runId":"r9","day":"2026-11-12","verification":"app"}, "nonsense": {"rank":"gold"}},
    "weekTrophies": [{"v":1,"week":"2026-11-09","boss":"focus","at":"2026-11-16T00:00:00.000Z","conditions":[]}],
    "achievements": {"firstQuest":true,"level3":true,"firstPlan":true,"plans7":true,"propDisciplined5":true}
  }');

  SET LOCAL ROLE game_migration_admin;
  p := public.game_mig_achievement_plan(c_a, public.game_mig_reconcile(c_a), NULL);
  RESET ROLE;
  -- one item per stable id, however many devices had it; nothing claimed by no device; the unknown id apart
  IF (SELECT jsonb_agg(i ->> 'id' ORDER BY i ->> 'id' COLLATE "C") FROM jsonb_array_elements(p -> 'items') i)
     <> '["author","category:trading","firstNote","firstPlan","firstQuest","firstTrade","level3","plans7","propDisciplined5","streakDay","stylist","week:2026-11-09"]'::jsonb THEN
    RAISE EXCEPTION 'AC1: the union of the devices, each id once: %', p -> 'items';
  END IF;
  -- 0021 (Q4.7-B2, applied on top in later tests): firstPlan is never proven by a Journal plan (the device never checked one)
  -- and stylist only by a worn item in a snapshot (none here) — both wait for a person; everything else as in 0020
  IF (SELECT jsonb_agg(i ->> 'id' || '=' || (i ->> 'status') || '/' || (i ->> 'source') ORDER BY i ->> 'id' COLLATE "C") FROM jsonb_array_elements(p -> 'items') i)
     <> (CASE WHEN EXISTS (SELECT 1 FROM public.game_achievement_catalog WHERE id = 'stylist' AND proof = 'snapshot_record') THEN
     '["author=pending_review/device_flag","category:trading=verified/reconciled_event","firstNote=verified/reconciled_event",
          "firstPlan=pending_review/device_flag","firstQuest=verified/reconciled_event","firstTrade=verified/reconciled_event",
          "level3=verified/confirmed_level","plans7=pending_review/device_flag","propDisciplined5=pending_review/device_flag",
          "streakDay=verified/reconciled_event","stylist=pending_review/device_flag","week:2026-11-09=pending_review/device_flag"]'::jsonb
     ELSE
     '["author=pending_review/device_flag","category:trading=verified/reconciled_event","firstNote=verified/reconciled_event",
          "firstPlan=verified/journal_record","firstQuest=verified/reconciled_event","firstTrade=verified/reconciled_event",
          "level3=verified/confirmed_level","plans7=pending_review/device_flag","propDisciplined5=pending_review/device_flag",
          "streakDay=verified/reconciled_event","stylist=verified/game_rule","week:2026-11-09=pending_review/device_flag"]'::jsonb END) THEN
    RAISE EXCEPTION 'AC2: what is proven and how, what only the device says: %', p -> 'items';
  END IF;
  -- the same achievement on two devices: one item naming both snapshots
  IF (SELECT i -> 'claimedBy' FROM jsonb_array_elements(p -> 'items') i WHERE i ->> 'id' = 'firstQuest')
     <> '["10000000-0000-0000-0000-00000020a011","10000000-0000-0000-0000-00000020a012"]'::jsonb THEN
    RAISE EXCEPTION 'AC3: two devices, one achievement';
  END IF;
  -- conflicting versions: the PROVEN rank (silver) wins over a higher unproven claim (gold); both claims kept as evidence;
  -- two bosses for one week: kept as evidence, the trophy waits for review
  IF (SELECT i -> 'detail' ->> 'rank' FROM jsonb_array_elements(p -> 'items') i WHERE i ->> 'id' = 'category:trading') <> 'silver'
     OR (SELECT i -> 'evidence' -> 'ranksClaimed' FROM jsonb_array_elements(p -> 'items') i WHERE i ->> 'id' = 'category:trading') <> '["gold", "silver"]'::jsonb
     OR (SELECT i -> 'evidence' -> 'bossesClaimed' FROM jsonb_array_elements(p -> 'items') i WHERE i ->> 'id' = 'week:2026-11-09') <> '["calm", "focus"]'::jsonb THEN
    RAISE EXCEPTION 'AC4: conflicting versions: %', p -> 'items';
  END IF;
  -- an id the game never had and a broken category entry: never recorded, listed apart (the snapshot keeps them)
  IF (SELECT jsonb_agg(u ->> 'key' ORDER BY u ->> 'key') FROM jsonb_array_elements(p -> 'unknown') u) <> '["madeUpOne", "nonsense"]'::jsonb THEN
    RAISE EXCEPTION 'AC5: unknown ids apart: %', p -> 'unknown';
  END IF;

  v_id := pg_temp.prepare(c_a);
  SET LOCAL ROLE game_migration_admin;
  v := public.game_mig_activate(c_a, v_id, 'owner', NULL);
  RESET ROLE;
  IF v ->> 'state' <> 'cloud_active' OR NOT (v ->> 'achievements_transferred')::boolean OR (v -> 'achievements' ->> 'recorded')::int <> 12 THEN
    RAISE EXCEPTION 'AC6: the activation records the achievements and only then says transferred: %', v;
  END IF;
  -- achievements pay nothing: the ledger is exactly the proven events (310 XP / 35 Coins), the projection too
  IF (SELECT sum(xp) || '/' || sum(coins) FROM public.game_ledger WHERE user_id = c_a) <> '310/35'
     OR (SELECT xp_total || '/' || coins FROM public.game_profile WHERE user_id = c_a) <> '310/35'
     OR EXISTS (SELECT 1 FROM public.game_ledger WHERE user_id = c_a AND idempotency_key LIKE 'ach:%') THEN
    RAISE EXCEPTION 'AC7: no XP or Coins for an achievement';
  END IF;
  IF (SELECT count(*) FROM public.game_achievements WHERE user_id = c_a) <> 12
     OR (SELECT count(*) FROM public.game_achievements WHERE user_id = c_a AND reconciliation_id = v_id AND idempotency_key = 'ach:' || achievement_id) <> 12
     OR NOT EXISTS (SELECT 1 FROM public.game_migration_audit WHERE user_id = c_a AND action = 'activated'
                    AND (details ->> 'achievements_transferred')::boolean AND details -> 'unknown_achievements' @> '[{"key":"madeUpOne"}]') THEN
    RAISE EXCEPTION 'AC8: twelve rows with their reconciliation and key; the unknown id in the decision log';
  END IF;
  -- the snapshot keeps what the device had, as it came
  IF (SELECT content -> 'achievements' ->> 'madeUpOne' FROM public.game_imports WHERE snapshot_id = '10000000-0000-0000-0000-00000020a011') <> 'true' THEN
    RAISE EXCEPTION 'AC9: the snapshot is unchanged';
  END IF;
  -- a second activation and a second transfer: replays, nothing twice
  v_ledger_before := (SELECT count(*) || '/' || sum(xp) FROM public.game_ledger WHERE user_id = c_a);
  SET LOCAL ROLE game_migration_admin;
  v := public.game_mig_activate(c_a, v_id, 'owner', NULL);
  IF NOT (v ->> 'replay')::boolean OR NOT (public.game_mig_transfer_achievements(c_a, 'owner') ->> 'replay')::boolean THEN
    RAISE EXCEPTION 'AC10: replays';
  END IF;
  RESET ROLE;
  IF (SELECT count(*) FROM public.game_achievements WHERE user_id = c_a) <> 12
     OR (SELECT count(*) || '/' || sum(xp) FROM public.game_ledger WHERE user_id = c_a) <> v_ledger_before THEN
    RAISE EXCEPTION 'AC11: a retry gives nothing twice';
  END IF;
END $$;

--------------------------------------------------------------------------------
-- 2. Decisions: only what the server could not prove; always a reason; nothing deleted
--------------------------------------------------------------------------------
SET LOCAL ROLE game_migration_admin;
DO $$
DECLARE
  c_a CONSTANT UUID := '00000000-0000-0000-0000-00000020a001';
  e TEXT;
BEGIN
  e := pg_temp.err(format('SELECT public.game_mig_decide_achievement(%L, %L, %L, %L, %L)', c_a, 'firstQuest', 'rejected', 'owner', 'x'));
  IF e NOT LIKE '%game_mig_achievement_verified%' THEN RAISE EXCEPTION 'D1: a proven achievement is never changed by hand: %', e; END IF;
  e := pg_temp.err(format('SELECT public.game_mig_decide_achievement(%L, %L, %L, %L, %L)', c_a, 'author', 'legacy_accepted', 'owner', ' '));
  IF e NOT LIKE '%game_mig_reason_required%' THEN RAISE EXCEPTION 'D2: a reason always: %', e; END IF;
  e := pg_temp.err(format('SELECT public.game_mig_decide_achievement(%L, %L, %L, %L, %L)', c_a, 'author', 'verified', 'owner', 'x'));
  IF e NOT LIKE '%game_bad_request%' THEN RAISE EXCEPTION 'D3: a person never marks «verified»: %', e; END IF;
  PERFORM public.game_mig_decide_achievement(c_a, 'author', 'legacy_accepted', 'owner', 'the user showed the post');
  PERFORM public.game_mig_decide_achievement(c_a, 'plans7', 'rejected', 'owner', 'one plan in the cloud, no other evidence');
  IF (SELECT status FROM public.game_achievements WHERE user_id = c_a AND achievement_id = 'author') <> 'legacy_accepted'
     OR (SELECT status FROM public.game_achievements WHERE user_id = c_a AND achievement_id = 'plans7') <> 'rejected'
     OR (SELECT count(*) FROM public.game_migration_audit WHERE user_id = c_a AND action = 'achievement_decided') <> 2 THEN
    RAISE EXCEPTION 'D4: decisions applied, kept and audited';
  END IF;
  -- the tool's role writes nothing directly
  IF pg_temp.err($q$UPDATE public.game_achievements SET status = 'verified'$q$) NOT LIKE '%permission denied%'
     OR pg_temp.err($q$INSERT INTO public.game_achievements (user_id, achievement_id, family, status, source, claimed_by, idempotency_key) VALUES ('00000000-0000-0000-0000-00000020a001', 'level3', 'profile', 'verified', 'game_rule', '{x}', 'ach:level3')$q$) NOT LIKE '%permission denied%' THEN
    RAISE EXCEPTION 'D5: the tool writes achievements only through the functions';
  END IF;
END $$;
RESET ROLE;

--------------------------------------------------------------------------------
-- 3. Who can read: the person through the route (fresh session) only; no client role at all
--------------------------------------------------------------------------------
SET LOCAL ROLE authenticated;
DO $$
BEGIN
  IF pg_temp.err('SELECT count(*) FROM public.game_achievements') NOT LIKE '%permission denied%'
     OR pg_temp.err($q$SELECT public.game_achievements_for_session('00000000-0000-0000-0000-00000020a001', NULL, 0, 'cloud_active')$q$) NOT LIKE '%permission denied%'
     OR pg_temp.err($q$SELECT public.game_mig_achievement_plan('00000000-0000-0000-0000-00000020a001', '{}', 0)$q$) NOT LIKE '%permission denied%' THEN
    RAISE EXCEPTION 'S1: a signed-in user reads no achievement table and calls nothing directly';
  END IF;
END $$;
RESET ROLE;
SET LOCAL ROLE service_role;
DO $$
DECLARE
  v JSONB;
  e TEXT;
BEGIN
  IF pg_temp.err('SELECT count(*) FROM public.game_achievements') NOT LIKE '%permission denied%'
     OR pg_temp.err($q$SELECT public.game_mig_decide_achievement('00000000-0000-0000-0000-00000020a001', 'author', 'rejected', 'route', 'x')$q$) NOT LIKE '%permission denied%'
     OR pg_temp.err($q$SELECT public.game_mig_transfer_achievements('00000000-0000-0000-0000-00000020a001', 'route')$q$) NOT LIKE '%permission denied%' THEN
    RAISE EXCEPTION 'S2: the route neither reads the table nor decides';
  END IF;
  -- a token of the old state is stale
  e := pg_temp.err($q$SELECT public.game_achievements_for_session('00000000-0000-0000-0000-00000020a001', '00000000-0000-0000-0000-0000000005e5', floor(extract(epoch FROM now()))::bigint, 'migration_pending')$q$);
  IF e NOT LIKE '%game_session_stale%' THEN RAISE EXCEPTION 'S3: a stale session reads nothing: %', e; END IF;
  v := public.game_achievements_for_session('00000000-0000-0000-0000-00000020a001', '00000000-0000-0000-0000-0000000005e5', floor(extract(epoch FROM now()))::bigint, 'cloud_active');
  IF v ->> 'state' <> 'cloud_active' OR NOT (v ->> 'transferred')::boolean OR jsonb_array_length(v -> 'achievements') <> 12
     OR (SELECT a ->> 'status' FROM jsonb_array_elements(v -> 'achievements') a WHERE a ->> 'id' = 'plans7') <> 'rejected' THEN
    RAISE EXCEPTION 'S4: the person reads every own achievement with its state: %', v;
  END IF;
  -- another account (local) reads nothing
  v := public.game_achievements_for_session('00000000-0000-0000-0000-00000020a005', '00000000-0000-0000-0000-0000000005e5', floor(extract(epoch FROM now()))::bigint, 'local');
  IF v <> '{"state":"local","transferred":false,"achievements":[]}'::jsonb THEN RAISE EXCEPTION 'S5: a local account has none: %', v; END IF;
END $$;
RESET ROLE;

--------------------------------------------------------------------------------
-- 4. B: level 3 only with an accepted remainder → legacy_accepted (never «verified»); C: a failure mid-activation
--------------------------------------------------------------------------------
DO $$
DECLARE
  c_b CONSTANT UUID := '00000000-0000-0000-0000-00000020a002';
  c_c CONSTANT UUID := '00000000-0000-0000-0000-00000020a003';
  v JSONB;
  v_id BIGINT;
  e TEXT;
BEGIN
  PERFORM public.game_economy_transition(c_b, 'local', 'migration_pending');
  PERFORM pg_temp.imp(c_b, '10000000-0000-0000-0000-00000020b011', '20000000-0000-0000-0000-00000020b011', '{"level":3,"xp":0,"coins":0,"achievements":{"level3":true}}');
  v_id := pg_temp.prepare(c_b, 280);
  SET LOCAL ROLE game_migration_admin;
  v := public.game_mig_activate(c_b, v_id, 'owner', NULL);
  RESET ROLE;
  IF (SELECT status || '/' || source FROM public.game_achievements WHERE user_id = c_b AND achievement_id = 'level3') <> 'legacy_accepted/accepted_level' THEN
    RAISE EXCEPTION 'L1: a level from an accepted remainder is legacy_accepted';
  END IF;

  PERFORM public.game_economy_transition(c_c, 'local', 'migration_pending');
  PERFORM pg_temp.imp(c_c, '10000000-0000-0000-0000-00000020c011', '20000000-0000-0000-0000-00000020c011',
    '{"level":1,"xp":40,"coins":10,"history":[{"questId":"q_bias","xp":40,"coins":10,"completedAt":"2026-11-01"}],"achievements":{"firstQuest":true}}');
  v_id := pg_temp.prepare(c_c);
  -- the database fails while recording the achievements: the whole activation is undone
  CREATE OR REPLACE FUNCTION pg_temp.boom() RETURNS TRIGGER AS $f$ BEGIN RAISE EXCEPTION 'simulated_failure'; END $f$ LANGUAGE plpgsql;
  CREATE TRIGGER tr_test_boom BEFORE INSERT ON public.game_achievements FOR EACH ROW EXECUTE FUNCTION pg_temp.boom();
  SET LOCAL ROLE game_migration_admin;
  e := pg_temp.err(format('SELECT public.game_mig_activate(%L, %s, %L, NULL)', c_c, v_id, 'owner'));
  RESET ROLE;
  DROP TRIGGER tr_test_boom ON public.game_achievements;
  IF e NOT LIKE '%simulated_failure%' OR (SELECT state FROM public.game_accounts WHERE user_id = c_c) <> 'migration_pending'
     OR EXISTS (SELECT 1 FROM public.game_ledger WHERE user_id = c_c) OR EXISTS (SELECT 1 FROM public.game_achievements WHERE user_id = c_c)
     OR (SELECT status FROM public.game_reconciliations WHERE id = v_id) <> 'draft' THEN
    RAISE EXCEPTION 'F1: a failure leaves nothing half done (still pending, no ledger, no achievement, the draft as it was): %', e;
  END IF;
  SET LOCAL ROLE game_migration_admin;
  v := public.game_mig_activate(c_c, v_id, 'owner', NULL);
  RESET ROLE;
  IF v ->> 'state' <> 'cloud_active' OR (SELECT status FROM public.game_achievements WHERE user_id = c_c AND achievement_id = 'firstQuest') <> 'verified' THEN
    RAISE EXCEPTION 'F2: after the failure the same activation goes through: %', v;
  END IF;
  -- an account activated before 0020 (achievements not on the server): transferred later, once
  SET LOCAL ROLE game_economy_owner;
  DELETE FROM public.game_achievements WHERE user_id = c_c;
  UPDATE public.game_reconciliations SET achievements_transferred_at = NULL WHERE id = v_id;
  RESET ROLE;
  SET LOCAL ROLE game_migration_admin;
  v := public.game_mig_transfer_achievements(c_c, 'owner');
  RESET ROLE;
  IF NOT (v ->> 'achievements_transferred')::boolean OR (v ->> 'replay')::boolean OR (SELECT count(*) FROM public.game_achievements WHERE user_id = c_c) <> 1 THEN
    RAISE EXCEPTION 'F3: the transfer of an earlier activation: %', v;
  END IF;
END $$;

--------------------------------------------------------------------------------
-- 5. E: snapshots up to 4 MiB as received, 16 MiB per account
--------------------------------------------------------------------------------
DO $$
DECLARE
  c_e CONSTANT UUID := '00000000-0000-0000-0000-00000020a005';
  e TEXT;
  k INT;
BEGIN
  PERFORM public.game_economy_transition(c_e, 'local', 'migration_pending');
  e := pg_temp.err($q$SELECT pg_temp.imp('00000000-0000-0000-0000-00000020a005', '10000000-0000-0000-0000-00000020e0ff', '20000000-0000-0000-0000-00000020e0ff', jsonb_build_object('pad', repeat('x', 4194304)))$q$);
  IF e NOT LIKE '%game_import_too_large%' THEN RAISE EXCEPTION 'Z1: above 4 MiB refused: %', e; END IF;
  FOR k IN 1..4 LOOP
    IF pg_temp.imp(c_e, format('10000000-0000-0000-0000-00000020e%s', lpad(k::text, 3, '0')), format('20000000-0000-0000-0000-00000020e%s', lpad(k::text, 3, '0')),
                   jsonb_build_object('pad', repeat('x', 4000000), 'n', k)) ->> 'status' <> 'accepted' THEN
      RAISE EXCEPTION 'Z2: a large snapshot under the limit is accepted (%)', k;
    END IF;
  END LOOP;
  e := pg_temp.err($q$SELECT pg_temp.imp('00000000-0000-0000-0000-00000020a005', '10000000-0000-0000-0000-00000020e005', '20000000-0000-0000-0000-00000020e005', jsonb_build_object('pad', repeat('x', 1000000)))$q$);
  IF e NOT LIKE '%game_import_quota%' THEN RAISE EXCEPTION 'Z3: 16 MiB per account: %', e; END IF;
  -- a replay of a stored one still answers (the quota counts new snapshots only)
  IF NOT (pg_temp.imp(c_e, '10000000-0000-0000-0000-00000020e001', '20000000-0000-0000-0000-00000020e001', jsonb_build_object('pad', repeat('x', 4000000), 'n', 1)) ->> 'replay')::boolean THEN
    RAISE EXCEPTION 'Z4: a replay is still a replay at the quota';
  END IF;
END $$;

--------------------------------------------------------------------------------
-- 6. Retention: purged by hand only — never early, never with anything open, never a late snapshot
--------------------------------------------------------------------------------
DO $$
DECLARE
  c_b CONSTANT UUID := '00000000-0000-0000-0000-00000020a002';
  c_d CONSTANT UUID := '00000000-0000-0000-0000-00000020a004';
  e TEXT;
  v JSONB;
BEGIN
  -- a device after the activation: late, kept
  PERFORM pg_temp.imp(c_b, '10000000-0000-0000-0000-00000020b0ff', '20000000-0000-0000-0000-00000020b0ff', '{"level":9}');
  SET LOCAL ROLE game_migration_admin;
  e := pg_temp.err(format('SELECT public.game_mig_purge_snapshots(%L, %L, %L)', c_b, 'owner', 'retention'));
  IF e NOT LIKE '%game_mig_retention_not_reached%' THEN RAISE EXCEPTION 'P1: not before 90 days after the activation: %', e; END IF;
  e := pg_temp.err(format('SELECT public.game_mig_purge_snapshots(%L, %L, %L)', c_d, 'owner', 'retention'));
  IF e NOT LIKE '%game_mig_not_active%' THEN RAISE EXCEPTION 'P2: never during a transfer: %', e; END IF;
  RESET ROLE;
  -- 91 days later (the test clock)
  SET LOCAL ROLE game_economy_owner;
  UPDATE public.game_reconciliations SET activated_at = now() - interval '91 days' WHERE user_id = c_b AND status = 'activated';
  RESET ROLE;
  SET LOCAL ROLE game_migration_admin;
  e := pg_temp.err(format('SELECT public.game_mig_purge_snapshots(%L, %L, %L)', c_b, 'owner', ' '));
  IF e NOT LIKE '%game_mig_reason_required%' THEN RAISE EXCEPTION 'P3: a reason always: %', e; END IF;
  v := public.game_mig_purge_snapshots(c_b, 'owner', 'retention policy: 90 days after the activation, nothing open');
  RESET ROLE;
  IF (v ->> 'purged')::int <> 1 OR (SELECT count(*) FROM public.game_imports WHERE user_id = c_b) <> 1
     OR (SELECT status FROM public.game_imports WHERE user_id = c_b) <> 'late'
     OR (SELECT n FROM public.game_deletion_log WHERE cause = 'retention_purge' AND table_name = 'game_imports' AND day = CURRENT_DATE) <> 1
     OR NOT EXISTS (SELECT 1 FROM public.game_migration_audit WHERE user_id = c_b AND action = 'snapshots_purged' AND (details ->> 'kept_late')::int = 1) THEN
    RAISE EXCEPTION 'P4: the accepted snapshot purged, the late one kept, counted and audited: %', v;
  END IF;
  -- the ledger and the achievement stay (the decisions are not undone by a purge)
  IF NOT EXISTS (SELECT 1 FROM public.game_ledger WHERE user_id = c_b) OR NOT EXISTS (SELECT 1 FROM public.game_achievements WHERE user_id = c_b) THEN
    RAISE EXCEPTION 'P5: a purge removes snapshots only';
  END IF;
  -- an open achievement review blocks a purge
  SET LOCAL ROLE game_economy_owner;
  UPDATE public.game_reconciliations SET activated_at = now() - interval '91 days' WHERE user_id = '00000000-0000-0000-0000-00000020a001' AND status = 'activated';
  RESET ROLE;
  SET LOCAL ROLE game_migration_admin;
  e := pg_temp.err(format('SELECT public.game_mig_purge_snapshots(%L, %L, %L)', '00000000-0000-0000-0000-00000020a001', 'owner', 'retention'));
  RESET ROLE;
  IF e NOT LIKE '%game_mig_open_review%' THEN RAISE EXCEPTION 'P6: never while an achievement waits for review: %', e; END IF;
END $$;

--------------------------------------------------------------------------------
-- 7. Deleting an account: every row of it goes; only anonymous counts remain
--------------------------------------------------------------------------------
DO $$
DECLARE
  c_a CONSTANT UUID := '00000000-0000-0000-0000-00000020a001';
  c_d CONSTANT UUID := '00000000-0000-0000-0000-00000020a004';
  v_id BIGINT;
  t TEXT;
  v_n BIGINT;
  v_audit_before BIGINT;
BEGIN
  -- D in the middle of its transfer: a snapshot, a draft, an open review, an extended window, decision-log rows
  PERFORM public.game_economy_transition(c_d, 'local', 'migration_pending');
  PERFORM pg_temp.imp(c_d, '10000000-0000-0000-0000-00000020d011', '20000000-0000-0000-0000-00000020d011', '{"level":2,"xp":0,"coins":5}');
  SET LOCAL ROLE game_migration_admin;
  v_id := (public.game_mig_save_reconciliation(c_d, public.game_mig_reconcile(c_d), 'owner') ->> 'id')::BIGINT;
  PERFORM public.game_mig_extend_window(c_d, public.game_mig_window_closes_at(c_d) + interval '1 day', 'owner', 'travelling');
  RESET ROLE;
  IF (SELECT status FROM public.game_legacy_reviews WHERE user_id = c_d) <> 'pending_review' THEN RAISE EXCEPTION 'X0: setup'; END IF;
  v_audit_before := (SELECT count(*) FROM public.game_migration_audit WHERE user_id IN (c_a, c_d));

  DELETE FROM auth.users WHERE id IN (c_a, c_d);

  -- nothing of them is left in any table that has a user column
  FOR t IN SELECT c.table_name FROM information_schema.columns c
           WHERE c.table_schema = 'public' AND c.column_name IN ('user_id', 'id') AND c.data_type = 'uuid' LOOP
    EXECUTE format('SELECT count(*) FROM public.%I WHERE %s IN (%L, %L)', t,
      (SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = t AND column_name IN ('user_id', 'id') AND data_type = 'uuid' LIMIT 1), c_a, c_d) INTO v_n;
    IF v_n <> 0 THEN RAISE EXCEPTION 'X1: % still has % rows of a deleted account', t, v_n; END IF;
  END LOOP;
  -- nor their snapshot ids anywhere (e.g. in another account's text): the snapshots, reviews, achievements are gone
  IF EXISTS (SELECT 1 FROM public.game_imports WHERE snapshot_id::text LIKE '10000000-0000-0000-0000-00000020a0%' OR snapshot_id::text LIKE '10000000-0000-0000-0000-00000020d0%') THEN
    RAISE EXCEPTION 'X2: no snapshot of them is left';
  END IF;
  -- the decision log of both is gone; only its monthly counts remain (no account, no amount, no text)
  IF (SELECT COALESCE(sum(n), 0) FROM public.game_privacy_stats) < v_audit_before
     OR (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'game_privacy_stats') <> 3
     OR (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'game_deletion_log') <> 4 THEN
    RAISE EXCEPTION 'X3: the decision log folded into anonymous counts (month, action, n)';
  END IF;
  -- every deletion counted per day, cause and table
  IF (SELECT n FROM public.game_deletion_log WHERE day = CURRENT_DATE AND cause = 'account_deleted' AND table_name = 'game_achievements') <> 12 + 1  -- A's twelve + the one the test removed by hand in F3
     OR NOT EXISTS (SELECT 1 FROM public.game_deletion_log WHERE cause = 'account_deleted' AND table_name = 'game_legacy_reviews')
     OR NOT EXISTS (SELECT 1 FROM public.game_deletion_log WHERE cause = 'account_deleted' AND table_name = 'game_migration_windows')
     OR NOT EXISTS (SELECT 1 FROM public.game_deletion_log WHERE cause = 'account_deleted' AND table_name = 'game_ledger') THEN
    RAISE EXCEPTION 'X4: the deletion is counted per table: %', (SELECT jsonb_agg(to_jsonb(l)) FROM public.game_deletion_log l);
  END IF;
  -- other accounts keep everything
  IF NOT EXISTS (SELECT 1 FROM public.game_achievements WHERE user_id = '00000000-0000-0000-0000-00000020a002')
     OR NOT EXISTS (SELECT 1 FROM public.game_migration_audit WHERE user_id = '00000000-0000-0000-0000-00000020a002') THEN
    RAISE EXCEPTION 'X5: another account is untouched';
  END IF;
  -- the anonymous tables are never readable by an API role
  SET LOCAL ROLE service_role;
  IF pg_temp.err('SELECT count(*) FROM public.game_privacy_stats') NOT LIKE '%permission denied%'
     OR pg_temp.err('SELECT count(*) FROM public.game_deletion_log') NOT LIKE '%permission denied%' THEN
    RAISE EXCEPTION 'X6: the counts are the owner''s';
  END IF;
  RESET ROLE;
END $$;

ROLLBACK;
