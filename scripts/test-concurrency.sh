#!/usr/bin/env bash
# AYRA Trading — concurrency tests of the server economy (migration 0014) on a REAL PostgreSQL (CI service container).
# PGlite has one connection; here many sessions run at the same moment. Never point this at Supabase or production:
# it refuses to run unless PGHOST is localhost/127.0.0.1 and it creates its own throw-away database.
#   PGHOST=localhost PGUSER=postgres PGPASSWORD=postgres bash scripts/test-concurrency.sh
set -uo pipefail

case "${PGHOST:-}" in
  localhost|127.0.0.1) ;;
  *) echo "FAIL refusing to run: PGHOST must be localhost (got '${PGHOST:-}')"; exit 2 ;;
esac
export PGUSER="${PGUSER:-postgres}"
DB=ayra_concurrency_test
TMP="$(mktemp -d)"
FAILED=0
ok()  { echo "PASS $1"; }
bad() { echo "FAIL $1"; FAILED=1; }
q()   { psql -X -q -At -v ON_ERROR_STOP=1 -d "$DB" -c "$1"; }

psql -X -q -d postgres -c "DROP DATABASE IF EXISTS $DB" -c "CREATE DATABASE $DB" >/dev/null || { echo "FAIL cannot create the test database"; exit 2; }
psql -X -q -v ON_ERROR_STOP=1 -d "$DB" -f supabase/tests/stub/supabase_stub.sql >/dev/null || { echo "FAIL stub"; exit 2; }
for f in 0001_init 0002_profile_defaults 0003_nickname_cooldown 0004_journal_sync 0014_game_economy 0015_game_days; do
  psql -X -q -v ON_ERROR_STOP=1 -d "$DB" -f "supabase/migrations/$f.sql" >/dev/null 2>"$TMP/migr.err" || { echo "FAIL migration $f"; cat "$TMP/migr.err"; exit 2; }
done
ok "migrations 0001–0004 + 0014 + 0015 on PostgreSQL $(q 'SHOW server_version')"

# Users U1…U6, five notes and a day plan each; all activated, the flag on, missions switched on by the owner
u() { printf '00000000-0000-0000-0000-0000000c0c0%s' "$1"; }
SEED=""
for i in 1 2 3 4 5 6; do
  SEED+="INSERT INTO auth.users (id, email) VALUES ('$(u $i)', 'c$i@example.com');"
  for n in 1 2 3 4 5; do
    SEED+="INSERT INTO public.journal_notes (user_id, id, data) VALUES ('$(u $i)', 'n$n', '{\"id\":\"n$n\",\"templateKey\":\"lesson\",\"body\":\"Урок $n пользователя $i.\",\"createdAt\":\"2026-11-01T10:0$n:00Z\",\"updatedAt\":\"2026-11-01T10:0$n:00Z\"}');"
  done
  SEED+="INSERT INTO public.user_features (user_id, game_sync) VALUES ('$(u $i)', TRUE) ON CONFLICT (user_id) DO UPDATE SET game_sync = TRUE;"
done
q "$SEED" >/dev/null
q "GRANT SELECT ON public.journal_notes TO service_role;
   CREATE FUNCTION public.test_ev(p_user uuid, p_id text) RETURNS jsonb LANGUAGE sql STABLE AS \$\$
     SELECT jsonb_build_array(jsonb_build_object('table','journal_notes','id',id,'version',client_updated_at,'fp',md5(data::text)))
     FROM public.journal_notes WHERE user_id = p_user AND id = p_id \$\$;
   GRANT EXECUTE ON FUNCTION public.test_ev(uuid, text) TO service_role;
   SET ROLE game_economy_owner; UPDATE public.game_award_kinds SET enabled = TRUE WHERE kind = 'mission'; RESET ROLE;" >/dev/null
for i in 1 2 3 5 6; do q "SET ROLE service_role; SELECT public.game_begin_migration('$(u $i)'); SELECT public.game_activate_cloud('$(u $i)');" >/dev/null; done
# 0015: the server day is open (study: observation, backtest, lesson) and its missions accepted before any award
for i in 1 2 3 5 6; do
  q "SET ROLE service_role; SELECT public.game_day_open('$(u $i)', 'study', '{}');
     SELECT public.game_day_accept('$(u $i)', 'm_lesson'); SELECT public.game_day_accept('$(u $i)', 'm_observation');
     SELECT public.game_day_accept('$(u $i)', 'm_backtest');" >/dev/null || bad "day setup for user $i"
