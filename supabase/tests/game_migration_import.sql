-- AYRA Trading — tests for 0019 (Q4.5-4: device snapshots in quarantine, reconciliation, legacy review, activation)
-- on top of 0014–0016 and 0018. Run on a TEST database; everything is rolled back. Synthetic users only.
--   M — the main account (two devices, a legacy remainder accepted, activated);  N — never opened (local);
--   O — another account (isolation);  P — an account with a snapshot that tries to skip the reconciliation.
BEGIN;

INSERT INTO auth.users (id, email) VALUES
  ('00000000-0000-0000-0000-00000019a001', 'mig-m@example.com'),
  ('00000000-0000-0000-0000-00000019a002', 'mig-n@example.com'),
  ('00000000-0000-0000-0000-00000019a003', 'mig-o@example.com'),
  ('00000000-0000-0000-0000-00000019a004', 'mig-p@example.com')
ON CONFLICT (id) DO NOTHING;

CREATE OR REPLACE FUNCTION pg_temp.err(p_sql TEXT) RETURNS TEXT AS $$
BEGIN
  EXECUTE p_sql;
  RETURN 'ok';
EXCEPTION WHEN OTHERS THEN
  RETURN SQLERRM;
END $$ LANGUAGE plpgsql;
GRANT EXECUTE ON FUNCTION pg_temp.err(TEXT) TO PUBLIC;
-- a fresh token of the account's state now (as the route passes it after the auth server confirmed the session)
CREATE OR REPLACE FUNCTION pg_temp.imp(p_user UUID, p_snap TEXT, p_install TEXT, p_content JSONB, p_claim TEXT DEFAULT NULL)
RETURNS JSONB AS $$
  SELECT public.game_import_snapshot(p_user, '00000000-0000-0000-0000-0000000005e5', floor(extract(epoch FROM now()))::bigint,
    COALESCE(p_claim, (SELECT state FROM public.game_accounts WHERE user_id = p_user), 'local'), p_snap::uuid, p_install::uuid, 1, p_content) $$ LANGUAGE sql;

--------------------------------------------------------------------------------
-- 1. Intake: only in the window, only with a fresh token, atomic and idempotent
--------------------------------------------------------------------------------
DO $$
DECLARE
  c_m CONSTANT UUID := '00000000-0000-0000-0000-00000019a001';
  c_n CONSTANT UUID := '00000000-0000-0000-0000-00000019a002';
  v JSONB;
  e TEXT;
