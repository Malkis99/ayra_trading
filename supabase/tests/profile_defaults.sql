-- AYRA Trading — test for migration 0002 (run in SQL Editor on a TEST project, or locally).
-- Everything runs inside a transaction and is rolled back: no data stays behind.
-- Success: the script finishes with "ROLLBACK" and no error. Failure: an ASSERT error names the problem.

BEGIN;

-- New user with no age group and no nickname: sign-up succeeds, profile row created, minor_mode = false
INSERT INTO auth.users (id, email)
VALUES ('00000000-0000-0000-0000-0000000000a1', 'profile-defaults-test@example.com');

DO $$
DECLARE p public.profiles%ROWTYPE;
BEGIN
  SELECT * INTO p FROM public.profiles WHERE id = '00000000-0000-0000-0000-0000000000a1';
  ASSERT FOUND, 'profile row was not created for a new user';
  ASSERT p.minor_mode = false, 'minor_mode must be false while age_group is empty';
  ASSERT p.nickname IS NULL AND p.age_group IS NULL, 'new profile must start without nickname and age group';
  ASSERT p.locale = 'ru' AND p.timezone = 'UTC', 'locale/timezone defaults missing';
  ASSERT p.consent_at IS NULL AND p.created_at IS NOT NULL AND p.updated_at IS NOT NULL, 'timestamps/consent defaults wrong';
END $$;

-- Choosing 16–17 turns minor_mode on; choosing an adult group turns it off; clearing it keeps it false
UPDATE public.profiles SET age_group = '16-17' WHERE id = '00000000-0000-0000-0000-0000000000a1';
DO $$ BEGIN
  ASSERT (SELECT minor_mode FROM public.profiles WHERE id = '00000000-0000-0000-0000-0000000000a1') = true,
    'minor_mode must be true for 16-17';
END $$;

UPDATE public.profiles SET age_group = '18-24' WHERE id = '00000000-0000-0000-0000-0000000000a1';
DO $$ BEGIN
  ASSERT (SELECT minor_mode FROM public.profiles WHERE id = '00000000-0000-0000-0000-0000000000a1') = false,
    'minor_mode must be false for 18-24';
END $$;

UPDATE public.profiles SET age_group = NULL WHERE id = '00000000-0000-0000-0000-0000000000a1';
DO $$ BEGIN
  ASSERT (SELECT minor_mode FROM public.profiles WHERE id = '00000000-0000-0000-0000-0000000000a1') = false,
    'minor_mode must be false when age_group is cleared';
END $$;

ROLLBACK;
