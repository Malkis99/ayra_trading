-- AYRA Trading — Migration 0004: Journal tables for cloud sync (T7b-2) + per-account sync flag
-- Requires 0001–0003. Safe to run more than once (idempotent). Apply in the Supabase SQL Editor.
-- Plan: docs/t7b-sync-plan.md (sections 4.1, 5, 6.3; owner answers 2026-10-18).
--
-- * One table per journal entity. The record is stored whole in `data` (jsonb, app format; the record's schema
--   version lives inside it). Search/filter columns (account_id, opened_at, instrument, direction, result,
--   date_key, client_updated_at, deleted_at) are filled by the server from `data` — the client cannot make them disagree.
-- * `updated_at` is set only by the server (pull cursor). Last-write-wins by `client_updated_at` (data.updatedAt):
--   an UPDATE carrying an older version is silently skipped. The conflict dialog is the app's job.
-- * No DELETE for clients: deletion is soft (data.deletedAt -> deleted_at, a "tombstone").
-- * RLS: a user sees and changes only their own rows. Writes are allowed only when cloud sync is enabled
--   for the account (public.user_features.cloud_sync, set by the owner only). Flag off = app works locally as today.
-- * No XP / coins here: progress is server-only (ledger, migration 0007). `data` may not carry reward keys.

BEGIN;

--------------------------------------------------------------------------------
-- 1. Per-account feature flag (rollout: owner -> closed beta -> everyone; rollback = turn off)
--------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.user_features (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  cloud_sync BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.user_features ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.user_features FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.user_features TO authenticated;

DROP POLICY IF EXISTS user_features_select_own ON public.user_features;
CREATE POLICY user_features_select_own ON public.user_features
  FOR SELECT USING (auth.uid() = user_id);

DROP TRIGGER IF EXISTS tr_user_features_updated_at ON public.user_features;
CREATE TRIGGER tr_user_features_updated_at
  BEFORE UPDATE ON public.user_features
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE FUNCTION public.cloud_sync_enabled()
RETURNS BOOLEAN AS $$
  SELECT COALESCE((SELECT cloud_sync FROM public.user_features WHERE user_id = auth.uid()), FALSE);
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION public.cloud_sync_enabled() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cloud_sync_enabled() TO authenticated;

--------------------------------------------------------------------------------
-- 2. Journal tables
--------------------------------------------------------------------------------
-- Common columns: user_id, id (app id: tr_…, acc_…; plans use their date), data, client_updated_at,
-- updated_at (server), deleted_at, device_id. PLACEHOLDER: max record size 256 KB.

CREATE TABLE IF NOT EXISTS public.journal_accounts (
  user_id UUID NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  id TEXT NOT NULL CHECK (char_length(id) BETWEEN 1 AND 64),
  data JSONB NOT NULL,
  client_updated_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  device_id TEXT CHECK (device_id IS NULL OR char_length(device_id) <= 64),
  PRIMARY KEY (user_id, id)
);

CREATE TABLE IF NOT EXISTS public.journal_trades (
  user_id UUID NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  id TEXT NOT NULL CHECK (char_length(id) BETWEEN 1 AND 64),
  data JSONB NOT NULL,
  account_id TEXT NOT NULL,
  opened_at TIMESTAMPTZ NOT NULL,
  instrument TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('long', 'short')),
  result TEXT NOT NULL CHECK (result IN ('win', 'loss', 'breakeven')),
  client_updated_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  device_id TEXT CHECK (device_id IS NULL OR char_length(device_id) <= 64),
  PRIMARY KEY (user_id, id)
);

CREATE TABLE IF NOT EXISTS public.journal_strategies (
  user_id UUID NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  id TEXT NOT NULL CHECK (char_length(id) BETWEEN 1 AND 64),
  data JSONB NOT NULL,
  client_updated_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  device_id TEXT CHECK (device_id IS NULL OR char_length(device_id) <= 64),
  PRIMARY KEY (user_id, id)
);

