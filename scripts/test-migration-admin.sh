#!/usr/bin/env bash
# AYRA Trading — the owner's transfer tool (scripts/migration-admin.mjs) end to end on a REAL throw-away PostgreSQL:
# two synthetic devices of one account (test-fixtures/q4-5-4/saves.ts shapes), the preview, the draft, the decisions and
# the activation — and the refusals on the way. Never point this at Supabase or production: PGHOST must be localhost.
#   PGHOST=localhost PGUSER=postgres PGPASSWORD=postgres bash scripts/test-migration-admin.sh
set -uo pipefail

case "${PGHOST:-}" in
  localhost|127.0.0.1) ;;
  *) echo "FAIL refusing to run: PGHOST must be localhost (got '${PGHOST:-}')"; exit 2 ;;
esac
export PGUSER="${PGUSER:-postgres}"
DB=ayra_migration_admin_test
FAILED=0
ok()  { echo "PASS $1"; }
bad() { echo "FAIL $1"; FAILED=1; }
q()   { psql -X -q -At -v ON_ERROR_STOP=1 -d "$DB" -c "$1"; }
export AYRA_MIGRATION_DB_URL="postgres://${PGUSER}:${PGPASSWORD:-}@${PGHOST}:${PGPORT:-5432}/${DB}"
# stdin closed: a missing --confirm can never wait for a person
tool() { node scripts/migration-admin.mjs "$@" </dev/null 2>&1; }

psql -X -q -d postgres -c "DROP DATABASE IF EXISTS $DB" -c "CREATE DATABASE $DB" >/dev/null || { echo "FAIL cannot create the test database"; exit 2; }
psql -X -q -v ON_ERROR_STOP=1 -d "$DB" -f supabase/tests/stub/supabase_stub.sql >/dev/null || { echo "FAIL stub"; exit 2; }
for f in 0001_init 0002_profile_defaults 0003_nickname_cooldown 0004_journal_sync 0014_game_economy 0015_game_days 0016_game_day_api 0018_game_economy_sessions 0019_game_migration_import; do
  psql -X -q -v ON_ERROR_STOP=1 -d "$DB" -f "supabase/migrations/$f.sql" >/dev/null || { echo "FAIL migration $f"; exit 2; }
done
U=00000000-0000-0000-0000-0000001ad001
q "INSERT INTO auth.users (id, email) VALUES ('$U', 'tool@example.com');" >/dev/null
q "INSERT INTO public.profiles (id, timezone) VALUES ('$U', 'UTC') ON CONFLICT (id) DO UPDATE SET timezone = 'UTC';" >/dev/null 2>&1 || true

# the window is opened by the tool only with an author, a reason and the typed account id
out=$(tool open "$U" --actor owner --reason "test window" --confirm 00000000-0000-0000-0000-000000000000)
st=$(q "SELECT COALESCE((SELECT state FROM public.game_accounts WHERE user_id = '$U'), 'local')")
echo "$out" | grep -q "does not match" && [ "$st" = local ] && ok "T1: a wrong confirmation changes nothing" || bad "T1: $out / $st"
out=$(tool open "$U" --actor owner --confirm "$U")
echo "$out" | grep -q "reason is required" && ok "T2: no reason → refused" || bad "T2: $out"
out=$(tool open "$U" --actor owner --reason "test window" --confirm "$U")
st=$(q "SELECT state FROM public.game_accounts WHERE user_id = '$U'")
[ "$st" = migration_pending ] && ok "T3: the window opened (migration_pending)" || bad "T3: $out / $st"

# two devices send their snapshots (as the route would, with a fresh token)
imp() { q "SELECT public.game_import_snapshot('$U', gen_random_uuid(), floor(extract(epoch FROM now()))::bigint, 'migration_pending', '$1', '$2', 1, '$3'::jsonb) ->> 'status'"; }
A=10000000-0000-4000-8000-0000001ad00a
B=10000000-0000-4000-8000-0000001ad00b
imp "$A" 20000000-0000-4000-8000-0000001ad00a '{"level":2,"xp":5,"coins":57,"history":[{"questId":"q_bias","xp":40,"coins":10,"completedAt":"2026-10-27"},{"questId":"q_reflect","xp":40,"coins":10,"completedAt":"2026-10-28"}],"firstActions":{"trade":"2026-10-27T15:00:00Z","note":"2026-10-27T15:10:00Z"},"dailyStats":{"2026-10-27":{"xpGained":55},"2026-10-28":{"xpGained":40}},"achievements":{"firstTrade":true}}' >/dev/null
imp "$B" 20000000-0000-4000-8000-0000001ad00b '{"level":2,"xp":10,"coins":50,"history":[{"questId":"q_bias","xp":40,"coins":10,"completedAt":"2026-10-27"},{"questId":"q_reflect","xp":30,"coins":10,"completedAt":"2026-10-28"},{"questId":"q_walk","xp":10,"coins":5,"completedAt":"2026-10-29"}],"firstActions":{"trade":"2026-10-28T10:00:00Z"}}' >/dev/null
q "INSERT INTO public.journal_notes (user_id, id, data, client_updated_at) VALUES ('$U', 'n1', '{\"id\":\"n1\",\"createdAt\":\"2026-10-27T12:00:00Z\"}', now());" >/dev/null

