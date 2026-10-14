-- AYRA Trading — is migration 0003 applied? (read-only)
SELECT
  EXISTS (SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'nickname_changed_at') AS nickname_changed_at_column,
  EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'tr_profiles_nickname_cooldown' AND NOT tgisinternal) AS cooldown_trigger;
