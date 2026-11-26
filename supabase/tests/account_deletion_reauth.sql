-- AYRA Trading — tests for 0024 (Q4.7 P5 remediation: a proof made now before an account deletion) on top of 0023.
-- Run on a TEST database; everything is rolled back. Synthetic users only. Times are moved by rewriting the row (what the
-- clock would do), never by waiting. Every use names the challenge id its try answered (kept in a temp table).
BEGIN;

INSERT INTO auth.users (id, email) VALUES
  ('00000000-0000-0000-0000-00000024c00a', 're-a@example.com'),
  ('00000000-0000-0000-0000-00000024c00b', 're-b@example.com'),
  ('00000000-0000-0000-0000-00000024c00c', 're-c@example.com')
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
  IF NOT coalesce(p_ok, FALSE) THEN RAISE EXCEPTION 'FAILED: %', p_what; END IF;
END $$ LANGUAGE plpgsql;
CREATE TEMP TABLE ids (k TEXT PRIMARY KEY, v UUID);
GRANT ALL ON ids TO PUBLIC;
-- a try, its answer's challenge id kept under k
CREATE OR REPLACE FUNCTION pg_temp.try_as(p_user UUID, p_k TEXT) RETURNS JSONB AS $$
DECLARE r JSONB := public.account_deletion_challenge_try(p_user);
BEGIN
  IF (r ->> 'ok')::boolean THEN
    INSERT INTO ids VALUES (p_k, (r ->> 'challengeId')::uuid) ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v;
  END IF;
  RETURN r;
END $$ LANGUAGE plpgsql;
GRANT EXECUTE ON FUNCTION pg_temp.try_as(UUID, TEXT) TO PUBLIC;
CREATE OR REPLACE FUNCTION pg_temp.id(p_k TEXT) RETURNS UUID AS $$ SELECT v FROM ids WHERE k = p_k $$ LANGUAGE sql;
GRANT EXECUTE ON FUNCTION pg_temp.id(TEXT) TO PUBLIC;
-- moves the account's challenge back in time (as the clock would): p_issued / p_expires seconds from now
CREATE OR REPLACE FUNCTION pg_temp.age(p_user UUID, p_issued INT, p_expires INT) RETURNS VOID AS $$
  UPDATE public.account_deletion_challenges SET issued_at = now() + make_interval(secs => p_issued), expires_at = now() + make_interval(secs => p_expires)
   WHERE user_id = p_user $$ LANGUAGE sql;

SET LOCAL ROLE service_role;

-- 1. issue → try (answers the id) → use with that id: once; never a use without a try, a NULL or another id
SELECT pg_temp.expect((public.account_deletion_challenge_issue('00000000-0000-0000-0000-00000024c00a') ->> 'expiresInSec')::int = 600, '1 issue answers the lifetime');
SELECT pg_temp.expect(NOT public.account_deletion_challenge_use('00000000-0000-0000-0000-00000024c00a', gen_random_uuid()), '1 no use before a try (any id)');
SELECT pg_temp.expect((pg_temp.try_as('00000000-0000-0000-0000-00000024c00a', 'a1') ->> 'tryNo')::int = 1, '1 a try of an open challenge');
SELECT pg_temp.expect(pg_temp.id('a1') IS NOT NULL, '1 the try answers the challenge id');
SELECT pg_temp.expect(NOT public.account_deletion_challenge_use('00000000-0000-0000-0000-00000024c00a', NULL), '1 a NULL id: refused');
SELECT pg_temp.expect(NOT public.account_deletion_challenge_use('00000000-0000-0000-0000-00000024c00a', gen_random_uuid()), '1 another id: refused');
SELECT pg_temp.expect(public.account_deletion_challenge_use('00000000-0000-0000-0000-00000024c00a', pg_temp.id('a1')), '1 the first use with the id');
SELECT pg_temp.expect(NOT public.account_deletion_challenge_use('00000000-0000-0000-0000-00000024c00a', pg_temp.id('a1')), '1 reuse: refused');
SELECT pg_temp.expect(pg_temp.try_as('00000000-0000-0000-0000-00000024c00a', 'x') ->> 'reason' = 'used', '1 a try after the use: used');

