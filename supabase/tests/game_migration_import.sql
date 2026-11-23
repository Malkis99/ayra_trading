-- AYRA Trading — tests for 0019 (Q4.5-4: device snapshots in quarantine, reconciliation computed by the database,
-- legacy review, the intake window, activation) on top of 0014–0016 and 0018. Run on a TEST database; everything is
-- rolled back. Synthetic users only. now() is fixed inside this transaction: «the 7 days passed» is simulated by the
-- database owner setting a window's end to now().
--   M — the main account (two devices, a legacy remainder accepted, activated);  N — never opened (local);
--   O — another account (isolation);  P — an account with a snapshot that tries to skip the reconciliation;
--   Q — two devices with 70 + 70 Coins on one day (the cap over all devices);  R — a genuinely new account.
BEGIN;

INSERT INTO auth.users (id, email) VALUES
  ('00000000-0000-0000-0000-00000019a001', 'mig-m@example.com'),
  ('00000000-0000-0000-0000-00000019a002', 'mig-n@example.com'),
  ('00000000-0000-0000-0000-00000019a003', 'mig-o@example.com'),
  ('00000000-0000-0000-0000-00000019a004', 'mig-p@example.com'),
  ('00000000-0000-0000-0000-00000019a005', 'mig-q@example.com'),
  ('00000000-0000-0000-0000-00000019a006', 'mig-r@example.com')
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
-- «7 days later»: the window's end set to now() by the database owner (the test's clock only)
CREATE OR REPLACE FUNCTION pg_temp.close_window(p_user UUID) RETURNS VOID AS $$
BEGIN
  SET LOCAL ROLE game_economy_owner;
  INSERT INTO public.game_migration_windows (user_id, closes_at, changed_by, reason) VALUES (p_user, now(), 'test clock', 'simulated: 7 days passed')
  ON CONFLICT (user_id) DO UPDATE SET closes_at = now();
  RESET ROLE;