CREATE TABLE IF NOT EXISTS public.journal_no_trades (
  user_id UUID NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  id TEXT NOT NULL CHECK (char_length(id) BETWEEN 1 AND 64),
  data JSONB NOT NULL,
  account_id TEXT,
  date_key TEXT NOT NULL,
  instrument TEXT,
  client_updated_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  device_id TEXT CHECK (device_id IS NULL OR char_length(device_id) <= 64),
  PRIMARY KEY (user_id, id)
);

-- Day plans: id = data.date (YYYY-MM-DD)
CREATE TABLE IF NOT EXISTS public.journal_day_plans (
  user_id UUID NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  id TEXT NOT NULL CHECK (id ~ '^\d{4}-\d{2}-\d{2}$'),
  data JSONB NOT NULL,
  client_updated_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  device_id TEXT CHECK (device_id IS NULL OR char_length(device_id) <= 64),
  PRIMARY KEY (user_id, id)
);

-- Week plans: id = data.weekStartDate (Monday, YYYY-MM-DD)
CREATE TABLE IF NOT EXISTS public.journal_week_plans (
  user_id UUID NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  id TEXT NOT NULL CHECK (id ~ '^\d{4}-\d{2}-\d{2}$'),
  data JSONB NOT NULL,
  client_updated_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  device_id TEXT CHECK (device_id IS NULL OR char_length(device_id) <= 64),
  PRIMARY KEY (user_id, id)
);

CREATE TABLE IF NOT EXISTS public.journal_notes (
  user_id UUID NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  id TEXT NOT NULL CHECK (char_length(id) BETWEEN 1 AND 64),
  data JSONB NOT NULL,
  client_updated_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  device_id TEXT CHECK (device_id IS NULL OR char_length(device_id) <= 64),
  PRIMARY KEY (user_id, id)
);

CREATE TABLE IF NOT EXISTS public.journal_import_batches (
  user_id UUID NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  id TEXT NOT NULL CHECK (char_length(id) BETWEEN 1 AND 64),
  data JSONB NOT NULL,
  account_id TEXT,
  client_updated_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  device_id TEXT CHECK (device_id IS NULL OR char_length(device_id) <= 64),
  PRIMARY KEY (user_id, id)
);

-- Journal-wide settings (primary prop account): one row per user, id = 'journal'
CREATE TABLE IF NOT EXISTS public.journal_settings (
  user_id UUID NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  id TEXT NOT NULL CHECK (id = 'journal'),
  data JSONB NOT NULL,
  client_updated_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  device_id TEXT CHECK (device_id IS NULL OR char_length(device_id) <= 64),
  PRIMARY KEY (user_id, id)
);

CREATE INDEX IF NOT EXISTS journal_trades_user_opened_idx ON public.journal_trades (user_id, opened_at);
CREATE INDEX IF NOT EXISTS journal_trades_user_account_idx ON public.journal_trades (user_id, account_id);
CREATE INDEX IF NOT EXISTS journal_no_trades_user_date_idx ON public.journal_no_trades (user_id, date_key);

