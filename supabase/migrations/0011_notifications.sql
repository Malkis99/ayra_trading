-- AYRA Issue #147, PR 1. Prepared only; the OWNER applies this migration.
-- 0006/0007 remain reserved. 0011 follows main's 0010; no cron or external delivery here.
BEGIN;

CREATE TABLE IF NOT EXISTS public.notification_settings (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  all_disabled boolean NOT NULL DEFAULT false,
  quiet_enabled boolean NOT NULL DEFAULT false,
  quiet_start time NOT NULL DEFAULT '22:00',
  quiet_end time NOT NULL DEFAULT '08:00',
  timezone text NOT NULL DEFAULT 'UTC',
  min_importance smallint NOT NULL DEFAULT 1 CHECK (min_importance BETWEEN 1 AND 3),
  instrument_ids text[] NOT NULL DEFAULT '{}',
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (NOT quiet_enabled OR quiet_start <> quiet_end),
  CHECK (cardinality(instrument_ids) <= 128)
);
CREATE TABLE IF NOT EXISTS public.notification_preferences (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type_code text NOT NULL CHECK (type_code ~ '^[a-z][a-z0-9_]{0,63}$'),
  channel_code text NOT NULL CHECK (channel_code IN ('site','web_push','telegram','email','mobile_push')),
  enabled boolean NOT NULL,
  PRIMARY KEY (user_id, type_code, channel_code),
  -- Critical site notifications cannot be disabled, even via direct Data API calls.
  CHECK (type_code NOT IN ('security_new_device','security_suspicious') OR channel_code <> 'site' OR enabled)
);
CREATE TABLE IF NOT EXISTS public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event_key text NOT NULL CHECK (length(event_key) BETWEEN 1 AND 256),
  type_code text NOT NULL CHECK (type_code ~ '^[a-z][a-z0-9_]{0,63}$'),
  payload jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(payload) = 'object' AND octet_length(payload::text) <= 8192),
  href text CHECK (href IS NULL OR (href ~ '^/[^/]' AND href !~ '[\\[:cntrl:]]')),
  created_at timestamptz NOT NULL DEFAULT now(),
  read_at timestamptz,
  UNIQUE (user_id, event_key, type_code)
);
CREATE INDEX IF NOT EXISTS notifications_inbox_idx ON public.notifications (user_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS notifications_unread_idx ON public.notifications (user_id, created_at DESC) WHERE read_at IS NULL;

ALTER TABLE public.notification_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.notification_settings, public.notification_preferences, public.notifications FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.notification_settings TO authenticated;
GRANT UPDATE (all_disabled, quiet_enabled, quiet_start, quiet_end, timezone, min_importance, instrument_ids) ON public.notification_settings TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.notification_preferences TO authenticated;
GRANT SELECT, DELETE ON public.notifications TO authenticated;
GRANT UPDATE (read_at) ON public.notifications TO authenticated;
GRANT ALL ON public.notification_settings, public.notification_preferences, public.notifications TO service_role;

DROP POLICY IF EXISTS notification_settings_select ON public.notification_settings;
CREATE POLICY notification_settings_select ON public.notification_settings FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id);
DROP POLICY IF EXISTS notification_settings_insert ON public.notification_settings;
CREATE POLICY notification_settings_insert ON public.notification_settings FOR INSERT TO authenticated WITH CHECK ((SELECT auth.uid()) = user_id);
DROP POLICY IF EXISTS notification_settings_update ON public.notification_settings;
CREATE POLICY notification_settings_update ON public.notification_settings FOR UPDATE TO authenticated USING ((SELECT auth.uid()) = user_id) WITH CHECK ((SELECT auth.uid()) = user_id);
DROP POLICY IF EXISTS notification_preferences_own ON public.notification_preferences;
CREATE POLICY notification_preferences_own ON public.notification_preferences FOR ALL TO authenticated USING ((SELECT auth.uid()) = user_id) WITH CHECK ((SELECT auth.uid()) = user_id);
DROP POLICY IF EXISTS notifications_select ON public.notifications;
CREATE POLICY notifications_select ON public.notifications FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id AND created_at >= now() - interval '90 days');
DROP POLICY IF EXISTS notifications_update ON public.notifications;
CREATE POLICY notifications_update ON public.notifications FOR UPDATE TO authenticated USING ((SELECT auth.uid()) = user_id) WITH CHECK ((SELECT auth.uid()) = user_id);
DROP POLICY IF EXISTS notifications_delete ON public.notifications;
CREATE POLICY notifications_delete ON public.notifications FOR DELETE TO authenticated USING ((SELECT auth.uid()) = user_id);