END $$ LANGUAGE plpgsql;

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
  -- the window: 7 calendar days from the start of migration_pending (owner decision)
  IF public.game_mig_window_closes_at(c_m) <> (SELECT state_changed_at FROM public.game_accounts WHERE user_id = c_m) + interval '7 days'
     OR public.game_mig_window_closes_at(c_n) IS NOT NULL THEN
    RAISE EXCEPTION 'W1: the window is 7 days from the start of migration_pending (none for a local account)';
  END IF;
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
     OR pg_temp.err('SELECT count(*) FROM public.game_migration_audit') NOT LIKE '%permission denied%'
     OR pg_temp.err('SELECT count(*) FROM public.game_migration_windows') NOT LIKE '%permission denied%' THEN
    RAISE EXCEPTION 'A1: a signed-in user reads no quarantine table';
  END IF;
  IF pg_temp.err($q$SELECT public.game_import_snapshot('00000000-0000-0000-0000-00000019a003', NULL, 0, 'x', gen_random_uuid(), gen_random_uuid(), 1, '{}')$q$) NOT LIKE '%permission denied%'
     OR pg_temp.err($q$SELECT public.game_mig_activate('00000000-0000-0000-0000-00000019a001', 1, 'me', 'x')$q$) NOT LIKE '%permission denied%'
     OR pg_temp.err($q$SELECT public.game_mig_reconcile('00000000-0000-0000-0000-00000019a001')$q$) NOT LIKE '%permission denied%'
     OR pg_temp.err($q$SELECT public.game_mig_activate_new('00000000-0000-0000-0000-00000019a001', 'me', 'x')$q$) NOT LIKE '%permission denied%'
     OR pg_temp.err($q$SELECT public.game_mig_extend_window('00000000-0000-0000-0000-00000019a001', now() + interval '30 days', 'me', 'x')$q$) NOT LIKE '%permission denied%' THEN
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
     OR pg_temp.err($q$SELECT public.game_begin_migration('00000000-0000-0000-0000-00000019a003')$q$) NOT LIKE '%permission denied%'
     OR pg_temp.err($q$SELECT public.game_mig_save_reconciliation('00000000-0000-0000-0000-00000019a001', '{}', 'route')$q$) NOT LIKE '%permission denied%'
     OR pg_temp.err($q$SELECT public.game_mig_activate_new('00000000-0000-0000-0000-00000019a003', 'route', 'x')$q$) NOT LIKE '%permission denied%'
     OR pg_temp.err($q$SELECT public.game_mig_extend_window('00000000-0000-0000-0000-00000019a001', now() + interval '30 days', 'route', 'x')$q$) NOT LIKE '%permission denied%' THEN
    RAISE EXCEPTION 'A4: the route can neither decide, activate, extend nor move an account';
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
     OR pg_temp.err($q$INSERT INTO public.game_migration_windows (user_id, closes_at, changed_by, reason) VALUES ('00000000-0000-0000-0000-00000019a001', now(), 'x', 'y')$q$) NOT LIKE '%permission denied%'
     OR pg_temp.err($q$UPDATE public.game_reconciliations SET result = '{}'$q$) NOT LIKE '%permission denied%'
     OR pg_temp.err($q$INSERT INTO public.game_ledger (user_id, idempotency_key, kind, rule_code, game_day, xp, coins, rules_version, result) VALUES ('00000000-0000-0000-0000-00000019a001', 'legacy:x', 'migration_legacy', 'migration_legacy', CURRENT_DATE, 1, 1, 'x', '{}')$q$) NOT LIKE '%permission denied%' THEN
    RAISE EXCEPTION 'A7: the tool writes only through its functions (never a stored result, a window or the ledger)';
  END IF;
  IF pg_temp.err($q$SELECT public.game_import_snapshot('00000000-0000-0000-0000-00000019a001', gen_random_uuid(), 0, 'x', gen_random_uuid(), gen_random_uuid(), 1, '{}')$q$) NOT LIKE '%permission denied%' THEN
    RAISE EXCEPTION 'A8: the tool cannot upload a snapshot for a user';
  END IF;
  IF pg_temp.err($q$SELECT public.game_mig_transition('00000000-0000-0000-0000-00000019a003', 'local', 'cloud_active', 'owner', 'x')$q$) NOT LIKE '%game_mig_activation_required%'
     OR pg_temp.err($q$SELECT public.game_mig_transition('00000000-0000-0000-0000-00000019a003', 'local', 'migration_pending', 'owner', ' ')$q$) NOT LIKE '%game_mig_reason_required%'
     OR pg_temp.err($q$SELECT public.game_economy_transition('00000000-0000-0000-0000-00000019a003', 'local', 'migration_pending')$q$) NOT LIKE '%permission denied%' THEN
    RAISE EXCEPTION 'A9: the tool moves an account only to the window, with a reason, never by the bare transition';
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
-- 3. The reconciliation is the DATABASE's: computed from the stored snapshots; anything else sent is refused and logged
--------------------------------------------------------------------------------
SET LOCAL ROLE game_migration_admin;
DO $$
DECLARE
  c_m CONSTANT UUID := '00000000-0000-0000-0000-00000019a001';
  r JSONB := public.game_mig_reconcile(c_m);
  v JSONB;
  e TEXT;
  v_id BIGINT;
