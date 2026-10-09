-- AYRA Trading — Migration 0001: Initial Schema and RLS Policies
-- Apply this file in the Supabase SQL Editor or via Supabase CLI.

-- Enable required extension if needed
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

--------------------------------------------------------------------------------
-- 1. Profiles Table
--------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  nickname TEXT UNIQUE,
  locale TEXT NOT NULL DEFAULT 'ru' CHECK (locale IN ('ru', 'en')),
  timezone TEXT NOT NULL DEFAULT 'UTC',
  age_group TEXT CHECK (age_group IN ('16-17', '18-24', '25-34', '35+')),
  minor_mode BOOLEAN NOT NULL DEFAULT FALSE,
  consent_at TIMESTAMPTZ,
  consent_version TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT nickname_format_check CHECK (nickname IS NULL OR nickname ~ '^[A-Za-z0-9_.-]{3,24}$')
);

-- Case-insensitive unique index for nicknames
CREATE UNIQUE INDEX IF NOT EXISTS profiles_nickname_lower_idx ON public.profiles (LOWER(nickname));

--------------------------------------------------------------------------------
-- 2. Triggers for Profiles (minor_mode & updated_at)
--------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.calc_minor_mode()
RETURNS TRIGGER AS $$
BEGIN
  NEW.minor_mode := (NEW.age_group = '16-17');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS tr_profiles_minor_mode ON public.profiles;
CREATE TRIGGER tr_profiles_minor_mode
  BEFORE INSERT OR UPDATE OF age_group ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.calc_minor_mode();

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS tr_profiles_updated_at ON public.profiles;
CREATE TRIGGER tr_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

--------------------------------------------------------------------------------
-- 3. Automatic Profile Creation Trigger on Auth User Registration
--------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id)
  VALUES (NEW.id)
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

--------------------------------------------------------------------------------
-- 4. RPC: is_nickname_available
--------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_nickname_available(nick TEXT)
RETURNS BOOLEAN AS $$
BEGIN
  IF nick IS NULL OR NOT (nick ~ '^[A-Za-z0-9_.-]{3,24}$') THEN
    RETURN FALSE;
  END IF;

  RETURN NOT EXISTS (
    SELECT 1 FROM public.profiles WHERE LOWER(nickname) = LOWER(nick)
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

--------------------------------------------------------------------------------
-- 5. Audit Log Table (for security events)
--------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  event TEXT NOT NULL,
  meta JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.audit_log FROM PUBLIC, anon, authenticated;

--------------------------------------------------------------------------------
-- 6. RPC: set_age_group (with cooldown and audit log)
--------------------------------------------------------------------------------
-- Note: Formal age verification with identity documents will be implemented in a future release.
CREATE OR REPLACE FUNCTION public.set_age_group(new_group TEXT)
RETURNS BOOLEAN AS $$
DECLARE
  v_uid UUID;
  v_last_change TIMESTAMPTZ;
  c_cooldown_hours CONSTANT INT := 24; -- Placeholder cooldown from lib/game-config.ts
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF new_group NOT IN ('16-17', '18-24', '25-34', '35+') THEN
    RAISE EXCEPTION 'Invalid age group';
  END IF;

  -- Transitioning to 18+ requires checking the cooldown
  IF new_group IN ('18-24', '25-34', '35+') THEN
    SELECT created_at INTO v_last_change
    FROM public.audit_log
    WHERE user_id = v_uid AND event = 'age_group_changed'
    ORDER BY created_at DESC
    LIMIT 1;

    IF v_last_change IS NOT NULL AND v_last_change > (now() - (c_cooldown_hours || ' hours')::INTERVAL) THEN
      RAISE EXCEPTION 'Age group change cooldown in effect. Please wait before changing again.';
    END IF;
  END IF;

  UPDATE public.profiles
  SET age_group = new_group
  WHERE id = v_uid;

  INSERT INTO public.audit_log (user_id, event, meta)
  VALUES (v_uid, 'age_group_changed', jsonb_build_object('new_age_group', new_group));

  RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

--------------------------------------------------------------------------------
-- 7. Reserved Tables for T7c (Telegram identities and link tokens)
--------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.telegram_identities (
  user_id UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  telegram_id BIGINT UNIQUE NOT NULL,
  linked_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.telegram_identities ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.telegram_identities FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS public.link_tokens (
  token_hash TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ
);

ALTER TABLE public.link_tokens ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.link_tokens FROM PUBLIC, anon, authenticated;

--------------------------------------------------------------------------------
-- 8. Row Level Security (RLS) & Column-Level Privileges on Profiles
--------------------------------------------------------------------------------
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.profiles FROM PUBLIC, anon, authenticated;

GRANT SELECT ON public.profiles TO authenticated;
GRANT UPDATE (nickname, locale, timezone, age_group, consent_at, consent_version) ON public.profiles TO authenticated;

-- RLS Policies for profiles
DROP POLICY IF EXISTS profiles_select_own ON public.profiles;
CREATE POLICY profiles_select_own ON public.profiles
  FOR SELECT
  USING (auth.uid() = id);

DROP POLICY IF EXISTS profiles_update_own ON public.profiles;
CREATE POLICY profiles_update_own ON public.profiles
  FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- Direct client INSERT and DELETE are forbidden
DROP POLICY IF EXISTS profiles_insert_forbidden ON public.profiles;
DROP POLICY IF EXISTS profiles_delete_forbidden ON public.profiles;

GRANT EXECUTE ON FUNCTION public.is_nickname_available(TEXT) TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_age_group(TEXT) TO authenticated;
