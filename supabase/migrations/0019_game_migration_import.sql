-- AYRA Trading — 0019: safe transfer of device progress (Q4.5-4, docs/q4-5-4-migration-provenance-audit.md).
-- NOT APPLIED TO PRODUCTION. Owner decision 2026-11-23: V2 (an unproven legacy remainder kept apart, reviewed, never
-- credited automatically) + V3 (cloud Journal records as evidence only).
--
--   * game_imports — every device snapshot as it came (quarantine): account, install, snapshot id, schema, content and
--     its md5, server time of receipt, the session it came with, the account state then, a status:
--       accepted          — in the window (migration_pending), the first one of its install: enters the reconciliation;
--       duplicate_install — a further snapshot of an install that already gave one: kept, never reconciled by itself;
--       late              — after the window closed or the account was activated: kept for a separate review, never
--                           reconciled or credited automatically.
--     The same snapshot id with the same content is a replay; with another content it is refused. Nothing is deleted.
--   * game_reconciliations — the result computed BY THE DATABASE (game_mig_reconcile, from the stored snapshots only)
--     for exactly the accepted snapshots of the moment, as a draft; one is activated. The owner's tool computes the same
--     result on its own (lib/migration/reconcile.ts, the twin) and sends it: the database saves only when the two are
--     equal, and stores its own. Anything the tool sends is never a number to credit: a forged or edited result is
--     refused and the refusal is written to the decision log. The activation computes it again and refuses when
--     anything changed since (a snapshot, the time zone, the stored row).
--   * game_migration_windows — the intake window: 7 calendar days (7 × 24 h) from the start of migration_pending
--     (owner decision 2026-11-23), extended only by hand with a reason (audited). After it closes, snapshots are still
--     received and kept (late) — closing the intake deletes nothing; the account is never activated automatically.
--   * game_legacy_reviews — per accepted snapshot, its unproven remainder (candidate, original totals, confirmed part,
--     reasons) and a review status: pending_review / accepted / rejected / needs_evidence. At most ONE accepted per
--     account (the same remainder can never be credited twice under another snapshot); an accepted amount never above
--     its candidate.
--   * game_migration_audit — every owner action: who, what, why, before and after. Append only.
--   * Activation (game_mig_activate) — one transaction: the state is migration_pending; the window is closed; the
--     reconciliation is the latest draft and equal to the database's computation NOW; no remainder is undecided; a level
--     below the original only with an explicit acknowledgement; then the proven events and the accepted remainder go to
--     the ledger (idempotent keys), the account becomes cloud_active, the projection is rebuilt, and the action is
--     audited. An account without any snapshot is never activated by a reconciliation (an empty one is refused): a
--     genuinely new account has its own path (game_mig_activate_new: no snapshot, no Journal record, no ledger row,
--     window closed, a reason) — never presented as a transfer. Nothing else makes an account cloud_active:
--     game_economy_transition requires one of these two activations in the same transaction.
--   * Achievements are not on the server before Q4.6: the snapshots keep each device's full set, the activation
--     records them and says achievements_transferred = false — the transfer is not complete for the person until Q4.6.
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
  -- the database's own computation (game_mig_reconcile), never the tool's JSON; its md5 is checked at activation
  result JSONB NOT NULL CHECK (jsonb_typeof(result) = 'object'),
  result_md5 TEXT NOT NULL CHECK (result_md5 ~ '^[0-9a-f]{32}$'),
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

-- The intake window: only an extension is stored (no row: 7 days from the start of migration_pending)
CREATE TABLE IF NOT EXISTS public.game_migration_windows (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  closes_at TIMESTAMPTZ NOT NULL,
  changed_by TEXT NOT NULL CHECK (length(btrim(changed_by)) > 0),
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reason TEXT NOT NULL CHECK (length(btrim(reason)) > 0)
);

ALTER TABLE public.game_imports OWNER TO game_economy_owner;
ALTER TABLE public.game_reconciliations OWNER TO game_economy_owner;
ALTER TABLE public.game_legacy_reviews OWNER TO game_economy_owner;
ALTER TABLE public.game_migration_audit OWNER TO game_economy_owner;
ALTER TABLE public.game_migration_windows OWNER TO game_economy_owner;

-- written only as the owner (inside the functions, or the account deletion cascade); the audit is never changed
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['game_imports', 'game_reconciliations', 'game_legacy_reviews', 'game_migration_audit', 'game_migration_windows'] LOOP
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
-- When the intake window of an account in migration_pending closes (NULL in any other state): 7 calendar days from
-- the start of migration_pending (owner decision 2026-11-23, not a placeholder), or the extension the owner set by hand
CREATE OR REPLACE FUNCTION public.game_mig_window_closes_at(p_user UUID)
RETURNS TIMESTAMPTZ AS $$
  SELECT CASE WHEN a.state = 'migration_pending' THEN COALESCE(w.closes_at, a.state_changed_at + interval '7 days') END
  FROM public.game_accounts a LEFT JOIN public.game_migration_windows w ON w.user_id = a.user_id
  WHERE a.user_id = p_user;
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

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
  -- after the activation, or after the window closed (no automatic activation either way): kept apart, never reconciled
  v_status := CASE WHEN v_state = 'cloud_active' OR now() >= public.game_mig_window_closes_at(p_user) THEN 'late' ELSE 'accepted' END;
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
  SELECT COALESCE(array_agg(snapshot_id::text || ':' || content_md5 ORDER BY snapshot_id::text COLLATE "C"), '{}')
  FROM public.game_imports WHERE user_id = p_user AND status = 'accepted';
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

-- The account's time zone (its game days; the reconciliation reads daily rewards and first actions in it); UTC when unset
CREATE OR REPLACE FUNCTION public.game_mig_timezone(p_user UUID)
RETURNS TEXT AS $$
  SELECT COALESCE((SELECT NULLIF(btrim(timezone), '') FROM public.profiles WHERE id = p_user), 'UTC');
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

