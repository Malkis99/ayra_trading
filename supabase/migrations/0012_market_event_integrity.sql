-- Additive only: no legacy backfill, renaming, deletion or value reset. Apply by owner after preflight.
BEGIN;
ALTER TABLE public.market_events ADD COLUMN IF NOT EXISTS identity_key text;
ALTER TABLE public.market_events ADD COLUMN IF NOT EXISTS source_uid text;
ALTER TABLE public.market_events ADD COLUMN IF NOT EXISTS reference_period text;
ALTER TABLE public.market_events ADD COLUMN IF NOT EXISTS release_stage text;
ALTER TABLE public.market_events ADD COLUMN IF NOT EXISTS schedule_meta jsonb;
ALTER TABLE public.market_events ADD COLUMN IF NOT EXISTS result_meta jsonb;
-- Existing rows remain NULL. Reapplication must fail rather than silently resolve an unexpected keyed collision.
CREATE UNIQUE INDEX IF NOT EXISTS market_events_identity_idx ON public.market_events(identity_key) WHERE identity_key IS NOT NULL;

CREATE OR REPLACE FUNCTION public.market_event_version_newer(n jsonb, o jsonb)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = public AS $$
 SELECT CASE
 WHEN n ? 'sequence' AND o ? 'sequence' AND (n->>'sequence')::bigint <> (o->>'sequence')::bigint
 THEN (n->>'sequence')::bigint > (o->>'sequence')::bigint
 ELSE coalesce((n->>'modified')::timestamptz > (o->>'modified')::timestamptz, false) END
$$;

-- SECURITY INVOKER: only the service role can execute or write; no new browser privilege.
CREATE OR REPLACE FUNCTION public.market_events_apply(p_rows jsonb, p_mode text)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE r jsonb; e public.market_events%ROWTYPE; v_id text; n int; answer jsonb := '[]';
 meta jsonb; version_ok boolean; changed boolean; cancelled boolean;
