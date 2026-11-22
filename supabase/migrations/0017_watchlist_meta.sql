-- WATCH-1B.1. Manual application only, after owner approval. Requires 0008.
-- No data backfill, new table, RLS/grant changes, or client-time ordering for metadata.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $$
DECLARE definition text;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO definition FROM pg_constraint
    WHERE conrelid = 'public.market_user_data'::regclass AND conname = 'market_user_data_id_check';
  IF definition IS NULL OR definition NOT IN (
    'CHECK ((id ~ ''^(watchlist|chart_view|note:[a-z0-9]{1,32})$''::text))',
    'CHECK ((id ~ ''^(watchlist|watchlist_meta|chart_view|note:[a-z0-9]{1,32})$''::text))'
  ) THEN RAISE EXCEPTION 'market_meta_unexpected_id_constraint'; END IF;
  IF EXISTS (SELECT 1 FROM public.market_user_data WHERE id = 'watchlist_meta'
    AND data->'version' IS DISTINCT FROM '1'::jsonb) THEN
    RAISE EXCEPTION 'market_meta_newer_contract_present';
  END IF;
END $$;

ALTER TABLE public.market_user_data DROP CONSTRAINT market_user_data_id_check;
ALTER TABLE public.market_user_data ADD CONSTRAINT market_user_data_id_check
  CHECK (id ~ '^(watchlist|watchlist_meta|chart_view|note:[a-z0-9]{1,32})$');