--------------------------------------------------------------------------------
-- 4a. The reconciliation, computed BY THE DATABASE from the stored snapshots — the twin of lib/migration/reconcile.ts
--     (every rule there has its line here; the tool's result is saved only when the two are equal)
--------------------------------------------------------------------------------
-- strict readers: a value is a record only in the exact form the game writes (anything else is a bad_record)
CREATE OR REPLACE FUNCTION public.game_mig_is_int(v JSONB)
RETURNS BOOLEAN AS $$
  SELECT CASE WHEN jsonb_typeof(v) = 'number'
    THEN (v::text)::numeric = trunc((v::text)::numeric) AND (v::text)::numeric BETWEEN 0 AND 1000000000 ELSE FALSE END;
$$ LANGUAGE sql IMMUTABLE SET search_path = public;
CREATE OR REPLACE FUNCTION public.game_mig_int(v JSONB)
RETURNS BIGINT AS $$
  SELECT CASE WHEN public.game_mig_is_int(v) THEN (v::text)::numeric::BIGINT END;
$$ LANGUAGE sql IMMUTABLE SET search_path = public;
CREATE OR REPLACE FUNCTION public.game_mig_str(v JSONB)
RETURNS TEXT AS $$
  SELECT CASE WHEN jsonb_typeof(v) = 'string' THEN v #>> '{}' END;
$$ LANGUAGE sql IMMUTABLE SET search_path = public;
CREATE OR REPLACE FUNCTION public.game_mig_arr(v JSONB)
RETURNS JSONB AS $$
  SELECT CASE WHEN jsonb_typeof(v) = 'array' THEN v ELSE '[]'::jsonb END;
$$ LANGUAGE sql IMMUTABLE SET search_path = public;
CREATE OR REPLACE FUNCTION public.game_mig_obj(v JSONB)
RETURNS JSONB AS $$
  SELECT CASE WHEN jsonb_typeof(v) = 'object' THEN v ELSE '{}'::jsonb END;
$$ LANGUAGE sql IMMUTABLE SET search_path = public;
-- a real calendar day of 2000…2100 written YYYY-MM-DD
CREATE OR REPLACE FUNCTION public.game_mig_is_day(p TEXT)
RETURNS BOOLEAN AS $$
BEGIN
  IF p IS NULL OR p !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN
    RETURN FALSE;
  END IF;
  IF substr(p, 1, 4)::INTEGER NOT BETWEEN 2000 AND 2100 THEN
    RETURN FALSE;
  END IF;
  RETURN to_char(make_date(substr(p, 1, 4)::INTEGER, substr(p, 6, 2)::INTEGER, substr(p, 9, 2)::INTEGER), 'YYYY-MM-DD') = p;
EXCEPTION WHEN others THEN
  RETURN FALSE;
END;
$$ LANGUAGE plpgsql IMMUTABLE SET search_path = public;
-- the exact form of Date.toISOString(): YYYY-MM-DDTHH:MM:SS[.mmm]Z with a real date and time; NULL otherwise
CREATE OR REPLACE FUNCTION public.game_mig_iso_time(p TEXT)
RETURNS TIMESTAMPTZ AS $$
DECLARE
  m TEXT[] := regexp_match(p, '^([0-9]{4}-[0-9]{2}-[0-9]{2})T([0-9]{2}):([0-9]{2}):([0-9]{2})(\.[0-9]{3})?Z$');
BEGIN
  IF m IS NULL OR NOT public.game_mig_is_day(m[1]) OR m[2]::INTEGER > 23 OR m[3]::INTEGER > 59 OR m[4]::INTEGER > 59 THEN
    RETURN NULL;
  END IF;
  RETURN p::TIMESTAMPTZ;
END;
$$ LANGUAGE plpgsql IMMUTABLE SET search_path = public;

CREATE OR REPLACE FUNCTION public.game_mig_reconcile(p_user UUID)
RETURNS JSONB AS $$
DECLARE
  -- rules of the past (lib/migration/reconcile.ts: FIRST_ACTION_RULES, DAILY_COIN_CAP, QUEST_BOUNDS, DAILY_REWARD_BOUNDS, PQ_XP)
  c_before CONSTANT JSONB := '{"trade":{"coins":20,"xp":20},"account":{"coins":10,"xp":10},"strategy":{"coins":10,"xp":10},
    "import":{"coins":10,"xp":10},"dayPlan":{"coins":10,"xp":10},"weekPlan":{"coins":10,"xp":10},"note":{"coins":10,"xp":10},
    "noTrade":{"coins":10,"xp":10},"screenshot":{"coins":10,"xp":10}}';
  c_after CONSTANT JSONB := '{"trade":{"coins":20,"xp":20},"account":{"coins":10,"xp":10},"strategy":{"coins":10,"xp":10},
    "import":{"coins":20,"xp":10},"dayPlan":{"coins":5,"xp":10},"weekPlan":{"coins":5,"xp":10},"note":{"coins":5,"xp":10},
    "noTrade":{"coins":5,"xp":10},"screenshot":{"coins":5,"xp":10}}';
  c_cap CONSTANT BIGINT := 100;
  c_cap_since CONSTANT TEXT := '2026-10-27';
  c_quest_xp CONSTANT BIGINT := 50;
  c_quest_coins CONSTANT BIGINT := 15;
  c_daily_min CONSTANT BIGINT := 1;
  c_daily_max CONSTANT BIGINT := 50;
  c_pq CONSTANT BIGINT[] := ARRAY[50, 90, 100, 125, 180, 250];
  c_id CONSTANT TEXT := '^[A-Za-z0-9_.-]{1,80}$';
  v_tz TEXT := public.game_mig_timezone(p_user);
  s RECORD;
  st JSONB;
  v_id TEXT;
  ev JSONB;
  v_rows JSONB := '[]';
  v_conf JSONB := '[]';
  v_snaps JSONB := '[]';
  v_inputs JSONB := '[]';
  v_events JSONB;
  v_legacy JSONB := '[]';
  x JSONB;
  i BIGINT;
  k TEXT;
  v_day TEXT;
  v_key TEXT;
  v_q TEXT;
  v_t TIMESTAMPTZ;
  v_n BIGINT;
  v_level BIGINT;
  v_xp BIGINT;
  v_coins BIGINT;
  v_c BIGINT;
  v_lo BIGINT;
  v_hi BIGINT;
  v_paid BIGINT;
  v_logged JSONB;
  v_marks TEXT[];
  v_version TEXT;
  v_reasons JSONB;
  v_jxp BIGINT;
  v_jdays BIGINT;
  v_since TEXT;
  v_shots BIGINT;
  v_cxp BIGINT;
  v_ccoins BIGINT;
  v_total_xp BIGINT := 0;
  v_total_coins BIGINT := 0;
