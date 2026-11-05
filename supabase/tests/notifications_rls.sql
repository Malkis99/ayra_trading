-- TEST database only. Fixtures are never production notifications. Everything is rolled back.
BEGIN;
INSERT INTO auth.users (id,email) VALUES
 ('00000000-0000-0000-0000-000000001101','notify-a@test.invalid'),
 ('00000000-0000-0000-0000-000000001102','notify-b@test.invalid');
INSERT INTO public.notifications(id,user_id,event_key,type_code,payload,created_at) VALUES
 ('00000000-0000-0000-0000-000000001111','00000000-0000-0000-0000-000000001101','test-a','market_actual','{"actual":"1"}', now()),
 ('00000000-0000-0000-0000-000000001112','00000000-0000-0000-0000-000000001102','test-b','security_new_device','{}', now()),
 ('00000000-0000-0000-0000-000000001113','00000000-0000-0000-0000-000000001101','test-old','quest','{}', now()-interval '91 days');
DO $$ BEGIN
  BEGIN
    INSERT INTO public.notifications(user_id,event_key,type_code) VALUES ('00000000-0000-0000-0000-000000001101','test-a','market_actual');
    RAISE EXCEPTION 'N: duplicate event accepted';
  EXCEPTION WHEN unique_violation THEN NULL; END;
END $$;

SET LOCAL ROLE anon;
DO $$ BEGIN
  BEGIN PERFORM * FROM public.notifications; RAISE EXCEPTION 'N: anon read accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM * FROM public.notification_settings; RAISE EXCEPTION 'N: anon settings read accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM * FROM public.notification_preferences; RAISE EXCEPTION 'N: anon preferences read accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM public.save_notification_settings(NULL,'{}','[]'); RAISE EXCEPTION 'N: anon RPC accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000001101',true);
SET LOCAL ROLE authenticated;
SELECT public.save_notification_settings('00000000-0000-0000-0000-000000001101','{"all_disabled":true,"quiet_enabled":true,"quiet_start":"22:00","quiet_end":"08:00","timezone":"Asia/Tbilisi","min_importance":3,"instrument_ids":["btc"]}',
 '[{"type_code":"market_actual","channel_code":"site","enabled":false}]');
-- upsert path is checked too, not only the initial insert
SELECT public.save_notification_settings('00000000-0000-0000-0000-000000001101','{"all_disabled":true,"quiet_enabled":true,"quiet_start":"22:00","quiet_end":"08:00","timezone":"Asia/Tbilisi","min_importance":2,"instrument_ids":["btc"]}', '[]');
DO $$ BEGIN
  IF (SELECT count(*) FROM public.notifications) <> 1 THEN RAISE EXCEPTION 'N: foreign/expired inbox visible'; END IF;
  IF NOT (SELECT all_disabled AND min_importance=2 FROM public.notification_settings) THEN RAISE EXCEPTION 'N: settings save failed'; END IF;
  IF (SELECT count(*) FROM public.notification_preferences) <> 1 THEN RAISE EXCEPTION 'N: preferences lost'; END IF;
  BEGIN
    INSERT INTO public.notifications(user_id,event_key,type_code) VALUES ('00000000-0000-0000-0000-000000001101','forged','quest');
    RAISE EXCEPTION 'N: client forged notification';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN UPDATE public.notifications SET payload='{}'; RAISE EXCEPTION 'N: payload update accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN UPDATE public.notifications SET user_id='00000000-0000-0000-0000-000000001102'; RAISE EXCEPTION 'N: owner update accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    INSERT INTO public.notification_settings(user_id) VALUES ('00000000-0000-0000-0000-000000001102');
    RAISE EXCEPTION 'N: foreign settings insert accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    INSERT INTO public.notification_preferences(user_id,type_code,channel_code,enabled) VALUES ('00000000-0000-0000-0000-000000001102','quest','site',false);
    RAISE EXCEPTION 'N: foreign preference accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    INSERT INTO public.notification_preferences(user_id,type_code,channel_code,enabled) VALUES ('00000000-0000-0000-0000-000000001101','security_new_device','site',false);
    RAISE EXCEPTION 'N: critical security disabled';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN UPDATE public.notification_settings SET timezone='Invalid/Zone'; RAISE EXCEPTION 'N: invalid timezone accepted'; EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN UPDATE public.notification_settings SET quiet_end=quiet_start; RAISE EXCEPTION 'N: ambiguous quiet range accepted'; EXCEPTION WHEN check_violation THEN NULL; END;
  -- The whole RPC must roll back if any cell is invalid.
  BEGIN
    PERFORM public.save_notification_settings('00000000-0000-0000-0000-000000001101','{"all_disabled":false,"quiet_enabled":false,"quiet_start":"22:00","quiet_end":"08:00","timezone":"UTC","min_importance":1,"instrument_ids":[]}',
      '[{"type_code":"security_suspicious","channel_code":"site","enabled":false}]');
    RAISE EXCEPTION 'N: invalid matrix accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
  IF NOT (SELECT all_disabled FROM public.notification_settings) THEN RAISE EXCEPTION 'N: partial RPC save'; END IF;
END $$;
UPDATE public.notifications SET read_at='2000-01-01' WHERE id='00000000-0000-0000-0000-000000001111';
DO $$ BEGIN
  IF (SELECT read_at FROM public.notifications WHERE id='00000000-0000-0000-0000-000000001111') <> now() THEN RAISE EXCEPTION 'N: forged read timestamp'; END IF;
END $$;
UPDATE public.notifications SET read_at=NULL WHERE id='00000000-0000-0000-0000-000000001111';
DO $$ BEGIN
  IF (SELECT read_at FROM public.notifications WHERE id='00000000-0000-0000-0000-000000001111') IS NULL THEN RAISE EXCEPTION 'N: read reset accepted'; END IF;
END $$;
-- An attempted foreign update/delete affects no rows, and the other account remains intact.
UPDATE public.notifications SET read_at=now() WHERE id='00000000-0000-0000-0000-000000001112';
DELETE FROM public.notifications WHERE id='00000000-0000-0000-0000-000000001112';
DELETE FROM public.notifications WHERE id='00000000-0000-0000-0000-000000001111';
RESET ROLE;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.notifications WHERE id='00000000-0000-0000-0000-000000001112' AND read_at IS NULL) THEN RAISE EXCEPTION 'N: foreign notification changed'; END IF;
  IF EXISTS (SELECT 1 FROM public.notifications WHERE id='00000000-0000-0000-0000-000000001111') THEN RAISE EXCEPTION 'N: own delete failed'; END IF;
END $$;
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000001102',true);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  BEGIN PERFORM public.save_notification_settings('00000000-0000-0000-0000-000000001101','{}','[]'); RAISE EXCEPTION 'N: stale account save accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  IF (SELECT count(*) FROM public.notifications) <> 1 THEN RAISE EXCEPTION 'N: B inbox wrong'; END IF;
  IF (SELECT count(*) FROM public.notification_settings) <> 0 OR (SELECT count(*) FROM public.notification_preferences) <> 0 THEN RAISE EXCEPTION 'N: B sees A preferences'; END IF;
END $$;
RESET ROLE;
ROLLBACK;