BEGIN
  -- what the database computes from M's two accepted snapshots (hand-checked): one proven quest; per device a candidate
  IF r -> 'events' <> '[{"key":"quest:2026-11-01:q_bias","kind":"quest","day":"2026-11-01","xp":40,"coins":10,"sources":["10000000-0000-0000-0000-00000000000b"]}]'::jsonb
     OR r -> 'proposed' <> '{"confirmedXp":40,"confirmedCoins":10,"level":1,"originalLevel":3,"levelGap":2,"originalCoins":120}'::jsonb
     OR (SELECT jsonb_agg(l -> 'candidate') FROM jsonb_array_elements(r -> 'legacy') l) <> '[{"xp":330,"coins":120},{"xp":80,"coins":10}]'::jsonb
     OR r ->> 'algorithm' <> 'q4.5-4/2' OR r ->> 'timeZone' <> 'UTC' OR jsonb_array_length(r -> 'inputs') <> 2 THEN
    RAISE EXCEPTION 'C1: the database''s reconciliation of M: %', r;
  END IF;
  -- mutations of the result: each one refused (no raise — the refusal stays in the decision log), nothing saved
  FOREACH v IN ARRAY ARRAY[
    jsonb_set(r, '{events}', (r -> 'events') || '[{"key":"quest:2026-11-02:q_fake","kind":"quest","day":"2026-11-02","xp":40,"coins":10,"sources":["10000000-0000-0000-0000-00000000000b"]}]'::jsonb),
    jsonb_set(r, '{events,0,xp}', '50'::jsonb),
    jsonb_set(r, '{events,0,coins}', '15'::jsonb),
    jsonb_set(r, '{proposed,confirmedXp}', '540'::jsonb),
    jsonb_set(r, '{proposed,confirmedCoins}', '110'::jsonb),
    jsonb_set(r, '{legacy,1,candidate,xp}', '9999'::jsonb),
    jsonb_set(r, '{inputs}', '["x:y"]'::jsonb),
    jsonb_set(r, '{algorithm}', '"q4.5-4/1"'::jsonb),
    r - 'conflicts',
    '{}'::jsonb] LOOP
    IF public.game_mig_save_reconciliation(c_m, v, 'mallory') ->> 'refused' IS DISTINCT FROM 'game_mig_result_differs' THEN
      RAISE EXCEPTION 'C2: an altered result must be refused: %', v;
    END IF;
  END LOOP;
  IF (SELECT count(*) FROM public.game_migration_audit WHERE user_id = c_m AND action = 'reconciliation_refused' AND actor = 'mallory') <> 10
     OR EXISTS (SELECT 1 FROM public.game_reconciliations WHERE user_id = c_m) THEN
    RAISE EXCEPTION 'C3: ten refusals logged, no reconciliation saved';
  END IF;
  e := pg_temp.err(format('SELECT public.game_mig_save_reconciliation(%L, %L, %L)', c_m, r, ' '));
  IF e NOT LIKE '%game_mig_actor_required%' THEN RAISE EXCEPTION 'C4: an author always: %', e; END IF;
  -- the exact result: saved — the database's own, with its md5
  v := public.game_mig_save_reconciliation(c_m, r, 'owner');
  v_id := (v ->> 'id')::BIGINT;
  IF NOT (v ->> 'saved')::boolean OR (SELECT result FROM public.game_reconciliations WHERE id = v_id) <> r
     OR (SELECT result_md5 FROM public.game_reconciliations WHERE id = v_id) <> md5(r::text) THEN
    RAISE EXCEPTION 'R1: the database''s result saved: %', v;
  END IF;
  IF (SELECT count(*) FROM public.game_legacy_reviews WHERE user_id = c_m AND status = 'pending_review') <> 2 THEN RAISE EXCEPTION 'R5: one review per accepted snapshot'; END IF;
  -- not ready: the window is open (7 days), then undecided remainders
  e := pg_temp.err(format('SELECT public.game_mig_activate(%L, %s, %L, NULL)', c_m, v_id, 'owner'));
  IF e NOT LIKE '%game_mig_window_open%' THEN RAISE EXCEPTION 'R6a: activation waits for the window: %', e; END IF;
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
  IF (SELECT count(*) FROM public.game_migration_audit WHERE user_id = c_m AND action = 'legacy_decided') <> 2 THEN RAISE EXCEPTION 'R12: every decision audited'; END IF;
END $$;
RESET ROLE;

--------------------------------------------------------------------------------
-- 3b. The window: extended only later, while open, with a reason (audited); the tool's role cannot write it
--------------------------------------------------------------------------------
SET LOCAL ROLE game_migration_admin;
DO $$
DECLARE
  c_m CONSTANT UUID := '00000000-0000-0000-0000-00000019a001';
  v_was TIMESTAMPTZ := public.game_mig_window_closes_at('00000000-0000-0000-0000-00000019a001');
  e TEXT;
