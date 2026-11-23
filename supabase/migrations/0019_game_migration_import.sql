-- AYRA Trading — 0019: safe transfer of device progress (Q4.5-4, docs/q4-5-4-migration-provenance-audit.md).
-- NOT APPLIED TO PRODUCTION. Owner decision 2026-11-23: V2 (an unproven legacy remainder kept apart, reviewed, never
-- credited automatically) + V3 (cloud Journal records as evidence only).
--
--   * game_imports — every device snapshot as it came (quarantine): account, install, snapshot id, schema, content and
--     its md5, server time of receipt, the session it came with, the account state then, a status:
--       accepted          — in the window (migration_pending), the first one of its install: enters the reconciliation;
--       duplicate_install — a further snapshot of an install that already gave one: kept, never reconciled by itself;
--       late              — after the account was activated: kept for review, never reconciled or credited.
--     The same snapshot id with the same content is a replay; with another content it is refused. Nothing is deleted.
--   * game_reconciliations — the result computed by the owner's tool (lib/migration/reconcile.ts) for exactly the
--     accepted snapshots of the moment (their ids and md5s), as a draft; one is activated.
--   * game_legacy_reviews — per accepted snapshot, its unproven remainder (candidate, original totals, confirmed part,
--     reasons) and a review status: pending_review / accepted / rejected / needs_evidence. At most ONE accepted per
--     account (the same remainder can never be credited twice under another snapshot); an accepted amount never above
--     its candidate.
--   * game_migration_audit — every owner action: who, what, why, before and after. Append only.
--   * Activation (game_mig_activate) — one transaction: the state is migration_pending; the reconciliation is the
--     latest draft for exactly the snapshots accepted now; no remainder is undecided; a level below the original only
--     with an explicit acknowledgement; then the proven events and the accepted remainder go to the ledger (idempotent
--     keys), the account becomes cloud_active, the projection is rebuilt, and the action is audited. Nothing else can
--     make an account WITH snapshots cloud_active (game_economy_transition requires this activation then).
--
-- Who may do what (least privilege):
--   * the app's server route (service_role): only game_import_snapshot — for the session's own account, with a fresh
--     session (0018 game_session_check), atomic and idempotent;
--   * the owner's tool: a NEW NOLOGIN role game_migration_admin (members: only the role applying the migration —
--     the owner runs it from the SQL editor or psql with SET ROLE); no API role is a member; there is NO public admin API;
--   * clients: nothing here at all.
--
-- Idempotent: safe to run twice.

BEGIN;

GRANT CREATE ON SCHEMA public TO game_economy_owner;

--------------------------------------------------------------------------------
-- 0. The owner's migration role (no login; members: only the migration runner)
--------------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'game_migration_admin') THEN
    CREATE ROLE game_migration_admin NOLOGIN NOINHERIT;
  END IF;
END $$;
-- by NAME: on Supabase «GRANT … TO CURRENT_USER» crashes the server process (Q4.5-2, migration test S)
DO $$ BEGIN EXECUTE format('GRANT game_migration_admin TO %I', current_user); END $$;
GRANT USAGE ON SCHEMA public TO game_migration_admin;

--------------------------------------------------------------------------------
-- 1. Award kinds and rules of the transfer (used only by the activation; game_apply_reward refuses them)
--------------------------------------------------------------------------------
ALTER TABLE public.game_award_kinds DROP CONSTRAINT IF EXISTS game_award_kinds_kind_check;
ALTER TABLE public.game_award_kinds ADD CONSTRAINT game_award_kinds_kind_check CHECK (kind IN ('mission', 'self_report', 'daily_reward',
  'first_action', 'journal_xp', 'personal_quest', 'achievement', 'migration_import', 'migration_legacy'));
SET LOCAL ROLE game_economy_owner;
INSERT INTO public.game_award_kinds (kind, needs) VALUES
  ('migration_import', 'Q4.5-4 activation only: a proven event of a device snapshot (never through game_apply_reward)'),
  ('migration_legacy', 'Q4.5-4 activation only: an unproven remainder accepted by the owner (never automatic)')
