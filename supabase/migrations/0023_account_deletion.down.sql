-- AYRA Trading — rollback of 0023 (Q4.7-Б1). Refuses while an account is being deleted (its file list is the only record of
-- which files the procedure still has to remove). Restores 0004's cloud_sync_enabled(); the anonymous counts go with it.

BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.account_deletions) THEN
    RAISE EXCEPTION 'account_deletion_in_progress: finish (or have the owner review) every account deletion before rolling back 0023';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.cloud_sync_enabled()
RETURNS BOOLEAN AS $$
  SELECT COALESCE((SELECT cloud_sync FROM public.user_features WHERE user_id = auth.uid()), FALSE);
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

DROP FUNCTION IF EXISTS public.account_deletion_ready(UUID);
DROP FUNCTION IF EXISTS public.account_deletion_failed(UUID, TEXT);
DROP FUNCTION IF EXISTS public.account_deletion_manifest(UUID);
DROP FUNCTION IF EXISTS public.account_deletion_begin(UUID);
DROP FUNCTION IF EXISTS public.account_deletion_status(UUID);
DROP FUNCTION IF EXISTS public.account_deletion_buckets();
DROP FUNCTION IF EXISTS public.account_deletion_count(TEXT, BIGINT);
DROP TABLE IF EXISTS public.account_deletion_objects;
DROP TABLE IF EXISTS public.account_deletion_stats;
DROP TABLE IF EXISTS public.account_deletions;

COMMIT;
