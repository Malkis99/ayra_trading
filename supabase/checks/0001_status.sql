-- AYRA — read-only check: is migration 0001_init.sql applied in this Supabase project?
-- Safe to run: it only reads system catalogs, changes nothing.
-- Every column must be true (and users_without_profile = 0 in query 2).

-- Query 1 (always works, even when the table does not exist)
SELECT
  to_regclass('public.profiles') IS NOT NULL AS profiles_table,
  EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'on_auth_user_created' AND tgrelid = 'auth.users'::regclass AND NOT tgisinternal
  ) AS signup_trigger,
  EXISTS (
    SELECT 1 FROM pg_proc WHERE proname = 'handle_new_user' AND pronamespace = 'public'::regnamespace
  ) AS handle_new_user_fn,
  EXISTS (
    SELECT 1 FROM pg_proc WHERE proname = 'is_nickname_available' AND pronamespace = 'public'::regnamespace
  ) AS nickname_rpc,
  COALESCE((SELECT relrowsecurity FROM pg_class WHERE oid = to_regclass('public.profiles')), false) AS profiles_rls_on,
  EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'profiles' AND policyname = 'profiles_select_own'
  ) AS select_own_policy,
  EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'profiles' AND policyname = 'profiles_update_own'
  ) AS update_own_policy,
  COALESCE(has_table_privilege('authenticated', to_regclass('public.profiles')::oid, 'SELECT'), false) AS authenticated_can_select;

-- Query 2 (run only if profiles_table = true): users who signed up without a profile row
-- (for example, before the trigger existed). Should be 0.
-- SELECT count(*) AS users_without_profile
-- FROM auth.users u
-- WHERE NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = u.id);