BEGIN
  -- no window yet: nothing stored
  e := pg_temp.err($q$SELECT pg_temp.imp('00000000-0000-0000-0000-00000019a002', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '{"level":1}')$q$);
  IF e NOT LIKE '%game_import_not_open%' THEN RAISE EXCEPTION 'I1: a local account accepts no snapshot: %', e; END IF;
  PERFORM public.game_economy_transition(c_m, 'local', 'migration_pending');
  -- a token with the old mark is stale
  e := pg_temp.err($q$SELECT pg_temp.imp('00000000-0000-0000-0000-00000019a001', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '{"level":1}', 'local')$q$);
  IF e NOT LIKE '%game_session_stale%' THEN RAISE EXCEPTION 'I2: an old mark is refused: %', e; END IF;
  -- schema, size, shape
  e := pg_temp.err($q$SELECT public.game_import_snapshot('00000000-0000-0000-0000-00000019a001', '00000000-0000-0000-0000-0000000005e5', floor(extract(epoch FROM now()))::bigint, 'migration_pending', '10000000-0000-0000-0000-000000000009', '20000000-0000-0000-0000-000000000009', 2, '{}')$q$);
  IF e NOT LIKE '%game_import_schema%' THEN RAISE EXCEPTION 'I3: unknown schema refused: %', e; END IF;
  e := pg_temp.err($q$SELECT pg_temp.imp('00000000-0000-0000-0000-00000019a001', '10000000-0000-0000-0000-000000000009', '20000000-0000-0000-0000-000000000009', jsonb_build_object('pad', repeat('x', 1100000)))$q$);
  IF e NOT LIKE '%game_import_too_large%' THEN RAISE EXCEPTION 'I4: a snapshot above 1 MB refused: %', e; END IF;
  e := pg_temp.err($q$SELECT pg_temp.imp('00000000-0000-0000-0000-00000019a001', '10000000-0000-0000-0000-000000000009', '20000000-0000-0000-0000-000000000009', '[1]')$q$);
  IF e NOT LIKE '%game_bad_request%' THEN RAISE EXCEPTION 'I5: a non-object refused: %', e; END IF;
  -- device A, then the same request again (a retry): one row
  v := pg_temp.imp(c_m, '10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-00000000000a', '{"level":3,"xp":50,"coins":120}');
  IF v ->> 'status' <> 'accepted' OR (v ->> 'replay')::boolean THEN RAISE EXCEPTION 'I6: first snapshot accepted: %', v; END IF;
  v := pg_temp.imp(c_m, '10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-00000000000a', '{"level":3,"xp":50,"coins":120}');
  IF v ->> 'status' <> 'accepted' OR NOT (v ->> 'replay')::boolean THEN RAISE EXCEPTION 'I7: a retry is a replay: %', v; END IF;
  -- the same id with another content: refused, the stored one unchanged
  e := pg_temp.err($q$SELECT pg_temp.imp('00000000-0000-0000-0000-00000019a001', '10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-00000000000a', '{"level":9,"xp":0,"coins":9999}')$q$);
  IF e NOT LIKE '%game_import_conflict%' THEN RAISE EXCEPTION 'I8: same id, other content refused: %', e; END IF;
  e := pg_temp.err($q$SELECT pg_temp.imp('00000000-0000-0000-0000-00000019a001', '10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-0000000000ff', '{"level":3,"xp":50,"coins":120}')$q$);
  IF e NOT LIKE '%game_import_conflict%' THEN RAISE EXCEPTION 'I9: same id from another install refused: %', e; END IF;
  -- a second snapshot of the same install: kept, never reconciled
  v := pg_temp.imp(c_m, '10000000-0000-0000-0000-00000000000c', '20000000-0000-0000-0000-00000000000a', '{"level":3,"xp":60,"coins":125}');
  IF v ->> 'status' <> 'duplicate_install' THEN RAISE EXCEPTION 'I10: a second snapshot of one install is a duplicate: %', v; END IF;
  -- device B
  v := pg_temp.imp(c_m, '10000000-0000-0000-0000-00000000000b', '20000000-0000-0000-0000-00000000000b',
    '{"level":2,"xp":0,"coins":20,"history":[{"questId":"q_bias","xp":40,"coins":10,"completedAt":"2026-11-01"}]}');
  IF v ->> 'status' <> 'accepted' THEN RAISE EXCEPTION 'I11: second device accepted: %', v; END IF;
  IF (SELECT count(*) FROM public.game_imports WHERE user_id = c_m) <> 3
     OR (SELECT content ->> 'coins' FROM public.game_imports WHERE snapshot_id = '10000000-0000-0000-0000-00000000000a') <> '120'
     OR (SELECT account_state FROM public.game_imports WHERE snapshot_id = '10000000-0000-0000-0000-00000000000a') <> 'migration_pending' THEN
    RAISE EXCEPTION 'I12: three rows kept as they came';
  END IF;
  IF cardinality(public.game_mig_inputs(c_m)) <> 2 THEN RAISE EXCEPTION 'I13: two accepted snapshots are the inputs'; END IF;
  -- a stored snapshot never changes
  e := pg_temp.err($q$UPDATE public.game_imports SET content = '{}' WHERE snapshot_id = '10000000-0000-0000-0000-00000000000a'$q$);
  IF e NOT LIKE '%game_import_immutable%' THEN RAISE EXCEPTION 'I14: a snapshot is immutable even for the owner: %', e; END IF;
  -- the account is NOT moved, nothing is credited by an intake
  IF (SELECT state FROM public.game_accounts WHERE user_id = c_m) <> 'migration_pending'
     OR EXISTS (SELECT 1 FROM public.game_ledger WHERE user_id = c_m) THEN
    RAISE EXCEPTION 'I15: an intake moves and credits nothing';
  END IF;
  -- the account N never opened: still nothing
  IF EXISTS (SELECT 1 FROM public.game_imports WHERE user_id = c_n) THEN RAISE EXCEPTION 'I16: no row for a refused intake'; END IF;
