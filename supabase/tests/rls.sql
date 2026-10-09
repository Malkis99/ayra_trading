-- AYRA Trading — RLS Manual Test Script
-- Run this script in the Supabase SQL Editor to verify RLS enforcement and privilege restrictions.

BEGIN;

-- 1. Test Anon Role Access (Must return 0 rows or permission denied)
SET LOCAL ROLE anon;
SELECT * FROM public.profiles; -- Expected: Permission denied or 0 rows
SELECT * FROM public.telegram_identities; -- Expected: Permission denied
SELECT * FROM public.link_tokens; -- Expected: Permission denied
SELECT * FROM public.audit_log; -- Expected: Permission denied

-- Test is_nickname_available under anon (Must work and return boolean)
SELECT public.is_nickname_available('valid_nick'); -- Expected: true
SELECT public.is_nickname_available('bad'); -- Expected: false

-- 2. Test Authenticated Role Access for User A
-- Set mock auth context for user A
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = '00000000-0000-0000-0000-000000000001';

-- Create mock profiles for testing
RESET ROLE;
INSERT INTO auth.users (id, email)
VALUES
  ('00000000-0000-0000-0000-000000000001', 'usera@example.com'),
  ('00000000-0000-0000-0000-000000000002', 'userb@example.com')
ON CONFLICT (id) DO NOTHING;

-- Trigger automatically creates profiles. Verify User A can see only User A profile
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = '00000000-0000-0000-0000-000000000001';

SELECT id, nickname FROM public.profiles; -- Expected: Only user A's profile row

-- Test updating own nickname
UPDATE public.profiles SET nickname = 'user_a_nick' WHERE id = '00000000-0000-0000-0000-000000000001';

-- Test trying to update minor_mode directly (Must fail or be ignored due to column grant)
-- UPDATE public.profiles SET minor_mode = true WHERE id = '00000000-0000-0000-0000-000000000001'; -- Expected: Permission denied

-- Test trying to update User B profile (Must affect 0 rows)
UPDATE public.profiles SET nickname = 'hacked' WHERE id = '00000000-0000-0000-0000-000000000002'; -- Expected: 0 rows updated

-- Test reserved tables access under authenticated (Must fail)
-- SELECT * FROM public.telegram_identities; -- Expected: Permission denied
-- SELECT * FROM public.link_tokens; -- Expected: Permission denied

ROLLBACK;