BEGIN
  e := pg_temp.err(format('SELECT public.game_mig_extend_window(%L, %L, %L, %L)', c_m, v_was - interval '1 day', 'owner', 'shorter'));
  IF e NOT LIKE '%game_mig_window_not_later%' THEN RAISE EXCEPTION 'W2: never shortened: %', e; END IF;
  e := pg_temp.err(format('SELECT public.game_mig_extend_window(%L, %L, %L, %L)', c_m, v_was + interval '3 days', 'owner', ''));
  IF e NOT LIKE '%game_mig_reason_required%' THEN RAISE EXCEPTION 'W3: an extension needs a reason: %', e; END IF;
  PERFORM public.game_mig_extend_window(c_m, v_was + interval '3 days', 'owner', 'the user is travelling until Friday');
  IF public.game_mig_window_closes_at(c_m) <> v_was + interval '3 days'
     OR NOT EXISTS (SELECT 1 FROM public.game_migration_audit WHERE user_id = c_m AND action = 'window_extended'
                    AND details ->> 'reason' = 'the user is travelling until Friday') THEN
    RAISE EXCEPTION 'W4: the extension is applied and audited';
  END IF;
END $$;
RESET ROLE;

--------------------------------------------------------------------------------
-- 4. A snapshot after the reconciliation; the window closes; the activation computes again
--------------------------------------------------------------------------------
DO $$
DECLARE
  c_m CONSTANT UUID := '00000000-0000-0000-0000-00000019a001';
  v_old BIGINT := (SELECT id FROM public.game_reconciliations WHERE user_id = c_m AND status = 'draft');
  v JSONB;
  e TEXT;
BEGIN
  -- device D in the window, after the reconciliation was saved
  PERFORM pg_temp.imp(c_m, '10000000-0000-0000-0000-00000000000d', '20000000-0000-0000-0000-00000000000d', '{"level":1,"xp":10,"coins":0}');
  -- the 7 days pass; extending a closed window is refused (no gap where devices would be late)
  PERFORM pg_temp.close_window(c_m);
  SET LOCAL ROLE game_migration_admin;
  e := pg_temp.err(format('SELECT public.game_mig_extend_window(%L, %L, %L, %L)', c_m, now() + interval '1 day', 'owner', 'late'));
  RESET ROLE;
  IF e NOT LIKE '%game_mig_window_closed%' THEN RAISE EXCEPTION 'W5: a closed window stays closed: %', e; END IF;
  -- a device after the window closed: kept apart (late) — closing the intake deletes and credits nothing
  v := pg_temp.imp(c_m, '10000000-0000-0000-0000-0000000000f0', '20000000-0000-0000-0000-0000000000f0', '{"level":7,"xp":0,"coins":900}');
  IF v ->> 'status' <> 'late' OR (SELECT state FROM public.game_accounts WHERE user_id = c_m) <> 'migration_pending' THEN
    RAISE EXCEPTION 'W6: after the window: late, kept; the account is not activated automatically: %', v;
  END IF;
  -- the old draft no longer matches the database's computation (device D): refused, logged, nothing credited
  SET LOCAL ROLE game_migration_admin;
  PERFORM public.game_mig_decide_legacy(c_m, '10000000-0000-0000-0000-00000000000b', 'rejected', NULL, NULL, 'owner', 'same progress as device A');
  v := public.game_mig_activate(c_m, v_old, 'owner', 'ack');
  RESET ROLE;
  IF v ->> 'refused' <> 'game_mig_result_changed' OR (SELECT state FROM public.game_accounts WHERE user_id = c_m) <> 'migration_pending'
     OR EXISTS (SELECT 1 FROM public.game_ledger WHERE user_id = c_m)
     OR NOT EXISTS (SELECT 1 FROM public.game_migration_audit WHERE user_id = c_m AND action = 'activation_refused') THEN
    RAISE EXCEPTION 'R13: a device after the reconciliation invalidates it at activation: %', v;
  END IF;
END $$;
SET LOCAL ROLE game_migration_admin;
DO $$
DECLARE
  c_m CONSTANT UUID := '00000000-0000-0000-0000-00000019a001';
  v_id BIGINT;
  v JSONB;
  e TEXT;