END $$;

--------------------------------------------------------------------------------
-- 2. Access: no client role sees anything; the route only receives; the owner's role only reads and decides
--------------------------------------------------------------------------------
SET LOCAL ROLE authenticated;
DO $$
BEGIN
  IF pg_temp.err('SELECT count(*) FROM public.game_imports') NOT LIKE '%permission denied%'
     OR pg_temp.err('SELECT count(*) FROM public.game_legacy_reviews') NOT LIKE '%permission denied%'
     OR pg_temp.err('SELECT count(*) FROM public.game_migration_audit') NOT LIKE '%permission denied%' THEN
    RAISE EXCEPTION 'A1: a signed-in user reads no quarantine table';
  END IF;
  IF pg_temp.err($q$SELECT public.game_import_snapshot('00000000-0000-0000-0000-00000019a003', NULL, 0, 'x', gen_random_uuid(), gen_random_uuid(), 1, '{}')$q$) NOT LIKE '%permission denied%'
     OR pg_temp.err($q$SELECT public.game_mig_activate('00000000-0000-0000-0000-00000019a001', 1, 'me', 'x')$q$) NOT LIKE '%permission denied%' THEN
    RAISE EXCEPTION 'A2: a signed-in user calls neither the intake nor the tool';
  END IF;
END $$;
RESET ROLE;
SET LOCAL ROLE service_role;
DO $$
BEGIN
  IF pg_temp.err('SELECT count(*) FROM public.game_imports') NOT LIKE '%permission denied%' THEN RAISE EXCEPTION 'A3: the route reads no snapshot'; END IF;
  IF pg_temp.err($q$SELECT public.game_mig_activate('00000000-0000-0000-0000-00000019a001', 1, 'route', 'x')$q$) NOT LIKE '%permission denied%'
     OR pg_temp.err($q$SELECT public.game_mig_decide_legacy('00000000-0000-0000-0000-00000019a001', gen_random_uuid(), 'accepted', 1, 1, 'route', 'x')$q$) NOT LIKE '%permission denied%'
     OR pg_temp.err($q$SELECT public.game_economy_transition('00000000-0000-0000-0000-00000019a003', 'local', 'migration_pending')$q$) NOT LIKE '%permission denied%'
     OR pg_temp.err($q$SELECT public.game_activate_cloud('00000000-0000-0000-0000-00000019a003', 'q4.1')$q$) NOT LIKE '%permission denied%'
     OR pg_temp.err($q$SELECT public.game_begin_migration('00000000-0000-0000-0000-00000019a003')$q$) NOT LIKE '%permission denied%' THEN
    RAISE EXCEPTION 'A4: the route can neither decide, activate nor move an account';
  END IF;
  -- the intake itself is the route's (a local account is refused by the rule, not by the privilege)
  IF pg_temp.err($q$SELECT public.game_import_snapshot('00000000-0000-0000-0000-00000019a003', '00000000-0000-0000-0000-0000000005e5', 0, 'local', gen_random_uuid(), gen_random_uuid(), 1, '{}')$q$) NOT LIKE '%game_import_not_open%' THEN
    RAISE EXCEPTION 'A5: the route may call the intake';
  END IF;
