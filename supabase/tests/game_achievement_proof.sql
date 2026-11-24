-- AYRA Trading — tests for 0021 (Q4.7-B2: what proves an achievement) on top of 0014–0016, 0018, 0019 and 0020.
-- Run on a TEST database; everything is rolled back. Synthetic users only.
--   P1 — every claim with evidence that is NOT the device's rule: nothing verified, all wait for a person.
--   P2 — the device's own rule proven: a worn wardrobe item, the trade quest, a note a person wrote.
--   P3 — equipment that is not a real item in its own slot, or only in a late snapshot: stylist not proven.
--   P4 — activation: rows under the q4.7 rules; a person accepts a pending one (legacy_accepted), never changes a proven one;
--        no XP or Coins from any achievement.
BEGIN;

INSERT INTO auth.users (id, email) VALUES
  ('00000000-0000-0000-0000-00000021b001', 'proof-1@example.com'),
  ('00000000-0000-0000-0000-00000021b002', 'proof-2@example.com'),
  ('00000000-0000-0000-0000-00000021b003', 'proof-3@example.com'),
  ('00000000-0000-0000-0000-00000021b004', 'proof-4@example.com')
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
-- the plan the owner's tool shows (it changes nothing): «id=status/source» in id order
CREATE OR REPLACE FUNCTION pg_temp.plan(p_user UUID) RETURNS JSONB AS $$
  SELECT public.game_mig_achievement_plan(p_user, public.game_mig_reconcile(p_user), NULL) $$ LANGUAGE sql;
CREATE OR REPLACE FUNCTION pg_temp.statuses(p JSONB) RETURNS JSONB AS $$
  SELECT jsonb_agg(i ->> 'id' || '=' || (i ->> 'status') || '/' || (i ->> 'source') ORDER BY i ->> 'id' COLLATE "C")
  FROM jsonb_array_elements(p -> 'items') i $$ LANGUAGE sql;
GRANT EXECUTE ON FUNCTION pg_temp.plan(UUID) TO game_migration_admin;
GRANT EXECUTE ON FUNCTION pg_temp.statuses(JSONB) TO game_migration_admin;

DO $$
BEGIN
  IF (SELECT proof FROM public.game_achievement_catalog WHERE id = 'stylist') <> 'snapshot_record'
     OR (SELECT proof FROM public.game_achievement_catalog WHERE id = 'firstTrade') <> 'event'
     OR (SELECT count(*) FROM public.game_achievement_catalog WHERE proof = 'device_only') <> 7 THEN
    RAISE EXCEPTION 'P0: the catalog names what proves each achievement: %', (SELECT jsonb_object_agg(id, proof) FROM public.game_achievement_catalog);
  END IF;
END $$;

--------------------------------------------------------------------------------
-- P1. Evidence that is not the device's rule proves nothing
--------------------------------------------------------------------------------
-- the account's cloud Journal has everything 0020 used to accept: a trade, seven day plans (one reviewed), prop rules,
-- notes — but every note is imported from a file or a backtest result
INSERT INTO public.journal_trades (user_id, id, data, account_id, opened_at, instrument, direction, result, client_updated_at) VALUES
  ('00000000-0000-0000-0000-00000021b001', 't1', '{"id":"t1","accountId":"a1","openedAt":"2026-11-01T09:00:00Z","instrument":"EURUSD","direction":"long","result":"win","createdAt":"2026-11-01T09:00:00Z"}',
   'a1', '2026-11-01T09:00:00Z', 'EURUSD', 'long', 'win', now());
INSERT INTO public.journal_day_plans (user_id, id, data, client_updated_at)
SELECT '00000000-0000-0000-0000-00000021b001', d, jsonb_build_object('date', d, 'createdAt', d || 'T08:00:00Z')
  || CASE WHEN d = '2026-11-01' THEN '{"review":{"completedAt":"2026-11-01T20:00:00Z"}}'::jsonb ELSE '{}'::jsonb END, now()
FROM (SELECT to_char(date '2026-11-01' + k, 'YYYY-MM-DD') AS d FROM generate_series(0, 6) k) g;
INSERT INTO public.journal_accounts (user_id, id, data, client_updated_at) VALUES
  ('00000000-0000-0000-0000-00000021b001', 'a1', '{"id":"a1","type":"prop","propRules":{"dailyLossPct":5},"createdAt":"2026-11-01T08:00:00Z"}', now());