CREATE OR REPLACE FUNCTION public.validate_notification_settings() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_timezone_names WHERE name = NEW.timezone) THEN
    RAISE EXCEPTION 'Invalid notification timezone' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (SELECT 1 FROM unnest(NEW.instrument_ids) AS i WHERE i IS NULL OR i !~ '^[a-z0-9_]{1,64}$')
    OR cardinality(NEW.instrument_ids) <> (SELECT count(DISTINCT i) FROM unnest(NEW.instrument_ids) AS i) THEN
    RAISE EXCEPTION 'Invalid notification instrument filter' USING ERRCODE = '23514';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.validate_notification_settings() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS notification_settings_validate ON public.notification_settings;
CREATE TRIGGER notification_settings_validate BEFORE INSERT OR UPDATE ON public.notification_settings FOR EACH ROW EXECUTE FUNCTION public.validate_notification_settings();

CREATE OR REPLACE FUNCTION public.notification_read_stamp() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  -- A client cannot forge a read timestamp or turn a read message back into unread.
  NEW.read_at := COALESCE(OLD.read_at, now());
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.notification_read_stamp() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS notification_read_stamp ON public.notifications;
CREATE TRIGGER notification_read_stamp BEFORE UPDATE OF read_at ON public.notifications FOR EACH ROW EXECUTE FUNCTION public.notification_read_stamp();

-- SECURITY INVOKER: grants/RLS apply. Expected identity prevents a late save after account switching.
CREATE OR REPLACE FUNCTION public.save_notification_settings(p_user_id uuid, p_settings jsonb, p_preferences jsonb) RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_user uuid := auth.uid(); p jsonb;
BEGIN
  IF v_user IS NULL OR p_user_id IS DISTINCT FROM v_user THEN RAISE EXCEPTION 'Notification account changed' USING ERRCODE = '42501'; END IF;
  IF jsonb_typeof(p_settings) IS DISTINCT FROM 'object' OR jsonb_typeof(p_preferences) IS DISTINCT FROM 'array'
    OR jsonb_array_length(p_preferences) > 256 THEN
    RAISE EXCEPTION 'Invalid notification preferences' USING ERRCODE = '23514';
  END IF;
  INSERT INTO public.notification_settings (user_id, all_disabled, quiet_enabled, quiet_start, quiet_end, timezone, min_importance, instrument_ids)
  VALUES (v_user, (p_settings->>'all_disabled')::boolean, (p_settings->>'quiet_enabled')::boolean,
    (p_settings->>'quiet_start')::time, (p_settings->>'quiet_end')::time, p_settings->>'timezone',
    (p_settings->>'min_importance')::smallint, ARRAY(SELECT jsonb_array_elements_text(p_settings->'instrument_ids')))
  ON CONFLICT (user_id) DO UPDATE SET all_disabled = EXCLUDED.all_disabled, quiet_enabled = EXCLUDED.quiet_enabled,
    quiet_start = EXCLUDED.quiet_start, quiet_end = EXCLUDED.quiet_end, timezone = EXCLUDED.timezone,
    min_importance = EXCLUDED.min_importance, instrument_ids = EXCLUDED.instrument_ids;
  -- Only supplied cells are changed: do not erase a new channel's settings from an older client.
  FOR p IN SELECT jsonb_array_elements(p_preferences) LOOP
    INSERT INTO public.notification_preferences (user_id, type_code, channel_code, enabled)
    VALUES (v_user, p->>'type_code', p->>'channel_code', (p->>'enabled')::boolean)
    ON CONFLICT (user_id,type_code,channel_code) DO UPDATE SET enabled = EXCLUDED.enabled;
  END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.save_notification_settings(uuid,jsonb,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_notification_settings(uuid,jsonb,jsonb) TO authenticated;
COMMIT;