END $$;
RESET ROLE;
SET LOCAL ROLE game_migration_admin;
DO $$
BEGIN
  IF (SELECT count(*) FROM public.game_imports WHERE user_id = '00000000-0000-0000-0000-00000019a001') <> 3 THEN RAISE EXCEPTION 'A6: the tool reads the snapshots'; END IF;
  IF pg_temp.err($q$INSERT INTO public.game_migration_audit (actor, action) VALUES ('x', 'y')$q$) NOT LIKE '%permission denied%'
     OR pg_temp.err($q$INSERT INTO public.game_ledger (user_id, idempotency_key, kind, rule_code, game_day, xp, coins, rules_version, result) VALUES ('00000000-0000-0000-0000-00000019a001', 'legacy:x', 'migration_legacy', 'migration_legacy', CURRENT_DATE, 1, 1, 'x', '{}')$q$) NOT LIKE '%permission denied%' THEN
    RAISE EXCEPTION 'A7: the tool writes only through its functions';
  END IF;
  IF pg_temp.err($q$SELECT public.game_import_snapshot('00000000-0000-0000-0000-00000019a001', gen_random_uuid(), 0, 'x', gen_random_uuid(), gen_random_uuid(), 1, '{}')$q$) NOT LIKE '%permission denied%' THEN
    RAISE EXCEPTION 'A8: the tool cannot upload a snapshot for a user';
  END IF;
  IF pg_temp.err($q$SELECT public.game_mig_transition('00000000-0000-0000-0000-00000019a003', 'local', 'cloud_active', 'owner', 'x')$q$) NOT LIKE '%game_mig_activation_required%'
     OR pg_temp.err($q$SELECT public.game_mig_transition('00000000-0000-0000-0000-00000019a003', 'local', 'migration_pending', 'owner', ' ')$q$) NOT LIKE '%game_mig_reason_required%' THEN
    RAISE EXCEPTION 'A9: the tool moves an account only to the window, with a reason';
  END IF;
END $$;
RESET ROLE;

--------------------------------------------------------------------------------
-- 2b. V3 evidence: Journal records per day in the account's zone, imports apart, deleted rows never counted
--------------------------------------------------------------------------------
INSERT INTO public.journal_notes (user_id, id, data, client_updated_at) VALUES
  ('00000000-0000-0000-0000-00000019a001', 'e1', '{"id":"e1","createdAt":"2026-10-27T22:30:00Z"}', now()),
  ('00000000-0000-0000-0000-00000019a001', 'e2', '{"id":"e2","createdAt":"2026-10-27T10:00:00Z","importBatchId":"b1"}', now());
-- a deleted note: the client sends data.deletedAt, the server fills deleted_at from it (0004)
INSERT INTO public.journal_notes (user_id, id, data, client_updated_at) VALUES
  ('00000000-0000-0000-0000-00000019a001', 'e3', '{"id":"e3","createdAt":"2026-10-27T10:00:00Z","deletedAt":"2026-10-29T10:00:00Z"}', now());
SET LOCAL ROLE game_migration_admin;
DO $$
DECLARE v JSONB := public.game_mig_journal_days('00000000-0000-0000-0000-00000019a001', 'Europe/Moscow');
BEGIN
  -- 22:30 UTC is the next day in Moscow; the import counted apart; the deleted note not at all
  IF v <> '{"2026-10-27": {"imported": 1}, "2026-10-28": {"notes": 1}}'::jsonb THEN RAISE EXCEPTION 'E1: journal days %', v; END IF;
  IF pg_temp.err('SELECT count(*) FROM public.journal_notes') NOT LIKE '%permission denied%' THEN RAISE EXCEPTION 'E2: the tool reads no Journal content'; END IF;
END $$;
RESET ROLE;