-- 2. a new challenge within a minute is refused; after it, a NEW id, tries again from 0, the old id void
SELECT pg_temp.expect(pg_temp.err($$SELECT public.account_deletion_challenge_issue('00000000-0000-0000-0000-00000024c00a')$$) LIKE 'account_deletion_challenge_too_soon%', '2 resend within a minute');
RESET ROLE;
SELECT pg_temp.age('00000000-0000-0000-0000-00000024c00a', -61, 539);
SET LOCAL ROLE service_role;
SELECT public.account_deletion_challenge_issue('00000000-0000-0000-0000-00000024c00a');
SELECT pg_temp.expect((pg_temp.try_as('00000000-0000-0000-0000-00000024c00a', 'a2') ->> 'tryNo')::int = 1, '2 a new challenge starts its tries again');
SELECT pg_temp.expect(pg_temp.id('a2') <> pg_temp.id('a1'), '2 a new challenge has a new id');
SELECT pg_temp.expect(NOT public.account_deletion_challenge_use('00000000-0000-0000-0000-00000024c00a', pg_temp.id('a1')), '2 the old id spends nothing');

-- 3. replaced DURING a check: a try on the old challenge, then a new challenge, then the use of the old try → refused;
--    the new challenge is untouched (not spent, its tries 0) and works with its own try
RESET ROLE;
SELECT pg_temp.age('00000000-0000-0000-0000-00000024c00a', -61, 539);
SET LOCAL ROLE service_role;
SELECT public.account_deletion_challenge_issue('00000000-0000-0000-0000-00000024c00a');
SELECT pg_temp.try_as('00000000-0000-0000-0000-00000024c00a', 'old');
RESET ROLE;
SELECT pg_temp.age('00000000-0000-0000-0000-00000024c00a', -61, 539);
SET LOCAL ROLE service_role;
SELECT public.account_deletion_challenge_issue('00000000-0000-0000-0000-00000024c00a'); -- another tab: «send a new code»
SELECT pg_temp.expect(NOT public.account_deletion_challenge_use('00000000-0000-0000-0000-00000024c00a', pg_temp.id('old')), '3 the try of the replaced challenge spends nothing');
RESET ROLE;
SELECT pg_temp.expect((SELECT used_at IS NULL AND tries = 0 FROM public.account_deletion_challenges WHERE user_id = '00000000-0000-0000-0000-00000024c00a'), '3 the new challenge untouched');
SET LOCAL ROLE service_role;
SELECT pg_temp.expect(NOT public.account_deletion_challenge_use('00000000-0000-0000-0000-00000024c00a', pg_temp.id('old')), '3 still nothing without a try of the new one');
SELECT pg_temp.try_as('00000000-0000-0000-0000-00000024c00a', 'new');
SELECT pg_temp.expect(NOT public.account_deletion_challenge_use('00000000-0000-0000-0000-00000024c00a', pg_temp.id('old')), '3 the old try never spends the new, tried challenge');
RESET ROLE;
SELECT pg_temp.expect((SELECT used_at IS NULL FROM public.account_deletion_challenges WHERE user_id = '00000000-0000-0000-0000-00000024c00a'), '3 the new challenge still open');
SET LOCAL ROLE service_role;
SELECT pg_temp.expect(public.account_deletion_challenge_use('00000000-0000-0000-0000-00000024c00a', pg_temp.id('new')), '3 the new challenge with its own try');

-- 4. five tries, then closed; a sixth gets no id
RESET ROLE;
SELECT pg_temp.age('00000000-0000-0000-0000-00000024c00a', -61, 539);
SET LOCAL ROLE service_role;
SELECT public.account_deletion_challenge_issue('00000000-0000-0000-0000-00000024c00a');
SELECT pg_temp.try_as('00000000-0000-0000-0000-00000024c00a', 'five') FROM generate_series(1, 5);
SELECT pg_temp.expect(pg_temp.try_as('00000000-0000-0000-0000-00000024c00a', 'six') ->> 'reason' = 'too_many', '4 the sixth try');
SELECT pg_temp.expect(pg_temp.id('six') IS NULL, '4 the sixth try answers no id');
SELECT pg_temp.expect(public.account_deletion_challenge_use('00000000-0000-0000-0000-00000024c00a', pg_temp.id('five')), '4 the fifth try may still be used (the route checks its code after it)');