INSERT INTO public.journal_notes (user_id, id, data, client_updated_at) VALUES
  ('00000000-0000-0000-0000-00000021b001', 'n1', '{"id":"n1","body":"imported","importBatchId":"b1","createdAt":"2026-11-01T08:00:00Z"}', now()),
  ('00000000-0000-0000-0000-00000021b001', 'n2', '{"id":"n2","body":"backtest","templateKey":"backtest","createdAt":"2026-11-01T08:00:00Z"}', now());
DO $$
DECLARE
  c_u CONSTANT UUID := '00000000-0000-0000-0000-00000021b001';
  p JSONB;
BEGIN
  PERFORM public.game_economy_transition(c_u, 'local', 'migration_pending');
  -- the first-action rewards are real and logged (first trade, first plan, first attachment) — none is the device's rule;
  -- no quest at all; the worn-items counter without any equipment
  PERFORM pg_temp.imp(c_u, '10000000-0000-0000-0000-00000021b011', '20000000-0000-0000-0000-00000021b011', '{
    "level": 1, "xp": 30, "coins": 30, "itemsEquippedCount": 5, "equipment": {},
    "firstActions": {"trade": "2026-11-01T09:00:00.000Z", "dayPlan": "2026-11-01T08:00:00.000Z", "screenshot": "2026-11-01T09:05:00.000Z"},
    "coinLogSince": "2026-10-30T00:00:00.000Z",
    "coinLog": [{"at":"2026-11-01T09:00:00.000Z","source":"firstAction","amount":20,"kind":"trade"},
                {"at":"2026-11-01T08:00:00.000Z","source":"firstAction","amount":5,"kind":"dayPlan"},
                {"at":"2026-11-01T09:05:00.000Z","source":"firstAction","amount":5,"kind":"screenshot"}],
    "achievements": {"stylist":true,"firstTrade":true,"firstNote":true,"firstPlan":true,"firstReview":true,"plans7":true,
                     "firstPropRules":true,"firstScreenshot":true}
  }');
  SET LOCAL ROLE game_migration_admin;
  p := pg_temp.plan(c_u);
  RESET ROLE;
  IF pg_temp.statuses(p) <> '["firstNote=pending_review/device_flag","firstPlan=pending_review/device_flag","firstPropRules=pending_review/device_flag",
       "firstReview=pending_review/device_flag","firstScreenshot=pending_review/device_flag","firstTrade=pending_review/device_flag",
       "plans7=pending_review/device_flag","stylist=pending_review/device_flag"]'::jsonb THEN
    RAISE EXCEPTION 'P1: nothing but the device''s own rule verifies: %', pg_temp.statuses(p);
  END IF;
  -- each of these was «verified» under 0020 on exactly this evidence
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p -> 'items') i WHERE i -> 'evidence' <> '{}'::jsonb) THEN
    RAISE EXCEPTION 'P1b: no evidence is claimed for what is not proven: %', p -> 'items';
  END IF;
END $$;

--------------------------------------------------------------------------------
-- P2. The device's own rule proven
--------------------------------------------------------------------------------
INSERT INTO public.journal_notes (user_id, id, data, client_updated_at) VALUES
  ('00000000-0000-0000-0000-00000021b002', 'n1', '{"id":"n1","body":"imported","importBatchId":"b1","createdAt":"2026-11-01T08:00:00Z"}', now()),
  ('00000000-0000-0000-0000-00000021b002', 'n2', '{"id":"n2","body":"written by the person","templateKey":"idea","createdAt":"2026-11-01T08:00:00Z"}', now());
DO $$
DECLARE
  c_u CONSTANT UUID := '00000000-0000-0000-0000-00000021b002';
  p JSONB;