BEGIN
  v_id := (public.game_mig_save_reconciliation(c_m, public.game_mig_reconcile(c_m), 'owner') ->> 'id')::BIGINT;
  IF (SELECT count(*) FROM public.game_reconciliations WHERE user_id = c_m AND status = 'superseded') <> 1 THEN RAISE EXCEPTION 'R14: the old draft superseded'; END IF;
  -- unchanged candidates keep their decisions; the new snapshot waits for one
  IF (SELECT status FROM public.game_legacy_reviews WHERE snapshot_id = '10000000-0000-0000-0000-00000000000a') <> 'accepted' THEN RAISE EXCEPTION 'R15: a decision survives an unchanged candidate'; END IF;
  e := pg_temp.err(format('SELECT public.game_mig_activate(%L, %s, %L, NULL)', c_m, v_id, 'owner'));
  IF e NOT LIKE '%game_mig_unresolved%' THEN RAISE EXCEPTION 'R11: an undecided remainder blocks the activation: %', e; END IF;
  PERFORM public.game_mig_decide_legacy(c_m, '10000000-0000-0000-0000-00000000000d', 'rejected', NULL, NULL, 'owner', 'a fresh install, nothing of its own');
  -- the proposal: 40 proven + 290 accepted = 330 XP → level 3 (equal to the original: no acknowledgement); 10 + 100 Coins
  v := public.game_mig_activate(c_m, v_id, 'owner', NULL);
  IF v ->> 'state' <> 'cloud_active' OR (v ->> 'xp')::int <> 330 OR (v ->> 'coins')::int <> 110 OR (v ->> 'level')::int <> 3
     OR (v ->> 'achievements_transferred')::boolean THEN
    RAISE EXCEPTION 'R16: activation (achievements not transferred before Q4.6): %', v;
  END IF;
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
  IF (SELECT count(*) FROM public.game_ledger WHERE user_id = c_m) <> 2
     OR (SELECT sum(xp) FROM public.game_ledger WHERE user_id = c_m) <> 330
     OR NOT EXISTS (SELECT 1 FROM public.game_ledger WHERE user_id = c_m AND idempotency_key = 'legacy:' || c_m::text AND xp = 290 AND coins = 100)
     OR NOT EXISTS (SELECT 1 FROM public.game_ledger WHERE user_id = c_m AND idempotency_key = 'import:quest:2026-11-01:q_bias'
                    AND evidence -> 0 ->> 'result_md5' = (SELECT result_md5 FROM public.game_reconciliations WHERE user_id = c_m AND status = 'activated')) THEN
    RAISE EXCEPTION 'R18: the ledger holds the proven event (with the result it came from) and the one accepted remainder';
  END IF;
  IF (SELECT xp_total FROM public.game_profile WHERE user_id = c_m) <> 330 OR (SELECT coins FROM public.game_profile WHERE user_id = c_m) <> 110 THEN
    RAISE EXCEPTION 'R19: the projection is rebuilt from the ledger';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.game_migration_audit WHERE user_id = c_m AND action = 'activated' AND actor = 'owner' AND db_user = session_user
                 AND details ->> 'achievements_transferred' = 'false') THEN
    RAISE EXCEPTION 'R20: the activation is audited (with the database login; achievements not yet transferred)';
  END IF;
  IF pg_temp.err($q$UPDATE public.game_migration_audit SET actor = 'x'$q$) <> 'game_ledger_append_only'
     OR pg_temp.err($q$SET LOCAL ROLE game_economy_owner; UPDATE public.game_migration_audit SET actor = 'x'$q$) <> 'game_ledger_append_only' THEN
    RAISE EXCEPTION 'A10: the audit is never changed, not even by the owner';
  END IF;
  RESET ROLE;
  -- after activation: a device that comes late is kept as late, never reconciled or credited
  v := pg_temp.imp(c_m, '10000000-0000-0000-0000-00000000000e', '20000000-0000-0000-0000-00000000000e', '{"level":5,"xp":0,"coins":500}');
  IF v ->> 'status' <> 'late' OR (SELECT sum(xp) FROM public.game_ledger WHERE user_id = c_m) <> 330 THEN RAISE EXCEPTION 'R21: a late snapshot is kept, nothing credited: %', v; END IF;
  -- and the original snapshots are all still there (A, A again, B, D, the late one in the closed window, E)
  IF (SELECT count(*) FROM public.game_imports WHERE user_id = c_m) <> 6 THEN RAISE EXCEPTION 'R22: nothing deleted'; END IF;
END $$;