--------------------------------------------------------------------------------
-- 3. Reconciliation: for exactly the accepted snapshots, canonical keys once; legacy reviews per snapshot
--------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION pg_temp.result(p_user UUID, p_events JSONB, p_legacy_a JSONB, p_legacy_b JSONB, p_orig_level INT) RETURNS JSONB AS $$
  SELECT jsonb_build_object('inputs', to_jsonb(public.game_mig_inputs(p_user)), 'events', p_events, 'conflicts', '[]'::jsonb,
    'legacy', jsonb_build_array(
      jsonb_build_object('snapshotId', '10000000-0000-0000-0000-00000000000a', 'candidate', p_legacy_a, 'original', '{"level":3,"totalXp":330,"coins":120}'::jsonb, 'confirmed', '{"xp":0,"coins":0}'::jsonb, 'reasons', '[{"code":"legacy_format"}]'::jsonb),
      jsonb_build_object('snapshotId', '10000000-0000-0000-0000-00000000000b', 'candidate', p_legacy_b, 'original', '{"level":2,"totalXp":120,"coins":20}'::jsonb, 'confirmed', '{"xp":40,"coins":10}'::jsonb, 'reasons', '[]'::jsonb)),
    'proposed', jsonb_build_object('originalLevel', p_orig_level)) $$ LANGUAGE sql;
GRANT EXECUTE ON FUNCTION pg_temp.result(UUID, JSONB, JSONB, JSONB, INT) TO PUBLIC;

SET LOCAL ROLE game_migration_admin;
DO $$
DECLARE
  c_m CONSTANT UUID := '00000000-0000-0000-0000-00000019a001';
  ev CONSTANT JSONB := '[{"key":"quest:2026-11-01:q_bias","kind":"quest","day":"2026-11-01","xp":40,"coins":10,"sources":["b"]}]';
  r JSONB;
  e TEXT;
  v_id BIGINT;
BEGIN
  r := pg_temp.result(c_m, ev, '{"xp":330,"coins":120}', '{"xp":80,"coins":10}', 3);
  -- a result computed for other snapshots is refused
  e := pg_temp.err(format('SELECT public.game_mig_save_reconciliation(%L, %L, %L)', c_m, jsonb_set(r, '{inputs}', '["x:y"]'), 'owner'));
  IF e NOT LIKE '%game_mig_inputs_changed%' THEN RAISE EXCEPTION 'R1: inputs must be the accepted snapshots: %', e; END IF;
  -- a key twice, a non-canonical key, an amount above any rule: refused
  e := pg_temp.err(format('SELECT public.game_mig_save_reconciliation(%L, %L, %L)', c_m, jsonb_set(r, '{events}', ev || ev), 'owner'));
  IF e NOT LIKE '%game_mig_bad_result%' THEN RAISE EXCEPTION 'R2: a key once: %', e; END IF;
  e := pg_temp.err(format('SELECT public.game_mig_save_reconciliation(%L, %L, %L)', c_m, jsonb_set(r, '{events}', '[{"key":"shot:abc","day":"2026-11-01","xp":10,"coins":0}]'), 'owner'));
  IF e NOT LIKE '%game_mig_bad_result%' THEN RAISE EXCEPTION 'R3: a screenshot hash is no provable key: %', e; END IF;
  e := pg_temp.err(format('SELECT public.game_mig_save_reconciliation(%L, %L, %L)', c_m, jsonb_set(r, '{events}', '[{"key":"quest:2026-11-01:x","day":"2026-11-01","xp":40,"coins":500}]'), 'owner'));
  IF e NOT LIKE '%game_mig_bad_result%' THEN RAISE EXCEPTION 'R4: amounts within the rules: %', e; END IF;
  v_id := public.game_mig_save_reconciliation(c_m, r, 'owner');
  IF (SELECT count(*) FROM public.game_legacy_reviews WHERE user_id = c_m AND status = 'pending_review') <> 2 THEN RAISE EXCEPTION 'R5: one review per accepted snapshot'; END IF;
  -- not ready: undecided remainders
  e := pg_temp.err(format('SELECT public.game_mig_activate(%L, %s, %L, NULL)', c_m, v_id, 'owner'));
  IF e NOT LIKE '%game_mig_unresolved%' THEN RAISE EXCEPTION 'R6: activation waits for every review: %', e; END IF;
  -- decisions: a reason always; never above the candidate; one accepted per account
  e := pg_temp.err(format('SELECT public.game_mig_decide_legacy(%L, %L, %L, 330, 120, %L, %L)', c_m, '10000000-0000-0000-0000-00000000000a', 'accepted', 'owner', ''));
  IF e NOT LIKE '%game_mig_reason_required%' THEN RAISE EXCEPTION 'R7: a decision needs a reason: %', e; END IF;
  e := pg_temp.err(format('SELECT public.game_mig_decide_legacy(%L, %L, %L, 331, 120, %L, %L)', c_m, '10000000-0000-0000-0000-00000000000a', 'accepted', 'owner', 'r'));
  IF e NOT LIKE '%game_legacy_reviews%' AND e NOT LIKE '%check constraint%' THEN RAISE EXCEPTION 'R8: never above the candidate: %', e; END IF;
  e := pg_temp.err(format('SELECT public.game_mig_decide_legacy(%L, %L, %L, NULL, NULL, %L, %L)', c_m, '10000000-0000-0000-0000-00000000000a', 'accepted', 'owner', 'r'));
  IF e = 'ok' THEN RAISE EXCEPTION 'R9: an acceptance names its amounts'; END IF;
  PERFORM public.game_mig_decide_legacy(c_m, '10000000-0000-0000-0000-00000000000a', 'accepted', 290, 100, 'owner', 'level 3 confirmed by the user, Journal records on 12 days');
  e := pg_temp.err(format('SELECT public.game_mig_decide_legacy(%L, %L, %L, 80, 10, %L, %L)', c_m, '10000000-0000-0000-0000-00000000000b', 'accepted', 'owner', 'r'));
  IF e NOT LIKE '%duplicate key%' THEN RAISE EXCEPTION 'R10: the same remainder never twice under another snapshot: %', e; END IF;
  PERFORM public.game_mig_decide_legacy(c_m, '10000000-0000-0000-0000-00000000000b', 'needs_evidence', NULL, NULL, 'owner', 'ask the user');
  e := pg_temp.err(format('SELECT public.game_mig_activate(%L, %s, %L, NULL)', c_m, v_id, 'owner'));
  IF e NOT LIKE '%game_mig_unresolved%' THEN RAISE EXCEPTION 'R11: needs_evidence blocks the activation: %', e; END IF;
  PERFORM public.game_mig_decide_legacy(c_m, '10000000-0000-0000-0000-00000000000b', 'rejected', NULL, NULL, 'owner', 'same progress as device A');
  IF (SELECT count(*) FROM public.game_migration_audit WHERE user_id = c_m AND action = 'legacy_decided') <> 3 THEN RAISE EXCEPTION 'R12: every decision audited'; END IF;