BEGIN
  PERFORM public.game_economy_transition(c_u, 'local', 'migration_pending');
  -- device 1: the trade quest done, the starter outfit worn (shirt 0 «Верх», pants 3 «Низ»)
  PERFORM pg_temp.imp(c_u, '10000000-0000-0000-0000-00000021b021', '20000000-0000-0000-0000-00000021b021', '{
    "level": 1, "xp": 40, "coins": 10,
    "history": [{"questId":"q_tradelog","xp":40,"coins":10,"completedAt":"2026-11-01"}],
    "equipment": {"Низ": 3, "Верх": 0},
    "achievements": {"firstTrade":true,"stylist":true}
  }');
  -- device 2: claims the note; nothing on it proves it, the person's note in the cloud Journal does
  PERFORM pg_temp.imp(c_u, '10000000-0000-0000-0000-00000021b022', '20000000-0000-0000-0000-00000021b022', '{
    "level": 1, "xp": 0, "coins": 0, "achievements": {"firstNote":true}
  }');
  SET LOCAL ROLE game_migration_admin;
  p := pg_temp.plan(c_u);
  RESET ROLE;
  IF pg_temp.statuses(p) <> '["firstNote=verified/journal_record","firstTrade=verified/reconciled_event","stylist=verified/snapshot_record"]'::jsonb THEN
    RAISE EXCEPTION 'P2: the device''s own rule verifies: %', pg_temp.statuses(p);
  END IF;
  IF (SELECT i -> 'evidence' FROM jsonb_array_elements(p -> 'items') i WHERE i ->> 'id' = 'firstTrade') <> '{"key":"quest:2026-11-01:q_tradelog"}'::jsonb
     OR (SELECT i -> 'evidence' FROM jsonb_array_elements(p -> 'items') i WHERE i ->> 'id' = 'firstNote') <> '{"table":"journal_notes","written":1}'::jsonb
     -- the first slot in byte order of the first accepted snapshot that has one: «Верх» (shirt, item 0)
     OR (SELECT i -> 'evidence' FROM jsonb_array_elements(p -> 'items') i WHERE i ->> 'id' = 'stylist')
        <> '{"snapshot":"10000000-0000-0000-0000-00000021b021","slot":"Верх","item":0}'::jsonb THEN
    RAISE EXCEPTION 'P2b: what proved each: %', p -> 'items';
  END IF;
END $$;

--------------------------------------------------------------------------------
-- P3. Equipment that is not a real item in its own slot proves nothing; nor does a late snapshot
--------------------------------------------------------------------------------
DO $$
DECLARE
  c_u CONSTANT UUID := '00000000-0000-0000-0000-00000021b003';
  p JSONB;
  r JSONB;
BEGIN
  PERFORM public.game_economy_transition(c_u, 'local', 'migration_pending');
  -- shirt in the shoes slot, an item that never existed, a string, a fraction, a negative, a huge number, an object, null,
  -- a slot the game never had
  PERFORM pg_temp.imp(c_u, '10000000-0000-0000-0000-00000021b031', '20000000-0000-0000-0000-00000021b031', '{
    "level": 1, "xp": 0, "coins": 0, "itemsEquippedCount": 3,
    "equipment": {"Обувь": 0, "Верх": 99, "Низ": "3", "Голова": 9.5, "Плащ": -11, "Аура": 1e30, "Аксессуар": {"id": 13}, "Перчатки": null, "Hat": 9},
    "achievements": {"stylist":true}
  }');
  PERFORM pg_temp.imp(c_u, '10000000-0000-0000-0000-00000021b032', '20000000-0000-0000-0000-00000021b032', '{
    "level": 1, "equipment": [0, 3, 5], "achievements": {"stylist":true}
  }');
  SET LOCAL ROLE game_migration_admin;
  p := pg_temp.plan(c_u);
  RESET ROLE;
  IF pg_temp.statuses(p) <> '["stylist=pending_review/device_flag"]'::jsonb THEN
    RAISE EXCEPTION 'P3: equipment that is not a real item in its own slot: %', p -> 'items';
  END IF;
  -- the window closes; a real outfit arrives only in a late snapshot: kept apart, never evidence
  SET LOCAL ROLE game_economy_owner;
  INSERT INTO public.game_migration_windows (user_id, closes_at, changed_by, reason) VALUES (c_u, now(), 'test clock', 'simulated: 7 days passed')
  ON CONFLICT (user_id) DO UPDATE SET closes_at = now();
  RESET ROLE;
  r := pg_temp.imp(c_u, '10000000-0000-0000-0000-00000021b033', '20000000-0000-0000-0000-00000021b033', '{
    "level": 1, "equipment": {"Верх": 0}, "achievements": {"stylist":true}
  }');
  IF (SELECT status FROM public.game_imports WHERE snapshot_id = '10000000-0000-0000-0000-00000021b033') <> 'late' THEN
    RAISE EXCEPTION 'P3b: setup — the snapshot after the window is late: %', r;
  END IF;
  SET LOCAL ROLE game_migration_admin;
  p := pg_temp.plan(c_u);
  RESET ROLE;
  IF pg_temp.statuses(p) <> '["stylist=pending_review/device_flag"]'::jsonb THEN
    RAISE EXCEPTION 'P3c: a late snapshot proves nothing: %', p -> 'items';
  END IF;
END $$;

