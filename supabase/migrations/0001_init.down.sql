-- AYRA Trading — Migration 0001 Down (Rollback)
-- Warning: Running this script will drop all T7a initial tables and functions.

DROP FUNCTION IF EXISTS public.set_age_group(TEXT);
DROP FUNCTION IF EXISTS public.is_nickname_available(TEXT);

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
DROP FUNCTION IF EXISTS public.handle_new_user();

DROP TRIGGER IF EXISTS tr_profiles_minor_mode ON public.profiles;
DROP FUNCTION IF EXISTS public.calc_minor_mode();

DROP TRIGGER IF EXISTS tr_profiles_updated_at ON public.profiles;
DROP FUNCTION IF EXISTS public.set_updated_at();

DROP TABLE IF EXISTS public.audit_log CASCADE;
DROP TABLE IF EXISTS public.link_tokens CASCADE;
DROP TABLE IF EXISTS public.telegram_identities CASCADE;
DROP TABLE IF EXISTS public.profiles CASCADE;