END $$;
RESET ROLE;

--------------------------------------------------------------------------------
-- 4. A snapshot after the reconciliation invalidates it; a changed candidate reopens its review
--------------------------------------------------------------------------------
DO $$
DECLARE
  c_m CONSTANT UUID := '00000000-0000-0000-0000-00000019a001';
  v_old BIGINT := (SELECT id FROM public.game_reconciliations WHERE user_id = c_m AND status = 'draft');
  e TEXT;
BEGIN
  PERFORM pg_temp.imp(c_m, '10000000-0000-0000-0000-00000000000d', '20000000-0000-0000-0000-00000000000d', '{"level":1,"xp":10,"coins":0}');
  SET LOCAL ROLE game_migration_admin;
  e := pg_temp.err(format('SELECT public.game_mig_activate(%L, %s, %L, %L)', c_m, v_old, 'owner', 'ack'));
  RESET ROLE;
  IF e NOT LIKE '%game_mig_inputs_changed%' THEN RAISE EXCEPTION 'R13: a late-arriving device invalidates the reconciliation: %', e; END IF;
END $$;
SET LOCAL ROLE game_migration_admin;
DO $$
DECLARE
  c_m CONSTANT UUID := '00000000-0000-0000-0000-00000019a001';
  ev CONSTANT JSONB := '[{"key":"quest:2026-11-01:q_bias","kind":"quest","day":"2026-11-01","xp":40,"coins":10,"sources":["b"]},{"key":"first:trade","kind":"first","day":"2026-10-30","xp":20,"coins":20,"sources":["a"]}]';
  r JSONB;
  v_id BIGINT;
  v JSONB;
  e TEXT;