--------------------------------------------------------------------------------
-- P4. Activation under the q4.7 rules; a person decides what is not proven; no XP or Coins from achievements
--------------------------------------------------------------------------------
DO $$
DECLARE
  c_u CONSTANT UUID := '00000000-0000-0000-0000-00000021b004';
  v_id BIGINT;
  v JSONB;
  e TEXT;
  v_ledger TEXT;
  r RECORD;
BEGIN
  PERFORM public.game_economy_transition(c_u, 'local', 'migration_pending');
  PERFORM pg_temp.imp(c_u, '10000000-0000-0000-0000-00000021b041', '20000000-0000-0000-0000-00000021b041', '{
    "level": 1, "xp": 40, "coins": 10,
    "history": [{"questId":"q_bias","xp":40,"coins":10,"completedAt":"2026-11-01"}],
    "equipment": {"Обувь": 5},
    "achievements": {"firstQuest":true,"stylist":true,"firstPlan":true}
  }');
  SET LOCAL ROLE game_migration_admin;
  v_id := (public.game_mig_save_reconciliation(c_u, public.game_mig_reconcile(c_u), 'owner') ->> 'id')::BIGINT;
  -- whatever the device had beyond the proven records is decided first (nothing beyond them here)
  FOR r IN SELECT snapshot_id FROM public.game_legacy_reviews WHERE user_id = c_u AND status = 'pending_review' LOOP
    PERFORM public.game_mig_decide_legacy(c_u, r.snapshot_id, 'rejected', NULL, NULL, 'owner', 'nothing beyond the records');
  END LOOP;
  RESET ROLE;
  SET LOCAL ROLE game_economy_owner;
  INSERT INTO public.game_migration_windows (user_id, closes_at, changed_by, reason) VALUES (c_u, now(), 'test clock', 'simulated: 7 days passed')
  ON CONFLICT (user_id) DO UPDATE SET closes_at = now();
  RESET ROLE;
  SET LOCAL ROLE game_migration_admin;
  v := public.game_mig_activate(c_u, v_id, 'owner', NULL);
  RESET ROLE;
  IF v ->> 'state' <> 'cloud_active' OR NOT (v ->> 'achievements_transferred')::boolean THEN
    RAISE EXCEPTION 'P4: activated with its achievements: %', v;
  END IF;
  IF (SELECT string_agg(achievement_id || '=' || status || '/' || source || '/' || rules_version, ',' ORDER BY achievement_id)
      FROM public.game_achievements WHERE user_id = c_u)
     <> 'firstPlan=pending_review/device_flag/q4.7,firstQuest=verified/reconciled_event/q4.7,stylist=verified/snapshot_record/q4.7' THEN
    RAISE EXCEPTION 'P4b: recorded under the q4.7 rules: %',
      (SELECT string_agg(achievement_id || '=' || status || '/' || source || '/' || rules_version, ',') FROM public.game_achievements WHERE user_id = c_u);
  END IF;
  -- achievements never pay: the ledger holds only the proven quest
  v_ledger := (SELECT count(*) || '/' || sum(xp) || '/' || sum(coins) FROM public.game_ledger WHERE user_id = c_u);
  IF v_ledger <> '1/40/10' THEN RAISE EXCEPTION 'P4c: no XP or Coins from achievements: %', v_ledger; END IF;
  -- a person accepts what the server cannot prove (with a reason, audited); never changes a proven one
  SET LOCAL ROLE game_migration_admin;
  PERFORM public.game_mig_decide_achievement(c_u, 'firstPlan', 'legacy_accepted', 'owner', 'the user showed the plan');
  e := pg_temp.err(format('SELECT public.game_mig_decide_achievement(%L, %L, %L, %L, %L)', c_u, 'stylist', 'rejected', 'owner', 'x'));
  RESET ROLE;
  IF (SELECT status FROM public.game_achievements WHERE user_id = c_u AND achievement_id = 'firstPlan') <> 'legacy_accepted'
     OR (SELECT count(*) FROM public.game_migration_audit WHERE user_id = c_u AND action = 'achievement_decided') <> 1 THEN
    RAISE EXCEPTION 'P4d: accepted by a person, audited';
  END IF;
  IF e NOT LIKE '%game_mig_achievement_verified%' THEN RAISE EXCEPTION 'P4e: a proven achievement is never changed by hand: %', e; END IF;
  IF (SELECT count(*) || '/' || sum(xp) || '/' || sum(coins) FROM public.game_ledger WHERE user_id = c_u) <> v_ledger THEN
    RAISE EXCEPTION 'P4f: a decision pays nothing';
  END IF;
END $$;

ROLLBACK;
