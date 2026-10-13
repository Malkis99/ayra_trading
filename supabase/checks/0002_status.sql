-- AYRA — read-only check: is migration 0002 applied? Changes nothing.
-- Expected: minor_mode_default = 'false', calc_minor_mode_fixed = true, signup_never_fails = true,
-- users_without_profile = 0.
SELECT
  (SELECT column_default FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'minor_mode') AS minor_mode_default,
  position('COALESCE' IN upper(pg_get_functiondef('public.calc_minor_mode()'::regprocedure))) > 0 AS calc_minor_mode_fixed,
  position('EXCEPTION' IN upper(pg_get_functiondef('public.handle_new_user()'::regprocedure))) > 0 AS signup_never_fails,
  (SELECT count(*) FROM auth.users u
    WHERE NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = u.id)) AS users_without_profile;
