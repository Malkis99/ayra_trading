-- AYRA Trading — 0024: proving it is the person before an account deletion starts (Q4.7 P5 remediation,
-- docs/q4-7-b1-account-deletion-storage.md, section «Повторное подтверждение»). Requires 0023.
--
-- Why: the hosted pilot showed that a session from a password-recovery link carries the same `amr` («otp») as a magic link
-- or an e-mail code, so the token cannot tell how the person signed in. A recent sign-in is no longer a proof. The route
-- accepts only a proof made NOW, for THIS deletion:
--   * the password — checked by the auth server (as before);
--   * or a one-time e-mail code: the route opens a challenge here (one per account, short-lived), asks the auth server to
--     send a code to the account's e-mail, and later checks the code with the auth server. The challenge binds the check to
--     the account and to the deletion, limits the tries, and is spent once (a second use is refused).
-- The code itself is single-use at the auth server too; this table adds the binding, the expiry, the try limit and the
-- one-time use on our side. Only the service key (the route) calls these; no API role reads or writes the table.
--
-- Concurrency (review of #230): every challenge has its own server-made id. A try answers the id it was counted on, and a
-- use spends the challenge only if it is STILL that id — so a challenge opened again while a code is being checked (a
-- second «send code» in another tab) voids every try of the old one: its code no longer spends anything. Every step locks
-- the account's row, so two uses of one challenge are serialised and only the first one finds it open. Anything else
-- (no challenge, another id, expired, spent, no try, too many tries, a NULL) is a refusal.
-- Idempotent: safe to run twice.

BEGIN;

CREATE TABLE IF NOT EXISTS public.account_deletion_challenges (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  -- this challenge's own id: new on every issue (the version a try answers and a use must name)
  challenge_id UUID NOT NULL DEFAULT gen_random_uuid(),
  issued_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  tries INT NOT NULL DEFAULT 0 CHECK (tries >= 0),
  used_at TIMESTAMPTZ,
  CHECK (expires_at > issued_at)
);
ALTER TABLE public.account_deletion_challenges ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.account_deletion_challenges FROM PUBLIC, anon, authenticated, service_role;
-- Part of the deletion procedure itself, like account_deletions: NOT under 0023's guard — a deletion that stopped half-way
-- is continued with a new proof, so a challenge must open also while the account is being deleted. It holds no data of the
-- person (times and a counter) and goes with the auth user.

-- The limits (seconds / tries): a challenge lives 10 minutes, a new one at most once a minute, 5 codes tried per challenge
CREATE OR REPLACE FUNCTION public.account_deletion_challenge_limits()
RETURNS JSONB AS $$ SELECT jsonb_build_object('ttlSec', 600, 'resendSec', 60, 'maxTries', 5) $$
LANGUAGE sql IMMUTABLE SET search_path = public;

-- Opens a new challenge with a new id (replaces the old one: every try of it is void, its tries and its use start
-- again). Refused within resendSec of the last.
CREATE OR REPLACE FUNCTION public.account_deletion_challenge_issue(p_user UUID)
RETURNS JSONB AS $$
DECLARE
  v_lim JSONB := public.account_deletion_challenge_limits();
  v_last TIMESTAMPTZ;
  v_row public.account_deletion_challenges%ROWTYPE;
BEGIN
  IF p_user IS NULL OR NOT EXISTS (SELECT 1 FROM auth.users WHERE id = p_user) THEN
    RAISE EXCEPTION 'account_deletion_no_user' USING ERRCODE = '22023';
  END IF;
  SELECT issued_at INTO v_last FROM public.account_deletion_challenges WHERE user_id = p_user FOR UPDATE;
  IF v_last IS NOT NULL AND v_last > now() - make_interval(secs => (v_lim ->> 'resendSec')::int) THEN
    RAISE EXCEPTION 'account_deletion_challenge_too_soon' USING ERRCODE = '22023',
      DETAIL = ceil(extract(epoch FROM v_last + make_interval(secs => (v_lim ->> 'resendSec')::int) - now()))::text;
  END IF;
  INSERT INTO public.account_deletion_challenges (user_id, challenge_id, issued_at, expires_at, tries, used_at)
  VALUES (p_user, gen_random_uuid(), now(), now() + make_interval(secs => (v_lim ->> 'ttlSec')::int), 0, NULL)
  ON CONFLICT (user_id) DO UPDATE SET challenge_id = EXCLUDED.challenge_id, issued_at = EXCLUDED.issued_at,
    expires_at = EXCLUDED.expires_at, tries = 0, used_at = NULL
  RETURNING * INTO v_row;
  RETURN jsonb_build_object('expiresInSec', (v_lim ->> 'ttlSec')::int, 'maxTries', (v_lim ->> 'maxTries')::int);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- One try of a code: counted BEFORE the code is checked (a wrong code spends a try). Answers why it cannot be tried:
-- none / expired / used / too_many — or ok with the id of the challenge the try was counted on.
CREATE OR REPLACE FUNCTION public.account_deletion_challenge_try(p_user UUID)
RETURNS JSONB AS $$
DECLARE
  v_lim JSONB := public.account_deletion_challenge_limits();
  v_row public.account_deletion_challenges%ROWTYPE;
BEGIN
  SELECT * INTO v_row FROM public.account_deletion_challenges WHERE user_id = p_user FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', FALSE, 'reason', 'none'); END IF;
  IF v_row.used_at IS NOT NULL THEN RETURN jsonb_build_object('ok', FALSE, 'reason', 'used'); END IF;
  IF v_row.expires_at <= now() THEN RETURN jsonb_build_object('ok', FALSE, 'reason', 'expired'); END IF;
  IF v_row.tries >= (v_lim ->> 'maxTries')::int THEN RETURN jsonb_build_object('ok', FALSE, 'reason', 'too_many'); END IF;
  UPDATE public.account_deletion_challenges SET tries = tries + 1 WHERE user_id = p_user;
  RETURN jsonb_build_object('ok', TRUE, 'tryNo', v_row.tries + 1, 'challengeId', v_row.challenge_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- The auth server accepted the code for this account: the challenge named by the try is spent. TRUE only for the first
-- caller, only while it is still THAT challenge, open and tried (a second use, a concurrent one, a challenge opened again
-- meanwhile, an expired one, a use without a try, a NULL: FALSE — the route then refuses).
DROP FUNCTION IF EXISTS public.account_deletion_challenge_use(UUID);
CREATE OR REPLACE FUNCTION public.account_deletion_challenge_use(p_user UUID, p_challenge UUID)
RETURNS BOOLEAN AS $$
DECLARE
  v_lim JSONB := public.account_deletion_challenge_limits();
  v_n INT;
BEGIN
  IF p_user IS NULL OR p_challenge IS NULL THEN RETURN FALSE; END IF;
  UPDATE public.account_deletion_challenges SET used_at = now()
   WHERE user_id = p_user AND challenge_id = p_challenge AND used_at IS NULL AND expires_at > now()
     AND tries BETWEEN 1 AND (v_lim ->> 'maxTries')::int;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n = 1;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION public.account_deletion_challenge_limits() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.account_deletion_challenge_issue(UUID) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.account_deletion_challenge_try(UUID) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.account_deletion_challenge_use(UUID, UUID) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.account_deletion_challenge_issue(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.account_deletion_challenge_try(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.account_deletion_challenge_use(UUID, UUID) TO service_role;

COMMIT;
