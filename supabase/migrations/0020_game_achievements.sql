-- AYRA Trading — 0020: achievements on the server, large snapshots, privacy and retention (Q4.6,
-- docs/q4-6-achievements-migration.md). NOT APPLIED TO PRODUCTION. Builds on 0019 (Q4.5-4).
--
--   * game_achievement_catalog — the 14 stable profile achievement ids the game ever had (git history: never renamed,
--     never removed, their conditions never changed), with how each can be proven.
--   * game_achievements — one row per account and stable id (profile ids, «category:<id>» for the best rank of a
--     personal-path category, «week:<monday>» for a week trophy): its status (verified / legacy_accepted /
--     pending_review / rejected), the source of that status, what the devices claimed, which snapshots claimed it, the
--     reconciliation it came with, an idempotency key. Written ONLY by the activation (from the accepted snapshots and
--     the database's own reconciliation) and by the owner's decisions; never by a client, never by the route. An
--     achievement pays nothing: no row here touches the ledger, XP or Coins.
--   * The activation records the achievements in the SAME transaction as the ledger and the state; then, and only then,
--     achievements_transferred becomes true (game_reconciliations.achievements_transferred_at).
--   * game_import_snapshot: a snapshot may now be up to 4 MiB as received (the route accepts a gzip body up to 1 MiB
--     for it — the size limits are the route's and the database's both); at most 16 MiB of snapshots per account.
--   * Privacy: deleting an account still deletes every row of it (the cascade, unchanged). Before the per-account
--     decision log goes, its rows are folded into anonymous monthly counts (game_privacy_stats: month, action, count —
--     no id, no amount, no text). Every deletion of game rows is counted per day, cause and table
--     (game_deletion_log) — no id either. Snapshots are purged only by hand (game_mig_purge_snapshots): 90 days after
--     the activation at the earliest, never while anything is open, never a late snapshot.
--
-- Idempotent: safe to run twice.

BEGIN;

GRANT CREATE ON SCHEMA public TO game_economy_owner;

--------------------------------------------------------------------------------
-- 1. The catalog of profile achievements and the server's achievements
--------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.game_achievement_catalog (
  id TEXT PRIMARY KEY CHECK (id ~ '^[A-Za-z0-9]{1,40}$'),
  introduced TEXT NOT NULL,
  -- how the server can prove it from what it has: an event of the reconciliation, a cloud Journal record, the level of
  -- the confirmed XP, a rule true for every account, or nothing (the device's flag only)
  proof TEXT NOT NULL CHECK (proof IN ('event', 'event_or_journal', 'journal', 'level', 'game_rule', 'device_only')),
  rule TEXT NOT NULL
);
ALTER TABLE public.game_achievement_catalog OWNER TO game_economy_owner;
SET LOCAL ROLE game_economy_owner;
INSERT INTO public.game_achievement_catalog (id, introduced, proof, rule) VALUES
  ('firstQuest', 'T3 2026-10-05', 'event', 'at least one quest completed'),
  ('stylist', 'T3 2026-10-05', 'game_rule', 'equipment with at least one slot (every new character has the starter outfit)'),
  ('streakDay', 'T3 2026-10-05', 'event', 'three quests completed on one game day'),
  ('level3', 'T3 2026-10-05', 'level', 'level 3 (280 XP in all: 120 + 160)'),
  ('author', 'T3 2026-10-05', 'device_only', 'a community post (posts were kept on the device only)'),
  ('firstTrade', 'T6a 2026-10-07', 'event_or_journal', 'the trade quest completed, or a first trade'),
  ('consciousRefusal', 'T6c-1 2026-10-08', 'event_or_journal', 'a no-trade day recorded'),
  ('firstPlan', 'T6c-2a 2026-10-08', 'event_or_journal', 'a first day plan'),
  ('firstReview', 'T6c-2a 2026-10-08', 'journal', 'a day plan with its review completed'),
  ('firstNote', 'T6c-2a 2026-10-08', 'event_or_journal', 'a first note'),
  ('plans7', 'T6c-2a 2026-10-08', 'journal', 'seven day plans'),
  ('firstScreenshot', 'T6c-2b 2026-10-08', 'event', 'a first rewarded screenshot'),
  ('firstPropRules', 'T6d 2026-10-09', 'journal', 'prop account rules saved'),
  ('propDisciplined5', 'T6d 2026-10-09', 'device_only', 'five disciplined prop days (a per-day flag kept on the device only)')
ON CONFLICT (id) DO NOTHING;
RESET ROLE;

CREATE TABLE IF NOT EXISTS public.game_achievements (
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  achievement_id TEXT NOT NULL CHECK (achievement_id ~ ('^(firstQuest|stylist|streakDay|level3|author|firstTrade|consciousRefusal|firstPlan|firstReview'
    || '|firstNote|plans7|firstScreenshot|firstPropRules|propDisciplined5|category:(discipline|physical|learning|psychology|trading|habits)'
    || '|week:[0-9]{4}-[0-9]{2}-[0-9]{2})$')),
  family TEXT NOT NULL CHECK (family IN ('profile', 'category', 'week')),
  status TEXT NOT NULL CHECK (status IN ('verified', 'legacy_accepted', 'pending_review', 'rejected')),
  -- why the status: an event of the database's reconciliation, a cloud Journal record, the confirmed level, the level
  -- with the remainder a person accepted, a rule true for every account, or the device's flag only
  source TEXT NOT NULL CHECK (source IN ('reconciled_event', 'journal_record', 'confirmed_level', 'accepted_level', 'game_rule', 'device_flag')),
  -- what the devices said (a rank, a boss — never a number to credit)
  detail JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(detail) = 'object'),
  -- what proved it (keys, counts, the level) — never a Journal record's content
  evidence JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(evidence) = 'object'),
  -- the accepted snapshots that had it (one row however many devices had it)
  claimed_by TEXT[] NOT NULL CHECK (cardinality(claimed_by) >= 1),
  rules_version TEXT NOT NULL DEFAULT 'q4.6',
  reconciliation_id BIGINT REFERENCES public.game_reconciliations(id) ON DELETE CASCADE,
  idempotency_key TEXT NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_by TEXT,
  decided_at TIMESTAMPTZ,
  reason TEXT,
  PRIMARY KEY (user_id, achievement_id),
  UNIQUE (user_id, idempotency_key),
  CHECK (idempotency_key = 'ach:' || achievement_id)
);
ALTER TABLE public.game_achievements OWNER TO game_economy_owner;

