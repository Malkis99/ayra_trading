BEGIN;

-- Public event fields contain only sanitized release state. Reservations stay private.
ALTER TABLE public.market_events
  ADD COLUMN IF NOT EXISTS release_outcome text CHECK (release_outcome = 'not_published'),
  ADD COLUMN IF NOT EXISTS release_reason text CHECK (release_reason = 'missing_comparison_base'),
  ADD COLUMN IF NOT EXISTS release_phase text CHECK (release_phase IN ('checking', 'delayed')),
  ADD COLUMN IF NOT EXISTS release_checked_at timestamptz,
  ADD COLUMN IF NOT EXISTS release_attempted_at timestamptz,
  ADD COLUMN IF NOT EXISTS release_check_until timestamptz,
  ADD COLUMN IF NOT EXISTS release_saved_at timestamptz,
  ADD COLUMN IF NOT EXISTS release_official_url text;

CREATE TABLE IF NOT EXISTS public.market_release_checks (
  release_key text PRIMARY KEY,
  event_ids text[] NOT NULL,
  starts_at timestamptz NOT NULL,
  last_slot integer NOT NULL DEFAULT -1,
  attempted_at timestamptz,
  retry_at timestamptz,
  lease_until timestamptz,
  token uuid UNIQUE
);
ALTER TABLE public.market_release_checks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.market_release_checks FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.market_release_checks TO service_role;

CREATE OR REPLACE FUNCTION public.market_release_reserve(p_family text, p_ids text[])
RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  t timestamptz;
  launch timestamptz;
  period text;
  stage text;
  k text;
  s integer;
  current_check public.market_release_checks%ROWTYPE;
  claim uuid;
BEGIN
  IF p_family IS NULL OR p_family NOT IN ('cpi','nfp') OR coalesce(cardinality(p_ids),0) NOT BETWEEN 1 AND 4 THEN
    RAISE EXCEPTION 'invalid release group';
  END IF;
  -- Serializes acquisition only. The committed lease covers the HTTP request.
  PERFORM pg_advisory_xact_lock(1470013);
  t := clock_timestamp();
  SELECT min(starts_at), min(reference_period), min(release_stage)
    INTO launch, period, stage
    FROM public.market_events WHERE id = ANY(p_ids);
  IF period IS NULL OR stage IS DISTINCT FROM 'regular' OR launch IS NULL
    OR launch > t OR launch < t - interval '7 days'
    OR (SELECT count(*) FROM public.market_events
        WHERE id = ANY(p_ids) AND source = 'bls' AND country = 'us' AND kind = 'release'
          AND starts_at = launch AND reference_period = period AND release_stage = stage
          AND ((p_family = 'cpi' AND code IN ('us_cpi','us_cpi_yoy','us_core_cpi','us_core_cpi_yoy'))
            OR (p_family = 'nfp' AND code = 'us_nfp'))) <> cardinality(p_ids)
    OR NOT EXISTS (SELECT 1 FROM public.market_events WHERE id = ANY(p_ids)
          AND status = 'scheduled' AND actual IS NULL AND release_outcome IS NULL)
  THEN RETURN NULL; END IF;
  k := p_family || ':' || period || ':' || stage;
  SELECT * INTO current_check FROM public.market_release_checks WHERE release_key = k;
  IF current_check.retry_at > t OR current_check.lease_until > t THEN RETURN NULL; END IF;
  IF EXISTS (SELECT 1 FROM public.market_release_checks WHERE lease_until > t) THEN RETURN NULL; END IF;
  IF t < launch + interval '20 minutes' THEN
    SELECT max(n) INTO s FROM unnest(ARRAY[0,2,4,8,14]) WITH ORDINALITY AS slots(minutes,n)
      WHERE launch + minutes * interval '1 minute' <= t;
    IF s <= coalesce(current_check.last_slot,-1) THEN RETURN NULL; END IF;
  ELSE
    s := greatest(5, coalesce(current_check.last_slot,-1));
    IF current_check.attempted_at + (CASE WHEN t < launch + interval '1 day' THEN interval '2 hours' ELSE interval '1 day' END) > t
    THEN RETURN NULL; END IF;
  END IF;
  claim := gen_random_uuid();
  INSERT INTO public.market_release_checks(release_key,event_ids,starts_at,last_slot,attempted_at,lease_until,token)
  VALUES (k,p_ids,launch,s,t,t + interval '2 minutes',claim)
  ON CONFLICT (release_key) DO UPDATE SET event_ids = excluded.event_ids, starts_at = excluded.starts_at,
    last_slot = excluded.last_slot, attempted_at = excluded.attempted_at,
    lease_until = excluded.lease_until, token = excluded.token, retry_at = NULL;
  UPDATE public.market_events SET release_phase = 'checking', release_attempted_at = t,
    release_check_until = t + interval '2 minutes'
    WHERE id = ANY(p_ids) AND status = 'scheduled' AND actual IS NULL AND release_outcome IS NULL;
  RETURN claim;