--------------------------------------------------------------------------------
-- 5. No way around the reconciliation; never an empty one; a lower level only with an acknowledgement; isolation
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
  -- even with the marker set by hand: a snapshot needs an activating reconciliation
  PERFORM set_config('ayra.mig_activation', c_p::text, TRUE);
  e := pg_temp.err(format('SELECT public.game_economy_transition(%L, %L, %L)', c_p, 'migration_pending', 'cloud_active'));
  PERFORM set_config('ayra.mig_activation', '', TRUE);
  IF e NOT LIKE '%game_mig_activation_required%' THEN RAISE EXCEPTION 'R23b: the marker alone never activates an account with a snapshot: %', e; END IF;
  -- another account's snapshot ids are its own: the same id is another row, not a conflict
  PERFORM public.game_economy_transition(c_o, 'local', 'migration_pending');
  IF (pg_temp.imp(c_o, '10000000-0000-0000-0000-0000000000f1', '20000000-0000-0000-0000-0000000000f1', '{"level":1}')) ->> 'status' <> 'accepted'
     OR (SELECT content ->> 'level' FROM public.game_imports WHERE user_id = c_p) <> '4' THEN
    RAISE EXCEPTION 'R24: accounts are isolated';
  END IF;
  -- the reconciliation of one account reads only its own snapshots
  IF public.game_mig_reconcile(c_o) -> 'inputs' <> to_jsonb(public.game_mig_inputs(c_o)) OR jsonb_array_length(public.game_mig_reconcile(c_o) -> 'legacy') <> 1 THEN
    RAISE EXCEPTION 'R24b: a reconciliation never mixes accounts';
  END IF;
  PERFORM pg_temp.close_window(c_p);
END $$;
SET LOCAL ROLE game_migration_admin;
DO $$
DECLARE
  c_p CONSTANT UUID := '00000000-0000-0000-0000-00000019a004';
  c_n CONSTANT UUID := '00000000-0000-0000-0000-00000019a002';
  v_id BIGINT;
  e TEXT;
BEGIN
  v_id := (public.game_mig_save_reconciliation(c_p, public.game_mig_reconcile(c_p), 'owner') ->> 'id')::BIGINT;
  PERFORM public.game_mig_decide_legacy(c_p, '10000000-0000-0000-0000-0000000000f1', 'rejected', NULL, NULL, 'owner', 'no evidence');
  e := pg_temp.err(format('SELECT public.game_mig_activate(%L, %s, %L, NULL)', c_p, v_id, 'owner'));
  IF e NOT LIKE '%game_mig_level_gap%' THEN RAISE EXCEPTION 'R25: never a hidden level decrease: %', e; END IF;
  IF (SELECT state FROM public.game_accounts WHERE user_id = c_p) <> 'migration_pending' THEN RAISE EXCEPTION 'R26: a refused activation leaves the account pending'; END IF;
  -- a time zone changed since the save: the activation computes again and refuses (days may differ)
  RESET ROLE;
  UPDATE public.profiles SET timezone = 'Asia/Tokyo' WHERE id = c_p;
  SET LOCAL ROLE game_migration_admin;
  IF public.game_mig_activate(c_p, v_id, 'owner', 'level 4 not proven; the user agreed') ->> 'refused' <> 'game_mig_result_changed' THEN
    RAISE EXCEPTION 'R27: a changed time zone invalidates the saved reconciliation';
  END IF;
  -- an account without any accepted snapshot: an empty reconciliation is never a transfer
  e := pg_temp.err(format('SELECT public.game_mig_save_reconciliation(%L, public.game_mig_reconcile(%L), %L)', c_n, c_n, 'owner'));
  IF e NOT LIKE '%game_mig_not_pending%' THEN RAISE EXCEPTION 'R28a: a local account has no reconciliation: %', e; END IF;
END $$;
RESET ROLE;

--------------------------------------------------------------------------------
-- 6. The daily Coins cap over ALL devices (owner review 2026-11-23): 70 + 70 Coins of different events on one day
--------------------------------------------------------------------------------
DO $$
DECLARE
  c_q CONSTANT UUID := '00000000-0000-0000-0000-00000019a005';
  r JSONB;
  v_day BIGINT;
  v_cut BIGINT;
