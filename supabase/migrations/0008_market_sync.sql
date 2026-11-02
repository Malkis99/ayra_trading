-- AYRA Trading — Migration 0008: Market data in the account (Watchlist, notes per instrument, chart view)
-- Requires 0004 (public.user_features, public.cloud_sync_enabled()). Safe to run more than once (idempotent).
-- Apply in the Supabase SQL Editor. Numbers 0006 (profile and character) and 0007 (server economy) stay reserved.
--
-- Same approach as the journal (0004):
-- * One row per item: id = 'watchlist' | 'chart_view' | 'note:<instrument id>'. The item is stored whole in `data`
--   (jsonb, app format); `data.id` must equal the row id.
-- * Last-write-wins by `client_updated_at` (data.updatedAt): an UPDATE carrying an older version is silently skipped.
--   `updated_at` is set only by the server (pull cursor).
-- * No DELETE for clients: a cleared note is a "tombstone" (data.deletedAt -> deleted_at).
-- * RLS: a user sees and changes only their own rows. Writes only when cloud sync is on for the account
--   (public.user_features.cloud_sync, set by the owner). Flag off = the Market works on the device as today.
-- * No XP / coins here.

BEGIN;

CREATE TABLE IF NOT EXISTS public.market_user_data (
  user_id UUID NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  id TEXT NOT NULL CHECK (id ~ '^(watchlist|chart_view|note:[a-z0-9]{1,32})$'),
  data JSONB NOT NULL,
  client_updated_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  device_id TEXT CHECK (device_id IS NULL OR char_length(device_id) <= 64),
  PRIMARY KEY (user_id, id)
);

-- data: a JSON object, at most 16 KB (a 2000-character note fits several times), no reward fields
ALTER TABLE public.market_user_data DROP CONSTRAINT IF EXISTS market_user_data_data_check;
ALTER TABLE public.market_user_data ADD CONSTRAINT market_user_data_data_check CHECK (
  jsonb_typeof(data) = 'object'
  AND octet_length(data::text) <= 16384
  AND NOT (data ?| ARRAY['xp', 'coins', 'xpAwarded', 'coinsAwarded', 'reward', 'rewards'])
);

CREATE OR REPLACE FUNCTION public.market_row_before_write()
RETURNS TRIGGER AS $$
DECLARE
  c_max_clock_skew CONSTANT INTERVAL := INTERVAL '5 minutes'; -- the same as the journal (0004)
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW.user_id IS DISTINCT FROM OLD.user_id OR NEW.id IS DISTINCT FROM OLD.id) THEN
    RAISE EXCEPTION 'market_row_identity_immutable';
  END IF;
  IF NEW.data ->> 'id' IS DISTINCT FROM NEW.id THEN
    RAISE EXCEPTION 'market_row_id_mismatch';
  END IF;

  NEW.client_updated_at := (NEW.data ->> 'updatedAt')::timestamptz;
  IF NEW.client_updated_at IS NULL THEN
    RAISE EXCEPTION 'market_row_missing_updated_at';
  END IF;
  IF NEW.client_updated_at > now() + c_max_clock_skew THEN
    RAISE EXCEPTION 'market_row_from_future';
  END IF;

  -- Last-write-wins: an older version never overwrites a newer one (same time = retry, allowed)
  IF TG_OP = 'UPDATE' AND NEW.client_updated_at < OLD.client_updated_at THEN
    RETURN NULL;
  END IF;

  NEW.deleted_at := (NEW.data ->> 'deletedAt')::timestamptz;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

DROP TRIGGER IF EXISTS tr_market_user_data_before_write ON public.market_user_data;
CREATE TRIGGER tr_market_user_data_before_write BEFORE INSERT OR UPDATE ON public.market_user_data
  FOR EACH ROW EXECUTE FUNCTION public.market_row_before_write();

-- pull cursor: "what changed since last sync"
CREATE INDEX IF NOT EXISTS market_user_data_user_updated_idx ON public.market_user_data (user_id, updated_at);

-- Clients: read own rows, insert/upsert own rows. No DELETE. Server columns are not writable.
ALTER TABLE public.market_user_data ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.market_user_data FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.market_user_data TO authenticated;
GRANT INSERT (user_id, id, data, device_id) ON public.market_user_data TO authenticated;
GRANT UPDATE (user_id, id, data, device_id) ON public.market_user_data TO authenticated;

DROP POLICY IF EXISTS market_user_data_select_own ON public.market_user_data;
CREATE POLICY market_user_data_select_own ON public.market_user_data FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS market_user_data_insert_own ON public.market_user_data;
CREATE POLICY market_user_data_insert_own ON public.market_user_data FOR INSERT
  WITH CHECK (auth.uid() = user_id AND public.cloud_sync_enabled());

DROP POLICY IF EXISTS market_user_data_update_own ON public.market_user_data;
CREATE POLICY market_user_data_update_own ON public.market_user_data FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id AND public.cloud_sync_enabled());

COMMIT;