# the preview: proven events once across devices, the conflict, a candidate per device, the Journal evidence
out=$(tool reconcile "$U")
echo "$out" | grep -q "quest:2026-10-27:q_bias" && echo "$out" | grep -q "amount_mismatch" && echo "$out" | grep -q "NEVER summed" \
  && echo "$out" | grep -q "Journal evidence (records per day, not a proof of any reward): 2026-10-27:1" && echo "$out" | grep -q "Preview only" \
  && [ "$(q "SELECT count(*) FROM public.game_reconciliations")" = 0 ] \
  && ok "T4: the preview shows proven events, conflicts, per-device candidates and Journal evidence; stores nothing" || bad "T4: $out"
out=$(tool reconcile "$U" --save --actor owner --confirm "$U")
REC=$(q "SELECT id FROM public.game_reconciliations WHERE user_id = '$U' AND status = 'draft'")
[ -n "$REC" ] && [ "$(q "SELECT count(*) FROM public.game_legacy_reviews WHERE user_id = '$U' AND status = 'pending_review'")" = 2 ] \
  && ok "T5: the draft saved; two remainders wait for review" || bad "T5: $out"

# activation refused until every remainder is decided; a decision needs a reason
out=$(tool activate "$U" "$REC" --actor owner --confirm "$U")
echo "$out" | grep -q game_mig_unresolved && [ "$(q "SELECT state FROM public.game_accounts WHERE user_id = '$U'")" = migration_pending ] \
  && ok "T6: activation refused while a remainder is undecided; still pending" || bad "T6: $out"
out=$(tool decide "$U" "$A" accepted --xp 15 --coins 12 --actor owner --confirm "$U")
echo "$out" | grep -q "reason is required" && ok "T7: a decision without a reason is refused" || bad "T7: $out"
out=$(tool decide "$U" "$A" accepted --xp 9999 --coins 12 --actor owner --reason "too much" --confirm "$U")
echo "$out" | grep -qi "check constraint\|violates" && ok "T8: never above the candidate" || bad "T8: $out"
tool decide "$U" "$A" accepted --xp 15 --coins 12 --actor owner --reason "journal XP of 2026-10-27 matches a note that day" --confirm "$U" >/dev/null
tool decide "$U" "$B" rejected --actor owner --reason "same person, same days as device A" --confirm "$U" >/dev/null
out=$(tool activate "$U" "$REC" --actor owner --confirm "$U")
st=$(q "SELECT state FROM public.game_accounts WHERE user_id = '$U'")
prof=$(q "SELECT xp_total || '/' || coins || '/' || level FROM public.game_profile WHERE user_id = '$U'")
legacy=$(q "SELECT count(*) FROM public.game_ledger WHERE user_id = '$U' AND idempotency_key LIKE 'legacy:%'")
# proven: q_bias 40/10, q_reflect 30/10 (smaller), q_walk 10/5, first:trade 20/20, first:note 10/5 = 110 XP / 50 Coins; + 15/12
[ "$st" = cloud_active ] && [ "$prof" = "125/62/2" ] && [ "$legacy" = 1 ] \
  && ok "T9: activated: 110 XP / 50 Coins proven + 15 / 12 accepted = 125 / 62, level 2" || bad "T9: $out / $st / $prof / $legacy"
out=$(tool show "$U")
echo "$out" | grep -q "activated" && echo "$out" | grep -q "legacy_decided" && echo "$out" | grep -q "transition" \
  && ok "T10: the decision log shows every step with its author" || bad "T10: $out"
out=$(tool activate "$U" "$REC" --actor owner --confirm "$U")
[ "$(q "SELECT count(*) FROM public.game_ledger WHERE user_id = '$U'")" = 6 ] && echo "$out" | grep -q '"replay": *true\|"replay":true' \
  && ok "T11: a second activation is a replay; the ledger unchanged (6 rows)" || bad "T11: $out"

psql -X -q -d postgres -c "DROP DATABASE IF EXISTS $DB" >/dev/null
[ "$FAILED" = 0 ] && echo "ALL MIGRATION TOOL TESTS PASSED" || echo "SOME MIGRATION TOOL TESTS FAILED"
exit "$FAILED"
