-- AYRA Trading — rollback of 0024 (Q4.7 P5 remediation). The open challenges go with it (nothing else depends on them);
-- the route of this version then refuses every deletion without the password (fail closed) until 0024 is back.

BEGIN;

DROP FUNCTION IF EXISTS public.account_deletion_challenge_use(UUID, UUID);
DROP FUNCTION IF EXISTS public.account_deletion_challenge_use(UUID);
DROP FUNCTION IF EXISTS public.account_deletion_challenge_try(UUID);
DROP FUNCTION IF EXISTS public.account_deletion_challenge_issue(UUID);
DROP FUNCTION IF EXISTS public.account_deletion_challenge_limits();
DROP TABLE IF EXISTS public.account_deletion_challenges;

COMMIT;