--------------------------------------------------------------------------------
-- 3. Server-side fill of derived columns + last-write-wins guard
--------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.journal_row_before_write()
RETURNS TRIGGER AS $$
DECLARE
  c_max_clock_skew CONSTANT INTERVAL := INTERVAL '5 minutes'; -- PLACEHOLDER (plan, section 10)
  v_id_key TEXT := CASE TG_TABLE_NAME
    WHEN 'journal_day_plans' THEN 'date'
    WHEN 'journal_week_plans' THEN 'weekStartDate'
    ELSE 'id' END;
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW.user_id IS DISTINCT FROM OLD.user_id OR NEW.id IS DISTINCT FROM OLD.id) THEN
    RAISE EXCEPTION 'journal_row_identity_immutable';
  END IF;
  IF NEW.data ->> v_id_key IS DISTINCT FROM NEW.id THEN
    RAISE EXCEPTION 'journal_row_id_mismatch';
  END IF;

  NEW.client_updated_at := COALESCE((NEW.data ->> 'updatedAt')::timestamptz, (NEW.data ->> 'createdAt')::timestamptz);
  IF NEW.client_updated_at IS NULL THEN
    RAISE EXCEPTION 'journal_row_missing_updated_at';
  END IF;
  IF NEW.client_updated_at > now() + c_max_clock_skew THEN
    RAISE EXCEPTION 'journal_row_from_future';
  END IF;

  -- Last-write-wins: an older version never overwrites a newer one (same time = retry, allowed)
  IF TG_OP = 'UPDATE' AND NEW.client_updated_at < OLD.client_updated_at THEN
    RETURN NULL;
  END IF;

  NEW.deleted_at := (NEW.data ->> 'deletedAt')::timestamptz;
  NEW.updated_at := now();

  IF TG_TABLE_NAME = 'journal_trades' THEN
    NEW.account_id := NEW.data ->> 'accountId';
    NEW.opened_at := (NEW.data ->> 'openedAt')::timestamptz;
    NEW.instrument := NEW.data ->> 'instrument';
    NEW.direction := NEW.data ->> 'direction';
    NEW.result := NEW.data ->> 'result';
  ELSIF TG_TABLE_NAME = 'journal_no_trades' THEN
    NEW.account_id := NEW.data ->> 'accountId';
    NEW.date_key := left(NEW.data ->> 'date', 10);
    NEW.instrument := NEW.data ->> 'instrument';
  ELSIF TG_TABLE_NAME = 'journal_import_batches' THEN
    NEW.account_id := NEW.data ->> 'accountId';
    NEW.deleted_at := COALESCE(NEW.deleted_at, (NEW.data ->> 'undoneAt')::timestamptz);
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

--------------------------------------------------------------------------------
-- 4. Common rules for every journal table: checks, trigger, indexes, grants, RLS
--------------------------------------------------------------------------------
DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'journal_accounts', 'journal_trades', 'journal_strategies', 'journal_no_trades',
    'journal_day_plans', 'journal_week_plans', 'journal_notes', 'journal_import_batches', 'journal_settings'
  ] LOOP
    -- data: a JSON object, size limit, no reward fields (XP / coins are server-only)
    EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT IF EXISTS %I', t, t || '_data_check');
    EXECUTE format($f$ALTER TABLE public.%I ADD CONSTRAINT %I CHECK (
      jsonb_typeof(data) = 'object'
      AND octet_length(data::text) <= 262144
      AND NOT (data ?| ARRAY['xp', 'coins', 'xpAwarded', 'coinsAwarded', 'reward', 'rewards'])
    )$f$, t, t || '_data_check');

    EXECUTE format('DROP TRIGGER IF EXISTS tr_%s_before_write ON public.%I', t, t);
    EXECUTE format('CREATE TRIGGER tr_%s_before_write BEFORE INSERT OR UPDATE ON public.%I
      FOR EACH ROW EXECUTE FUNCTION public.journal_row_before_write()', t, t);

    -- pull cursor: "what changed since last sync"
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON public.%I (user_id, updated_at)', t || '_user_updated_idx', t);

    -- Clients: read own rows, insert/upsert own rows. No DELETE (soft delete only).
    -- Derived columns, updated_at and deleted_at are not writable (the trigger fills them).
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated', t);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated', t);
    EXECUTE format('GRANT INSERT (user_id, id, data, device_id) ON public.%I TO authenticated', t);
    EXECUTE format('GRANT UPDATE (user_id, id, data, device_id) ON public.%I TO authenticated', t);

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_select_own', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT USING (auth.uid() = user_id)', t || '_select_own', t);

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_insert_own', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR INSERT
      WITH CHECK (auth.uid() = user_id AND public.cloud_sync_enabled())', t || '_insert_own', t);

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_update_own', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR UPDATE
      USING (auth.uid() = user_id)
      WITH CHECK (auth.uid() = user_id AND public.cloud_sync_enabled())', t || '_update_own', t);
  END LOOP;
END $$;

COMMIT;