END $$;

CREATE OR REPLACE FUNCTION public.market_release_finish(
  p_token uuid, p_verified boolean, p_failure text, p_retry_at timestamptz,
  p_results jsonb, p_absences jsonb
)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  claim public.market_release_checks%ROWTYPE;
  t timestamptz;
  item jsonb;
  response jsonb := '[]'::jsonb;
BEGIN
  SELECT * INTO claim FROM public.market_release_checks WHERE token = p_token FOR UPDATE;
  t := clock_timestamp();
  IF claim.token IS NULL OR claim.lease_until IS NULL OR claim.lease_until <= t THEN
    RAISE EXCEPTION 'release reservation expired';
  END IF;
  IF p_failure IS NOT NULL AND p_failure NOT IN ('blocked','rate_limited','transient','invalid') THEN
    RAISE EXCEPTION 'invalid release failure';
  END IF;
  IF coalesce(jsonb_typeof(p_results),'') <> 'array' OR coalesce(jsonb_typeof(p_absences),'') <> 'array'
     OR (NOT coalesce(p_verified,false) AND (jsonb_array_length(p_results) > 0 OR jsonb_array_length(p_absences) > 0)) THEN
    RAISE EXCEPTION 'invalid release outcome';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_results) r WHERE NOT coalesce((r->>'id') = ANY(claim.event_ids),false)) THEN
    RAISE EXCEPTION 'result outside release reservation';
  END IF;
  PERFORM 1 FROM public.market_events WHERE id = ANY(claim.event_ids) ORDER BY id FOR UPDATE;
  IF EXISTS (SELECT 1 FROM public.market_events WHERE id = ANY(claim.event_ids) AND starts_at <> claim.starts_at) THEN
    UPDATE public.market_release_checks SET token = NULL, lease_until = NULL WHERE release_key = claim.release_key;
    UPDATE public.market_events SET release_phase = NULL, release_check_until = NULL WHERE id = ANY(claim.event_ids);
    RETURN jsonb_build_array(jsonb_build_object('conflict','release schedule changed'));
  END IF;
  IF jsonb_array_length(p_results) > 0 THEN
    response := public.market_events_apply(p_results, 'result');
    UPDATE public.market_events e SET release_saved_at = coalesce(e.release_saved_at,t),
      release_official_url = CASE WHEN e.result_meta->>'release_url' ~ '^https://www[.]bls[.]gov/news[.]release/archives/cpi_[0-9]{8}[.]htm$'
          THEN e.result_meta->>'release_url' ELSE e.release_official_url END
      WHERE e.id IN (SELECT r->>'id' FROM jsonb_array_elements(response) r WHERE NOT (r ? 'conflict'))
        AND e.status = 'released' AND e.actual IS NOT NULL;
  END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(p_absences) LOOP
    UPDATE public.market_events e SET release_outcome = 'not_published',
      release_reason = 'missing_comparison_base', release_official_url = item->>'url'
      WHERE e.id = item->>'id' AND e.id = ANY(claim.event_ids)
        AND e.source = 'bls' AND e.country = 'us' AND e.code IN ('us_cpi_yoy','us_core_cpi_yoy')
        AND e.reference_period = item->>'period' AND e.release_stage = item->>'stage'
        AND e.release_stage = 'regular' AND e.status = 'scheduled' AND e.actual IS NULL
        AND item->>'url' = 'https://www.bls.gov/news.release/archives/cpi_' ||
          to_char(e.starts_at AT TIME ZONE 'America/New_York','MMDDYYYY') || '.htm';
    IF NOT FOUND THEN
      response := response || jsonb_build_array(jsonb_build_object('id', item->>'id', 'conflict', 'absence evidence mismatched'));
    END IF;
  END LOOP;
  UPDATE public.market_events SET
    release_checked_at = CASE WHEN p_verified THEN t ELSE release_checked_at END,
    release_check_until = NULL,
    release_phase = CASE WHEN status = 'scheduled' AND release_outcome IS NULL THEN 'delayed' ELSE NULL END
    WHERE id = ANY(claim.event_ids);
  UPDATE public.market_release_checks SET token = NULL, lease_until = NULL,
    retry_at = CASE WHEN p_failure = 'blocked' THEN t + interval '1 day'
      WHEN p_failure = 'rate_limited' THEN greatest(t + interval '2 minutes',p_retry_at)
      ELSE NULL END
    WHERE release_key = claim.release_key;
  RETURN response;
END $$;

REVOKE ALL ON FUNCTION public.market_release_reserve(text,text[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.market_release_finish(uuid,boolean,text,timestamptz,jsonb,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.market_release_reserve(text,text[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.market_release_finish(uuid,boolean,text,timestamptz,jsonb,jsonb) TO service_role;
COMMIT;
