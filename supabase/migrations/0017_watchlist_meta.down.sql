-- Structural rollback refuses to discard priorities. Prefer rolling back application code while keeping 0017.
BEGIN;
SET LOCAL lock_timeout = '5s';
DO $$ BEGIN IF EXISTS (SELECT 1 FROM public.market_user_data WHERE id='watchlist_meta') THEN RAISE EXCEPTION 'market_meta_rollback_requires_preservation'; END IF; END $$;
ALTER TABLE public.market_user_data DROP CONSTRAINT market_user_data_id_check;
ALTER TABLE public.market_user_data ADD CONSTRAINT market_user_data_id_check CHECK (id ~ '^(watchlist|chart_view|note:[a-z0-9]{1,32})$');
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


COMMIT;