done
ok "seeded 6 users (5 activated, server day open with the study missions accepted, missions on, flag on)"

# Run each line of stdin as its own session, all released at the same moment by an advisory-lock barrier
parallel() {
  local i=0 holder
  rm -rf "$TMP/out" && mkdir -p "$TMP/out"
  psql -X -q -At -d "$DB" -c "SELECT pg_advisory_lock(424242); SELECT pg_sleep(1.5);" >/dev/null &
  holder=$!
  sleep 0.4
  while IFS= read -r sql; do
    ( psql -X -q -At -v ON_ERROR_STOP=1 -d "$DB" -c "SELECT pg_advisory_lock_shared(424242); SELECT pg_advisory_unlock_shared(424242);" \
        -c "SET ROLE service_role;" -c "$sql" >"$TMP/out/$i.out" 2>"$TMP/out/$i.err" ) &
    i=$((i + 1))
  done
  wait
  wait "$holder" 2>/dev/null || true
}
count_out() { grep -h -x -- "$1" "$TMP"/out/*.out 2>/dev/null | wc -l | tr -d ' '; }
count_err() { grep -l -- "$1" "$TMP"/out/*.err 2>/dev/null | wc -l | tr -d ' '; }
other_errors() { cat "$TMP"/out/*.err 2>/dev/null | grep -vE -- "$1" | grep -c "ERROR" || true; }

# A. The same idempotency key from 10 sessions: one award, nine replays of the same result
for k in $(seq 1 10); do echo "SELECT public.game_apply_reward('$(u 1)','mission','m_lesson', public.test_ev('$(u 1)','n1')) ->> 'replay';"; done | parallel
rows=$(q "SELECT count(*) FROM public.game_ledger WHERE user_id = '$(u 1)'")
prof=$(q "SELECT xp_total || '/' || coins || '/' || version FROM public.game_profile WHERE user_id = '$(u 1)'")
[ "$(count_out false)" = 1 ] && [ "$(count_out true)" = 9 ] && [ "$rows" = 1 ] && [ "$prof" = "40/10/1" ] \
  && ok "A: same key ×10 at once → 1 award + 9 replays, ledger 1 row, projection 40/10 updated once" \
  || bad "A: false=$(count_out false) true=$(count_out true) rows=$rows profile=$prof errs=$(cat "$TMP"/out/*.err)"

# B. One record for five different missions at once: it pays exactly one (missions not in the day are refused too)
for m in m_lesson m_observation m_mistake m_backtest q_reflect m_lesson m_observation m_backtest; do
  echo "SELECT public.game_apply_reward('$(u 2)','mission','$m', public.test_ev('$(u 2)','n1')) ->> 'xp';"
done | parallel
rows=$(q "SELECT count(*) FROM public.game_ledger WHERE user_id = '$(u 2)'")
claims=$(q "SELECT count(*) FROM public.game_source_claims WHERE user_id = '$(u 2)'")
[ "$rows" = 1 ] && [ "$claims" = 1 ] && [ "$(count_err game_mission_not_assigned)" = 2 ] && [ "$(other_errors 'game_source_used|game_mission_not_assigned')" = 0 ] \
  && ok "B: one record, 8 sessions with 5 missions → 1 award; the rest game_source_used, missions outside the day not_assigned" \
  || bad "B: rows=$rows claims=$claims errs=$(cat "$TMP"/out/*.err)"

# C. Five different missions with five different records at once: only the day's three can be paid, exactly once each
i=0; for m in m_lesson m_observation m_mistake m_backtest q_reflect; do i=$((i + 1))
  echo "SELECT public.game_apply_reward('$(u 3)','mission','$m', public.test_ev('$(u 3)','n$i')) ->> 'xp';"
done | parallel
rows=$(q "SELECT count(*) FROM public.game_ledger WHERE user_id = '$(u 3)'")
prof=$(q "SELECT xp_total || '/' || coins || '/' || level FROM public.game_profile WHERE user_id = '$(u 3)'")
[ "$rows" = 3 ] && [ "$prof" = "120/30/2" ] && [ "$(count_err game_mission_not_assigned)" = 2 ] && [ "$(other_errors game_mission_not_assigned)" = 0 ] \
  && ok "C: 5 missions at once → exactly the day's 3 (120 XP, 30 Coins, level 2), 2 × game_mission_not_assigned" \
  || bad "C: rows=$rows profile=$prof errs=$(cat "$TMP"/out/*.err)"
# a mode change after three payments offers no fourth mission
C_OUT=$(psql -X -q -At -d "$DB" -c "SET ROLE service_role;" -c "SELECT public.game_day_set_mode('$(u 3)', 'recovery') ->> 'core';" -c "SELECT public.game_day_accept('$(u 3)', 'm_mistake');" 2>&1)
echo "$C_OUT" | grep -q game_mission_not_assigned && [ "$(q "SELECT count(*) FROM public.game_ledger WHERE user_id = '$(u 3)'")" = 3 ] \
  && ok "C2: after three payments a mode change keeps the three; no fourth mission can be accepted" || bad "C2: $C_OUT"

# D. Account state at once: 10 activations of a pending account → one projection; rollbacks never pass
q "SET ROLE service_role; SELECT public.game_begin_migration('$(u 4)');" >/dev/null
for k in $(seq 1 10); do echo "SELECT public.game_activate_cloud('$(u 4)');"; done | parallel
prof=$(q "SELECT count(*) FROM public.game_profile WHERE user_id = '$(u 4)'")
state=$(q "SELECT state FROM public.game_accounts WHERE user_id = '$(u 4)'")
[ "$(count_out cloud_active)" = 10 ] && [ "$prof" = 1 ] && [ "$state" = cloud_active ] \
  && ok "D1: 10 activations at once → all cloud_active, one projection" \
  || bad "D1: outs=$(count_out cloud_active) profiles=$prof state=$state errs=$(cat "$TMP"/out/*.err)"
# owner-level rollback attempts at once (an admin script racing): all refused, state stays
rm -rf "$TMP/out" && mkdir -p "$TMP/out"
for k in 1 2 3 4 5; do
  ( psql -X -q -At -d "$DB" -c "SET ROLE game_economy_owner; UPDATE public.game_accounts SET state = 'local' WHERE user_id = '$(u 4)';" >"$TMP/out/$k.out" 2>"$TMP/out/$k.err" ) &
done
wait
[ "$(count_err game_state_one_way)" = 5 ] && [ "$(q "SELECT state FROM public.game_accounts WHERE user_id = '$(u 4)'")" = cloud_active ] \
  && ok "D2: 5 concurrent rollbacks of cloud_active → all refused (game_state_one_way)" \
  || bad "D2: refused=$(count_err game_state_one_way) errs=$(cat "$TMP"/out/*.err)"

# E1. The award holds the evidence lock: a Journal edit started meanwhile waits until the award is committed
OLDFP=$(q "SELECT md5(data::text) FROM public.journal_notes WHERE user_id = '$(u 5)' AND id = 'n1'")
( psql -X -q -At -d "$DB" -c "BEGIN; SET LOCAL ROLE service_role; SELECT public.game_apply_reward('$(u 5)','mission','m_lesson', public.test_ev('$(u 5)','n1')) ->> 'xp'; SELECT pg_sleep(2); COMMIT;" >"$TMP/e1.out" 2>"$TMP/e1.err" ) &
award=$!
sleep 0.7
t0=$(date +%s%N)
q "UPDATE public.journal_notes SET data = data || '{\"updatedAt\":\"2026-11-01T13:00:00Z\"}' WHERE user_id = '$(u 5)' AND id = 'n1'" >/dev/null
t1=$(date +%s%N)
wait "$award"
waited=$(( (t1 - t0) / 1000000 ))
evfp=$(q "SELECT evidence -> 0 ->> 'fp' FROM public.game_ledger WHERE user_id = '$(u 5)'")
[ "$waited" -ge 900 ] && grep -qx 40 "$TMP/e1.out" && [ "$evfp" = "$OLDFP" ] \
  && ok "E1: Journal edit waited ${waited} ms for the award; the award paid exactly the checked version" \
  || bad "E1: waited=${waited}ms out=$(cat "$TMP/e1.out") err=$(cat "$TMP/e1.err") evfp=$evfp old=$OLDFP"

# E2. A Journal edit holds the row: the award (with the evidence read before the edit) waits, then refuses
EV=$(q "SELECT public.test_ev('$(u 6)','n1')")
( psql -X -q -At -d "$DB" -c "BEGIN; UPDATE public.journal_notes SET data = jsonb_set(data, '{body}', '\"cut\"') WHERE user_id = '$(u 6)' AND id = 'n1'; SELECT pg_sleep(2); COMMIT;" >/dev/null 2>&1 ) &
edit=$!
sleep 0.7
t0=$(date +%s%N)
psql -X -q -At -d "$DB" -c "SET ROLE service_role; SELECT public.game_apply_reward('$(u 6)','mission','m_lesson', '$EV'::jsonb);" >"$TMP/e2.out" 2>"$TMP/e2.err"
t1=$(date +%s%N)
wait "$edit"
waited=$(( (t1 - t0) / 1000000 ))
rows=$(q "SELECT count(*) FROM public.game_ledger WHERE user_id = '$(u 6)'")
[ "$waited" -ge 900 ] && grep -q game_evidence_changed "$TMP/e2.err" && [ "$rows" = 0 ] \
  && ok "E2: award waited ${waited} ms for the Journal edit, then refused (game_evidence_changed), nothing written" \
  || bad "E2: waited=${waited}ms out=$(cat "$TMP/e2.out") err=$(cat "$TMP/e2.err") rows=$rows"

# H. The server day (0015) under concurrency — account U4 (activated in D1)
# H1. Two devices (10 sessions) open the day at once, with different modes and extras: one day, one answer
for k in $(seq 1 10); do
  if [ $((k % 2)) = 0 ]; then echo "SELECT (public.game_day_open('$(u 4)', 'study', '{q_read_pages,q_walk}') - 'opened') ->> 'core';"
  else echo "SELECT (public.game_day_open('$(u 4)', 'trading', '{q_meditate,q_stretching}') - 'opened') ->> 'core';"; fi
done | parallel
days=$(q "SELECT count(*) FROM public.game_days WHERE user_id = '$(u 4)'")
answers=$(cat "$TMP"/out/*.out | sort -u | wc -l | tr -d ' ')
[ "$days" = 1 ] && [ "$answers" = 1 ] && [ "$(other_errors '^$')" = 0 ] \
  && ok "H1: 10 devices open the day at once → one day row, every device gets the same set" \
  || bad "H1: days=$days answers=$answers outs=$(cat "$TMP"/out/*.out | sort -u) errs=$(cat "$TMP"/out/*.err)"
CORE=$(q "SELECT array_to_string(core, ' ') FROM public.game_days WHERE user_id = '$(u 4)'")
M1=$(echo "$CORE" | cut -d' ' -f1); M2=$(echo "$CORE" | cut -d' ' -f2); M3=$(echo "$CORE" | cut -d' ' -f3)
BONUS=$(q "SELECT array_to_string(bonus, ' ') FROM public.game_days WHERE user_id = '$(u 4)'")
B1=$(echo "$BONUS" | cut -d' ' -f1); B2=$(echo "$BONUS" | cut -d' ' -f2)

# H2. One mission accepted on two devices at once: one acceptance time, the rest are repeats
for k in $(seq 1 10); do echo "SELECT public.game_day_accept('$(u 4)', '$M1') ->> 'repeat';"; done | parallel
times=$(q "SELECT count(*) FROM jsonb_object_keys((SELECT accepted FROM public.game_days WHERE user_id = '$(u 4)'))")
[ "$(count_out false)" = 1 ] && [ "$(count_out true)" = 9 ] && [ "$times" = 1 ] \
  && ok "H2: the same mission accepted by 10 sessions at once → one acceptance, 9 repeats keep its time" \
  || bad "H2: false=$(count_out false) true=$(count_out true) keys=$times errs=$(cat "$TMP"/out/*.err)"

# H3. Six replacements of the two extras at once: never more than the limit (2), never a replaced extra twice
for k in 1 2 3; do
  echo "SELECT jsonb_array_length(public.game_day_replace('$(u 4)', '$B1', 'q_alt_a$k') -> 'replacements');"
  echo "SELECT jsonb_array_length(public.game_day_replace('$(u 4)', '$B2', 'q_alt_b$k') -> 'replacements');"
done | parallel
reps=$(q "SELECT jsonb_array_length(replacements) FROM public.game_days WHERE user_id = '$(u 4)'")
okn=$(cat "$TMP"/out/*.out | grep -c . || true)
[ "$reps" -le 2 ] && [ "$okn" = "$reps" ] && [ "$(other_errors 'game_replacement_limit|game_not_offered|game_not_replaceable')" = 0 ] \
  && ok "H3: 6 replacements at once → $reps applied (limit 2), the rest refused" \
  || bad "H3: reps=$reps ok=$okn errs=$(cat "$TMP"/out/*.err)"

# H4. Mode changes racing awards: whatever wins, every paid mission keeps a slot, nothing above three, nothing unaccepted
for k in 2 3; do q "SET ROLE service_role; SELECT public.game_day_accept('$(u 4)', '$(eval echo \$M$k)');" >/dev/null 2>&1 || true; done
q "INSERT INTO public.user_features (user_id, game_sync) VALUES ('$(u 4)', TRUE) ON CONFLICT (user_id) DO UPDATE SET game_sync = TRUE;" >/dev/null
for n in 1 2 3 4 5; do
  q "INSERT INTO public.journal_notes (user_id, id, data) VALUES ('$(u 4)', 'h$n', '{\"id\":\"h$n\",\"templateKey\":\"lesson\",\"body\":\"H $n.\",\"createdAt\":\"2026-11-01T10:00:00Z\",\"updatedAt\":\"2026-11-01T10:00:00Z\"}');" >/dev/null
done
q "INSERT INTO public.journal_day_plans (user_id, id, data) SELECT '$(u 4)', d::text, jsonb_build_object('date', d::text, 'createdAt', '2026-11-01T07:00:00Z', 'updatedAt', '2026-11-01T07:00:00Z')
   FROM (SELECT current_day AS d FROM public.game_accounts WHERE user_id = '$(u 4)') x;" >/dev/null
q "CREATE FUNCTION public.test_ev_any(p_user uuid, p_mission text, p_note text) RETURNS jsonb LANGUAGE sql STABLE AS \$\$
     SELECT CASE WHEN p_mission IN ('q_bias','q_riskcheck','m_day_state','m_plan_tomorrow') THEN
       (SELECT jsonb_build_array(jsonb_build_object('table','journal_day_plans','id',id,'version',client_updated_at,'fp',md5(data::text))) FROM public.journal_day_plans WHERE user_id = p_user ORDER BY id DESC LIMIT 1)
     ELSE public.test_ev(p_user, p_note) END \$\$;
   GRANT EXECUTE ON FUNCTION public.test_ev_any(uuid, text, text) TO service_role;" >/dev/null
{
  i=0; for m in $M1 $M2 $M3 q_bias q_riskcheck; do i=$((i + 1)); echo "SELECT public.game_apply_reward('$(u 4)', 'mission', '$m', public.test_ev_any('$(u 4)', '$m', 'h$i')) ->> 'xp';"; done
  echo "SELECT public.game_day_set_mode('$(u 4)', 'trading') ->> 'mode';"
  echo "SELECT public.game_day_set_mode('$(u 4)', 'recovery') ->> 'mode';"
  echo "SELECT public.game_day_set_mode('$(u 4)', 'rest') ->> 'mode';"
  echo "SELECT public.game_day_set_mode('$(u 4)', 'study') ->> 'mode';"
} | parallel
paid=$(q "SELECT count(*) FROM public.game_ledger WHERE user_id = '$(u 4)'")
lost=$(q "SELECT count(*) FROM public.game_ledger l JOIN public.game_days d ON d.user_id = l.user_id AND d.game_day = l.game_day
          WHERE l.user_id = '$(u 4)' AND NOT ((l.result ->> 'item') = ANY(d.core) AND d.accepted ? (l.result ->> 'item'))")
[ "$paid" -le 3 ] && [ "$lost" = 0 ] && [ "$(other_errors 'game_mission_not_assigned|game_mission_not_accepted|game_source_used')" = 0 ] \
  && ok "H4: 5 awards racing 4 mode changes → $paid paid, every one accepted and still in the day's slots" \
  || bad "H4: paid=$paid lost=$lost errs=$(cat "$TMP"/out/*.err)"

# H5. One lock per account: a day change waits while an award of the same account is in progress (two devices)
q "SET ROLE service_role; SELECT public.game_day_set_mode('$(u 4)', 'study');" >/dev/null 2>&1 || true
( psql -X -q -At -d "$DB" -c "BEGIN; SET LOCAL ROLE service_role; SELECT public.game_day_set_mode('$(u 4)', 'rest'); SELECT pg_sleep(2); COMMIT;" >/dev/null 2>"$TMP/h5a.err" ) &
holder=$!
sleep 0.7
t0=$(date +%s%N)
H5_OUT=$(psql -X -q -At -d "$DB" -c "SET ROLE service_role;" -c "SELECT public.game_day_set_mode('$(u 4)', 'study') ->> 'mode';" 2>&1)
t1=$(date +%s%N)
wait "$holder"
waited=$(( (t1 - t0) / 1000000 ))
[ "$waited" -ge 900 ] && [ "$H5_OUT" = study ] && [ ! -s "$TMP/h5a.err" ] \
  && ok "H5: the second device waited ${waited} ms for the first, then applied its change on the fresh day" \
  || bad "H5: waited=${waited}ms out=$H5_OUT err=$(cat "$TMP/h5a.err")"

# F. The login role of the API (like Supabase's authenticator) cannot become the owner or write
export PGPASSWORD_SAVED="${PGPASSWORD:-}"
F_OUT=$(PGPASSWORD=authenticator-test-only psql -X -q -At -h "$PGHOST" -U authenticator -d "$DB" -c "SET ROLE service_role;" -c "SET ROLE game_economy_owner;" 2>&1)
echo "$F_OUT" | grep -q "permission denied to set role" && ok "F1: authenticator → service_role cannot SET ROLE game_economy_owner" || bad "F1: $F_OUT"
F_OUT=$(PGPASSWORD=authenticator-test-only psql -X -q -At -h "$PGHOST" -U authenticator -d "$DB" -c "SET ROLE service_role;" \
  -c "SET ayra.game_writer = 'on'; INSERT INTO public.game_ledger (user_id, idempotency_key, kind, rule_code, game_day, xp, coins, rules_version, result) VALUES ('$(u 1)', 'mission:2099-01-01:forged', 'mission', 'mission', current_date, 40, 10, 'q4.1', '{}');" 2>&1)
echo "$F_OUT" | grep -q "permission denied for table game_ledger" && ok "F2: service_role with a hand-set writer mark cannot insert into the ledger" || bad "F2: $F_OUT"

# G. Deletion: an unrelated nested trigger cannot erase history; deleting the account removes it (cascade as the owner)
G_OUT=$(psql -X -q -At -d "$DB" -c "CREATE TABLE public.purge_probe (id int);
  CREATE FUNCTION public.purge_probe_fn() RETURNS trigger LANGUAGE plpgsql AS \$\$ BEGIN DELETE FROM public.game_ledger WHERE user_id = '$(u 3)'; RETURN NEW; END \$\$;
  CREATE TRIGGER purge_probe_tr AFTER INSERT ON public.purge_probe FOR EACH ROW EXECUTE FUNCTION public.purge_probe_fn();" -c "INSERT INTO public.purge_probe VALUES (1);" 2>&1)
rows=$(q "SELECT count(*) FROM public.game_ledger WHERE user_id = '$(u 3)'")
echo "$G_OUT" | grep -q game_write_only_through_functions && [ "$rows" = 3 ]   && ok "G1: a nested trigger of another table cannot delete ledger rows (history intact: $rows rows)" || bad "G1: rows=$rows $G_OUT"
q "DELETE FROM auth.users WHERE id = '$(u 3)'" >/dev/null 2>"$TMP/g2.err"
left=$(q "SELECT (SELECT count(*) FROM public.game_ledger WHERE user_id = '$(u 3)') + (SELECT count(*) FROM public.game_profile WHERE user_id = '$(u 3)')
  + (SELECT count(*) FROM public.game_source_claims WHERE user_id = '$(u 3)') + (SELECT count(*) FROM public.game_accounts WHERE user_id = '$(u 3)')
  + (SELECT count(*) FROM public.game_days WHERE user_id = '$(u 3)')")
others=$(q "SELECT count(*) FROM public.game_ledger WHERE user_id = '$(u 1)'")
[ "$left" = 0 ] && [ "$others" = 1 ] && [ ! -s "$TMP/g2.err" ]   && ok "G2: deleting the account removes its ledger, projection, claims and state; other accounts keep theirs"   || bad "G2: left=$left others=$others err=$(cat "$TMP/g2.err")"

psql -X -q -d postgres -c "DROP DATABASE IF EXISTS $DB" >/dev/null
rm -rf "$TMP"
[ "$FAILED" = 0 ] && echo "ALL CONCURRENCY TESTS PASSED" || echo "SOME CONCURRENCY TESTS FAILED"
exit "$FAILED"