ON CONFLICT (kind) DO NOTHING;
INSERT INTO public.game_reward_rules (code, kind, xp, coins, rules_version) VALUES
  ('migration_import', 'migration_import', 0, 0, 'q4.5-4'),
  ('migration_legacy', 'migration_legacy', 0, 0, 'q4.5-4')
ON CONFLICT (code) DO NOTHING;
RESET ROLE;

--------------------------------------------------------------------------------
-- 2. Tables (owner's; written only by the functions below)
--------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.game_imports (
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  snapshot_id UUID NOT NULL,
  install_id UUID NOT NULL,
  schema_version INTEGER NOT NULL CHECK (schema_version = 1),
  content JSONB NOT NULL CHECK (jsonb_typeof(content) = 'object'),
  content_md5 TEXT NOT NULL CHECK (content_md5 ~ '^[0-9a-f]{32}$'),
  byte_size INTEGER NOT NULL CHECK (byte_size > 0),
  status TEXT NOT NULL CHECK (status IN ('accepted', 'duplicate_install', 'late')),
  account_state TEXT NOT NULL,
  session_id UUID,
  token_iat BIGINT,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, snapshot_id)
);
-- one accepted snapshot per install (a second one is kept as duplicate_install)
CREATE UNIQUE INDEX IF NOT EXISTS game_imports_one_per_install ON public.game_imports (user_id, install_id) WHERE status = 'accepted';