BEGIN
  r := pg_temp.result(c_m, ev, '{"xp":330,"coins":120}', '{"xp":80,"coins":10}', 3);
  r := jsonb_set(r, '{legacy}', (r -> 'legacy') || jsonb_build_array(jsonb_build_object('snapshotId', '10000000-0000-0000-0000-00000000000d',
    'candidate', '{"xp":10,"coins":0}'::jsonb, 'original', '{"level":1}'::jsonb, 'confirmed', '{}'::jsonb, 'reasons', '[]'::jsonb)));
  v_id := public.game_mig_save_reconciliation(c_m, r, 'owner');
  IF (SELECT count(*) FROM public.game_reconciliations WHERE user_id = c_m AND status = 'superseded') <> 1 THEN RAISE EXCEPTION 'R14: the old draft superseded'; END IF;
  -- unchanged candidates keep their decisions; the new snapshot waits for one
  IF (SELECT status FROM public.game_legacy_reviews WHERE snapshot_id = '10000000-0000-0000-0000-00000000000a') <> 'accepted' THEN RAISE EXCEPTION 'R15: a decision survives an unchanged candidate'; END IF;
  PERFORM public.game_mig_decide_legacy(c_m, '10000000-0000-0000-0000-00000000000d', 'rejected', NULL, NULL, 'owner', 'a fresh install, nothing of its own');
  -- the level of the proposal (40 + 20 + 290 = 350 XP → level 3) — equal to the original: no acknowledgement needed
  v := public.game_mig_activate(c_m, v_id, 'owner', NULL);
  IF v ->> 'state' <> 'cloud_active' OR (v ->> 'xp')::int <> 350 OR (v ->> 'coins')::int <> 130 OR (v ->> 'level')::int <> 3 THEN RAISE EXCEPTION 'R16: activation: %', v; END IF;
  -- a second click: nothing more
  v := public.game_mig_activate(c_m, v_id, 'owner', NULL);
  IF NOT (v ->> 'replay')::boolean THEN RAISE EXCEPTION 'R17: a second activation is a replay: %', v; END IF;
END $$;
RESET ROLE;
DO $$
DECLARE
  c_m CONSTANT UUID := '00000000-0000-0000-0000-00000019a001';
  v JSONB;
BEGIN
  IF (SELECT count(*) FROM public.game_ledger WHERE user_id = c_m) <> 3
     OR (SELECT sum(xp) FROM public.game_ledger WHERE user_id = c_m) <> 350
     OR NOT EXISTS (SELECT 1 FROM public.game_ledger WHERE user_id = c_m AND idempotency_key = 'legacy:' || c_m::text AND xp = 290 AND coins = 100)
     OR NOT EXISTS (SELECT 1 FROM public.game_ledger WHERE user_id = c_m AND idempotency_key = 'import:first:trade') THEN
    RAISE EXCEPTION 'R18: the ledger holds the proven events and the one accepted remainder';
  END IF;
  IF (SELECT xp_total FROM public.game_profile WHERE user_id = c_m) <> 350 OR (SELECT coins FROM public.game_profile WHERE user_id = c_m) <> 130 THEN
    RAISE EXCEPTION 'R19: the projection is rebuilt from the ledger';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.game_migration_audit WHERE user_id = c_m AND action = 'activated' AND actor = 'owner' AND db_user = session_user) THEN RAISE EXCEPTION 'R20: the activation is audited (with the database login)'; END IF;
  IF pg_temp.err($q$UPDATE public.game_migration_audit SET actor = 'x'$q$) <> 'game_ledger_append_only'
     OR pg_temp.err($q$SET LOCAL ROLE game_economy_owner; UPDATE public.game_migration_audit SET actor = 'x'$q$) <> 'game_ledger_append_only' THEN
    RAISE EXCEPTION 'A10: the audit is never changed, not even by the owner';
  END IF;
  RESET ROLE;
  -- after activation: a device that comes late is kept as late, never reconciled or credited
  v := pg_temp.imp(c_m, '10000000-0000-0000-0000-00000000000e', '20000000-0000-0000-0000-00000000000e', '{"level":5,"xp":0,"coins":500}');
  IF v ->> 'status' <> 'late' OR (SELECT sum(xp) FROM public.game_ledger WHERE user_id = c_m) <> 350 THEN RAISE EXCEPTION 'R21: a late snapshot is kept, nothing credited: %', v; END IF;
  -- and the original snapshots are all still there
  IF (SELECT count(*) FROM public.game_imports WHERE user_id = c_m) <> 5 THEN RAISE EXCEPTION 'R22: nothing deleted'; END IF;
