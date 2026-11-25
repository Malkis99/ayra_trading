-- AYRA Trading — tests for 0024 (Q4.7 P5 remediation: a proof made now before an account deletion) on top of 0023.
-- Run on a TEST database; everything is rolled back. Synthetic users only. Times are moved by rewriting the row (what the
-- clock would do), never by waiting.
BEGIN;

INSERT INTO auth.users (id, email) VALUES
  ('00000000-0000-0000-0000-00000024c00a', 're-a@example.com'),
  ('00000000-0000-0000-0000-00000024c00b', 're-b@example.com')
ON CONFLICT (id) DO NOTHING;

CREATE OR REPLACE FUNCTION pg_temp.err(p_sql TEXT) RETURNS TEXT AS $$
BEGIN
  EXECUTE p_sql;
  RETURN 'ok';
EXCEPTION WHEN OTHERS THEN
  RETURN SQLERRM;
END $$ LANGUAGE plpgsql;
GRANT EXECUTE ON FUNCTION pg_temp.err(TEXT) TO PUBLIC;
CREATE OR REPLACE FUNCTION pg_temp.expect(p_ok BOOLEAN, p_what TEXT) RETURNS VOID AS $$
BEGIN
  IF NOT p_ok THEN RAISE EXCEPTION 'FAILED: %', p_what; END IF;
END $$ LANGUAGE plpgsql;

SET LOCAL ROLE service_role;

-- 1. issue → try → use: once; never a use without a counted try
SELECT pg_temp.expect((public.account_deletion_challenge_issue('00000000-0000-0000-0000-00000024c00a') ->> 'expiresInSec')::int = 600, 'issue answers the lifetime');
SELECT pg_temp.expect(NOT public.account_deletion_challenge_use('00000000-0000-0000-0000-00000024c00a'), 'no use before a try');
SELECT pg_temp.expect((public.account_deletion_challenge_try('00000000-0000-0000-0000-00000024c00a') ->> 'ok')::boolean, 'a try of an open challenge');
SELECT pg_temp.expect(public.account_deletion_challenge_use('00000000-0000-0000-0000-00000024c00a'), 'the first use');
SELECT pg_temp.expect(NOT public.account_deletion_challenge_use('00000000-0000-0000-0000-00000024c00a'), 'a second use is refused');
SELECT pg_temp.expect(public.account_deletion_challenge_try('00000000-0000-0000-0000-00000024c00a') ->> 'reason' = 'used', 'a try after the use: used');

-- 2. a new challenge within a minute is refused; after it, a new one starts again (tries 0, not used)
SELECT pg_temp.expect(pg_temp.err($$SELECT public.account_deletion_challenge_issue('00000000-0000-0000-0000-00000024c00a')$$) LIKE 'account_deletion_challenge_too_soon%', 'resend within a minute');
RESET ROLE;
UPDATE public.account_deletion_challenges SET issued_at = issued_at - interval '61 seconds', expires_at = expires_at - interval '61 seconds'
 WHERE user_id = '00000000-0000-0000-0000-00000024c00a';
SET LOCAL ROLE service_role;
SELECT public.account_deletion_challenge_issue('00000000-0000-0000-0000-00000024c00a');
SELECT pg_temp.expect((public.account_deletion_challenge_try('00000000-0000-0000-0000-00000024c00a') ->> 'tryNo')::int = 1, 'a new challenge starts its tries again');

-- 3. five tries, then closed
SELECT public.account_deletion_challenge_try('00000000-0000-0000-0000-00000024c00a') FROM generate_series(1, 4);
SELECT pg_temp.expect(public.account_deletion_challenge_try('00000000-0000-0000-0000-00000024c00a') ->> 'reason' = 'too_many', 'the sixth try');
SELECT pg_temp.expect(public.account_deletion_challenge_use('00000000-0000-0000-0000-00000024c00a'), 'the fifth try may still be used (the route checks the code after it)');

-- 4. expired: neither tried nor used
SELECT pg_temp.expect(public.account_deletion_challenge_try('00000000-0000-0000-0000-00000024c00b') ->> 'reason' = 'none', 'no challenge');
SELECT pg_temp.expect(NOT public.account_deletion_challenge_use('00000000-0000-0000-0000-00000024c00b'), 'no challenge, no use');
SELECT public.account_deletion_challenge_issue('00000000-0000-0000-0000-00000024c00b');
RESET ROLE;
UPDATE public.account_deletion_challenges SET issued_at = now() - interval '11 minutes', expires_at = now() - interval '1 minute'
 WHERE user_id = '00000000-0000-0000-0000-00000024c00b';
SET LOCAL ROLE service_role;
SELECT pg_temp.expect(public.account_deletion_challenge_try('00000000-0000-0000-0000-00000024c00b') ->> 'reason' = 'expired', 'expired: no try');
SELECT pg_temp.expect(NOT public.account_deletion_challenge_use('00000000-0000-0000-0000-00000024c00b'), 'expired: no use');

-- 5. one account's challenge never answers for another
SELECT pg_temp.expect(pg_temp.err($$SELECT count(*) FROM public.account_deletion_challenges$$) LIKE 'permission denied%', 'the service role cannot read the table');
RESET ROLE;
SELECT pg_temp.expect((SELECT count(*) FROM public.account_deletion_challenges WHERE used_at IS NOT NULL AND user_id = '00000000-0000-0000-0000-00000024c00b') = 0, 'B was never used');

-- 6. an unknown account: refused; the API roles call nothing and read nothing
SET LOCAL ROLE service_role;
SELECT pg_temp.expect(pg_temp.err($$SELECT public.account_deletion_challenge_issue('00000000-0000-0000-0000-00000024c0ff')$$) LIKE 'account_deletion_no_user%', 'unknown account');
RESET ROLE;
SELECT pg_temp.expect(NOT has_function_privilege(r, f, 'EXECUTE'), r || ' ' || f)
  FROM unnest(ARRAY['anon', 'authenticated']) r,
       unnest(ARRAY['public.account_deletion_challenge_issue(uuid)', 'public.account_deletion_challenge_try(uuid)', 'public.account_deletion_challenge_use(uuid)']) f;
SELECT pg_temp.expect(NOT has_table_privilege(r, 'public.account_deletion_challenges', p), r || ' ' || p)
  FROM unnest(ARRAY['anon', 'authenticated', 'service_role']) r, unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE']) p;

-- 7. a challenge opens also while the account is being deleted (a stopped deletion is continued with a new proof);
--    it goes with the auth user
SET LOCAL ROLE service_role;
SELECT public.account_deletion_begin('00000000-0000-0000-0000-00000024c00b');
SELECT pg_temp.expect(pg_temp.err($$SELECT public.account_deletion_challenge_issue('00000000-0000-0000-0000-00000024c00b')$$) = 'ok', 'a challenge during a deletion');
RESET ROLE;
DELETE FROM auth.users WHERE id = '00000000-0000-0000-0000-00000024c00b';
SELECT pg_temp.expect(NOT EXISTS (SELECT 1 FROM public.account_deletion_challenges WHERE user_id = '00000000-0000-0000-0000-00000024c00b'), 'gone with the account');

ROLLBACK;
