-- AYRA Trading — test for migration 0003 (run on a TEST project; everything is rolled back at the end).
-- Every check raises an exception when it fails, so a clean run means all passed.
BEGIN;

INSERT INTO auth.users (id, email) VALUES ('00000000-0000-0000-0000-0000000000c1', 'cooldown@example.com')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.profiles (id) VALUES ('00000000-0000-0000-0000-0000000000c1') ON CONFLICT (id) DO NOTHING;

DO $$
DECLARE
  v_at TIMESTAMPTZ;
  v_failed BOOLEAN := FALSE;
BEGIN
  -- 1. First nickname (onboarding) is free and does not start the cooldown
  UPDATE public.profiles SET nickname = 'Cool_One' WHERE id = '00000000-0000-0000-0000-0000000000c1';
  SELECT nickname_changed_at INTO v_at FROM public.profiles WHERE id = '00000000-0000-0000-0000-0000000000c1';
  IF v_at IS NOT NULL THEN RAISE EXCEPTION 'T1: first nickname must not set nickname_changed_at'; END IF;

  -- 2. The first change after onboarding is allowed at once and stores the date
  UPDATE public.profiles SET nickname = 'Cool_Two' WHERE id = '00000000-0000-0000-0000-0000000000c1';
  SELECT nickname_changed_at INTO v_at FROM public.profiles WHERE id = '00000000-0000-0000-0000-0000000000c1';
  IF v_at IS NULL THEN RAISE EXCEPTION 'T2: change after onboarding must set nickname_changed_at'; END IF;

  -- 3. A second change within 14 days fails with nickname_change_cooldown
  BEGIN
    UPDATE public.profiles SET nickname = 'Cool_Three' WHERE id = '00000000-0000-0000-0000-0000000000c1';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'nickname_change_cooldown' THEN v_failed := TRUE; END IF;
  END;
  IF NOT v_failed THEN RAISE EXCEPTION 'T3: second change within 14 days must fail'; END IF;

  -- 4. Other columns can still be updated; the date cannot be forged by the client
  UPDATE public.profiles SET locale = 'en', nickname_changed_at = now() - INTERVAL '30 days'
  WHERE id = '00000000-0000-0000-0000-0000000000c1';
  IF (SELECT nickname_changed_at FROM public.profiles WHERE id = '00000000-0000-0000-0000-0000000000c1') <> v_at THEN
    RAISE EXCEPTION 'T4: nickname_changed_at must not change without a nickname change';
  END IF;

  -- 5. After 14 days the nickname can be changed again
  ALTER TABLE public.profiles DISABLE TRIGGER tr_profiles_nickname_cooldown;
  UPDATE public.profiles SET nickname_changed_at = now() - INTERVAL '15 days' WHERE id = '00000000-0000-0000-0000-0000000000c1';
  ALTER TABLE public.profiles ENABLE TRIGGER tr_profiles_nickname_cooldown;
  UPDATE public.profiles SET nickname = 'Cool_Four' WHERE id = '00000000-0000-0000-0000-0000000000c1';
  IF (SELECT nickname FROM public.profiles WHERE id = '00000000-0000-0000-0000-0000000000c1') <> 'Cool_Four' THEN
    RAISE EXCEPTION 'T5: change after 14 days must succeed';
  END IF;
END $$;

ROLLBACK;