END $$;

--------------------------------------------------------------------------------
-- 5. No way around the reconciliation; a lower level only with an acknowledgement; isolation
--------------------------------------------------------------------------------
DO $$
DECLARE
  c_o CONSTANT UUID := '00000000-0000-0000-0000-00000019a003';
  c_p CONSTANT UUID := '00000000-0000-0000-0000-00000019a004';
  e TEXT;
BEGIN
  PERFORM public.game_economy_transition(c_p, 'local', 'migration_pending');
  PERFORM pg_temp.imp(c_p, '10000000-0000-0000-0000-0000000000f1', '20000000-0000-0000-0000-0000000000f1', '{"level":4,"xp":0,"coins":50}');
  e := pg_temp.err(format('SELECT public.game_activate_cloud(%L, %L)', c_p, 'q4.1'));
  IF e NOT LIKE '%game_mig_activation_required%' THEN RAISE EXCEPTION 'R23: an account with a snapshot is never activated around the reconciliation: %', e; END IF;
  -- another account's snapshot ids are its own: the same id is another row, not a conflict
  PERFORM public.game_economy_transition(c_o, 'local', 'migration_pending');
  IF (pg_temp.imp(c_o, '10000000-0000-0000-0000-0000000000f1', '20000000-0000-0000-0000-0000000000f1', '{"level":1}')) ->> 'status' <> 'accepted'
     OR (SELECT content ->> 'level' FROM public.game_imports WHERE user_id = c_p) <> '4' THEN
    RAISE EXCEPTION 'R24: accounts are isolated';
  END IF;
END $$;
SET LOCAL ROLE game_migration_admin;
DO $$
DECLARE
  c_p CONSTANT UUID := '00000000-0000-0000-0000-00000019a004';
  r JSONB;
  v_id BIGINT;
  e TEXT;
BEGIN
  r := jsonb_build_object('inputs', to_jsonb(public.game_mig_inputs(c_p)), 'events', '[]'::jsonb,
    'legacy', jsonb_build_array(jsonb_build_object('snapshotId', '10000000-0000-0000-0000-0000000000f1', 'candidate', '{"xp":680,"coins":50}'::jsonb,
      'original', '{"level":4}'::jsonb, 'confirmed', '{}'::jsonb, 'reasons', '[]'::jsonb)), 'proposed', '{"originalLevel":4}'::jsonb);
  v_id := public.game_mig_save_reconciliation(c_p, r, 'owner');
  PERFORM public.game_mig_decide_legacy(c_p, '10000000-0000-0000-0000-0000000000f1', 'rejected', NULL, NULL, 'owner', 'no evidence');
  e := pg_temp.err(format('SELECT public.game_mig_activate(%L, %s, %L, NULL)', c_p, v_id, 'owner'));
  IF e NOT LIKE '%game_mig_level_gap%' THEN RAISE EXCEPTION 'R25: never a hidden level decrease: %', e; END IF;
  IF (SELECT state FROM public.game_accounts WHERE user_id = c_p) <> 'migration_pending' THEN RAISE EXCEPTION 'R26: a refused activation leaves the account pending'; END IF;
END $$;
RESET ROLE;

ROLLBACK;