ALTER TABLE public.game_reconciliations ADD COLUMN IF NOT EXISTS achievements_transferred_at TIMESTAMPTZ;

--------------------------------------------------------------------------------
-- 2. Privacy: anonymous counts that outlive an account, and the count of every deletion
--------------------------------------------------------------------------------
-- How many decisions of each kind were taken per month — nothing else (no account, snapshot, amount, author or text)
CREATE TABLE IF NOT EXISTS public.game_privacy_stats (
  month DATE NOT NULL CHECK (extract(day FROM month) = 1),
  action TEXT NOT NULL CHECK (action ~ '^[a-z_]{1,40}$'),
  n BIGINT NOT NULL CHECK (n >= 0),
  PRIMARY KEY (month, action)
);
-- How many game rows were deleted per day, cause and table — nothing else
CREATE TABLE IF NOT EXISTS public.game_deletion_log (
  day DATE NOT NULL,
  cause TEXT NOT NULL CHECK (cause IN ('account_deleted', 'retention_purge')),
  table_name TEXT NOT NULL CHECK (table_name ~ '^game_[a-z_]{1,40}$'),
  n BIGINT NOT NULL CHECK (n >= 0),
  PRIMARY KEY (day, cause, table_name)
);
ALTER TABLE public.game_privacy_stats OWNER TO game_economy_owner;
ALTER TABLE public.game_deletion_log OWNER TO game_economy_owner;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['game_achievement_catalog', 'game_achievements', 'game_privacy_stats', 'game_deletion_log'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS tr_%s_owner_only ON public.%I', t, t);
    EXECUTE format('CREATE TRIGGER tr_%s_owner_only BEFORE INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.game_owner_only()', t, t);
  END LOOP;
END $$;

-- The decision log of a deleted account leaves only its monthly counts (the cascade deletes the rows themselves)
CREATE OR REPLACE FUNCTION public.game_privacy_fold_audit()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.game_privacy_stats (month, action, n)
  SELECT date_trunc('month', g.at)::date, CASE WHEN g.action ~ '^[a-z_]{1,40}$' THEN g.action ELSE 'other' END, count(*)
  FROM gone g GROUP BY 1, 2
  ON CONFLICT (month, action) DO UPDATE SET n = public.game_privacy_stats.n + EXCLUDED.n;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Every deleted game row is counted (the cause: a retention purge marks its transaction; anything else is an account
-- deletion — no function here deletes game rows otherwise)
CREATE OR REPLACE FUNCTION public.game_privacy_count_deletion()
RETURNS TRIGGER AS $$
DECLARE
  v_n BIGINT;
BEGIN
  SELECT count(*) INTO v_n FROM gone;
  IF v_n > 0 THEN
    INSERT INTO public.game_deletion_log (day, cause, table_name, n)
    VALUES (CURRENT_DATE, CASE WHEN current_setting('ayra.deletion_cause', TRUE) = 'retention_purge' THEN 'retention_purge' ELSE 'account_deleted' END,
            TG_TABLE_NAME, v_n)
    ON CONFLICT (day, cause, table_name) DO UPDATE SET n = public.game_deletion_log.n + EXCLUDED.n;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
ALTER FUNCTION public.game_privacy_fold_audit() OWNER TO game_economy_owner;
ALTER FUNCTION public.game_privacy_count_deletion() OWNER TO game_economy_owner;

DROP TRIGGER IF EXISTS tr_game_migration_audit_fold ON public.game_migration_audit;
CREATE TRIGGER tr_game_migration_audit_fold AFTER DELETE ON public.game_migration_audit
  REFERENCING OLD TABLE AS gone FOR EACH STATEMENT EXECUTE FUNCTION public.game_privacy_fold_audit();
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['game_imports', 'game_reconciliations', 'game_legacy_reviews', 'game_migration_windows', 'game_migration_audit',
                           'game_achievements', 'game_ledger', 'game_profile', 'game_accounts'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS tr_%s_count_deletion ON public.%I', t, t);
    EXECUTE format('CREATE TRIGGER tr_%s_count_deletion AFTER DELETE ON public.%I REFERENCING OLD TABLE AS gone FOR EACH STATEMENT '
                   'EXECUTE FUNCTION public.game_privacy_count_deletion()', t, t);
  END LOOP;
END $$;

--------------------------------------------------------------------------------
-- 3. Snapshots up to 4 MiB as received; 16 MiB per account
--------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.game_import_snapshot(p_user UUID, p_session UUID, p_iat BIGINT, p_claim TEXT,
  p_snapshot UUID, p_install UUID, p_schema INTEGER, p_content JSONB)
RETURNS JSONB AS $$
DECLARE
  v_state TEXT;
  v_locked TEXT;
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
  IF v_size > 4194304 THEN  -- 4 MiB (Q4.6, measured on synthetic saves: 5 years × 10 quests a day ≈ 3.5 MB)
    RAISE EXCEPTION 'game_import_too_large' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.game_accounts (user_id) VALUES (p_user) ON CONFLICT (user_id) DO NOTHING;
  -- Q4.6 lock order: the account row is locked only AFTER the snapshot row is written (its foreign key takes the user row
  -- first) — the same order as deleting the account (the user row, then its account row by the cascade). In the 0019
  -- order a deletion racing an upload deadlocked and the deletion was aborted (test-concurrency M3).
  SELECT state INTO v_state FROM public.game_accounts WHERE user_id = p_user;
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
  -- PLACEHOLDER (Q4.6): 16 MiB of snapshots per account — four devices of the largest size
  IF (SELECT COALESCE(sum(byte_size), 0) FROM public.game_imports WHERE user_id = p_user) + v_size > 16777216 THEN
    RAISE EXCEPTION 'game_import_quota' USING ERRCODE = '54000';
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
  -- held until the commit: the activation (FOR UPDATE) waits for this snapshot, or this waits for the activation — and
  -- if the account moved meanwhile, nothing is kept: the device's token is stale now, it refreshes and sends again
  SELECT state INTO v_locked FROM public.game_accounts WHERE user_id = p_user FOR SHARE;
  IF v_locked IS DISTINCT FROM v_state THEN
    RAISE EXCEPTION 'game_session_stale' USING ERRCODE = '42501';
  END IF;
  RETURN jsonb_build_object('status', v_status, 'replay', FALSE, 'received_at', now());
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;


--------------------------------------------------------------------------------
-- 4. Which achievements the accepted snapshots carry, and what the server can prove of each
--------------------------------------------------------------------------------
-- From the accepted snapshots (never the late ones), with the database's reconciliation (its events) and the final XP
-- of the activation (proven + the accepted remainder). Pure: writes nothing. A claim of an id that never existed is
-- listed apart (the snapshot keeps it as it came) and is never recorded.
CREATE OR REPLACE FUNCTION public.game_mig_achievement_plan(p_user UUID, p_result JSONB, p_final_xp BIGINT)
RETURNS JSONB AS $$
DECLARE
  c_profile CONSTANT TEXT[] := ARRAY['firstQuest', 'stylist', 'streakDay', 'level3', 'author', 'firstTrade', 'consciousRefusal', 'firstPlan',
    'firstReview', 'firstNote', 'plans7', 'firstScreenshot', 'firstPropRules', 'propDisciplined5'];
  c_cats CONSTANT TEXT[] := ARRAY['discipline', 'physical', 'learning', 'psychology', 'trading', 'habits'];
  c_ranks CONSTANT TEXT[] := ARRAY['bronze', 'silver', 'gold'];
  s RECORD;
  c RECORD;
  k TEXT;
  x JSONB;
  v_events JSONB := COALESCE(p_result -> 'events', '[]'::jsonb);
  v_claims JSONB := '[]';
  v_unknown JSONB := '[]';
  v_items JSONB := '[]';
  v_status TEXT;
  v_source TEXT;
  v_evidence JSONB;
  v_detail JSONB;
  v_found TEXT;
  v_n BIGINT;
BEGIN
  FOR s IN SELECT snapshot_id::text AS id, content FROM public.game_imports
           WHERE user_id = p_user AND status = 'accepted' ORDER BY snapshot_id::text COLLATE "C" LOOP
    FOR k, x IN SELECT key, value FROM jsonb_each(public.game_mig_obj(s.content -> 'achievements')) LOOP
      IF x IS DISTINCT FROM 'true'::jsonb THEN
        CONTINUE;  -- not unlocked on this device
      END IF;
      IF k = ANY (c_profile) THEN
        v_claims := v_claims || jsonb_build_object('id', k, 'family', 'profile', 'snap', s.id, 'detail', '{}'::jsonb);
      ELSE
        v_unknown := v_unknown || jsonb_build_object('snapshot', s.id, 'where', 'achievements', 'key', left(k, 80));
      END IF;
    END LOOP;
    FOR k, x IN SELECT key, value FROM jsonb_each(public.game_mig_obj(s.content -> 'personalAchievements')) LOOP
      IF k = ANY (c_cats) AND COALESCE(public.game_mig_str(x -> 'rank') = ANY (c_ranks), FALSE)
         AND COALESCE(public.game_mig_str(x -> 'runId') ~ '^[A-Za-z0-9_.-]{1,80}$', FALSE) AND public.game_mig_is_day(public.game_mig_str(x -> 'day')) THEN
        v_claims := v_claims || jsonb_build_object('id', 'category:' || k, 'family', 'category', 'snap', s.id,
          'detail', jsonb_build_object('rank', x ->> 'rank', 'runId', x ->> 'runId', 'day', x ->> 'day'));
      ELSE
        v_unknown := v_unknown || jsonb_build_object('snapshot', s.id, 'where', 'personalAchievements', 'key', left(k, 80));
      END IF;
    END LOOP;
    FOR x IN SELECT value FROM jsonb_array_elements(public.game_mig_arr(s.content -> 'weekTrophies')) LOOP
      IF public.game_mig_is_day(public.game_mig_str(x -> 'week')) AND COALESCE(public.game_mig_str(x -> 'boss') ~ '^[A-Za-z0-9_.-]{1,40}$', FALSE) THEN
        v_claims := v_claims || jsonb_build_object('id', 'week:' || (x ->> 'week'), 'family', 'week', 'snap', s.id,
          'detail', jsonb_build_object('boss', x ->> 'boss'));
      ELSE
        v_unknown := v_unknown || jsonb_build_object('snapshot', s.id, 'where', 'weekTrophies', 'key', left(COALESCE(x ->> 'week', '?'), 80));
      END IF;
    END LOOP;
  END LOOP;

  -- one item per stable id, however many devices had it
  FOR c IN SELECT * FROM (
             SELECT cl ->> 'id' AS id, min(cl ->> 'family') AS family,
                    jsonb_agg(DISTINCT cl ->> 'snap' ORDER BY cl ->> 'snap') AS snaps,
                    jsonb_agg(cl -> 'detail' ORDER BY cl ->> 'snap' COLLATE "C") AS details
             FROM jsonb_array_elements(v_claims) cl GROUP BY cl ->> 'id') g
           ORDER BY g.id COLLATE "C" LOOP
    v_status := 'pending_review';
    v_source := 'device_flag';
    v_evidence := '{}';
    v_detail := c.details -> 0;
    v_found := NULL;
    IF c.family = 'profile' THEN
      CASE c.id
        WHEN 'firstQuest' THEN
          SELECT e ->> 'key' INTO v_found FROM jsonb_array_elements(v_events) e WHERE e ->> 'kind' = 'quest' ORDER BY e ->> 'key' COLLATE "C" LIMIT 1;
        WHEN 'streakDay' THEN
          SELECT q.day INTO v_found FROM (SELECT e ->> 'day' AS day FROM jsonb_array_elements(v_events) e WHERE e ->> 'kind' = 'quest'
                                           GROUP BY e ->> 'day' HAVING count(*) >= 3) q ORDER BY q.day COLLATE "C" LIMIT 1;
        WHEN 'firstTrade' THEN
          SELECT e ->> 'key' INTO v_found FROM jsonb_array_elements(v_events) e
          WHERE e ->> 'key' = 'first:trade' OR e ->> 'key' ~ '^quest:[0-9]{4}-[0-9]{2}-[0-9]{2}:q_tradelog$' ORDER BY e ->> 'key' COLLATE "C" LIMIT 1;
          IF v_found IS NULL THEN SELECT count(*) INTO v_n FROM public.journal_trades WHERE user_id = p_user; END IF;
          IF v_found IS NULL AND v_n > 0 THEN v_status := 'verified'; v_source := 'journal_record'; v_evidence := jsonb_build_object('table', 'journal_trades', 'records', v_n); END IF;
        WHEN 'consciousRefusal' THEN
          SELECT e ->> 'key' INTO v_found FROM jsonb_array_elements(v_events) e WHERE e ->> 'key' = 'first:noTrade' LIMIT 1;
          IF v_found IS NULL THEN SELECT count(*) INTO v_n FROM public.journal_no_trades WHERE user_id = p_user; END IF;
          IF v_found IS NULL AND v_n > 0 THEN v_status := 'verified'; v_source := 'journal_record'; v_evidence := jsonb_build_object('table', 'journal_no_trades', 'records', v_n); END IF;
        WHEN 'firstPlan' THEN
          SELECT e ->> 'key' INTO v_found FROM jsonb_array_elements(v_events) e WHERE e ->> 'key' = 'first:dayPlan' LIMIT 1;
          IF v_found IS NULL THEN SELECT count(*) INTO v_n FROM public.journal_day_plans WHERE user_id = p_user; END IF;
          IF v_found IS NULL AND v_n > 0 THEN v_status := 'verified'; v_source := 'journal_record'; v_evidence := jsonb_build_object('table', 'journal_day_plans', 'records', v_n); END IF;
        WHEN 'firstNote' THEN
          SELECT e ->> 'key' INTO v_found FROM jsonb_array_elements(v_events) e WHERE e ->> 'key' = 'first:note' LIMIT 1;
          IF v_found IS NULL THEN SELECT count(*) INTO v_n FROM public.journal_notes WHERE user_id = p_user; END IF;
          IF v_found IS NULL AND v_n > 0 THEN v_status := 'verified'; v_source := 'journal_record'; v_evidence := jsonb_build_object('table', 'journal_notes', 'records', v_n); END IF;
        WHEN 'firstReview' THEN
          SELECT count(*) INTO v_n FROM public.journal_day_plans WHERE user_id = p_user AND jsonb_typeof(data -> 'review' -> 'completedAt') = 'string';
          IF v_n > 0 THEN v_status := 'verified'; v_source := 'journal_record'; v_evidence := jsonb_build_object('table', 'journal_day_plans', 'reviewed', v_n); END IF;
        WHEN 'plans7' THEN
          SELECT count(*) INTO v_n FROM public.journal_day_plans WHERE user_id = p_user;
          IF v_n >= 7 THEN v_status := 'verified'; v_source := 'journal_record'; v_evidence := jsonb_build_object('table', 'journal_day_plans', 'records', v_n); END IF;
        WHEN 'firstPropRules' THEN
          SELECT count(*) INTO v_n FROM public.journal_accounts WHERE user_id = p_user AND jsonb_typeof(data -> 'propRules') = 'object';
          IF v_n > 0 THEN v_status := 'verified'; v_source := 'journal_record'; v_evidence := jsonb_build_object('table', 'journal_accounts', 'withPropRules', v_n); END IF;
        WHEN 'firstScreenshot' THEN
          SELECT e ->> 'key' INTO v_found FROM jsonb_array_elements(v_events) e WHERE e ->> 'key' = 'first:screenshot' LIMIT 1;
        WHEN 'level3' THEN
          IF public.game_level_for_xp(COALESCE((p_result -> 'proposed' ->> 'confirmedXp')::BIGINT, 0)) >= 3 THEN
            v_status := 'verified'; v_source := 'confirmed_level';
            v_evidence := jsonb_build_object('confirmedXp', (p_result -> 'proposed' ->> 'confirmedXp')::BIGINT);
          ELSIF p_final_xp IS NOT NULL AND public.game_level_for_xp(p_final_xp) >= 3 THEN
            -- the level only with the remainder a person accepted: never shown as independently proven
            v_status := 'legacy_accepted'; v_source := 'accepted_level'; v_evidence := jsonb_build_object('finalXp', p_final_xp);
          END IF;
        WHEN 'stylist' THEN
          v_status := 'verified'; v_source := 'game_rule'; v_evidence := jsonb_build_object('rule', 'every character starts with an outfit (T3)');
        ELSE
          NULL;  -- author, propDisciplined5: the device's flag only
      END CASE;
      IF v_found IS NOT NULL THEN
        v_status := 'verified';
        v_source := 'reconciled_event';
        v_evidence := CASE WHEN c.id = 'streakDay' THEN jsonb_build_object('day', v_found) ELSE jsonb_build_object('key', v_found) END;
      END IF;
    ELSIF c.family = 'category' THEN
      -- proven when a claimed best run is a PAID personal quest of the reconciliation with this category and rank
      SELECT d INTO v_detail FROM jsonb_array_elements(c.details) d
      WHERE ('pq:' || (d ->> 'runId')) IN (SELECT e ->> 'key' FROM jsonb_array_elements(v_events) e)
        AND EXISTS (SELECT 1 FROM public.game_imports i, jsonb_array_elements(public.game_mig_arr(i.content -> 'personalLedger')) l
                    WHERE i.user_id = p_user AND i.status = 'accepted' AND l -> 'paid' = 'true'::jsonb AND l ->> 'runId' = d ->> 'runId'
                      AND l ->> 'category' = substr(c.id, 10) AND l ->> 'rank' = d ->> 'rank')
      ORDER BY array_position(c_ranks, d ->> 'rank') DESC LIMIT 1;
      IF v_detail IS NOT NULL THEN
        v_status := 'verified'; v_source := 'reconciled_event'; v_evidence := jsonb_build_object('key', 'pq:' || (v_detail ->> 'runId'));
      ELSE
        SELECT d INTO v_detail FROM jsonb_array_elements(c.details) d ORDER BY array_position(c_ranks, d ->> 'rank') DESC LIMIT 1;
      END IF;
      IF (SELECT count(DISTINCT d ->> 'rank') FROM jsonb_array_elements(c.details) d) > 1 THEN
        v_evidence := v_evidence || jsonb_build_object('ranksClaimed', (SELECT jsonb_agg(DISTINCT d ->> 'rank') FROM jsonb_array_elements(c.details) d));
      END IF;
    ELSE
      -- a week trophy: kept on the device only (the week's journal check ran there)
      IF (SELECT count(DISTINCT d ->> 'boss') FROM jsonb_array_elements(c.details) d) > 1 THEN
        v_evidence := jsonb_build_object('bossesClaimed', (SELECT jsonb_agg(DISTINCT d ->> 'boss') FROM jsonb_array_elements(c.details) d));
      END IF;
    END IF;
    v_items := v_items || jsonb_build_object('id', c.id, 'family', c.family, 'status', v_status, 'source', v_source,
      'detail', COALESCE(v_detail, '{}'::jsonb), 'evidence', v_evidence, 'claimedBy', c.snaps);
  END LOOP;
  RETURN jsonb_build_object('items', v_items, 'unknown', v_unknown,
    'counts', (SELECT jsonb_object_agg(st, n) FROM (SELECT i ->> 'status' AS st, count(*) AS n FROM jsonb_array_elements(v_items) i GROUP BY 1) q));
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public;

-- Record a plan (inside an activation, or for an account activated before 0020): one row per id, never twice
CREATE OR REPLACE FUNCTION public.game_mig_record_achievements(p_user UUID, p_reconciliation BIGINT, p_plan JSONB)
RETURNS JSONB AS $$
DECLARE
  v_new BIGINT;
BEGIN
  INSERT INTO public.game_achievements (user_id, achievement_id, family, status, source, detail, evidence, claimed_by, reconciliation_id, idempotency_key)
  SELECT p_user, i ->> 'id', i ->> 'family', i ->> 'status', i ->> 'source', i -> 'detail', i -> 'evidence',
         ARRAY(SELECT jsonb_array_elements_text(i -> 'claimedBy')), p_reconciliation, 'ach:' || (i ->> 'id')
  FROM jsonb_array_elements(COALESCE(p_plan -> 'items', '[]'::jsonb)) i
  ON CONFLICT (user_id, achievement_id) DO NOTHING;
  GET DIAGNOSTICS v_new = ROW_COUNT;
  UPDATE public.game_reconciliations SET achievements_transferred_at = now() WHERE id = p_reconciliation AND achievements_transferred_at IS NULL;
  RETURN jsonb_build_object('recorded', v_new, 'counts', COALESCE(p_plan -> 'counts', '{}'::jsonb), 'unknown', jsonb_array_length(COALESCE(p_plan -> 'unknown', '[]'::jsonb)));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

--------------------------------------------------------------------------------
-- 5. The activation records the achievements in the same transaction
--------------------------------------------------------------------------------
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
  v_plan JSONB;
  v_ach JSONB;
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
  -- Q4.6: the achievements of the accepted snapshots, in this same transaction (none of them pays anything)
  v_plan := public.game_mig_achievement_plan(p_user, v_now, v_xp);
  v_ach := public.game_mig_record_achievements(p_user, p_reconciliation, v_plan);
  UPDATE public.game_reconciliations SET status = 'activated', activated_by = p_actor, activated_at = now(), level_gap_ack = p_level_gap_ack WHERE id = p_reconciliation;
  PERFORM public.game_mig_audit(p_actor, 'activated', p_user, jsonb_build_object('reconciliation', p_reconciliation, 'result_md5', v_rec.result_md5,
    'xp', v_xp, 'coins', v_coins, 'level', v_level, 'original_level', v_orig, 'level_gap_ack', p_level_gap_ack, 'legacy', v_legacy.snapshot_id,
    'achievements_transferred', TRUE, 'achievements', v_ach, 'unknown_achievements', v_plan -> 'unknown'));
  RETURN jsonb_build_object('state', 'cloud_active', 'replay', FALSE, 'xp', v_xp, 'coins', v_coins, 'level', v_level,
    'achievements_transferred', TRUE, 'achievements', v_ach);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;


-- An account activated before 0020 (achievements_transferred false): its achievements, from the snapshots and the
-- reconciliation it was activated with, once
CREATE OR REPLACE FUNCTION public.game_mig_transfer_achievements(p_user UUID, p_actor TEXT)
RETURNS JSONB AS $$
DECLARE
  v_rec public.game_reconciliations%ROWTYPE;
  v_plan JSONB;
  v_out JSONB;
  v_xp BIGINT;
BEGIN
  IF p_actor IS NULL OR length(btrim(p_actor)) = 0 THEN
    RAISE EXCEPTION 'game_mig_actor_required' USING ERRCODE = '22023';
  END IF;
  PERFORM 1 FROM public.game_accounts WHERE user_id = p_user AND state = 'cloud_active' FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'game_mig_not_active' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_rec FROM public.game_reconciliations WHERE user_id = p_user AND status = 'activated';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'game_mig_no_such_reconciliation' USING ERRCODE = '22023';
  END IF;
  IF v_rec.achievements_transferred_at IS NOT NULL THEN
    RETURN jsonb_build_object('achievements_transferred', TRUE, 'replay', TRUE);
  END IF;
  SELECT COALESCE(sum(xp), 0) INTO v_xp FROM public.game_ledger WHERE user_id = p_user AND kind IN ('migration_import', 'migration_legacy');
  v_plan := public.game_mig_achievement_plan(p_user, v_rec.result, v_xp);
  v_out := public.game_mig_record_achievements(p_user, v_rec.id, v_plan);
  PERFORM public.game_mig_audit(p_actor, 'achievements_transferred', p_user, jsonb_build_object('reconciliation', v_rec.id, 'summary', v_out,
    'unknown', v_plan -> 'unknown'));
  RETURN jsonb_build_object('achievements_transferred', TRUE, 'replay', FALSE) || v_out;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- A person's decision on an achievement that the server could not prove (always with a reason; verified ones are
-- proven by the server and are never changed by hand). Rejected is never deleted: the row stays with its history.
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

--------------------------------------------------------------------------------
-- 6. The person's own achievements (the app's server route, with a fresh session)
--------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.game_achievements_for_session(p_user UUID, p_session UUID, p_iat BIGINT, p_claim TEXT)
RETURNS JSONB AS $$
DECLARE
  v_check JSONB;
  v_state TEXT;
  v_transferred BOOLEAN;
BEGIN
  v_check := public.game_session_check(p_user, p_session, p_iat, p_claim);
  IF NOT (v_check ->> 'fresh')::BOOLEAN THEN
    RAISE EXCEPTION 'game_session_stale' USING ERRCODE = '42501';
  END IF;
  SELECT state INTO v_state FROM public.game_accounts WHERE user_id = p_user;
  v_state := COALESCE(v_state, 'local');
  IF v_state <> 'cloud_active' THEN
    RETURN jsonb_build_object('state', v_state, 'transferred', FALSE, 'achievements', '[]'::jsonb);
  END IF;
  -- transferred: the activation recorded them (a new account had nothing to transfer)
  v_transferred := EXISTS (SELECT 1 FROM public.game_reconciliations WHERE user_id = p_user AND status = 'activated' AND achievements_transferred_at IS NOT NULL)
                OR EXISTS (SELECT 1 FROM public.game_migration_audit WHERE user_id = p_user AND action = 'activated_new_account');
  RETURN jsonb_build_object('state', v_state, 'transferred', v_transferred,
    'achievements', (SELECT COALESCE(jsonb_agg(jsonb_build_object('id', achievement_id, 'family', family, 'status', status, 'detail', detail,
                       'recordedAt', recorded_at) ORDER BY achievement_id COLLATE "C"), '[]'::jsonb)
                     FROM public.game_achievements WHERE user_id = p_user));
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public;

--------------------------------------------------------------------------------
-- 7. Retention: snapshots purged by hand only, when nothing about them is open
--------------------------------------------------------------------------------
-- At the earliest 90 days after the activation (owner decision); refused while a remainder or an achievement waits for
-- a decision; a late snapshot is never purged (it waits for its own review). The decision log keeps what was decided
-- (numbers, never content) as long as the account exists.
CREATE OR REPLACE FUNCTION public.game_mig_purge_snapshots(p_user UUID, p_actor TEXT, p_reason TEXT)
RETURNS JSONB AS $$
DECLARE
  v_rec public.game_reconciliations%ROWTYPE;
  v_n BIGINT;
  v_md5 JSONB;
BEGIN
  IF p_actor IS NULL OR length(btrim(p_actor)) = 0 THEN
    RAISE EXCEPTION 'game_mig_actor_required' USING ERRCODE = '22023';
  END IF;
  IF p_reason IS NULL OR length(btrim(p_reason)) = 0 THEN
    RAISE EXCEPTION 'game_mig_reason_required' USING ERRCODE = '22023';
  END IF;
  PERFORM 1 FROM public.game_accounts WHERE user_id = p_user AND state = 'cloud_active' FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'game_mig_not_active' USING ERRCODE = '22023';  -- a migration in progress keeps everything
  END IF;
  SELECT * INTO v_rec FROM public.game_reconciliations WHERE user_id = p_user AND status = 'activated';
  IF NOT FOUND OR v_rec.activated_at > now() - interval '90 days' THEN
    RAISE EXCEPTION 'game_mig_retention_not_reached' USING ERRCODE = '22023', DETAIL = format('activated at %s', v_rec.activated_at);
  END IF;
  IF v_rec.achievements_transferred_at IS NULL THEN
    RAISE EXCEPTION 'game_mig_achievements_not_transferred' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM public.game_legacy_reviews WHERE user_id = p_user AND status IN ('pending_review', 'needs_evidence'))
     OR EXISTS (SELECT 1 FROM public.game_achievements WHERE user_id = p_user AND status = 'pending_review') THEN
    RAISE EXCEPTION 'game_mig_open_review' USING ERRCODE = '22023';
  END IF;
  SELECT count(*), COALESCE(jsonb_agg(snapshot_id::text || ':' || content_md5 ORDER BY snapshot_id), '[]'::jsonb) INTO v_n, v_md5
  FROM public.game_imports WHERE user_id = p_user AND status IN ('accepted', 'duplicate_install');
  PERFORM set_config('ayra.deletion_cause', 'retention_purge', TRUE);
  DELETE FROM public.game_imports WHERE user_id = p_user AND status IN ('accepted', 'duplicate_install');
  PERFORM set_config('ayra.deletion_cause', '', TRUE);
  PERFORM public.game_mig_audit(p_actor, 'snapshots_purged', p_user, jsonb_build_object('snapshots', v_n, 'ids_md5', v_md5, 'reason', p_reason,
    'kept_late', (SELECT count(*) FROM public.game_imports WHERE user_id = p_user AND status = 'late')));
  RETURN jsonb_build_object('purged', v_n);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