BEGIN
  PERFORM public.game_economy_transition(c_q, 'local', 'migration_pending');
  PERFORM pg_temp.imp(c_q, '10000000-0000-0000-0000-0000000005a1', '20000000-0000-0000-0000-0000000005a1', jsonb_build_object('level', 3, 'xp', 0, 'coins', 70,
    'history', (SELECT jsonb_agg(jsonb_build_object('questId', 'qa_' || n, 'xp', 40, 'coins', 10, 'completedAt', '2026-11-03')) FROM generate_series(0, 6) n)));
  PERFORM pg_temp.imp(c_q, '10000000-0000-0000-0000-0000000005b1', '20000000-0000-0000-0000-0000000005b1', jsonb_build_object('level', 3, 'xp', 40, 'coins', 110,
    'history', (SELECT jsonb_agg(jsonb_build_object('questId', 'qb_' || n, 'xp', 40, 'coins', 10, 'completedAt', '2026-11-03')) FROM generate_series(0, 6) n)
      || (SELECT jsonb_agg(jsonb_build_object('questId', 'qold_' || n, 'xp', 10, 'coins', 10, 'completedAt', '2026-10-20')) FROM generate_series(0, 1) n),
    'firstActions', jsonb_build_object('trade', '2026-11-03T08:00:00.000Z'),
    'coinLog', jsonb_build_array(jsonb_build_object('at', '2026-11-03T08:00:00.000Z', 'source', 'firstAction', 'amount', 20, 'kind', 'trade'))));
  r := public.game_mig_reconcile(c_q);
  SELECT sum((e ->> 'coins')::BIGINT) INTO v_day FROM jsonb_array_elements(r -> 'events') e WHERE e ->> 'day' = '2026-11-03' AND e ->> 'kind' IN ('quest', 'daily');
  SELECT sum((c ->> 'coins')::BIGINT) INTO v_cut FROM jsonb_array_elements(r -> 'conflicts') c WHERE c ->> 'code' = 'daily_coin_cap';
  IF jsonb_array_length(r -> 'events') <> 17 OR v_day <> 100 OR v_cut <> 40 THEN
    RAISE EXCEPTION 'Q1: one cap for the account: 140 Coins of 14 different quests → 100 (40 a conflict); got % / % / %', jsonb_array_length(r -> 'events'), v_day, v_cut;
  END IF;
  -- the highest keys of the day are cut, whatever the order of the snapshots; first actions and earlier days untouched
  IF (SELECT jsonb_agg(c ->> 'subject' ORDER BY c ->> 'subject') FROM jsonb_array_elements(r -> 'conflicts') c WHERE c ->> 'code' = 'daily_coin_cap')
       <> '["quest:2026-11-03:qb_3","quest:2026-11-03:qb_4","quest:2026-11-03:qb_5","quest:2026-11-03:qb_6"]'::jsonb
     OR (SELECT (e ->> 'coins')::int FROM jsonb_array_elements(r -> 'events') e WHERE e ->> 'key' = 'first:trade') <> 20
     OR (SELECT sum((e ->> 'coins')::int) FROM jsonb_array_elements(r -> 'events') e WHERE e ->> 'day' = '2026-10-20') <> 20 THEN
    RAISE EXCEPTION 'Q2: the cut is fixed and only where the cap applied: %', r -> 'conflicts';
  END IF;
  -- the cut 40 is in device B's candidate (a reviewer may look at it); never credited by itself
  IF (r -> 'proposed' ->> 'confirmedCoins')::int <> 100 + 20 + 20
     OR (SELECT jsonb_agg(l -> 'candidate' -> 'coins' ORDER BY l ->> 'snapshotId') FROM jsonb_array_elements(r -> 'legacy') l) <> '[0, 40]'::jsonb THEN
    RAISE EXCEPTION 'Q3: proposed Coins 140 (100 capped + 20 first action + 20 before the cap); B''s candidate 40: %', r -> 'legacy';
  END IF;
END $$;

--------------------------------------------------------------------------------
-- 7. A genuinely new account: its own path, never a transfer, never around the checks
--------------------------------------------------------------------------------
DO $$
DECLARE
  c_r CONSTANT UUID := '00000000-0000-0000-0000-00000019a006';
  c_p CONSTANT UUID := '00000000-0000-0000-0000-00000019a004';
  c_q CONSTANT UUID := '00000000-0000-0000-0000-00000019a005';
  e TEXT;
  v JSONB;