CREATE TABLE IF NOT EXISTS public.game_reconciliations (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  inputs TEXT[] NOT NULL,
  result JSONB NOT NULL CHECK (jsonb_typeof(result) = 'object'),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'superseded', 'activating', 'activated')),
  created_by TEXT NOT NULL CHECK (length(btrim(created_by)) > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  activated_by TEXT,
  activated_at TIMESTAMPTZ,
  level_gap_ack TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS game_reconciliations_one_open ON public.game_reconciliations (user_id) WHERE status IN ('draft', 'activating');

CREATE TABLE IF NOT EXISTS public.game_legacy_reviews (
  user_id UUID NOT NULL,
  snapshot_id UUID NOT NULL,
  candidate_xp INTEGER NOT NULL CHECK (candidate_xp >= 0),
  candidate_coins INTEGER NOT NULL CHECK (candidate_coins >= 0),
  original JSONB NOT NULL,
  confirmed JSONB NOT NULL,
  reasons JSONB NOT NULL CHECK (jsonb_typeof(reasons) = 'array'),
  status TEXT NOT NULL DEFAULT 'pending_review' CHECK (status IN ('pending_review', 'accepted', 'rejected', 'needs_evidence')),
  accepted_xp INTEGER CHECK (accepted_xp IS NULL OR accepted_xp BETWEEN 0 AND candidate_xp),
  accepted_coins INTEGER CHECK (accepted_coins IS NULL OR accepted_coins BETWEEN 0 AND candidate_coins),
  decided_by TEXT,
  decided_at TIMESTAMPTZ,
  reason TEXT,
  PRIMARY KEY (user_id, snapshot_id),
  FOREIGN KEY (user_id, snapshot_id) REFERENCES public.game_imports (user_id, snapshot_id) ON DELETE CASCADE,
  CHECK ((status = 'accepted') = (accepted_xp IS NOT NULL AND accepted_coins IS NOT NULL))
);
-- the same remainder can never be credited twice under another snapshot: one accepted per account
CREATE UNIQUE INDEX IF NOT EXISTS game_legacy_one_accepted ON public.game_legacy_reviews (user_id) WHERE status = 'accepted';

CREATE TABLE IF NOT EXISTS public.game_migration_audit (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  at TIMESTAMPTZ NOT NULL DEFAULT now(),
  actor TEXT NOT NULL CHECK (length(btrim(actor)) > 0),
  -- the database login that ran it (session_user, set by the server — the actor above is what the person typed)
  db_user TEXT NOT NULL DEFAULT session_user,
  action TEXT NOT NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  details JSONB NOT NULL DEFAULT '{}'::jsonb
);

ALTER TABLE public.game_imports OWNER TO game_economy_owner;
ALTER TABLE public.game_reconciliations OWNER TO game_economy_owner;
ALTER TABLE public.game_legacy_reviews OWNER TO game_economy_owner;
ALTER TABLE public.game_migration_audit OWNER TO game_economy_owner;

-- written only as the owner (inside the functions, or the account deletion cascade); the audit is never changed
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['game_imports', 'game_reconciliations', 'game_legacy_reviews', 'game_migration_audit'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS tr_%s_owner_only ON public.%I', t, t);
    EXECUTE format('CREATE TRIGGER tr_%s_owner_only BEFORE INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.game_owner_only()', t, t);
  END LOOP;
END $$;
DROP TRIGGER IF EXISTS tr_game_migration_audit_no_update ON public.game_migration_audit;
CREATE TRIGGER tr_game_migration_audit_no_update BEFORE UPDATE ON public.game_migration_audit
  FOR EACH ROW EXECUTE FUNCTION public.game_ledger_no_update();
-- an imported snapshot's content and identity never change (only nothing: a snapshot is written once)
CREATE OR REPLACE FUNCTION public.game_import_immutable()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'game_import_immutable' USING ERRCODE = '42501';
END;
$$ LANGUAGE plpgsql SET search_path = public;
DROP TRIGGER IF EXISTS tr_game_imports_no_update ON public.game_imports;
CREATE TRIGGER tr_game_imports_no_update BEFORE UPDATE ON public.game_imports FOR EACH ROW EXECUTE FUNCTION public.game_import_immutable();

--------------------------------------------------------------------------------
-- 3. Receiving a snapshot (the app's server route; the session's own account only)
--------------------------------------------------------------------------------
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
  v_status := CASE WHEN v_state = 'cloud_active' THEN 'late' ELSE 'accepted' END;
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

--------------------------------------------------------------------------------
-- 4. The owner's tool (game_migration_admin only)
--------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.game_mig_audit(p_actor TEXT, p_action TEXT, p_user UUID, p_details JSONB)
RETURNS VOID AS $$
BEGIN
  IF p_actor IS NULL OR length(btrim(p_actor)) = 0 THEN
    RAISE EXCEPTION 'game_mig_actor_required' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.game_migration_audit (actor, action, user_id, details) VALUES (p_actor, p_action, p_user, COALESCE(p_details, '{}'::jsonb));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

/** The accepted snapshots of an account now: «snapshot_id:md5», sorted — what a reconciliation must be for. */
CREATE OR REPLACE FUNCTION public.game_mig_inputs(p_user UUID)
RETURNS TEXT[] AS $$
  SELECT COALESCE(array_agg(snapshot_id::text || ':' || content_md5 ORDER BY snapshot_id::text), '{}')
  FROM public.game_imports WHERE user_id = p_user AND status = 'accepted';
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

-- The account's time zone (its game days; the reconciliation reads daily rewards in it)
CREATE OR REPLACE FUNCTION public.game_mig_timezone(p_user UUID)
RETURNS TEXT AS $$
  SELECT timezone FROM public.profiles WHERE id = p_user;
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

-- V3 (evidence only): how many cloud Journal records the account has per day, by the record's own creation time in the
-- account's zone. Imported records are counted apart (an import never earned anything). A record's existence proves no
-- reward and its time proves no reward time — the reviewer sees these counts next to a candidate; no number changes.
CREATE OR REPLACE FUNCTION public.game_mig_journal_days(p_user UUID, p_tz TEXT)
RETURNS JSONB AS $$
  WITH rows AS (
    SELECT 'trades' AS t, data FROM public.journal_trades WHERE user_id = p_user AND deleted_at IS NULL
    UNION ALL SELECT 'notes', data FROM public.journal_notes WHERE user_id = p_user AND deleted_at IS NULL
    UNION ALL SELECT 'noTrades', data FROM public.journal_no_trades WHERE user_id = p_user AND deleted_at IS NULL
    UNION ALL SELECT 'dayPlans', data FROM public.journal_day_plans WHERE user_id = p_user AND deleted_at IS NULL
  ), dated AS (
    SELECT CASE WHEN data ? 'importBatchId' THEN 'imported' ELSE t END AS t,
           to_char((data ->> 'createdAt')::timestamptz AT TIME ZONE p_tz, 'YYYY-MM-DD') AS day
    FROM rows WHERE (data ->> 'createdAt') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T'
  ), per AS (SELECT day, t, count(*) AS n FROM dated GROUP BY day, t)
  SELECT COALESCE(jsonb_object_agg(day, counts), '{}'::jsonb)
  FROM (SELECT day, jsonb_object_agg(t, n) AS counts FROM per GROUP BY day) d;
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

-- Announce or start the transfer (never activation: that is game_mig_activate)
CREATE OR REPLACE FUNCTION public.game_mig_transition(p_user UUID, p_from TEXT, p_to TEXT, p_actor TEXT, p_reason TEXT)
RETURNS JSONB AS $$
DECLARE
  v JSONB;
BEGIN
  IF p_to NOT IN ('migration_scheduled', 'migration_pending') THEN
    RAISE EXCEPTION 'game_mig_activation_required' USING ERRCODE = '42501';
  END IF;
  IF p_reason IS NULL OR length(btrim(p_reason)) = 0 THEN
    RAISE EXCEPTION 'game_mig_reason_required' USING ERRCODE = '22023';
  END IF;
  v := public.game_economy_transition(p_user, p_from, p_to);
  PERFORM public.game_mig_audit(p_actor, 'transition', p_user, jsonb_build_object('from', p_from, 'to', p_to, 'changed', v -> 'changed', 'reason', p_reason));
  RETURN v;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Save the tool's reconciliation as the draft for exactly the snapshots accepted now; refresh the legacy reviews
CREATE OR REPLACE FUNCTION public.game_mig_save_reconciliation(p_user UUID, p_result JSONB, p_actor TEXT)
RETURNS BIGINT AS $$
DECLARE
  v_state TEXT;
  v_inputs TEXT[];
  v_given TEXT[];
  v_id BIGINT;
  e JSONB;
  l JSONB;
  v_keys TEXT[] := '{}';
  v_old public.game_legacy_reviews%ROWTYPE;
BEGIN
  SELECT state INTO v_state FROM public.game_accounts WHERE user_id = p_user FOR UPDATE;
  IF v_state IS DISTINCT FROM 'migration_pending' THEN
    RAISE EXCEPTION 'game_mig_not_pending' USING ERRCODE = '22023';
  END IF;
  v_inputs := public.game_mig_inputs(p_user);
  SELECT COALESCE(array_agg(x ORDER BY x), '{}') INTO v_given FROM jsonb_array_elements_text(COALESCE(p_result -> 'inputs', '[]')) x;
  IF v_given IS DISTINCT FROM v_inputs OR cardinality(v_inputs) = 0 THEN
    RAISE EXCEPTION 'game_mig_inputs_changed' USING ERRCODE = '40001';
  END IF;
  -- the events: canonical keys, once each, amounts within any rule
  FOR e IN SELECT * FROM jsonb_array_elements(COALESCE(p_result -> 'events', '[]')) LOOP
    IF NOT (e ->> 'key' ~ '^(quest:\d{4}-\d{2}-\d{2}:[A-Za-z0-9_.-]{1,80}|first:[A-Za-z]{1,32}|pq:[A-Za-z0-9_.-]{1,80}|daily:\d{4}-\d{2}-\d{2})$')
       OR NOT (e ->> 'day' ~ '^\d{4}-\d{2}-\d{2}$')
       OR jsonb_typeof(e -> 'xp') <> 'number' OR jsonb_typeof(e -> 'coins') <> 'number'
       OR (e ->> 'xp')::numeric NOT BETWEEN 0 AND 1000 OR (e ->> 'coins')::numeric NOT BETWEEN 0 AND 100
       OR (e ->> 'key') = ANY (v_keys) THEN
      RAISE EXCEPTION 'game_mig_bad_result' USING ERRCODE = '22023', DETAIL = left(e::text, 200);
    END IF;
    v_keys := v_keys || (e ->> 'key');
  END LOOP;
  UPDATE public.game_reconciliations SET status = 'superseded' WHERE user_id = p_user AND status = 'draft';
  INSERT INTO public.game_reconciliations (user_id, inputs, result, created_by) VALUES (p_user, v_inputs, p_result, p_actor) RETURNING id INTO v_id;
  -- legacy reviews: one per accepted snapshot; a changed candidate goes back to review
  FOR l IN SELECT * FROM jsonb_array_elements(COALESCE(p_result -> 'legacy', '[]')) LOOP
    IF NOT EXISTS (SELECT 1 FROM public.game_imports WHERE user_id = p_user AND snapshot_id = (l ->> 'snapshotId')::UUID AND status = 'accepted') THEN
      RAISE EXCEPTION 'game_mig_bad_result' USING ERRCODE = '22023', DETAIL = 'legacy of a snapshot that is not accepted';
    END IF;
    SELECT * INTO v_old FROM public.game_legacy_reviews WHERE user_id = p_user AND snapshot_id = (l ->> 'snapshotId')::UUID;
    IF NOT FOUND THEN
      INSERT INTO public.game_legacy_reviews (user_id, snapshot_id, candidate_xp, candidate_coins, original, confirmed, reasons)
      VALUES (p_user, (l ->> 'snapshotId')::UUID, (l -> 'candidate' ->> 'xp')::INTEGER, (l -> 'candidate' ->> 'coins')::INTEGER, l -> 'original', l -> 'confirmed', COALESCE(l -> 'reasons', '[]'));
    ELSIF v_old.candidate_xp <> (l -> 'candidate' ->> 'xp')::INTEGER OR v_old.candidate_coins <> (l -> 'candidate' ->> 'coins')::INTEGER THEN
      UPDATE public.game_legacy_reviews SET candidate_xp = (l -> 'candidate' ->> 'xp')::INTEGER, candidate_coins = (l -> 'candidate' ->> 'coins')::INTEGER,
        original = l -> 'original', confirmed = l -> 'confirmed', reasons = COALESCE(l -> 'reasons', '[]'),
        status = 'pending_review', accepted_xp = NULL, accepted_coins = NULL, decided_by = NULL, decided_at = NULL, reason = NULL
      WHERE user_id = p_user AND snapshot_id = v_old.snapshot_id;
      PERFORM public.game_mig_audit(p_actor, 'legacy_reopened', p_user, jsonb_build_object('snapshot', v_old.snapshot_id, 'was', to_jsonb(v_old)));
    END IF;
  END LOOP;
  PERFORM public.game_mig_audit(p_actor, 'reconciliation_saved', p_user, jsonb_build_object('id', v_id, 'inputs', v_inputs,
    'confirmed_xp', p_result -> 'proposed' -> 'confirmedXp', 'confirmed_coins', p_result -> 'proposed' -> 'confirmedCoins', 'conflicts', jsonb_array_length(COALESCE(p_result -> 'conflicts', '[]'))));
  RETURN v_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- A person's decision on one remainder (always with a reason; an accepted amount never above its candidate)
CREATE OR REPLACE FUNCTION public.game_mig_decide_legacy(p_user UUID, p_snapshot UUID, p_status TEXT, p_xp INTEGER, p_coins INTEGER, p_actor TEXT, p_reason TEXT)
RETURNS JSONB AS $$
DECLARE
  v_old public.game_legacy_reviews%ROWTYPE;
  v_new public.game_legacy_reviews%ROWTYPE;
BEGIN
  IF p_reason IS NULL OR length(btrim(p_reason)) = 0 THEN
    RAISE EXCEPTION 'game_mig_reason_required' USING ERRCODE = '22023';
  END IF;
  IF p_status NOT IN ('pending_review', 'accepted', 'rejected', 'needs_evidence') THEN
    RAISE EXCEPTION 'game_bad_request' USING ERRCODE = '22023';
  END IF;
  PERFORM 1 FROM public.game_accounts WHERE user_id = p_user AND state = 'migration_pending' FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'game_mig_not_pending' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_old FROM public.game_legacy_reviews WHERE user_id = p_user AND snapshot_id = p_snapshot FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'game_mig_no_such_legacy' USING ERRCODE = '22023';
  END IF;
  UPDATE public.game_legacy_reviews SET status = p_status,
    accepted_xp = CASE WHEN p_status = 'accepted' THEN p_xp END, accepted_coins = CASE WHEN p_status = 'accepted' THEN p_coins END,
    decided_by = p_actor, decided_at = now(), reason = p_reason
  WHERE user_id = p_user AND snapshot_id = p_snapshot RETURNING * INTO v_new;
  PERFORM public.game_mig_audit(p_actor, 'legacy_decided', p_user, jsonb_build_object('snapshot', p_snapshot, 'before', to_jsonb(v_old), 'after', to_jsonb(v_new)));
  RETURN to_jsonb(v_new);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Activation: everything checked, then the ledger, the state and the projection in one transaction
CREATE OR REPLACE FUNCTION public.game_mig_activate(p_user UUID, p_reconciliation BIGINT, p_actor TEXT, p_level_gap_ack TEXT)
RETURNS JSONB AS $$
DECLARE
  v_state TEXT;
  v_rec public.game_reconciliations%ROWTYPE;
  e JSONB;
  v_legacy public.game_legacy_reviews%ROWTYPE;
  v_xp BIGINT := 0;
  v_coins BIGINT := 0;
  v_level INTEGER;
  v_orig INTEGER;
BEGIN
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
  IF v_rec.inputs IS DISTINCT FROM public.game_mig_inputs(p_user) THEN
    RAISE EXCEPTION 'game_mig_inputs_changed' USING ERRCODE = '40001';  -- a snapshot came after the reconciliation
  END IF;
  IF EXISTS (SELECT 1 FROM public.game_imports i WHERE i.user_id = p_user AND i.status = 'accepted'
             AND NOT EXISTS (SELECT 1 FROM public.game_legacy_reviews r WHERE r.user_id = p_user AND r.snapshot_id = i.snapshot_id))
     OR EXISTS (SELECT 1 FROM public.game_legacy_reviews WHERE user_id = p_user AND status IN ('pending_review', 'needs_evidence')) THEN
    RAISE EXCEPTION 'game_mig_unresolved' USING ERRCODE = '22023';  -- every remainder decided before anything is credited
  END IF;
  SELECT * INTO v_legacy FROM public.game_legacy_reviews WHERE user_id = p_user AND status = 'accepted';
  FOR e IN SELECT * FROM jsonb_array_elements(COALESCE(v_rec.result -> 'events', '[]')) LOOP
    v_xp := v_xp + (e ->> 'xp')::BIGINT;
    v_coins := v_coins + (e ->> 'coins')::BIGINT;
  END LOOP;
  IF v_legacy.snapshot_id IS NOT NULL THEN
    v_xp := v_xp + v_legacy.accepted_xp;
    v_coins := v_coins + v_legacy.accepted_coins;
  END IF;
  v_level := public.game_level_for_xp(v_xp);
  v_orig := COALESCE((v_rec.result -> 'proposed' ->> 'originalLevel')::INTEGER, 1);
  IF v_level < v_orig AND (p_level_gap_ack IS NULL OR length(btrim(p_level_gap_ack)) = 0) THEN
    RAISE EXCEPTION 'game_mig_level_gap' USING ERRCODE = '22023', DETAIL = format('level %s below the original %s', v_level, v_orig);
  END IF;
  UPDATE public.game_reconciliations SET status = 'activating' WHERE id = p_reconciliation;
  FOR e IN SELECT * FROM jsonb_array_elements(COALESCE(v_rec.result -> 'events', '[]')) LOOP
    INSERT INTO public.game_ledger (user_id, idempotency_key, kind, rule_code, game_day, xp, coins, rules_version, evidence, result)
    VALUES (p_user, 'import:' || (e ->> 'key'), 'migration_import', 'migration_import', (e ->> 'day')::DATE, (e ->> 'xp')::INTEGER, (e ->> 'coins')::INTEGER,
            'q4.5-4', jsonb_build_array(jsonb_build_object('reconciliation', p_reconciliation, 'sources', e -> 'sources')), e)
    ON CONFLICT (user_id, idempotency_key) DO NOTHING;
  END LOOP;
  IF v_legacy.snapshot_id IS NOT NULL AND (v_legacy.accepted_xp > 0 OR v_legacy.accepted_coins > 0) THEN
    INSERT INTO public.game_ledger (user_id, idempotency_key, kind, rule_code, game_day, xp, coins, rules_version, evidence, result)
    VALUES (p_user, 'legacy:' || p_user::text, 'migration_legacy', 'migration_legacy', CURRENT_DATE, v_legacy.accepted_xp, v_legacy.accepted_coins,
            'q4.5-4', jsonb_build_array(jsonb_build_object('snapshot', v_legacy.snapshot_id, 'decided_by', v_legacy.decided_by, 'reason', v_legacy.reason)),
            jsonb_build_object('candidate_xp', v_legacy.candidate_xp, 'candidate_coins', v_legacy.candidate_coins))
    ON CONFLICT (user_id, idempotency_key) DO NOTHING;
  END IF;
  PERFORM public.game_economy_transition(p_user, 'migration_pending', 'cloud_active');
  PERFORM public.game_rebuild_profile(p_user);
  UPDATE public.game_reconciliations SET status = 'activated', activated_by = p_actor, activated_at = now(), level_gap_ack = p_level_gap_ack WHERE id = p_reconciliation;
  PERFORM public.game_mig_audit(p_actor, 'activated', p_user, jsonb_build_object('reconciliation', p_reconciliation, 'xp', v_xp, 'coins', v_coins,
    'level', v_level, 'original_level', v_orig, 'level_gap_ack', p_level_gap_ack, 'legacy', v_legacy.snapshot_id));
  RETURN jsonb_build_object('state', 'cloud_active', 'replay', FALSE, 'xp', v_xp, 'coins', v_coins, 'level', v_level);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

--------------------------------------------------------------------------------
-- 5. Only this activation makes an account cloud_active (0018's transition is guarded)
--------------------------------------------------------------------------------
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
  -- Q4.5-4: an account with device snapshots starts only from a checked reconciliation (game_mig_activate) — never
  -- around it (a snapshot would be silently left out). Without snapshots there is nothing to reconcile (open question 3).
  IF p_to = 'cloud_active'
     AND EXISTS (SELECT 1 FROM public.game_imports WHERE user_id = p_user)
     AND NOT EXISTS (SELECT 1 FROM public.game_reconciliations WHERE user_id = p_user AND status = 'activating') THEN
    RAISE EXCEPTION 'game_mig_activation_required' USING ERRCODE = '42501';
  END IF;
  IF p_to = 'cloud_active' THEN
    INSERT INTO public.game_profile (user_id) VALUES (p_user) ON CONFLICT (user_id) DO NOTHING;
  END IF;
  UPDATE public.game_accounts SET state = p_to WHERE user_id = p_user RETURNING * INTO v_row;
  RETURN jsonb_build_object('state', p_to, 'changed', TRUE, 'state_changed_at', v_row.state_changed_at);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

ALTER FUNCTION public.game_import_immutable() OWNER TO game_economy_owner;
ALTER FUNCTION public.game_import_snapshot(UUID, UUID, BIGINT, TEXT, UUID, UUID, INTEGER, JSONB) OWNER TO game_economy_owner;
ALTER FUNCTION public.game_mig_audit(TEXT, TEXT, UUID, JSONB) OWNER TO game_economy_owner;
ALTER FUNCTION public.game_mig_inputs(UUID) OWNER TO game_economy_owner;
ALTER FUNCTION public.game_mig_journal_days(UUID, TEXT) OWNER TO game_economy_owner;
ALTER FUNCTION public.game_mig_timezone(UUID) OWNER TO game_economy_owner;
ALTER FUNCTION public.game_mig_transition(UUID, TEXT, TEXT, TEXT, TEXT) OWNER TO game_economy_owner;
ALTER FUNCTION public.game_mig_save_reconciliation(UUID, JSONB, TEXT) OWNER TO game_economy_owner;
ALTER FUNCTION public.game_mig_decide_legacy(UUID, UUID, TEXT, INTEGER, INTEGER, TEXT, TEXT) OWNER TO game_economy_owner;
ALTER FUNCTION public.game_mig_activate(UUID, BIGINT, TEXT, TEXT) OWNER TO game_economy_owner;
ALTER FUNCTION public.game_economy_transition(UUID, TEXT, TEXT) OWNER TO game_economy_owner;

--------------------------------------------------------------------------------
-- 6. Access
--------------------------------------------------------------------------------
ALTER TABLE public.game_imports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.game_reconciliations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.game_legacy_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.game_migration_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.game_imports, public.game_reconciliations, public.game_legacy_reviews, public.game_migration_audit
  FROM PUBLIC, anon, authenticated, service_role;
-- the owner's tool reads everything it decides on (no write: only through the functions)
GRANT SELECT ON public.game_imports, public.game_reconciliations, public.game_legacy_reviews, public.game_migration_audit,
  public.game_accounts, public.game_ledger, public.game_profile TO game_migration_admin;
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['game_imports', 'game_reconciliations', 'game_legacy_reviews', 'game_migration_audit', 'game_accounts', 'game_ledger', 'game_profile'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_mig_admin_read', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO game_migration_admin USING (TRUE)', t || '_mig_admin_read', t);
  END LOOP;
END $$;

REVOKE ALL ON FUNCTION public.game_import_snapshot(UUID, UUID, BIGINT, TEXT, UUID, UUID, INTEGER, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.game_import_snapshot(UUID, UUID, BIGINT, TEXT, UUID, UUID, INTEGER, JSONB) TO service_role;
REVOKE ALL ON FUNCTION public.game_mig_audit(TEXT, TEXT, UUID, JSONB) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.game_mig_inputs(UUID) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.game_mig_journal_days(UUID, TEXT) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.game_mig_journal_days(UUID, TEXT) TO game_migration_admin;
REVOKE ALL ON FUNCTION public.game_mig_timezone(UUID) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.game_mig_timezone(UUID) TO game_migration_admin;
REVOKE ALL ON FUNCTION public.game_mig_transition(UUID, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.game_mig_save_reconciliation(UUID, JSONB, TEXT) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.game_mig_decide_legacy(UUID, UUID, TEXT, INTEGER, INTEGER, TEXT, TEXT) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.game_mig_activate(UUID, BIGINT, TEXT, TEXT) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.game_mig_inputs(UUID) TO game_migration_admin;
GRANT EXECUTE ON FUNCTION public.game_mig_transition(UUID, TEXT, TEXT, TEXT, TEXT) TO game_migration_admin;
GRANT EXECUTE ON FUNCTION public.game_mig_save_reconciliation(UUID, JSONB, TEXT) TO game_migration_admin;
GRANT EXECUTE ON FUNCTION public.game_mig_decide_legacy(UUID, UUID, TEXT, INTEGER, INTEGER, TEXT, TEXT) TO game_migration_admin;
GRANT EXECUTE ON FUNCTION public.game_mig_activate(UUID, BIGINT, TEXT, TEXT) TO game_migration_admin;
-- state changes are the owner's tool's now (with a reason and the audit): the server route never moves an account
REVOKE EXECUTE ON FUNCTION public.game_economy_transition(UUID, TEXT, TEXT) FROM service_role;
REVOKE EXECUTE ON FUNCTION public.game_begin_migration(UUID) FROM service_role;
REVOKE EXECUTE ON FUNCTION public.game_activate_cloud(UUID, TEXT) FROM service_role;

REVOKE CREATE ON SCHEMA public FROM game_economy_owner;

COMMIT;