CREATE OR REPLACE FUNCTION public.market_row_before_write()
RETURNS TRIGGER AS $$
DECLARE
  c_max_clock_skew CONSTANT INTERVAL := INTERVAL '5 minutes';
  k text;
  entry jsonb;
  previous jsonb;
  unknown_key text;
  changed boolean := false;
  server_time timestamptz;
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW.user_id IS DISTINCT FROM OLD.user_id OR NEW.id IS DISTINCT FROM OLD.id) THEN
    RAISE EXCEPTION 'market_row_identity_immutable';
  END IF;
  IF NEW.data ->> 'id' IS DISTINCT FROM NEW.id THEN
    RAISE EXCEPTION 'market_row_id_mismatch';
  END IF;

  IF NEW.id = 'watchlist_meta' THEN
    -- WATCH_META_V1: validate without truncating/normalizing opaque extension fields.
    IF jsonb_typeof(NEW.data) IS DISTINCT FROM 'object' OR NEW.data->'version' IS DISTINCT FROM '1'::jsonb
      OR jsonb_typeof(NEW.data->'entries') IS DISTINCT FROM 'object' OR NEW.data ? 'deletedAt' THEN
      RAISE EXCEPTION 'market_meta_invalid_contract';
    END IF;
    IF TG_OP = 'UPDATE' AND OLD.data->'version' IS DISTINCT FROM '1'::jsonb THEN
      RAISE EXCEPTION 'market_meta_unsupported_version';
    END IF;
    IF jsonb_typeof(NEW.data->'revision') IS DISTINCT FROM 'number'
      OR (NEW.data->>'revision') !~ '^[0-9]+$' THEN
      RAISE EXCEPTION 'market_meta_invalid_revision';
    END IF;
    IF (NEW.data->>'revision')::numeric NOT BETWEEN 1 AND 9007199254740991 THEN
      RAISE EXCEPTION 'market_meta_invalid_revision';
    END IF;
    IF (TG_OP = 'INSERT' AND NEW.data->'revision' <> '1'::jsonb)
      OR (TG_OP = 'UPDATE' AND (NEW.data->>'revision')::numeric <> (OLD.data->>'revision')::numeric + 1) THEN
      RAISE EXCEPTION 'market_meta_revision_conflict';
    END IF;
    IF TG_OP = 'UPDATE' THEN
      -- Unknown top-level fields and all existing instrument records must survive a V1 write.
      FOR unknown_key IN SELECT jsonb_object_keys(OLD.data - ARRAY['id','version','revision','updatedAt','entries']) LOOP
        IF NEW.data->unknown_key IS DISTINCT FROM OLD.data->unknown_key THEN
          RAISE EXCEPTION 'market_meta_extension_removed';
        END IF;
      END LOOP;
      FOR k IN SELECT jsonb_object_keys(OLD.data->'entries') LOOP
        IF NOT (NEW.data->'entries' ? k) THEN RAISE EXCEPTION 'market_meta_entry_removed'; END IF;
      END LOOP;
    END IF;
    FOR k, entry IN SELECT * FROM jsonb_each(NEW.data->'entries') LOOP
      IF k !~ '^[a-z0-9]{1,32}$' OR jsonb_typeof(entry) IS DISTINCT FROM 'object'
        OR jsonb_typeof(entry->'priority') IS DISTINCT FROM 'boolean'
        OR jsonb_typeof(entry->'revision') IS DISTINCT FROM 'number'
        OR (entry->>'revision') !~ '^[0-9]+$'
        OR jsonb_typeof(entry->'operationId') IS DISTINCT FROM 'string'
        OR (entry->>'operationId') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        OR entry ?| ARRAY['xp','coins','xpAwarded','coinsAwarded','reward','rewards'] THEN
        RAISE EXCEPTION 'market_meta_invalid_entry';
      END IF;
      IF (entry->>'revision')::numeric NOT BETWEEN 1 AND 9007199254740991 THEN
        RAISE EXCEPTION 'market_meta_invalid_entry_revision';
      END IF;
      previous := CASE WHEN TG_OP = 'UPDATE' THEN OLD.data->'entries'->k ELSE NULL END;
      IF previous IS NOT NULL THEN
        FOR unknown_key IN SELECT jsonb_object_keys(previous - ARRAY['priority','revision','operationId']) LOOP
          IF entry->unknown_key IS DISTINCT FROM previous->unknown_key THEN
            RAISE EXCEPTION 'market_meta_extension_removed';
          END IF;
        END LOOP;
      END IF;
      IF entry IS DISTINCT FROM previous THEN
        changed := true;
        IF (entry->>'revision')::numeric <> COALESCE((previous->>'revision')::numeric, 0) + 1 THEN
          RAISE EXCEPTION 'market_meta_entry_revision_conflict';
        END IF;
        IF previous IS NOT NULL AND entry->>'operationId' = previous->>'operationId' THEN
          RAISE EXCEPTION 'market_meta_operation_reused';
        END IF;
      END IF;
    END LOOP;
    IF EXISTS (SELECT 1 FROM jsonb_each(NEW.data->'entries') e
      GROUP BY e.value->>'operationId' HAVING count(*) > 1) THEN
      RAISE EXCEPTION 'market_meta_duplicate_operation';
    END IF;
    IF TG_OP = 'UPDATE' AND NOT changed THEN RAISE EXCEPTION 'market_meta_no_change'; END IF;
    -- Metadata revisions are the arbiter; caller-supplied timestamps are ignored.
    server_time := clock_timestamp();
    NEW.data := jsonb_set(NEW.data, '{updatedAt}', to_jsonb(server_time));
    NEW.client_updated_at := server_time;
    NEW.updated_at := server_time;
    NEW.deleted_at := NULL;
    RETURN NEW;
  END IF;

  -- Original 0008 path: keep legacy clock checks and last-write-wins semantics unchanged.
  NEW.client_updated_at := (NEW.data ->> 'updatedAt')::timestamptz;
  IF NEW.client_updated_at IS NULL THEN RAISE EXCEPTION 'market_row_missing_updated_at'; END IF;
  IF NEW.client_updated_at > now() + c_max_clock_skew THEN RAISE EXCEPTION 'market_row_from_future'; END IF;
  IF TG_OP = 'UPDATE' AND NEW.client_updated_at < OLD.client_updated_at THEN RETURN NULL; END IF;
  NEW.deleted_at := (NEW.data ->> 'deletedAt')::timestamptz;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY INVOKER SET search_path = public;
COMMIT;
