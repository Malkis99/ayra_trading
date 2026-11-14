-- Manual migration. Review and apply separately from the application deployment.
BEGIN;
CREATE SCHEMA ons_internal;

CREATE TABLE ons_internal.days (
  utc_day date PRIMARY KEY,
  daily_state text NOT NULL DEFAULT 'pending'
    CHECK (daily_state IN ('pending', 'running', 'ready', 'failed')),
  daily_token uuid,
  daily_until timestamptz
);
CREATE TABLE ons_internal.slots (
  utc_day date NOT NULL REFERENCES ons_internal.days,
  pool text NOT NULL CHECK (pool IN ('schedule', 'detail')),
  slot int NOT NULL CHECK (slot BETWEEN 1 AND CASE pool WHEN 'schedule' THEN 3 ELSE 2 END),
  token uuid NOT NULL UNIQUE,
  target text NOT NULL,
  fast boolean NOT NULL DEFAULT false,
  snapshot jsonb,
  reserved_until timestamptz NOT NULL,
  charged_at timestamptz,
  completed_at timestamptz,
  outcome text,
  PRIMARY KEY (utc_day, pool, slot),
  CHECK (completed_at IS NULL OR charged_at IS NOT NULL)
);
CREATE TABLE ons_internal.state (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  pause_until timestamptz
);
INSERT INTO ons_internal.state DEFAULT VALUES;

ALTER TABLE ons_internal.days ENABLE ROW LEVEL SECURITY;
ALTER TABLE ons_internal.slots ENABLE ROW LEVEL SECURITY;
ALTER TABLE ons_internal.state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON SCHEMA ons_internal FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL TABLES IN SCHEMA ons_internal FROM PUBLIC, anon, authenticated, service_role;
GRANT USAGE ON SCHEMA ons_internal TO service_role;
GRANT SELECT, INSERT, UPDATE ON ons_internal.days, ons_internal.slots TO service_role;
GRANT SELECT, UPDATE ON ons_internal.state TO service_role;

CREATE FUNCTION public.ons_daily(p_token uuid DEFAULT NULL, p_ready boolean DEFAULT false)
RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog AS $$
DECLARE
  v_now timestamptz;
  v_day date;
  v_token uuid := gen_random_uuid();
BEGIN
  PERFORM 1 FROM ons_internal.state FOR UPDATE;
  v_now := clock_timestamp();
  v_day := (v_now AT TIME ZONE 'UTC')::date;
  IF p_token IS NOT NULL THEN
    UPDATE ons_internal.days SET daily_state = CASE WHEN p_ready THEN 'ready' ELSE 'failed' END
    WHERE utc_day = v_day AND daily_state = 'running' AND daily_token = p_token AND daily_until > v_now;
    RETURN NULL;
  END IF;
  INSERT INTO ons_internal.days(utc_day, daily_state, daily_token, daily_until)
  VALUES (v_day, 'running', v_token, v_now + interval '90 seconds')
  ON CONFLICT DO NOTHING;
  RETURN CASE WHEN FOUND THEN v_token ELSE NULL END;
END $$;

CREATE FUNCTION public.ons_reserve_slot(p_kind text, p_target text, p_daily uuid DEFAULT NULL, p_expected_start timestamptz DEFAULT NULL)
RETURNS text LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog AS $$
DECLARE
  v_now timestamptz;
  v_day date;
  v_slot int;
  v_token uuid := gen_random_uuid();
  v_pause timestamptz;
  v_pool text;
  v_snapshot jsonb;