BEGIN
 IF p_mode NOT IN ('schedule','result','cancel','previous') OR jsonb_typeof(p_rows) <> 'array' THEN RAISE EXCEPTION 'invalid calendar operation'; END IF;
 -- All calendar writers use this transaction lock, including identity adoption and initial insert.
 PERFORM pg_advisory_xact_lock(1470012);
 FOR r IN SELECT value FROM jsonb_array_elements(p_rows) LOOP
  e := NULL;
  IF p_mode = 'cancel' THEN
   SELECT count(*) INTO n FROM public.market_events WHERE source=r->>'source' AND source_uid=r->>'source_uid';
   IF n <> 1 THEN answer := answer || jsonb_build_array(jsonb_build_object('conflict','ambiguous cancellation UID')); CONTINUE; END IF;
   SELECT * INTO e FROM public.market_events WHERE source=r->>'source' AND source_uid=r->>'source_uid' FOR UPDATE;
  ELSIF p_mode = 'schedule' AND r->>'identity_key' IS NOT NULL THEN
   SELECT * INTO e FROM public.market_events WHERE identity_key=r->>'identity_key' FOR UPDATE;
   IF e.id IS NULL THEN
    SELECT * INTO e FROM public.market_events WHERE id=r->>'id' AND identity_key IS NULL
      AND source=r->>'source' AND country=r->>'country' AND kind=r->>'kind' AND code IS NOT DISTINCT FROM r->>'code'
      AND title=r->>'title' AND starts_at=(r->>'starts_at')::timestamptz FOR UPDATE;
    IF e.id IS NOT NULL THEN
     SELECT count(*) INTO n FROM public.market_events WHERE source=e.source AND country=e.country AND code IS NOT DISTINCT FROM e.code AND title=e.title AND starts_at=e.starts_at;
     IF n > 1 THEN answer := answer || jsonb_build_array(jsonb_build_object('conflict','ambiguous legacy identity')); CONTINUE; END IF;
    ELSE
    -- Exact legacy title+source+country+kind+code only. Two candidates are never merged/adopted.
    SELECT count(*) INTO n FROM public.market_events WHERE identity_key IS NULL AND source=r->>'source' AND country=r->>'country'
      AND kind=r->>'kind' AND code IS NOT DISTINCT FROM r->>'code' AND title=r->>'title';
    IF n > 1 THEN answer := answer || jsonb_build_array(jsonb_build_object('conflict','ambiguous legacy identity')); CONTINUE; END IF;
    IF n = 1 THEN SELECT * INTO e FROM public.market_events WHERE identity_key IS NULL AND source=r->>'source' AND country=r->>'country'
      AND kind=r->>'kind' AND code IS NOT DISTINCT FROM r->>'code' AND title=r->>'title' FOR UPDATE; END IF;
    END IF;
   END IF;
  ELSE
   SELECT * INTO e FROM public.market_events WHERE id=r->>'id' FOR UPDATE;
  END IF;

  IF p_mode = 'schedule' THEN
   IF e.id IS NULL THEN
    v_id := r->>'id';
    IF EXISTS(SELECT 1 FROM public.market_events WHERE id=v_id) THEN
     IF r->>'identity_key' IS NULL THEN answer := answer || jsonb_build_array(jsonb_build_object('conflict','identity required')); CONTINUE; END IF;
     v_id := (r->>'source') || ':stable:' || md5(r->>'identity_key');
    END IF;
    INSERT INTO public.market_events(id,source,country,kind,code,title,importance,starts_at,time_tbd,url,identity_key,source_uid,reference_period,release_stage,schedule_meta,status)
     VALUES(v_id,r->>'source',r->>'country',r->>'kind',r->>'code',r->>'title',(r->>'importance')::smallint,(r->>'starts_at')::timestamptz,
       (r->>'time_tbd')::boolean,r->>'url',r->>'identity_key',r->>'source_uid',r->>'reference_period',r->>'release_stage',r->'schedule_meta',
       CASE WHEN coalesce((r->'schedule_meta'->>'cancelled')::boolean,false) THEN 'cancelled' ELSE 'scheduled' END);
    answer := answer || jsonb_build_array(jsonb_build_object('id',v_id)); CONTINUE;
   END IF;
   IF e.source <> r->>'source' OR e.country <> r->>'country' OR e.code IS DISTINCT FROM r->>'code'
     OR (e.reference_period IS NOT NULL AND r->>'reference_period' IS NOT NULL AND e.reference_period IS DISTINCT FROM r->>'reference_period')
     OR (e.release_stage IS NOT NULL AND e.release_stage IS DISTINCT FROM r->>'release_stage') THEN
    answer := answer || jsonb_build_array(jsonb_build_object('id',e.id,'conflict','identity components changed')); CONTINUE;
   END IF;
  END IF;

  IF e.id IS NULL THEN answer := answer || jsonb_build_array(jsonb_build_object('conflict','event not found')); CONTINUE; END IF;
  IF p_mode IN ('schedule','cancel') THEN
   meta := coalesce(r->'schedule_meta','{}');
   changed := (p_mode='schedule' AND (e.starts_at IS DISTINCT FROM (r->>'starts_at')::timestamptz OR e.title IS DISTINCT FROM r->>'title'))
     OR (meta ? 'cancelled' AND (e.status='cancelled') IS DISTINCT FROM (meta->>'cancelled')::boolean);
   -- First exact legacy adoption may add metadata but cannot move/cancel an unversioned existing row.
   version_ok := public.market_event_version_newer(meta,coalesce(e.schedule_meta,'{}'));
   IF changed AND NOT version_ok THEN answer := answer || jsonb_build_array(jsonb_build_object('id',e.id,'conflict','schedule freshness unproven')); CONTINUE; END IF;
   IF public.market_event_version_newer(coalesce(e.schedule_meta,'{}'),meta) THEN
    answer := answer || jsonb_build_array(jsonb_build_object('id',e.id,'conflict','older schedule')); CONTINUE;
   END IF;
   cancelled := CASE WHEN meta ? 'cancelled' THEN (meta->>'cancelled')::boolean ELSE e.status='cancelled' END;
   UPDATE public.market_events SET
    identity_key=coalesce(identity_key,r->>'identity_key'), source_uid=coalesce(source_uid,r->>'source_uid'),
    reference_period=coalesce(reference_period,r->>'reference_period'), release_stage=coalesce(release_stage,r->>'release_stage'),
    schedule_meta=coalesce(schedule_meta,'{}') || meta || CASE WHEN cancelled AND e.status <> 'cancelled' THEN jsonb_build_object('prior_status',e.status) ELSE '{}'::jsonb END,
    starts_at=CASE WHEN p_mode='schedule' THEN (r->>'starts_at')::timestamptz ELSE starts_at END,
    title=CASE WHEN p_mode='schedule' THEN r->>'title' ELSE title END,
    time_tbd=CASE WHEN p_mode='schedule' THEN (r->>'time_tbd')::boolean ELSE time_tbd END,
    status=CASE WHEN cancelled THEN 'cancelled' WHEN e.status <> 'cancelled' THEN e.status WHEN e.schedule_meta->>'prior_status'='released' OR actual IS NOT NULL THEN 'released' ELSE 'scheduled' END
    WHERE id=e.id;
  ELSIF p_mode='previous' THEN
   -- Preliminary previous is fill-only; it never competes with official published results.
   UPDATE public.market_events SET previous=r->>'previous' WHERE id=e.id AND status='scheduled' AND previous IS NULL AND r->>'previous' IS NOT NULL;
  ELSE
   -- A partial response without its actual is not proof that a new result was published.
   -- Do not change previous/provenance/status from such a response, including a pre-release row.
   IF r->>'actual' IS NULL THEN answer := answer || jsonb_build_array(jsonb_build_object('id',e.id)); CONTINUE; END IF;
   meta := r->'result_meta';
   IF e.status='cancelled' THEN answer := answer || jsonb_build_array(jsonb_build_object('id',e.id,'conflict','event cancelled')); CONTINUE; END IF;
   IF meta IS NULL OR meta->>'period' IS NULL OR meta->>'series' IS NULL OR meta->>'unit' IS NULL OR meta->>'adjustment' IS NULL
     OR (e.reference_period IS NOT NULL AND e.reference_period <> meta->>'period')
     OR (e.release_stage IS NOT NULL AND r->>'release_stage' IS NOT NULL AND e.release_stage <> r->>'release_stage') THEN
    answer := answer || jsonb_build_array(jsonb_build_object('id',e.id,'conflict','result provenance missing or mismatched')); CONTINUE;
   END IF;
   IF e.result_meta IS NOT NULL AND (e.result_meta - 'source_updated') <> (meta - 'source_updated') THEN
    answer := answer || jsonb_build_array(jsonb_build_object('id',e.id,'conflict','series units or period changed')); CONTINUE;
   END IF;
   changed := (e.actual IS NOT NULL AND r->>'actual' IS NOT NULL AND e.actual <> r->>'actual') OR
     (e.status='released' AND e.previous IS NOT NULL AND r->>'previous' IS NOT NULL AND e.previous <> r->>'previous');
   version_ok := coalesce((meta->>'source_updated')::timestamptz > (e.result_meta->>'source_updated')::timestamptz,false);
   IF changed AND NOT version_ok THEN answer := answer || jsonb_build_array(jsonb_build_object('id',e.id,'conflict','result freshness unproven')); CONTINUE; END IF;
   IF coalesce((meta->>'source_updated')::timestamptz < (e.result_meta->>'source_updated')::timestamptz,false) THEN
    answer := answer || jsonb_build_array(jsonb_build_object('id',e.id,'conflict','older result')); CONTINUE;
   END IF;
   UPDATE public.market_events SET actual=coalesce(r->>'actual',actual),previous=coalesce(r->>'previous',previous),
    summary=coalesce(r->>'summary',summary), reference_period=coalesce(reference_period,meta->>'period'),
    result_meta=CASE WHEN r->>'actual' IS NULL THEN result_meta
      WHEN e.result_meta->>'source_updated' IS NOT NULL AND meta->>'source_updated' IS NULL THEN e.result_meta ELSE meta END,
    status=CASE WHEN coalesce(r->>'actual',actual) IS NOT NULL THEN 'released' ELSE status END WHERE id=e.id;
  END IF;
  answer := answer || jsonb_build_array(jsonb_build_object('id',e.id));
 END LOOP;
 RETURN answer;
END $$;
REVOKE ALL ON FUNCTION public.market_event_version_newer(jsonb,jsonb) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.market_events_apply(jsonb,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.market_event_version_newer(jsonb,jsonb), public.market_events_apply(jsonb,text) TO service_role;
COMMIT;