BEGIN
  PERFORM public.game_economy_transition(c_r, 'local', 'migration_pending');
  -- the bare transition (the database owner's direct call) is refused even without a snapshot
  e := pg_temp.err(format('SELECT public.game_economy_transition(%L, %L, %L)', c_r, 'migration_pending', 'cloud_active'));
  IF e NOT LIKE '%game_mig_activation_required%' THEN RAISE EXCEPTION 'N1: no activation outside the two paths: %', e; END IF;
  SET LOCAL ROLE game_migration_admin;
  -- no snapshot: an empty reconciliation is never a transfer
  e := pg_temp.err(format('SELECT public.game_mig_save_reconciliation(%L, public.game_mig_reconcile(%L), %L)', c_r, c_r, 'owner'));
  IF e NOT LIKE '%game_mig_no_snapshots%' THEN RAISE EXCEPTION 'R28: an empty reconciliation is refused: %', e; END IF;
  e := pg_temp.err(format('SELECT public.game_mig_activate_new(%L, %L, %L)', c_r, 'owner', 'new'));
  IF e NOT LIKE '%game_mig_window_open%' THEN RAISE EXCEPTION 'N2: a new account waits for its window too: %', e; END IF;
  e := pg_temp.err(format('SELECT public.game_mig_activate_new(%L, %L, %L)', c_r, 'owner', ' '));
  IF e NOT LIKE '%game_mig_reason_required%' THEN RAISE EXCEPTION 'N3: always a reason: %', e; END IF;
  e := pg_temp.err(format('SELECT public.game_mig_activate_new(%L, %L, %L)', c_p, 'owner', 'new'));
  IF e NOT LIKE '%game_mig_has_snapshots%' THEN RAISE EXCEPTION 'N4: an account with a snapshot is a transfer, never «new»: %', e; END IF;
  RESET ROLE;
  PERFORM pg_temp.close_window(c_r);
  PERFORM pg_temp.close_window(c_q);
  SET LOCAL ROLE game_migration_admin;
  v := public.game_mig_activate_new(c_r, 'owner', 'signed up during the window, never played');
  IF v ->> 'state' <> 'cloud_active' OR NOT (v ->> 'new_account')::boolean
     OR (SELECT xp_total + coins FROM public.game_profile WHERE user_id = c_r) <> 0
     OR NOT EXISTS (SELECT 1 FROM public.game_migration_audit WHERE user_id = c_r AND action = 'activated_new_account' AND details ->> 'reason' = 'signed up during the window, never played') THEN
    RAISE EXCEPTION 'N5: a new account starts at zero, audited as new: %', v;
  END IF;
  IF NOT (public.game_mig_activate_new(c_r, 'owner', 'again') ->> 'replay')::boolean THEN RAISE EXCEPTION 'N6: a second click is a replay'; END IF;
  RESET ROLE;
END $$;
-- a Journal history without a snapshot: never zeroed as «new» — the account waits (pending)
INSERT INTO auth.users (id, email) VALUES ('00000000-0000-0000-0000-00000019a007', 'mig-s@example.com');
INSERT INTO public.journal_notes (user_id, id, data, client_updated_at) VALUES
  ('00000000-0000-0000-0000-00000019a007', 'n1', '{"id":"n1","createdAt":"2026-11-01T10:00:00Z"}', now());
DO $$
DECLARE
  c_s CONSTANT UUID := '00000000-0000-0000-0000-00000019a007';
  e TEXT;
BEGIN
  PERFORM public.game_economy_transition(c_s, 'local', 'migration_pending');
  PERFORM pg_temp.close_window(c_s);
  SET LOCAL ROLE game_migration_admin;
  e := pg_temp.err(format('SELECT public.game_mig_activate_new(%L, %L, %L)', c_s, 'owner', 'no snapshot came'));
  RESET ROLE;
  IF e NOT LIKE '%game_mig_has_history%' OR (SELECT state FROM public.game_accounts WHERE user_id = c_s) <> 'migration_pending' THEN
    RAISE EXCEPTION 'N7: a history without a snapshot keeps waiting: %', e;
  END IF;
END $$;

ROLLBACK;