BEGIN
  IF p_kind IS NULL OR p_kind NOT IN ('schedule', 'move', 'fact')
     OR p_target IS NULL OR p_target = '' THEN
    RAISE EXCEPTION 'invalid ONS slot request';
  END IF;
  SELECT pause_until INTO STRICT v_pause FROM ons_internal.state FOR UPDATE;
  v_now := clock_timestamp();
  v_day := (v_now AT TIME ZONE 'UTC')::date;
  IF v_pause > v_now THEN RETURN NULL; END IF;
  v_pool := CASE WHEN p_kind = 'schedule' THEN 'schedule' ELSE 'detail' END;
  IF NOT EXISTS (
    SELECT 1 FROM ons_internal.days WHERE utc_day = v_day AND
      ((p_daily IS NOT NULL AND daily_state = 'running' AND daily_token = p_daily AND daily_until > v_now)
      OR (p_daily IS NULL AND p_kind = 'fact' AND daily_state = 'ready'))
  ) THEN RETURN NULL; END IF;
  IF p_kind = 'fact' THEN
    SELECT jsonb_build_array(starts_at, source_uid, reference_period, release_stage, schedule_meta, code)
    INTO v_snapshot FROM public.market_events
    WHERE id = p_target AND source = 'ons' AND country = 'gb' AND kind = 'release'
      AND status = 'scheduled' AND actual IS NULL AND NOT time_tbd AND starts_at = p_expected_start
      AND starts_at <= v_now AND starts_at >= v_now -
        CASE WHEN p_daily IS NULL THEN interval '30 minutes' ELSE interval '14 days' END;
    IF NOT FOUND THEN RETURN NULL; END IF;
    -- Protect both detail slots while an unresolved publication still has a fast window today.
    IF p_daily IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.market_events WHERE source = 'ons' AND country = 'gb'
        AND kind = 'release' AND status = 'scheduled' AND actual IS NULL AND NOT time_tbd
        AND starts_at >= v_now - interval '30 minutes'
        AND starts_at < ((v_day + 1)::timestamp AT TIME ZONE 'UTC')
    ) THEN RETURN NULL; END IF;
    IF p_daily IS NULL AND EXISTS (
      SELECT 1 FROM ons_internal.slots WHERE utc_day = v_day AND target = p_target AND charged_at IS NOT NULL
    ) AND EXISTS (
      SELECT 1 FROM public.market_events e WHERE source = 'ons' AND country = 'gb'
        AND kind = 'release' AND status = 'scheduled' AND actual IS NULL AND NOT time_tbd
        AND starts_at BETWEEN v_now - interval '30 minutes' AND ((v_day + 1)::timestamp AT TIME ZONE 'UTC')
        AND e.id <> p_target AND NOT EXISTS (
          SELECT 1 FROM ons_internal.slots s WHERE s.utc_day = v_day AND s.target = e.id AND s.charged_at IS NOT NULL
        )
    ) THEN RETURN NULL; END IF;
  END IF;
  IF EXISTS (
    SELECT 1 FROM ons_internal.slots
    WHERE utc_day = v_day
      AND (target = p_target OR (pool = 'detail' AND v_pool = 'detail' AND completed_at IS NULL))
      AND (charged_at IS NULL AND reserved_until > v_now
        OR charged_at IS NOT NULL AND completed_at IS NULL
          AND charged_at + interval '2 minutes' > v_now
        OR target = p_target AND p_daily IS NULL AND charged_at + interval '9 minutes' > v_now)
  ) THEN RETURN NULL; END IF;
  SELECT candidate INTO v_slot
  FROM generate_series(1, CASE v_pool WHEN 'schedule' THEN 3 ELSE 2 END) AS candidate
  WHERE NOT EXISTS (
    SELECT 1 FROM ons_internal.slots
    WHERE utc_day = v_day AND pool = v_pool AND slot = candidate
      AND (charged_at IS NOT NULL OR reserved_until > v_now)
  ) ORDER BY candidate LIMIT 1;
  IF v_slot IS NULL THEN
    IF (SELECT count(*) FROM ons_internal.slots
        WHERE utc_day = v_day AND pool = v_pool AND charged_at IS NOT NULL)
        = (CASE v_pool WHEN 'schedule' THEN 3 ELSE 2 END)
    THEN RETURN 'exhausted'; END IF;
    RETURN NULL;
  END IF;
  INSERT INTO ons_internal.slots(utc_day, pool, slot, token, target, fast, snapshot, reserved_until)
  VALUES (v_day, v_pool, v_slot, v_token, p_target, p_daily IS NULL, v_snapshot, v_now + interval '30 seconds')
  ON CONFLICT (utc_day, pool, slot) DO UPDATE
    SET token = excluded.token, target = excluded.target, fast = excluded.fast, snapshot = excluded.snapshot,
      reserved_until = excluded.reserved_until
    WHERE slots.charged_at IS NULL AND slots.reserved_until <= v_now;
  IF NOT FOUND THEN RETURN NULL; END IF;
  RETURN v_token::text;
END $$;

