-- AYRA Trading — Migration 0002: creating a profile row never fails sign-up
-- Requires 0001_init.sql. Safe to run more than once (idempotent).
--
-- Bug: calc_minor_mode() set minor_mode := (age_group = '16-17'), which is NULL while age_group is
-- not chosen yet (every new user). minor_mode is NOT NULL, so the INSERT from handle_new_user()
-- failed with 23502 and the whole sign-up in auth.users was rolled back.
--
-- Columns of public.profiles for a new row with no fields filled (INSERT ... (id) only):
--   nickname NULL ok (nickname_format_check allows NULL) | locale default 'ru' (CHECK ok)
--   timezone default 'UTC' | age_group NULL ok (CHECK allows NULL) | minor_mode -> false (fixed here)
--   consent_at / consent_version NULL ok | created_at / updated_at default now()

BEGIN;

-- 1. Defaults for every NOT NULL column (re-applied in case they were lost).
ALTER TABLE public.profiles ALTER COLUMN minor_mode SET DEFAULT false;
ALTER TABLE public.profiles ALTER COLUMN locale SET DEFAULT 'ru';
ALTER TABLE public.profiles ALTER COLUMN timezone SET DEFAULT 'UTC';
ALTER TABLE public.profiles ALTER COLUMN created_at SET DEFAULT now();
ALTER TABLE public.profiles ALTER COLUMN updated_at SET DEFAULT now();

-- 2. minor_mode is never NULL: no age group yet -> false. NOT NULL stays.
CREATE OR REPLACE FUNCTION public.calc_minor_mode()
RETURNS TRIGGER AS $$
BEGIN
  NEW.minor_mode := COALESCE(NEW.age_group = '16-17', false);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- 3. A profile problem must never block sign-up: log a warning and let auth.users insert succeed.
--    The app treats a missing row as a new account (-> /awakening); step 4 and the check below find such users.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  BEGIN
    INSERT INTO public.profiles (id)
    VALUES (NEW.id)
    ON CONFLICT (id) DO NOTHING;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'handle_new_user: profile row not created for user %: % (SQLSTATE %)', NEW.id, SQLERRM, SQLSTATE;
  END;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- 4. Empty profile rows for existing users that have none (only inserts missing rows; changes nothing else).
INSERT INTO public.profiles (id)
SELECT u.id FROM auth.users u
ON CONFLICT (id) DO NOTHING;

COMMIT;
