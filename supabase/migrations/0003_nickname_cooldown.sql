-- AYRA Trading — Migration 0003: nickname can be changed once per 14 days
-- Requires 0001 and 0002. Safe to run more than once (idempotent). Apply in the Supabase SQL Editor.
--
-- * profiles.nickname_changed_at — when the nickname was last changed. Set only by the server (trigger);
--   clients cannot write it (it is not in the column-level UPDATE grant from 0001).
-- * The first nickname (NULL -> value, set during onboarding) is free and does not start the 14 days.
-- * Every later change: allowed if the previous change was 14+ days ago (or never), then the date is stored.
-- * Otherwise the UPDATE fails with SQLSTATE P0001, message 'nickname_change_cooldown' (the app shows a clear text).

BEGIN;

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS nickname_changed_at TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION public.enforce_nickname_cooldown()
RETURNS TRIGGER AS $$
DECLARE
  c_cooldown CONSTANT INTERVAL := INTERVAL '14 days';
BEGIN
  IF NEW.nickname IS NOT DISTINCT FROM OLD.nickname THEN
    -- nickname not changed: keep the stored date whatever the client sent
    NEW.nickname_changed_at := OLD.nickname_changed_at;
    RETURN NEW;
  END IF;

  IF OLD.nickname IS NULL THEN
    -- first nickname (onboarding): free, does not start the cooldown
    NEW.nickname_changed_at := OLD.nickname_changed_at;
    RETURN NEW;
  END IF;

  IF OLD.nickname_changed_at IS NOT NULL AND OLD.nickname_changed_at > now() - c_cooldown THEN
    RAISE EXCEPTION 'nickname_change_cooldown' USING ERRCODE = 'P0001',
      DETAIL = 'next change allowed after ' || (OLD.nickname_changed_at + c_cooldown)::text;
  END IF;

  NEW.nickname_changed_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS tr_profiles_nickname_cooldown ON public.profiles;
CREATE TRIGGER tr_profiles_nickname_cooldown
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_nickname_cooldown();

COMMIT;