--------------------------------------------------------------------------------
-- 8. Ownership and access
--------------------------------------------------------------------------------
ALTER FUNCTION public.game_mig_achievement_plan(UUID, JSONB, BIGINT) OWNER TO game_economy_owner;
ALTER FUNCTION public.game_mig_record_achievements(UUID, BIGINT, JSONB) OWNER TO game_economy_owner;
ALTER FUNCTION public.game_mig_transfer_achievements(UUID, TEXT) OWNER TO game_economy_owner;
ALTER FUNCTION public.game_mig_decide_achievement(UUID, TEXT, TEXT, TEXT, TEXT) OWNER TO game_economy_owner;
ALTER FUNCTION public.game_achievements_for_session(UUID, UUID, BIGINT, TEXT) OWNER TO game_economy_owner;
ALTER FUNCTION public.game_mig_purge_snapshots(UUID, TEXT, TEXT) OWNER TO game_economy_owner;
ALTER FUNCTION public.game_mig_activate(UUID, BIGINT, TEXT, TEXT) OWNER TO game_economy_owner;
ALTER FUNCTION public.game_import_snapshot(UUID, UUID, BIGINT, TEXT, UUID, UUID, INTEGER, JSONB) OWNER TO game_economy_owner;

ALTER TABLE public.game_achievement_catalog ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.game_achievements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.game_privacy_stats ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.game_deletion_log ENABLE ROW LEVEL SECURITY;
-- no API role reads or writes any of them (the person's achievements come through the session function)
REVOKE ALL ON public.game_achievement_catalog, public.game_achievements, public.game_privacy_stats, public.game_deletion_log
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.game_achievement_catalog, public.game_achievements, public.game_privacy_stats, public.game_deletion_log TO game_migration_admin;
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['game_achievement_catalog', 'game_achievements', 'game_privacy_stats', 'game_deletion_log'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_mig_admin_read', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO game_migration_admin USING (TRUE)', t || '_mig_admin_read', t);
  END LOOP;
END $$;

DO $$
DECLARE f TEXT;
BEGIN
  FOREACH f IN ARRAY ARRAY['game_mig_achievement_plan(UUID, JSONB, BIGINT)', 'game_mig_record_achievements(UUID, BIGINT, JSONB)',
    'game_mig_transfer_achievements(UUID, TEXT)', 'game_mig_decide_achievement(UUID, TEXT, TEXT, TEXT, TEXT)',
    'game_achievements_for_session(UUID, UUID, BIGINT, TEXT)', 'game_mig_purge_snapshots(UUID, TEXT, TEXT)',
    'game_privacy_fold_audit()', 'game_privacy_count_deletion()'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated, service_role', f);
  END LOOP;
END $$;
-- the route: only the person's own read, with a fresh session
GRANT EXECUTE ON FUNCTION public.game_achievements_for_session(UUID, UUID, BIGINT, TEXT) TO service_role;
-- the owner's tool: the plan (it changes nothing), the transfer of an earlier activation, decisions, the purge
GRANT EXECUTE ON FUNCTION public.game_mig_achievement_plan(UUID, JSONB, BIGINT) TO game_migration_admin;
GRANT EXECUTE ON FUNCTION public.game_mig_transfer_achievements(UUID, TEXT) TO game_migration_admin;
GRANT EXECUTE ON FUNCTION public.game_mig_decide_achievement(UUID, TEXT, TEXT, TEXT, TEXT) TO game_migration_admin;
GRANT EXECUTE ON FUNCTION public.game_mig_purge_snapshots(UUID, TEXT, TEXT) TO game_migration_admin;

REVOKE CREATE ON SCHEMA public FROM game_economy_owner;

COMMIT;