BEGIN
  -- an unknown zone is refused (the tool's twin throws too): never a silent fallback
  BEGIN
    PERFORM now() AT TIME ZONE v_tz;
  EXCEPTION WHEN others THEN
    RAISE EXCEPTION 'game_mig_bad_timezone' USING ERRCODE = '22023', DETAIL = v_tz;
  END;

  FOR s IN SELECT snapshot_id::text AS id, install_id::text AS install, content, content_md5 FROM public.game_imports
           WHERE user_id = p_user AND status = 'accepted' ORDER BY snapshot_id::text COLLATE "C" LOOP
    st := s.content;
    v_id := s.id;
    ev := '{}';
    v_inputs := v_inputs || to_jsonb(v_id || ':' || s.content_md5);

    -- the original totals
    v_n := public.game_mig_int(st -> 'level');
    v_level := CASE WHEN v_n BETWEEN 1 AND 1000 THEN v_n ELSE 1 END;
    v_xp := COALESCE(public.game_mig_int(st -> 'xp'), 0);
    v_coins := COALESCE(public.game_mig_int(st -> 'coins'), 0);
    IF v_xp >= 80 + 40 * v_level THEN
      v_conf := v_conf || jsonb_build_object('code', 'level_xp_inconsistent', 'subject', v_id, 'xp', 0, 'coins', 0);
    END IF;
    v_marks := ARRAY[]::TEXT[];
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(public.game_mig_arr(st -> 'history')) h WHERE jsonb_typeof(h -> 'at') = 'string') THEN
      v_marks := v_marks || 'history_at'::TEXT;
    END IF;
    IF jsonb_typeof(st -> 'firstActions') = 'object' THEN v_marks := v_marks || 'first_actions'::TEXT; END IF;
    IF jsonb_typeof(st -> 'coinLog') = 'array' THEN v_marks := v_marks || 'coin_log'::TEXT; END IF;
    IF jsonb_typeof(st -> 'missionLedger') = 'object' THEN v_marks := v_marks || 'missions'::TEXT; END IF;
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(public.game_mig_arr(st -> 'personalLedger')) e WHERE e -> 'paid' = 'true'::jsonb) THEN
      v_marks := v_marks || 'pq_paid'::TEXT;
    END IF;
    v_version := CASE WHEN cardinality(v_marks) = 0 THEN 'legacy' ELSE array_to_string(v_marks, '+') END;

    -- quests and missions: the history, amounts as paid (already capped on the device)
    FOR x, i IN SELECT value, ordinality - 1 FROM jsonb_array_elements(public.game_mig_arr(st -> 'history')) WITH ORDINALITY LOOP
      v_day := public.game_mig_str(x -> 'completedAt');
      v_q := public.game_mig_str(x -> 'questId');
      IF NOT public.game_mig_is_day(v_day) OR v_q IS NULL OR v_q !~ c_id OR NOT public.game_mig_is_int(x -> 'xp') OR NOT public.game_mig_is_int(x -> 'coins') THEN
        v_conf := v_conf || jsonb_build_object('code', 'bad_record', 'subject', v_id || '/history/' || i,
          'xp', COALESCE(public.game_mig_int(x -> 'xp'), 0), 'coins', COALESCE(public.game_mig_int(x -> 'coins'), 0));
        CONTINUE;
      END IF;
      v_key := 'quest:' || v_day || ':' || v_q;
      v_n := public.game_mig_int(x -> 'xp');
      v_c := public.game_mig_int(x -> 'coins');
      IF ev ? v_key THEN
        v_conf := v_conf || jsonb_build_object('code', 'duplicate_in_snapshot', 'subject', v_id || '/' || v_key, 'xp', v_n, 'coins', v_c);
        CONTINUE;
      END IF;
      IF v_n > c_quest_xp OR v_c > c_quest_coins THEN
        v_conf := v_conf || jsonb_build_object('code', 'amount_out_of_rule', 'subject', v_id || '/' || v_key, 'xp', v_n, 'coins', v_c);
        CONTINUE;
      END IF;
      ev := ev || jsonb_build_object(v_key, jsonb_build_object('kind', 'quest', 'day', v_day, 'xp', v_n, 'coins', v_c));
    END LOOP;

    -- first actions: the amount is proven only by the coin log (it started with the new amounts, in the same commit)
    FOR k, x IN SELECT key, value FROM jsonb_each(public.game_mig_obj(st -> 'firstActions')) LOOP
      v_t := public.game_mig_iso_time(public.game_mig_str(x));
      IF NOT (c_before ? k) OR v_t IS NULL THEN
        v_conf := v_conf || jsonb_build_object('code', 'bad_record', 'subject', v_id || '/firstActions', 'xp', 0, 'coins', 0);
        CONTINUE;
      END IF;
      v_key := 'first:' || k;
      v_lo := LEAST((c_before -> k ->> 'coins')::BIGINT, (c_after -> k ->> 'coins')::BIGINT);
      v_hi := GREATEST((c_before -> k ->> 'coins')::BIGINT, (c_after -> k ->> 'coins')::BIGINT);
      v_logged := NULL;
      SELECT value INTO v_logged FROM jsonb_array_elements(public.game_mig_arr(st -> 'coinLog')) WITH ORDINALITY
        WHERE value -> 'source' = '"firstAction"'::jsonb AND value -> 'kind' = to_jsonb(k) ORDER BY ordinality LIMIT 1;
      v_paid := v_lo;
      IF v_logged IS NOT NULL AND v_logged -> 'amount' = c_after -> k -> 'coins' THEN
        v_paid := (c_after -> k ->> 'coins')::BIGINT;
      ELSIF v_logged IS NOT NULL THEN
        v_conf := v_conf || jsonb_build_object('code', 'amount_out_of_rule', 'subject', v_id || '/' || v_key, 'xp', 0, 'coins', v_hi - v_lo);
      ELSIF v_hi > v_lo THEN
        v_conf := v_conf || jsonb_build_object('code', 'first_action_unlogged', 'subject', v_id || '/' || v_key, 'xp', 0, 'coins', v_hi - v_lo);
      END IF;
      ev := ev || jsonb_build_object(v_key, jsonb_build_object('kind', 'first', 'day', to_char(v_t AT TIME ZONE v_tz, 'YYYY-MM-DD'),
        'xp', LEAST((c_before -> k ->> 'xp')::BIGINT, (c_after -> k ->> 'xp')::BIGINT), 'coins', v_paid));
    END LOOP;

    -- personal quests: only completions that paid; the run id is the key
    FOR x, i IN SELECT value, ordinality - 1 FROM jsonb_array_elements(public.game_mig_arr(st -> 'personalLedger')) WITH ORDINALITY LOOP
      IF x -> 'paid' IS DISTINCT FROM 'true'::jsonb THEN
        CONTINUE;
      END IF;
      v_q := public.game_mig_str(x -> 'runId');
      v_day := public.game_mig_str(x -> 'day');
      IF v_q IS NULL OR v_q !~ c_id OR NOT public.game_mig_is_int(x -> 'xp') OR NOT public.game_mig_is_day(v_day) THEN
        v_conf := v_conf || jsonb_build_object('code', 'bad_record', 'subject', v_id || '/personalLedger/' || i,
          'xp', COALESCE(public.game_mig_int(x -> 'xp'), 0), 'coins', 0);
        CONTINUE;
      END IF;
      v_key := 'pq:' || v_q;
      v_n := public.game_mig_int(x -> 'xp');
      IF NOT (v_n = ANY (c_pq)) THEN
        v_conf := v_conf || jsonb_build_object('code', 'amount_out_of_rule', 'subject', v_id || '/' || v_key, 'xp', v_n, 'coins', 0);
        CONTINUE;
      END IF;
      IF ev ? v_key THEN
        v_conf := v_conf || jsonb_build_object('code', 'duplicate_in_snapshot', 'subject', v_id || '/' || v_key, 'xp', v_n, 'coins', 0);
        CONTINUE;
      END IF;
      ev := ev || jsonb_build_object(v_key, jsonb_build_object('kind', 'pq', 'day', v_day, 'xp', v_n, 'coins', 0));
    END LOOP;

    -- daily rewards: only inside the coin log; the game day in the account's zone
    FOR x, i IN SELECT value, ordinality - 1 FROM jsonb_array_elements(public.game_mig_arr(st -> 'coinLog')) WITH ORDINALITY LOOP
      IF x -> 'source' IS DISTINCT FROM '"dailyReward"'::jsonb THEN
        CONTINUE;
      END IF;
      v_t := public.game_mig_iso_time(public.game_mig_str(x -> 'at'));
      IF v_t IS NULL OR NOT public.game_mig_is_int(x -> 'amount') THEN
        v_conf := v_conf || jsonb_build_object('code', 'bad_record', 'subject', v_id || '/coinLog/' || i,
          'xp', 0, 'coins', COALESCE(public.game_mig_int(x -> 'amount'), 0));
        CONTINUE;
      END IF;
      v_day := to_char(v_t AT TIME ZONE v_tz, 'YYYY-MM-DD');
      v_key := 'daily:' || v_day;
      v_c := public.game_mig_int(x -> 'amount');
      IF v_c < c_daily_min OR v_c > c_daily_max THEN
        v_conf := v_conf || jsonb_build_object('code', 'amount_out_of_rule', 'subject', v_id || '/' || v_key, 'xp', 0, 'coins', v_c);
        CONTINUE;
      END IF;
      IF ev ? v_key THEN
        v_conf := v_conf || jsonb_build_object('code', 'duplicate_in_snapshot', 'subject', v_id || '/' || v_key, 'xp', 0, 'coins', v_c);
        CONTINUE;
      END IF;
      ev := ev || jsonb_build_object(v_key, jsonb_build_object('kind', 'daily', 'day', v_day, 'xp', 0, 'coins', v_c));
    END LOOP;

    -- what is known about the rest (reasons of the legacy candidate; none of it is a proof)
    SELECT COALESCE(sum(r), 0), count(*) INTO v_jxp, v_jdays FROM (
      SELECT public.game_mig_int(d.value -> 'xpGained') - COALESCE(q.xp, 0) AS r
      FROM jsonb_each(public.game_mig_obj(st -> 'dailyStats')) d
      LEFT JOIN (SELECT e.value ->> 'day' AS day, sum((e.value ->> 'xp')::BIGINT) AS xp FROM jsonb_each(ev) e
                 WHERE e.value ->> 'kind' = 'quest' GROUP BY 1) q ON q.day = d.key
      WHERE d.key ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' AND public.game_mig_is_int(d.value -> 'xpGained')) t
    WHERE r > 0;
    v_reasons := '[]';
    IF v_jxp > 0 THEN
      v_reasons := v_reasons || jsonb_build_object('code', 'journal_xp_by_day', 'xp', v_jxp, 'count', v_jdays);
    END IF;
    v_shots := jsonb_array_length(public.game_mig_arr(st -> 'rewardedScreenshotHashes'));
    IF v_shots > 0 THEN
      v_reasons := v_reasons || jsonb_build_object('code', 'screenshot_hashes', 'count', v_shots);
    END IF;
    v_since := public.game_mig_str(st -> 'coinLogSince');
    v_reasons := v_reasons || CASE WHEN v_since IS NULL THEN jsonb_build_object('code', 'coins_before_log')
                                   ELSE jsonb_build_object('code', 'coins_before_log', 'since', v_since) END;
    IF v_version = 'legacy' THEN
      v_reasons := v_reasons || jsonb_build_object('code', 'legacy_format');
    END IF;

    v_snaps := v_snaps || jsonb_build_object('snapshotId', v_id, 'installId', s.install,
      'original', jsonb_build_object('level', v_level, 'xpInLevel', v_xp, 'totalXp', v_xp + 80 * (v_level - 1) + 20 * v_level * (v_level - 1),
        'coins', v_coins, 'saveVersion', v_version),
      'reasons', v_reasons,
      'achievements', (SELECT COALESCE(jsonb_agg(a.key), '[]') FROM jsonb_each(public.game_mig_obj(st -> 'achievements')) a
                       WHERE a.value = 'true'::jsonb AND a.key ~ c_id));
    FOR k, x IN SELECT key, value FROM jsonb_each(ev) LOOP
      v_rows := v_rows || (jsonb_build_object('snap', v_id, 'key', k) || x);
    END LOOP;
  END LOOP;

  -- 1. the same key on several devices is ONE event: the smaller amount; a difference is a conflict
  SELECT COALESCE(jsonb_agg(jsonb_build_object('key', key, 'kind', kind, 'day', day, 'xp', xp, 'coins', coins, 'sources', sources)
                            ORDER BY key COLLATE "C"), '[]'),
         COALESCE(jsonb_agg(jsonb_build_object('code', 'amount_mismatch', 'subject', key, 'xp', mxp - xp, 'coins', mcoins - coins))
                  FILTER (WHERE mxp <> xp OR mcoins <> coins), '[]')
  INTO v_events, x
  FROM (SELECT r ->> 'key' AS key, min(r ->> 'kind') AS kind, min((r ->> 'day') COLLATE "C") AS day,
               min((r ->> 'xp')::BIGINT) AS xp, min((r ->> 'coins')::BIGINT) AS coins,
               max((r ->> 'xp')::BIGINT) AS mxp, max((r ->> 'coins')::BIGINT) AS mcoins,
               jsonb_agg(r ->> 'snap' ORDER BY (r ->> 'snap') COLLATE "C") AS sources
        FROM jsonb_array_elements(v_rows) r GROUP BY r ->> 'key') g;
  v_conf := v_conf || x;

  -- 2. the daily Coins cap over ALL devices together (quests and daily rewards; from the day #98 shipped), cut from the
  --    highest key down: cut = clamp(excess − Coins of the higher keys of that day, 0, its Coins)
  WITH e AS (
    SELECT ord, x2 AS j, x2 ->> 'key' AS key, x2 ->> 'day' AS day, (x2 ->> 'coins')::BIGINT AS coins,
           (x2 ->> 'kind') IN ('quest', 'daily') AND (x2 ->> 'day') COLLATE "C" >= c_cap_since AS capped
    FROM jsonb_array_elements(v_events) WITH ORDINALITY AS t(x2, ord)
  ), w AS (
    SELECT ord, j, key, coins, capped,
           sum(coins) FILTER (WHERE capped) OVER (PARTITION BY day) - c_cap AS excess,
           COALESCE(sum(coins) FILTER (WHERE capped) OVER (PARTITION BY day ORDER BY key COLLATE "C" DESC
                                                           ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING), 0) AS higher
    FROM e
  ), c AS (
    SELECT ord, j, key, CASE WHEN capped THEN GREATEST(0, LEAST(coins, excess - higher)) ELSE 0 END AS cut FROM w
  )
  SELECT jsonb_agg(CASE WHEN cut > 0 THEN jsonb_set(j, '{coins}', to_jsonb((j ->> 'coins')::BIGINT - cut)) ELSE j END ORDER BY ord),
         COALESCE(jsonb_agg(jsonb_build_object('code', 'daily_coin_cap', 'subject', key, 'xp', 0, 'coins', cut)) FILTER (WHERE cut > 0), '[]')
  INTO v_events, x FROM c;
  v_events := COALESCE(v_events, '[]');
  v_conf := v_conf || x;

  -- 3. a legacy CANDIDATE per snapshot: its total beyond its own proven events — never credited by itself
  FOR x IN SELECT value FROM jsonb_array_elements(v_snaps) LOOP
    SELECT COALESCE(sum((e ->> 'xp')::BIGINT), 0), COALESCE(sum((e ->> 'coins')::BIGINT), 0) INTO v_cxp, v_ccoins
    FROM jsonb_array_elements(v_events) e WHERE (e -> 'sources') ? (x ->> 'snapshotId');
    IF (x -> 'original' ->> 'totalXp')::BIGINT < v_cxp OR (x -> 'original' ->> 'coins')::BIGINT < v_ccoins THEN
      v_conf := v_conf || jsonb_build_object('code', 'balance_below_records', 'subject', x ->> 'snapshotId', 'xp', 0, 'coins', 0);
    END IF;
    v_legacy := v_legacy || jsonb_build_object('snapshotId', x -> 'snapshotId', 'installId', x -> 'installId', 'original', x -> 'original',
      'confirmed', jsonb_build_object('xp', v_cxp, 'coins', v_ccoins),
      'candidate', jsonb_build_object('xp', GREATEST(0, (x -> 'original' ->> 'totalXp')::BIGINT - v_cxp), 'coins', GREATEST(0, (x -> 'original' ->> 'coins')::BIGINT - v_ccoins)),
      'reasons', x -> 'reasons');
  END LOOP;

  SELECT COALESCE(sum((e ->> 'xp')::BIGINT), 0), COALESCE(sum((e ->> 'coins')::BIGINT), 0) INTO v_total_xp, v_total_coins
  FROM jsonb_array_elements(v_events) e;
  SELECT GREATEST(1, max((l -> 'original' ->> 'level')::BIGINT)), GREATEST(0, max((l -> 'original' ->> 'coins')::BIGINT)) INTO v_level, v_coins
  FROM jsonb_array_elements(v_snaps) l;
  v_level := COALESCE(v_level, 1);
  v_coins := COALESCE(v_coins, 0);
  RETURN jsonb_build_object(
    'algorithm', 'q4.5-4/2',
    'timeZone', v_tz,
    'inputs', v_inputs,
    'events', v_events,
    'conflicts', (SELECT COALESCE(jsonb_agg(c ORDER BY c ->> 'code' COLLATE "C", c ->> 'subject' COLLATE "C", (c ->> 'xp')::BIGINT, (c ->> 'coins')::BIGINT), '[]')
                  FROM jsonb_array_elements(v_conf) c),
    'legacy', v_legacy,
    'proposed', jsonb_build_object('confirmedXp', v_total_xp, 'confirmedCoins', v_total_coins, 'level', public.game_level_for_xp(v_total_xp),
      'originalLevel', v_level, 'levelGap', GREATEST(0, v_level - public.game_level_for_xp(v_total_xp)), 'originalCoins', v_coins),
    'achievements', (SELECT COALESCE(jsonb_agg(name ORDER BY name COLLATE "C"), '[]')
                     FROM (SELECT DISTINCT a.value #>> '{}' AS name FROM jsonb_array_elements(v_snaps) l, jsonb_array_elements(l -> 'achievements') a) u));
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public;

-- Save a reconciliation: the tool's result must be EQUAL to the database's own computation; the database's is stored.
-- A different result (a forged event, a raised amount, another rule, other snapshots) is refused, and the refusal is
-- written to the decision log (the function returns instead of raising, so the log entry stays).
DROP FUNCTION IF EXISTS public.game_mig_save_reconciliation(UUID, JSONB, TEXT);
CREATE OR REPLACE FUNCTION public.game_mig_save_reconciliation(p_user UUID, p_result JSONB, p_actor TEXT)
RETURNS JSONB AS $$
DECLARE
  v_state TEXT;
  v_server JSONB;
  v_id BIGINT;
  l JSONB;
  v_old public.game_legacy_reviews%ROWTYPE;
BEGIN
  IF p_actor IS NULL OR length(btrim(p_actor)) = 0 THEN
    RAISE EXCEPTION 'game_mig_actor_required' USING ERRCODE = '22023';
  END IF;
  SELECT state INTO v_state FROM public.game_accounts WHERE user_id = p_user FOR UPDATE;
  IF v_state IS DISTINCT FROM 'migration_pending' THEN
    RAISE EXCEPTION 'game_mig_not_pending' USING ERRCODE = '22023';
  END IF;
  -- an empty reconciliation is never a transfer (a new account has its own path: game_mig_activate_new)
  IF NOT EXISTS (SELECT 1 FROM public.game_imports WHERE user_id = p_user AND status = 'accepted') THEN
    RAISE EXCEPTION 'game_mig_no_snapshots' USING ERRCODE = '22023';
  END IF;
  v_server := public.game_mig_reconcile(p_user);
  IF p_result IS DISTINCT FROM v_server THEN
    PERFORM public.game_mig_audit(p_actor, 'reconciliation_refused', p_user, jsonb_build_object(
      'reason', 'the result differs from the database''s own computation',
      'differs', (SELECT COALESCE(jsonb_agg(f ORDER BY f), '[]') FROM (
                    SELECT f FROM jsonb_object_keys(v_server) f WHERE (p_result -> f) IS DISTINCT FROM (v_server -> f)
                    UNION SELECT f FROM jsonb_object_keys(CASE WHEN jsonb_typeof(p_result) = 'object' THEN p_result ELSE '{}' END) f
                    WHERE NOT (v_server ? f)) u),
      'given_md5', md5(COALESCE(p_result::text, '')), 'server_md5', md5(v_server::text),
      'given_proposed', p_result -> 'proposed', 'server_proposed', v_server -> 'proposed'));
    RETURN jsonb_build_object('saved', FALSE, 'refused', 'game_mig_result_differs');
  END IF;
  UPDATE public.game_reconciliations SET status = 'superseded' WHERE user_id = p_user AND status = 'draft';
  INSERT INTO public.game_reconciliations (user_id, inputs, result, result_md5, created_by)
  VALUES (p_user, ARRAY(SELECT jsonb_array_elements_text(v_server -> 'inputs')), v_server, md5(v_server::text), p_actor)
  RETURNING id INTO v_id;
  -- legacy reviews: one per accepted snapshot; a changed candidate goes back to review
  FOR l IN SELECT * FROM jsonb_array_elements(v_server -> 'legacy') LOOP
    SELECT * INTO v_old FROM public.game_legacy_reviews WHERE user_id = p_user AND snapshot_id = (l ->> 'snapshotId')::UUID;
    IF NOT FOUND THEN
      INSERT INTO public.game_legacy_reviews (user_id, snapshot_id, candidate_xp, candidate_coins, original, confirmed, reasons)
      VALUES (p_user, (l ->> 'snapshotId')::UUID, (l -> 'candidate' ->> 'xp')::INTEGER, (l -> 'candidate' ->> 'coins')::INTEGER, l -> 'original', l -> 'confirmed', l -> 'reasons');
    ELSIF v_old.candidate_xp <> (l -> 'candidate' ->> 'xp')::INTEGER OR v_old.candidate_coins <> (l -> 'candidate' ->> 'coins')::INTEGER THEN
      UPDATE public.game_legacy_reviews SET candidate_xp = (l -> 'candidate' ->> 'xp')::INTEGER, candidate_coins = (l -> 'candidate' ->> 'coins')::INTEGER,
        original = l -> 'original', confirmed = l -> 'confirmed', reasons = l -> 'reasons',
        status = 'pending_review', accepted_xp = NULL, accepted_coins = NULL, decided_by = NULL, decided_at = NULL, reason = NULL
      WHERE user_id = p_user AND snapshot_id = v_old.snapshot_id;
      PERFORM public.game_mig_audit(p_actor, 'legacy_reopened', p_user, jsonb_build_object('snapshot', v_old.snapshot_id, 'was', to_jsonb(v_old)));
    END IF;
  END LOOP;
  PERFORM public.game_mig_audit(p_actor, 'reconciliation_saved', p_user, jsonb_build_object('id', v_id, 'inputs', v_server -> 'inputs',
    'result_md5', md5(v_server::text), 'algorithm', v_server -> 'algorithm', 'time_zone', v_server -> 'timeZone',
    'confirmed_xp', v_server -> 'proposed' -> 'confirmedXp', 'confirmed_coins', v_server -> 'proposed' -> 'confirmedCoins',
    'conflicts', jsonb_array_length(v_server -> 'conflicts')));
  RETURN jsonb_build_object('saved', TRUE, 'id', v_id, 'result_md5', md5(v_server::text));
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

-- Activation: everything checked again (the window, the database's computation NOW equal to the saved one, every
-- remainder decided, the level), then the ledger, the state and the projection in one transaction.
CREATE OR REPLACE FUNCTION public.game_mig_activate(p_user UUID, p_reconciliation BIGINT, p_actor TEXT, p_level_gap_ack TEXT)
RETURNS JSONB AS $$
DECLARE
  v_state TEXT;
  v_rec public.game_reconciliations%ROWTYPE;
  v_now JSONB;
  v_closes TIMESTAMPTZ;
  e JSONB;
  v_legacy public.game_legacy_reviews%ROWTYPE;
  v_xp BIGINT := 0;
  v_coins BIGINT := 0;
  v_level INTEGER;
  v_orig INTEGER;
BEGIN
  IF p_actor IS NULL OR length(btrim(p_actor)) = 0 THEN
    RAISE EXCEPTION 'game_mig_actor_required' USING ERRCODE = '22023';
  END IF;
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
  -- the window is closed first (owner decision: 7 days, extended only by hand): no device of the window is left out
  v_closes := public.game_mig_window_closes_at(p_user);
  IF now() < v_closes THEN
    RAISE EXCEPTION 'game_mig_window_open' USING ERRCODE = '22023', DETAIL = format('the intake window closes at %s', v_closes);
  END IF;
  -- the independent check again, right before anything is credited: the database computes the result from the stored
  -- snapshots now; it must be the saved one (a snapshot that came since, another time zone, an edited row: refused)
  v_now := public.game_mig_reconcile(p_user);
  IF v_now IS DISTINCT FROM v_rec.result OR md5(v_rec.result::text) IS DISTINCT FROM v_rec.result_md5 THEN
    PERFORM public.game_mig_audit(p_actor, 'activation_refused', p_user, jsonb_build_object('reconciliation', p_reconciliation,
      'reason', 'the database''s computation now differs from the saved reconciliation',
      'saved_md5', v_rec.result_md5, 'stored_md5', md5(v_rec.result::text), 'now_md5', md5(v_now::text),
      'now_inputs', v_now -> 'inputs', 'saved_inputs', v_rec.result -> 'inputs'));
    RETURN jsonb_build_object('state', 'migration_pending', 'activated', FALSE, 'refused', 'game_mig_result_changed');
  END IF;
  IF EXISTS (SELECT 1 FROM public.game_imports i WHERE i.user_id = p_user AND i.status = 'accepted'
             AND NOT EXISTS (SELECT 1 FROM public.game_legacy_reviews r WHERE r.user_id = p_user AND r.snapshot_id = i.snapshot_id))
     OR EXISTS (SELECT 1 FROM public.game_legacy_reviews WHERE user_id = p_user AND status IN ('pending_review', 'needs_evidence')) THEN
    RAISE EXCEPTION 'game_mig_unresolved' USING ERRCODE = '22023';  -- every remainder decided before anything is credited
  END IF;
  -- every review is about the candidate computed now (never an amount decided for another one)
  IF EXISTS (SELECT 1 FROM public.game_legacy_reviews r WHERE r.user_id = p_user AND NOT EXISTS (
       SELECT 1 FROM jsonb_array_elements(v_now -> 'legacy') l WHERE (l ->> 'snapshotId')::UUID = r.snapshot_id
         AND (l -> 'candidate' ->> 'xp')::INTEGER = r.candidate_xp AND (l -> 'candidate' ->> 'coins')::INTEGER = r.candidate_coins)
       AND EXISTS (SELECT 1 FROM public.game_imports i WHERE i.user_id = p_user AND i.snapshot_id = r.snapshot_id AND i.status = 'accepted')) THEN
    RAISE EXCEPTION 'game_mig_reviews_stale' USING ERRCODE = '40001';
  END IF;
  SELECT * INTO v_legacy FROM public.game_legacy_reviews WHERE user_id = p_user AND status = 'accepted';
  FOR e IN SELECT * FROM jsonb_array_elements(v_now -> 'events') LOOP
    v_xp := v_xp + (e ->> 'xp')::BIGINT;
    v_coins := v_coins + (e ->> 'coins')::BIGINT;
  END LOOP;
  IF v_legacy.snapshot_id IS NOT NULL THEN
    v_xp := v_xp + v_legacy.accepted_xp;
    v_coins := v_coins + v_legacy.accepted_coins;
  END IF;
  v_level := public.game_level_for_xp(v_xp);
  v_orig := (v_now -> 'proposed' ->> 'originalLevel')::INTEGER;
  IF v_level < v_orig AND (p_level_gap_ack IS NULL OR length(btrim(p_level_gap_ack)) = 0) THEN
    RAISE EXCEPTION 'game_mig_level_gap' USING ERRCODE = '22023', DETAIL = format('level %s below the original %s', v_level, v_orig);
  END IF;
  UPDATE public.game_reconciliations SET status = 'activating' WHERE id = p_reconciliation;
  FOR e IN SELECT * FROM jsonb_array_elements(v_now -> 'events') LOOP
    INSERT INTO public.game_ledger (user_id, idempotency_key, kind, rule_code, game_day, xp, coins, rules_version, evidence, result)
    VALUES (p_user, 'import:' || (e ->> 'key'), 'migration_import', 'migration_import', (e ->> 'day')::DATE, (e ->> 'xp')::INTEGER, (e ->> 'coins')::INTEGER,
            'q4.5-4', jsonb_build_array(jsonb_build_object('reconciliation', p_reconciliation, 'result_md5', v_rec.result_md5, 'sources', e -> 'sources')), e)
    ON CONFLICT (user_id, idempotency_key) DO NOTHING;
  END LOOP;
  IF v_legacy.snapshot_id IS NOT NULL AND (v_legacy.accepted_xp > 0 OR v_legacy.accepted_coins > 0) THEN
    INSERT INTO public.game_ledger (user_id, idempotency_key, kind, rule_code, game_day, xp, coins, rules_version, evidence, result)
    VALUES (p_user, 'legacy:' || p_user::text, 'migration_legacy', 'migration_legacy', CURRENT_DATE, v_legacy.accepted_xp, v_legacy.accepted_coins,
            'q4.5-4', jsonb_build_array(jsonb_build_object('snapshot', v_legacy.snapshot_id, 'decided_by', v_legacy.decided_by, 'reason', v_legacy.reason)),
            jsonb_build_object('candidate_xp', v_legacy.candidate_xp, 'candidate_coins', v_legacy.candidate_coins))
    ON CONFLICT (user_id, idempotency_key) DO NOTHING;
  END IF;
  -- the transition accepts cloud_active only inside an activation (this marker, for this account, in this transaction)
  PERFORM set_config('ayra.mig_activation', p_user::text, TRUE);
  PERFORM public.game_economy_transition(p_user, 'migration_pending', 'cloud_active');
  PERFORM set_config('ayra.mig_activation', '', TRUE);
  PERFORM public.game_rebuild_profile(p_user);
  UPDATE public.game_reconciliations SET status = 'activated', activated_by = p_actor, activated_at = now(), level_gap_ack = p_level_gap_ack WHERE id = p_reconciliation;
  -- achievements are not on the server before Q4.6: recorded here, the transfer is not complete for the person yet
  PERFORM public.game_mig_audit(p_actor, 'activated', p_user, jsonb_build_object('reconciliation', p_reconciliation, 'result_md5', v_rec.result_md5,
    'xp', v_xp, 'coins', v_coins, 'level', v_level, 'original_level', v_orig, 'level_gap_ack', p_level_gap_ack, 'legacy', v_legacy.snapshot_id,
    'achievements_on_devices', v_now -> 'achievements', 'achievements_transferred', FALSE));
  RETURN jsonb_build_object('state', 'cloud_active', 'replay', FALSE, 'xp', v_xp, 'coins', v_coins, 'level', v_level,
    'achievements_transferred', FALSE, 'achievements_on_devices', v_now -> 'achievements');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- A genuinely NEW account (no history at all) — its own path, never presented as a transfer: no snapshot of any status,
-- no reconciliation, no cloud Journal record (deleted ones included), no ledger row, the window closed, a reason
CREATE OR REPLACE FUNCTION public.game_mig_activate_new(p_user UUID, p_actor TEXT, p_reason TEXT)
RETURNS JSONB AS $$
DECLARE
  v_state TEXT;
  v_closes TIMESTAMPTZ;
BEGIN
  IF p_actor IS NULL OR length(btrim(p_actor)) = 0 THEN
    RAISE EXCEPTION 'game_mig_actor_required' USING ERRCODE = '22023';
  END IF;
  IF p_reason IS NULL OR length(btrim(p_reason)) = 0 THEN
    RAISE EXCEPTION 'game_mig_reason_required' USING ERRCODE = '22023';
  END IF;
  SELECT state INTO v_state FROM public.game_accounts WHERE user_id = p_user FOR UPDATE;
  IF v_state = 'cloud_active' AND EXISTS (SELECT 1 FROM public.game_migration_audit WHERE user_id = p_user AND action = 'activated_new_account') THEN
    RETURN jsonb_build_object('state', 'cloud_active', 'replay', TRUE);
  END IF;
  IF v_state IS DISTINCT FROM 'migration_pending' THEN
    RAISE EXCEPTION 'game_mig_not_pending' USING ERRCODE = '22023';
  END IF;
  v_closes := public.game_mig_window_closes_at(p_user);
  IF now() < v_closes THEN
    RAISE EXCEPTION 'game_mig_window_open' USING ERRCODE = '22023', DETAIL = format('the intake window closes at %s', v_closes);
  END IF;
  IF EXISTS (SELECT 1 FROM public.game_imports WHERE user_id = p_user) OR EXISTS (SELECT 1 FROM public.game_reconciliations WHERE user_id = p_user) THEN
    RAISE EXCEPTION 'game_mig_has_snapshots' USING ERRCODE = '22023';  -- a device sent its progress: that is a transfer
  END IF;
  IF EXISTS (SELECT 1 FROM public.journal_trades WHERE user_id = p_user) OR EXISTS (SELECT 1 FROM public.journal_notes WHERE user_id = p_user)
     OR EXISTS (SELECT 1 FROM public.journal_no_trades WHERE user_id = p_user) OR EXISTS (SELECT 1 FROM public.journal_day_plans WHERE user_id = p_user)
     OR EXISTS (SELECT 1 FROM public.game_ledger WHERE user_id = p_user) THEN
    RAISE EXCEPTION 'game_mig_has_history' USING ERRCODE = '22023';  -- a history without a snapshot waits (pending) — never zeroed
  END IF;
  PERFORM set_config('ayra.mig_activation', p_user::text, TRUE);
  PERFORM public.game_economy_transition(p_user, 'migration_pending', 'cloud_active');
  PERFORM set_config('ayra.mig_activation', '', TRUE);
  PERFORM public.game_rebuild_profile(p_user);
  PERFORM public.game_mig_audit(p_actor, 'activated_new_account', p_user, jsonb_build_object('reason', p_reason, 'window_closed_at', v_closes,
    'checked', jsonb_build_array('no snapshot', 'no reconciliation', 'no Journal record', 'no ledger row')));
  RETURN jsonb_build_object('state', 'cloud_active', 'replay', FALSE, 'new_account', TRUE);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Extend the intake window by hand (owner decision): only later, only while it is open, always with a reason (audited)
CREATE OR REPLACE FUNCTION public.game_mig_extend_window(p_user UUID, p_until TIMESTAMPTZ, p_actor TEXT, p_reason TEXT)
RETURNS JSONB AS $$
DECLARE
  v_closes TIMESTAMPTZ;
BEGIN
  IF p_actor IS NULL OR length(btrim(p_actor)) = 0 THEN
    RAISE EXCEPTION 'game_mig_actor_required' USING ERRCODE = '22023';
  END IF;
  IF p_reason IS NULL OR length(btrim(p_reason)) = 0 THEN
    RAISE EXCEPTION 'game_mig_reason_required' USING ERRCODE = '22023';
  END IF;
  -- the same lock as an intake and an activation: an extension never interleaves with either
  PERFORM 1 FROM public.game_accounts WHERE user_id = p_user AND state = 'migration_pending' FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'game_mig_not_pending' USING ERRCODE = '22023';
  END IF;
  v_closes := public.game_mig_window_closes_at(p_user);
  IF now() >= v_closes THEN
    RAISE EXCEPTION 'game_mig_window_closed' USING ERRCODE = '22023', DETAIL = format('closed at %s', v_closes);
  END IF;
  IF p_until IS NULL OR p_until <= v_closes THEN
    RAISE EXCEPTION 'game_mig_window_not_later' USING ERRCODE = '22023', DETAIL = format('now closes at %s', v_closes);
  END IF;
  INSERT INTO public.game_migration_windows (user_id, closes_at, changed_by, reason) VALUES (p_user, p_until, p_actor, p_reason)
  ON CONFLICT (user_id) DO UPDATE SET closes_at = EXCLUDED.closes_at, changed_by = EXCLUDED.changed_by, changed_at = now(), reason = EXCLUDED.reason;
  PERFORM public.game_mig_audit(p_actor, 'window_extended', p_user, jsonb_build_object('from', v_closes, 'to', p_until, 'reason', p_reason));
  RETURN jsonb_build_object('closes_at', p_until, 'was', v_closes);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

--------------------------------------------------------------------------------
-- 5. Only these activations make an account cloud_active (0018's transition is guarded)
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
  -- Q4.5-4: cloud_active only inside one of the two activations (they set this transaction's marker for this account):
  -- a transfer from a checked reconciliation (game_mig_activate), or a genuinely new account (game_mig_activate_new).
  -- Never around them — a snapshot would be silently left out, or an account with a history zeroed. (The marker guards
  -- against a mistaken direct call by the database owner; no API role and not the tool's role can call this function.)
  IF p_to = 'cloud_active' AND v_row.state = 'migration_pending' THEN
    IF current_setting('ayra.mig_activation', TRUE) IS DISTINCT FROM p_user::text
       OR (EXISTS (SELECT 1 FROM public.game_imports WHERE user_id = p_user)
           AND NOT EXISTS (SELECT 1 FROM public.game_reconciliations WHERE user_id = p_user AND status = 'activating')) THEN
      RAISE EXCEPTION 'game_mig_activation_required' USING ERRCODE = '42501';
    END IF;
  END IF;
  IF p_to = 'cloud_active' THEN
    INSERT INTO public.game_profile (user_id) VALUES (p_user) ON CONFLICT (user_id) DO NOTHING;
  END IF;
  UPDATE public.game_accounts SET state = p_to WHERE user_id = p_user RETURNING * INTO v_row;
  RETURN jsonb_build_object('state', p_to, 'changed', TRUE, 'state_changed_at', v_row.state_changed_at);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

ALTER FUNCTION public.game_import_immutable() OWNER TO game_economy_owner;
ALTER FUNCTION public.game_mig_window_closes_at(UUID) OWNER TO game_economy_owner;
ALTER FUNCTION public.game_mig_is_int(JSONB) OWNER TO game_economy_owner;
ALTER FUNCTION public.game_mig_int(JSONB) OWNER TO game_economy_owner;
ALTER FUNCTION public.game_mig_str(JSONB) OWNER TO game_economy_owner;
ALTER FUNCTION public.game_mig_arr(JSONB) OWNER TO game_economy_owner;
ALTER FUNCTION public.game_mig_obj(JSONB) OWNER TO game_economy_owner;
ALTER FUNCTION public.game_mig_is_day(TEXT) OWNER TO game_economy_owner;
ALTER FUNCTION public.game_mig_iso_time(TEXT) OWNER TO game_economy_owner;
ALTER FUNCTION public.game_mig_reconcile(UUID) OWNER TO game_economy_owner;
ALTER FUNCTION public.game_mig_activate_new(UUID, TEXT, TEXT) OWNER TO game_economy_owner;
ALTER FUNCTION public.game_mig_extend_window(UUID, TIMESTAMPTZ, TEXT, TEXT) OWNER TO game_economy_owner;
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
ALTER TABLE public.game_migration_windows ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.game_imports, public.game_reconciliations, public.game_legacy_reviews, public.game_migration_audit,
  public.game_migration_windows FROM PUBLIC, anon, authenticated, service_role;
-- the owner's tool reads everything it decides on (no write: only through the functions)
GRANT SELECT ON public.game_imports, public.game_reconciliations, public.game_legacy_reviews, public.game_migration_audit,
  public.game_migration_windows, public.game_accounts, public.game_ledger, public.game_profile TO game_migration_admin;
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['game_imports', 'game_reconciliations', 'game_legacy_reviews', 'game_migration_audit', 'game_migration_windows',
                           'game_accounts', 'game_ledger', 'game_profile'] LOOP
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
-- the reconciliation of the database (the tool shows it and compares its own with it; it credits nothing), the window
-- and the new-account path; the strict readers are internal
DO $$
DECLARE f TEXT;
BEGIN
  FOREACH f IN ARRAY ARRAY['game_mig_window_closes_at(UUID)', 'game_mig_is_int(JSONB)', 'game_mig_int(JSONB)', 'game_mig_str(JSONB)',
    'game_mig_arr(JSONB)', 'game_mig_obj(JSONB)', 'game_mig_is_day(TEXT)', 'game_mig_iso_time(TEXT)', 'game_mig_reconcile(UUID)',
    'game_mig_activate_new(UUID, TEXT, TEXT)', 'game_mig_extend_window(UUID, TIMESTAMPTZ, TEXT, TEXT)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated, service_role', f);
  END LOOP;
END $$;
GRANT EXECUTE ON FUNCTION public.game_mig_window_closes_at(UUID) TO game_migration_admin;
GRANT EXECUTE ON FUNCTION public.game_mig_reconcile(UUID) TO game_migration_admin;
GRANT EXECUTE ON FUNCTION public.game_mig_activate_new(UUID, TEXT, TEXT) TO game_migration_admin;
GRANT EXECUTE ON FUNCTION public.game_mig_extend_window(UUID, TIMESTAMPTZ, TEXT, TEXT) TO game_migration_admin;
-- state changes are the owner's tool's now (with a reason and the audit): the server route never moves an account
REVOKE EXECUTE ON FUNCTION public.game_economy_transition(UUID, TEXT, TEXT) FROM service_role;
REVOKE EXECUTE ON FUNCTION public.game_begin_migration(UUID) FROM service_role;
REVOKE EXECUTE ON FUNCTION public.game_activate_cloud(UUID, TEXT) FROM service_role;

REVOKE CREATE ON SCHEMA public FROM game_economy_owner;

COMMIT;
