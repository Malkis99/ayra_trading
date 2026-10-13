-- AYRA Trading — Migration 0002 Down: restores the 0001 functions (the minor_mode NULL bug returns).
-- Column defaults are left in place (they match 0001). Rows added by step 4 are not removed.
BEGIN;

CREATE OR REPLACE FUNCTION public.calc_minor_mode()
RETURNS TRIGGER AS $$
BEGIN
  NEW.minor_mode := (NEW.age_group = '16-17');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id)
  VALUES (NEW.id)
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

COMMIT;