CREATE FUNCTION public.ons_charge_slot(p_token uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog AS $$
DECLARE
  v_now timestamptz;
  v_day date;
  v_pause timestamptz;
BEGIN
  SELECT pause_until INTO STRICT v_pause FROM ons_internal.state FOR UPDATE;
  v_now := clock_timestamp();
  v_day := (v_now AT TIME ZONE 'UTC')::date;
  IF v_pause > v_now OR v_now >=
    ((v_day + 1)::timestamp AT TIME ZONE 'UTC') - interval '30 seconds'
  THEN RETURN false; END IF;
  UPDATE ons_internal.slots SET charged_at = v_now
  WHERE token = p_token AND utc_day = v_day AND charged_at IS NULL
    AND reserved_until > v_now
    AND (NOT fast OR v_now < (snapshot->>0)::timestamptz + interval '29 minutes 55 seconds');
  RETURN FOUND;
END $$;

CREATE FUNCTION public.ons_release_slot(p_token uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog AS $$
BEGIN
  PERFORM 1 FROM ons_internal.state FOR UPDATE;
  UPDATE ons_internal.slots SET reserved_until = clock_timestamp()
  WHERE token = p_token AND charged_at IS NULL AND reserved_until > clock_timestamp();
  RETURN FOUND;
END $$;

CREATE FUNCTION public.ons_finish_slot(p_token uuid, p_result jsonb, p_pause timestamptz)
RETURNS text LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog AS $$
DECLARE
  v_slot ons_internal.slots%ROWTYPE;
  v_snapshot jsonb;
  v_outcome text := 'complete';
  v_applied jsonb;
BEGIN
  PERFORM 1 FROM ons_internal.state FOR UPDATE;
  SELECT * INTO v_slot FROM ons_internal.slots WHERE token = p_token AND charged_at IS NOT NULL;
  IF NOT FOUND THEN RETURN 'invalid attempt'; END IF;
  IF v_slot.completed_at IS NOT NULL THEN RETURN v_slot.outcome; END IF;
  -- Honor a received Retry-After even if the fact-write window has expired.
  IF p_pause IS NOT NULL THEN
    UPDATE ons_internal.state SET pause_until = greatest(pause_until, p_pause);
  END IF;
  IF v_slot.charged_at + interval '2 minutes' <= clock_timestamp() THEN
    v_outcome := 'attempt expired';
  ELSIF p_result IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(1470012);
    SELECT jsonb_build_array(starts_at, source_uid, reference_period, release_stage, schedule_meta, code)
    INTO v_snapshot FROM public.market_events
    WHERE id = v_slot.target AND source = 'ons' AND country = 'gb'
      AND status = 'scheduled' AND actual IS NULL FOR UPDATE;
    IF v_slot.charged_at + interval '2 minutes' <= clock_timestamp() THEN
      v_outcome := 'attempt expired';
    ELSIF v_snapshot IS NULL OR v_snapshot IS DISTINCT FROM v_slot.snapshot
      OR p_result->>'id' IS DISTINCT FROM v_slot.target
      OR p_result->>'reference_period' IS DISTINCT FROM v_snapshot->>2
      OR p_result->>'release_stage' IS DISTINCT FROM v_snapshot->>3
      OR p_result->>'actual' IS NULL
    THEN v_outcome := 'release changed during verification';
    ELSE
      v_applied := public.market_events_apply(jsonb_build_array(p_result), 'result')->0;
      IF v_applied->>'conflict' IS NOT NULL THEN
        v_outcome := 'provenance conflict: ' || (v_applied->>'conflict');
      ELSIF v_applied->>'id' IS DISTINCT FROM v_slot.target OR NOT EXISTS (
        SELECT 1 FROM public.market_events WHERE id = v_slot.target AND status = 'released'
          AND actual = p_result->>'actual'
          AND (p_result->>'previous' IS NULL OR previous = p_result->>'previous')
          AND result_meta = p_result->'result_meta'
      ) THEN
        v_outcome := 'result write not confirmed by RPC 0012';
      ELSE
        v_outcome := 'saved';
      END IF;
    END IF;
  END IF;
  UPDATE ons_internal.slots SET completed_at = clock_timestamp(), outcome = v_outcome WHERE token = p_token;
  RETURN v_outcome;
END $$;

REVOKE ALL ON FUNCTION public.ons_daily(uuid,boolean), public.ons_reserve_slot(text,text,uuid,timestamptz),
  public.ons_charge_slot(uuid), public.ons_release_slot(uuid),
  public.ons_finish_slot(uuid,jsonb,timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ons_daily(uuid,boolean), public.ons_reserve_slot(text,text,uuid,timestamptz),
  public.ons_charge_slot(uuid), public.ons_release_slot(uuid),
  public.ons_finish_slot(uuid,jsonb,timestamptz) TO service_role;
COMMIT;