-- 5. expired: neither tried nor used (also with the id of a try made before it expired)
SELECT pg_temp.expect(pg_temp.try_as('00000000-0000-0000-0000-00000024c00b', 'x') ->> 'reason' = 'none', '5 no challenge');
SELECT public.account_deletion_challenge_issue('00000000-0000-0000-0000-00000024c00b');
SELECT pg_temp.try_as('00000000-0000-0000-0000-00000024c00b', 'b1');
RESET ROLE;
SELECT pg_temp.age('00000000-0000-0000-0000-00000024c00b', -660, -60);
SET LOCAL ROLE service_role;
SELECT pg_temp.expect(pg_temp.try_as('00000000-0000-0000-0000-00000024c00b', 'x') ->> 'reason' = 'expired', '5 expired: no try');
SELECT pg_temp.expect(NOT public.account_deletion_challenge_use('00000000-0000-0000-0000-00000024c00b', pg_temp.id('b1')), '5 expired: its earlier try spends nothing');

-- 6. the wrong account: another account's challenge id never spends this one, and the reverse
SELECT public.account_deletion_challenge_issue('00000000-0000-0000-0000-00000024c00c');
SELECT pg_temp.try_as('00000000-0000-0000-0000-00000024c00c', 'c1');
SELECT pg_temp.expect(NOT public.account_deletion_challenge_use('00000000-0000-0000-0000-00000024c00b', pg_temp.id('c1')), '6 C''s id for B: refused');
SELECT pg_temp.expect(NOT public.account_deletion_challenge_use('00000000-0000-0000-0000-00000024c0ff', pg_temp.id('c1')), '6 C''s id for an unknown account: refused');
RESET ROLE;
SELECT pg_temp.expect((SELECT used_at IS NULL FROM public.account_deletion_challenges WHERE user_id = '00000000-0000-0000-0000-00000024c00c'), '6 C untouched');

-- 7. privileges: the service role calls the three steps but reads nothing; the API roles call and read nothing
SET LOCAL ROLE service_role;
SELECT pg_temp.expect(pg_temp.err($$SELECT count(*) FROM public.account_deletion_challenges$$) LIKE 'permission denied%', '7 the service role cannot read the table');
SELECT pg_temp.expect(pg_temp.err($$SELECT public.account_deletion_challenge_issue('00000000-0000-0000-0000-00000024c0ff')$$) LIKE 'account_deletion_no_user%', '7 unknown account');
RESET ROLE;
SELECT pg_temp.expect(NOT has_function_privilege(r, f, 'EXECUTE'), '7 ' || r || ' ' || f)
  FROM unnest(ARRAY['anon', 'authenticated']) r,
       unnest(ARRAY['public.account_deletion_challenge_issue(uuid)', 'public.account_deletion_challenge_try(uuid)', 'public.account_deletion_challenge_use(uuid,uuid)']) f;
SELECT pg_temp.expect(NOT has_table_privilege(r, 'public.account_deletion_challenges', p), '7 ' || r || ' ' || p)
  FROM unnest(ARRAY['anon', 'authenticated', 'service_role']) r, unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE']) p;
SELECT pg_temp.expect(to_regprocedure('public.account_deletion_challenge_use(uuid)') IS NULL, '7 no use without an id exists');

-- 8. a challenge opens also while the account is being deleted (a stopped deletion is continued with a new proof);
--    it goes with the auth user
SET LOCAL ROLE service_role;
SELECT public.account_deletion_begin('00000000-0000-0000-0000-00000024c00b');
SELECT pg_temp.expect(pg_temp.err($$SELECT public.account_deletion_challenge_issue('00000000-0000-0000-0000-00000024c00b')$$) = 'ok', '8 a challenge during a deletion');
RESET ROLE;
DELETE FROM auth.users WHERE id = '00000000-0000-0000-0000-00000024c00b';
SELECT pg_temp.expect(NOT EXISTS (SELECT 1 FROM public.account_deletion_challenges WHERE user_id = '00000000-0000-0000-0000-00000024c00b'), '8 gone with the account');

ROLLBACK;
