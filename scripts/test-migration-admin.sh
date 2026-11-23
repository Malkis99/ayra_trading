#!/usr/bin/env bash
# AYRA Trading — the owner's transfer tool (scripts/migration-admin.mjs) end to end on a REAL throw-away PostgreSQL:
# two synthetic devices of one account (test-fixtures/q4-5-4/saves.ts shapes), the preview, the draft, the decisions and
# the activation — and the refusals on the way: a forged result, an open window, a new account, a late device. Then the
# two implementations of the reconciliation side by side (scripts/test-reconcile-twins.mjs).
# Never point this at Supabase or production: PGHOST must be localhost.
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
tool() { node --no-warnings scripts/migration-admin.mjs "$@" </dev/null 2>&1; }
# time passing (7 days) is simulated by the database owner setting the window's end to now — the test's clock only
close_window() { q "SET ROLE game_economy_owner; INSERT INTO public.game_migration_windows (user_id, closes_at, changed_by, reason)
  VALUES ('$1', now(), 'test clock', 'simulated: the 7 days passed') ON CONFLICT (user_id) DO UPDATE SET closes_at = now();" >/dev/null; }

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
days=$(q "SELECT CASE WHEN public.game_mig_window_closes_at('$U') - state_changed_at = interval '7 days' THEN 7 END FROM public.game_accounts WHERE user_id = '$U'")
[ "$st" = migration_pending ] && [ "$days" = 7 ] && ok "T3: the window opened (migration_pending) for 7 days" || bad "T3: $out / $st / $days days"

# two devices send their snapshots (as the route would, with a fresh token)
imp() { q "SELECT public.game_import_snapshot('$U', gen_random_uuid(), floor(extract(epoch FROM now()))::bigint, 'migration_pending', '$1', '$2', 1, '$3'::jsonb) ->> 'status'"; }
A=10000000-0000-4000-8000-0000001ad00a
B=10000000-0000-4000-8000-0000001ad00b
imp "$A" 20000000-0000-4000-8000-0000001ad00a '{"level":2,"xp":5,"coins":57,"history":[{"questId":"q_bias","xp":40,"coins":10,"completedAt":"2026-10-27"},{"questId":"q_reflect","xp":40,"coins":10,"completedAt":"2026-10-28"}],"firstActions":{"trade":"2026-10-27T15:00:00Z","note":"2026-10-27T15:10:00Z"},"dailyStats":{"2026-10-27":{"xpGained":55},"2026-10-28":{"xpGained":40}},"achievements":{"firstTrade":true}}' >/dev/null
imp "$B" 20000000-0000-4000-8000-0000001ad00b '{"level":2,"xp":10,"coins":50,"history":[{"questId":"q_bias","xp":40,"coins":10,"completedAt":"2026-10-27"},{"questId":"q_reflect","xp":30,"coins":10,"completedAt":"2026-10-28"},{"questId":"q_walk","xp":10,"coins":5,"completedAt":"2026-10-29"}],"firstActions":{"trade":"2026-10-28T10:00:00Z"}}' >/dev/null
q "INSERT INTO public.journal_notes (user_id, id, data, client_updated_at) VALUES ('$U', 'n1', '{\"id\":\"n1\",\"createdAt\":\"2026-10-27T12:00:00Z\"}', now());" >/dev/null

# the preview: proven events once across devices, the conflict, a candidate per device, the Journal evidence — and the
# database's own computation equal to the tool's
out=$(tool reconcile "$U")
echo "$out" | grep -q "quest:2026-10-27:q_bias" && echo "$out" | grep -q "amount_mismatch" && echo "$out" | grep -q "NEVER summed" \
  && echo "$out" | grep -q "Journal evidence (records per day, not a proof of any reward): 2026-10-27:1" && echo "$out" | grep -q "Preview only" \
  && echo "$out" | grep -q "The database computed the SAME result" && [ "$(q "SELECT count(*) FROM public.game_reconciliations")" = 0 ] \
  && ok "T4: the preview shows proven events, conflicts, per-device candidates and Journal evidence; the database agrees; nothing stored" || bad "T4: $out"

# the trusted boundary: a result the database did not compute is never saved — and the refusal is logged
forge() { q "SET ROLE game_migration_admin; SELECT public.game_mig_save_reconciliation('$U', $1, 'mallory') ->> 'refused';"; }
r1=$(forge "jsonb_set(public.game_mig_reconcile('$U'), '{events}', public.game_mig_reconcile('$U') -> 'events' || '[{\"key\":\"quest:2026-10-30:q_forged\",\"kind\":\"quest\",\"day\":\"2026-10-30\",\"xp\":40,\"coins\":10,\"sources\":[\"$A\"]}]'::jsonb)")
r2=$(forge "jsonb_set(public.game_mig_reconcile('$U'), '{proposed,confirmedXp}', to_jsonb((public.game_mig_reconcile('$U') -> 'proposed' ->> 'confirmedXp')::int + 500))")
r3=$(forge "jsonb_set(public.game_mig_reconcile('$U'), '{events,0,coins}', '15'::jsonb)")
r4=$(forge "public.game_mig_reconcile('$U') - 'conflicts'")
logged=$(q "SELECT count(*) FROM public.game_migration_audit WHERE user_id = '$U' AND action = 'reconciliation_refused' AND actor = 'mallory'")
[ "$r1$r2$r3$r4" = "game_mig_result_differsgame_mig_result_differsgame_mig_result_differsgame_mig_result_differs" ] && [ "$logged" = 4 ] \
  && [ "$(q "SELECT count(*) FROM public.game_reconciliations")" = 0 ] \
  && ok "T5a: a forged event, +500 confirmed XP, a raised amount, a dropped conflict → each refused, each in the decision log, nothing saved" \
  || bad "T5a: $r1 / $r2 / $r3 / $r4 / logged=$logged"
out=$(tool reconcile "$U" --save --actor owner --confirm "$U")
REC=$(q "SELECT id FROM public.game_reconciliations WHERE user_id = '$U' AND status = 'draft'")
stored=$(q "SELECT (result = public.game_mig_reconcile('$U') AND result_md5 = md5(result::text))::text FROM public.game_reconciliations WHERE id = ${REC:-0}")
[ -n "$REC" ] && [ "$stored" = true ] && [ "$(q "SELECT count(*) FROM public.game_legacy_reviews WHERE user_id = '$U' AND status = 'pending_review'")" = 2 ] \
  && ok "T5: the draft saved (the database's own result and its md5); two remainders wait for review" || bad "T5: $out / stored=$stored"

# the window: extended only later, with a reason; the activation waits for it to close
out=$(tool window "$U" --until 2020-01-01T00:00:00Z --actor owner --reason "earlier" --confirm "$U")
echo "$out" | grep -q game_mig_window_not_later && ok "T6a: a window is never shortened" || bad "T6a: $out"
until=$(q "SELECT to_char((public.game_mig_window_closes_at('$U') + interval '2 days') AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"')")
out=$(tool window "$U" --until "$until" --actor owner --reason "the user is travelling" --confirm "$U")
ext=$(q "SELECT count(*) FROM public.game_migration_audit WHERE user_id = '$U' AND action = 'window_extended' AND details ->> 'reason' = 'the user is travelling'")
[ "$ext" = 1 ] && ok "T6b: the window extended by hand by 2 days, with its reason in the decision log" || bad "T6b: $out / $ext"
out=$(tool activate "$U" "$REC" --actor owner --confirm "$U")
echo "$out" | grep -q game_mig_window_open && [ "$(q "SELECT state FROM public.game_accounts WHERE user_id = '$U'")" = migration_pending ] \
  && ok "T6c: activation refused while the window is open; still pending" || bad "T6c: $out"
close_window "$U"
# a device after the window closed: kept apart (late), the reconciliation unchanged
late=$(imp 10000000-0000-4000-8000-0000001ad00c 20000000-0000-4000-8000-0000001ad00c '{"level":9,"xp":0,"coins":999}')
[ "$late" = late ] && [ "$(q "SELECT (result = public.game_mig_reconcile('$U'))::text FROM public.game_reconciliations WHERE id = $REC")" = true ] \
  && ok "T6d: a snapshot after the window closed is kept as late, outside the reconciliation (nothing deleted, nothing added)" || bad "T6d: $late"

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

# the stored result edited at rest (only the database owner could): the activation computes again and refuses
c0=$(q "SELECT result -> 'events' -> 0 ->> 'coins' FROM public.game_reconciliations WHERE id = $REC")
q "SET ROLE game_economy_owner; UPDATE public.game_reconciliations SET result = jsonb_set(result, '{events,0,coins}', to_jsonb($c0 + 10)) WHERE id = $REC;" >/dev/null
out=$(tool activate "$U" "$REC" --actor owner --confirm "$U")
echo "$out" | grep -q game_mig_result_changed && [ "$(q "SELECT state FROM public.game_accounts WHERE user_id = '$U'")" = migration_pending ] \
  && [ "$(q "SELECT count(*) FROM public.game_ledger WHERE user_id = '$U'")" = 0 ] \
  && [ "$(q "SELECT count(*) FROM public.game_migration_audit WHERE user_id = '$U' AND action = 'activation_refused'")" = 1 ] \
  && ok "T9a: a saved result edited afterwards → the activation refuses, logs it, credits nothing" || bad "T9a: $out"
# put the saved row back as it was (the test only): the activation then finds it equal to its own computation
q "SET ROLE game_economy_owner; UPDATE public.game_reconciliations SET result = jsonb_set(result, '{events,0,coins}', to_jsonb($c0)) WHERE id = $REC;" >/dev/null

out=$(tool activate "$U" "$REC" --actor owner --confirm "$U")
st=$(q "SELECT state FROM public.game_accounts WHERE user_id = '$U'")
prof=$(q "SELECT xp_total || '/' || coins || '/' || level FROM public.game_profile WHERE user_id = '$U'")
legacy=$(q "SELECT count(*) FROM public.game_ledger WHERE user_id = '$U' AND idempotency_key LIKE 'legacy:%'")
# proven: q_bias 40/10, q_reflect 30/10 (smaller), q_walk 10/5, first:trade 20/20, first:note 10/5 = 110 XP / 50 Coins; + 15/12
[ "$st" = cloud_active ] && [ "$prof" = "125/62/2" ] && [ "$legacy" = 1 ] && echo "$out" | grep -q "achievements stay on the devices" \
  && ok "T9: activated: 110 XP / 50 Coins proven + 15 / 12 accepted = 125 / 62, level 2; achievements not yet transferred (Q4.6)" || bad "T9: $out / $st / $prof / $legacy"
out=$(tool show "$U")
echo "$out" | grep -q "activated" && echo "$out" | grep -q "legacy_decided" && echo "$out" | grep -q "transition" && echo "$out" | grep -q "reconciliation_refused" \
  && ok "T10: the decision log shows every step with its author, the refusals included" || bad "T10: $out"
out=$(tool activate "$U" "$REC" --actor owner --confirm "$U")
[ "$(q "SELECT count(*) FROM public.game_ledger WHERE user_id = '$U'")" = 6 ] && echo "$out" | grep -q '"replay": *true\|"replay":true' \
  && ok "T11: a second activation is a replay; the ledger unchanged (6 rows)" || bad "T11: $out"

# accounts without snapshots: never a transfer with an empty reconciliation; a new account only on its own path
N1=00000000-0000-0000-0000-0000001ad0a1
N2=00000000-0000-0000-0000-0000001ad0a2
q "INSERT INTO auth.users (id, email) VALUES ('$N1', 'new1@example.com'), ('$N2', 'new2@example.com');" >/dev/null
tool open "$N1" --actor owner --reason "new account" --confirm "$N1" >/dev/null
tool open "$N2" --actor owner --reason "journal only" --confirm "$N2" >/dev/null
e1=$(q "SET ROLE game_migration_admin; SELECT public.game_mig_save_reconciliation('$N1', public.game_mig_reconcile('$N1'), 'owner');" 2>&1)
out=$(tool activate-new "$N1" --actor owner --reason "signed up during the window, never played" --confirm "$N1")
echo "$e1" | grep -q game_mig_no_snapshots && echo "$out" | grep -q game_mig_window_open \
  && ok "T12a: an empty reconciliation is refused; a new account waits for its window too" || bad "T12a: $e1 / $out"
close_window "$N1"; close_window "$N2"
q "INSERT INTO public.journal_notes (user_id, id, data, client_updated_at) VALUES ('$N2', 'n1', '{\"id\":\"n1\",\"createdAt\":\"2026-11-01T12:00:00Z\"}', now());" >/dev/null
out2=$(tool activate-new "$N2" --actor owner --reason "no snapshot came" --confirm "$N2")
out=$(tool activate-new "$N1" --actor owner --reason "signed up during the window, never played" --confirm "$N1")
direct=$(q "SELECT public.game_economy_transition('$N2', 'migration_pending', 'cloud_active');" 2>&1)
echo "$out2" | grep -q game_mig_has_history && [ "$(q "SELECT state FROM public.game_accounts WHERE user_id = '$N2'")" = migration_pending ] \
  && [ "$(q "SELECT state FROM public.game_accounts WHERE user_id = '$N1'")" = cloud_active ] \
  && [ "$(q "SELECT count(*) FROM public.game_migration_audit WHERE user_id = '$N1' AND action = 'activated_new_account'")" = 1 ] \
  && echo "$direct" | grep -q game_mig_activation_required \
  && ok "T12: a new account (no snapshot, no history) activated on its own path; a Journal history without a snapshot keeps waiting; no direct activation" \
  || bad "T12: $out2 / $out / $direct"

psql -X -q -d postgres -c "DROP DATABASE IF EXISTS $DB" >/dev/null

# the two implementations side by side on a fresh database (fixtures, the owner's cases, generated saves)
psql -X -q -d postgres -c "CREATE DATABASE $DB" >/dev/null && psql -X -q -v ON_ERROR_STOP=1 -d "$DB" -f supabase/tests/stub/supabase_stub.sql >/dev/null
for f in 0001_init 0002_profile_defaults 0003_nickname_cooldown 0004_journal_sync 0014_game_economy 0015_game_days 0016_game_day_api 0018_game_economy_sessions 0019_game_migration_import; do
  psql -X -q -v ON_ERROR_STOP=1 -d "$DB" -f "supabase/migrations/$f.sql" >/dev/null || { echo "FAIL migration $f"; exit 2; }
done
node --no-warnings scripts/test-reconcile-twins.mjs || FAILED=1
psql -X -q -d postgres -c "DROP DATABASE IF EXISTS $DB" >/dev/null
[ "$FAILED" = 0 ] && echo "ALL MIGRATION TOOL TESTS PASSED" || echo "SOME MIGRATION TOOL TESTS FAILED"
exit "$FAILED"
