#!/usr/bin/env bash
# AYRA Trading — concurrency tests of the server economy (migrations 0014–0016, 0018, 0019, 0020) on a REAL PostgreSQL (CI service container).
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
for f in 0001_init 0002_profile_defaults 0003_nickname_cooldown 0004_journal_sync 0014_game_economy 0015_game_days 0016_game_day_api; do
  psql -X -q -v ON_ERROR_STOP=1 -d "$DB" -f "supabase/migrations/$f.sql" >/dev/null 2>"$TMP/migr.err" || { echo "FAIL migration $f"; cat "$TMP/migr.err"; exit 2; }
done
ok "migrations 0001–0004 + 0014 + 0015 + 0016 on PostgreSQL $(q 'SHOW server_version')"

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
q "GRANT SELECT ON public.journal_notes, public.journal_day_plans TO service_role;
   CREATE FUNCTION public.test_ev(p_user uuid, p_id text) RETURNS jsonb LANGUAGE sql STABLE AS \$\$
     SELECT jsonb_build_array(jsonb_build_object('table','journal_notes','id',id,'version',client_updated_at,'fp',md5(data::text)))
     FROM public.journal_notes WHERE user_id = p_user AND id = p_id \$\$;
   GRANT EXECUTE ON FUNCTION public.test_ev(uuid, text) TO service_role;
   SET ROLE game_economy_owner; UPDATE public.game_award_kinds SET enabled = TRUE WHERE kind = 'mission'; RESET ROLE;" >/dev/null
for i in 1 2 3 5 6; do q "SET ROLE service_role; SELECT public.game_begin_migration('$(u $i)'); SELECT public.game_activate_cloud('$(u $i)');" >/dev/null; done
# 0015: the server day is open (study: observation, backtest, lesson) and its missions accepted before any award
for i in 1 2 3 5 6; do
  # 0016: the day opens in the mode of the saved trading days (none saved: trading); the study set is taken by a change
  q "SET ROLE service_role; SELECT public.game_day_open('$(u $i)', '{}'); SELECT public.game_day_set_mode('$(u $i)', 'study');
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
  if [ $((k % 2)) = 0 ]; then echo "SELECT (public.game_day_open('$(u 4)', '{q_read_pages,q_walk}') - 'opened') ->> 'core';"
  else echo "SELECT (public.game_day_open('$(u 4)', '{q_meditate,q_stretching}') - 'opened') ->> 'core';"; fi
done | parallel
days=$(q "SELECT count(*) FROM public.game_days WHERE user_id = '$(u 4)'")
# only the result lines (the barrier prints an empty line and "t")
answers=$(cat "$TMP"/out/*.out | grep '^\[' | sort -u | wc -l | tr -d ' ')
opened=$(cat "$TMP"/out/*.out | grep -c '^\[' || true)
[ "$days" = 1 ] && [ "$answers" = 1 ] && [ "$opened" = 10 ] && [ "$(other_errors '^$')" = 0 ] \
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

# H3. Six replacements of the two extras at once, all with quests the catalog allows (0016: the trading pool, no more
# XP): exactly the limit (2) is applied whatever the order, the rest refused; a replaced or shown quest never twice
FREE=""
for c in q_walk q_meditate q_sleep_prep q_stretching q_read_pages q_lang_10m; do
  [ "$c" = "$B1" ] || [ "$c" = "$B2" ] || FREE="$FREE $c"
done
set -- $FREE
T1=$1; T2=$2; T3=$3; T4=$4
{
  echo "SELECT jsonb_array_length(public.game_day_replace('$(u 4)', '$B1', '$T1') -> 'replacements');"
  echo "SELECT jsonb_array_length(public.game_day_replace('$(u 4)', '$B1', '$T2') -> 'replacements');"
  echo "SELECT jsonb_array_length(public.game_day_replace('$(u 4)', '$B1', '$T3') -> 'replacements');"
  echo "SELECT jsonb_array_length(public.game_day_replace('$(u 4)', '$B2', '$T4') -> 'replacements');"
  echo "SELECT jsonb_array_length(public.game_day_replace('$(u 4)', '$B2', '$T2') -> 'replacements');"
  echo "SELECT jsonb_array_length(public.game_day_replace('$(u 4)', '$B2', '$T1') -> 'replacements');"
} | parallel
reps=$(q "SELECT jsonb_array_length(replacements) FROM public.game_days WHERE user_id = '$(u 4)'")
okn=$(cat "$TMP"/out/*.out | grep -cE '^[0-9]+$' || true)
[ -n "$T4" ] && [ "$reps" = 2 ] && [ "$okn" = 2 ] && [ "$(other_errors 'game_replacement_limit|game_not_offered|game_not_replaceable')" = 0 ] \
  && ok "H3: 6 allowed replacements at once → exactly 2 applied (the limit), the rest refused" \
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
# one mission is paid before the race (the setup is checked): whatever the mode changes do, it must keep its slot
PRE=$(psql -X -q -At -d "$DB" -c "SET ROLE service_role;" -c "SELECT public.game_apply_reward('$(u 4)', 'mission', '$M1', public.test_ev_any('$(u 4)', '$M1', 'h1')) ->> 'xp';" 2>&1)
[ "$PRE" = 40 ] || bad "H4 setup: the first award must pay 40, got: $PRE"
{
  i=1; for m in $M2 $M3 q_bias q_riskcheck m_day_state; do i=$((i + 1)); echo "SELECT public.game_apply_reward('$(u 4)', 'mission', '$m', public.test_ev_any('$(u 4)', '$m', 'h$i')) ->> 'xp';"; done
  echo "SELECT public.game_day_set_mode('$(u 4)', 'trading') ->> 'mode';"
  echo "SELECT public.game_day_set_mode('$(u 4)', 'recovery') ->> 'mode';"
  echo "SELECT public.game_day_set_mode('$(u 4)', 'rest') ->> 'mode';"
  echo "SELECT public.game_day_set_mode('$(u 4)', 'study') ->> 'mode';"
} | parallel
paid=$(q "SELECT count(*) FROM public.game_ledger WHERE user_id = '$(u 4)'")
lost=$(q "SELECT count(*) FROM public.game_ledger l JOIN public.game_days d ON d.user_id = l.user_id AND d.game_day = l.game_day
          WHERE l.user_id = '$(u 4)' AND NOT ((l.result ->> 'item') = ANY(d.core) AND d.accepted ? (l.result ->> 'item'))")
[ "$paid" -ge 1 ] && [ "$paid" -le 3 ] && [ "$lost" = 0 ] && [ "$(other_errors 'game_mission_not_assigned|game_mission_not_accepted|game_source_used|game_day_rest')" = 0 ] \
  && ok "H4: 1 paid + 5 awards racing 4 mode changes → $paid paid in total, every one accepted and still in the day's slots" \
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

# J. 0016: the first server trace of a Journal row under concurrency, and the evidence chain of the mission check
# J1. Two devices send a NEW note at once (10 upserts with different versions): one row, one first trace, never moved
rm -rf "$TMP/out" && mkdir -p "$TMP/out"
for k in $(seq 1 10); do
  ( psql -X -q -At -d "$DB" -c "INSERT INTO public.journal_notes (user_id, id, data) VALUES ('$(u 5)', 'j_race',
      '{\"id\":\"j_race\",\"templateKey\":\"lesson\",\"body\":\"race $k\",\"createdAt\":\"2026-11-01T10:00:00Z\",\"updatedAt\":\"2026-11-01T10:00:$(printf %02d $k)Z\"}')
      ON CONFLICT (user_id, id) DO UPDATE SET data = EXCLUDED.data;" >"$TMP/out/$k.out" 2>"$TMP/out/$k.err" ) &
done
wait
first=$(q "SELECT first_seen_at FROM public.journal_notes WHERE user_id = '$(u 5)' AND id = 'j_race'")
rows=$(q "SELECT count(*) FROM public.journal_notes WHERE user_id = '$(u 5)' AND id = 'j_race'")
rm -rf "$TMP/out" && mkdir -p "$TMP/out"
for k in $(seq 11 15); do
  ( psql -X -q -At -d "$DB" -c "UPDATE public.journal_notes SET data = data || '{\"updatedAt\":\"2026-11-02T10:00:$k\"}', first_seen_at = now() + interval '1 day'
      WHERE user_id = '$(u 5)' AND id = 'j_race';" >"$TMP/out/$k.out" 2>"$TMP/out/$k.err" ) &
done
wait
after=$(q "SELECT first_seen_at FROM public.journal_notes WHERE user_id = '$(u 5)' AND id = 'j_race'")
[ "$rows" = 1 ] && [ -n "$first" ] && [ "$first" = "$after" ] && [ "$(other_errors '^$')" = 0 ] \
  && ok "J1: 10 devices create one note at once → one row, one first trace; 5 concurrent updates (even naming it) never move it" \
  || bad "J1: rows=$rows first=$first after=$after errs=$(cat "$TMP"/out/*.err)"

# J2. The award accepts exactly the version and fingerprint the mission check reads (game_journal_for_check → game_apply_reward)
q "INSERT INTO public.journal_notes (user_id, id, data) VALUES ('$(u 5)', 'j_obs',
   '{\"id\":\"j_obs\",\"templateKey\":\"idea\",\"body\":\"Наблюдение J.\",\"createdAt\":\"2026-11-01T10:00:00Z\",\"updatedAt\":\"2026-11-01T10:00:00Z\"}');" >/dev/null
J2_OUT=$(psql -X -q -At -d "$DB" -c "SET ROLE service_role;" -c "SELECT public.game_apply_reward('$(u 5)', 'mission', 'm_observation',
  (SELECT jsonb_build_array(jsonb_build_object('table', 'journal_notes', 'id', n ->> 'id', 'version', n ->> 'client_updated_at', 'fp', n ->> 'fp'))
     FROM jsonb_array_elements(public.game_journal_for_check('$(u 5)', public.game_day_today('$(u 5)')) -> 'notes') n WHERE n ->> 'id' = 'j_obs')) ->> 'xp';" 2>&1)
J2_STALE=$(psql -X -q -At -d "$DB" -c "SET ROLE service_role;" -c "SELECT public.game_apply_reward('$(u 5)', 'mission', 'm_backtest',
  (SELECT jsonb_build_array(jsonb_build_object('table', 'journal_notes', 'id', n ->> 'id', 'version', n ->> 'client_updated_at', 'fp', 'not-the-postgres-md5'))
     FROM jsonb_array_elements(public.game_journal_for_check('$(u 5)', public.game_day_today('$(u 5)')) -> 'notes') n WHERE n ->> 'id' = 'j_race'));" 2>&1)
[ "$J2_OUT" = 40 ] && echo "$J2_STALE" | grep -q game_evidence_changed \
  && ok "J2: the check's Postgres version + md5 fingerprint are accepted by the award; any other fingerprint is refused" \
  || bad "J2: out=$J2_OUT stale=$J2_STALE"

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

# K. 0018 (Q4.5-2): the account state, the Custom Access Token Hook and the session check under concurrency
psql -X -q -v ON_ERROR_STOP=1 -d "$DB" -f supabase/migrations/0018_game_economy_sessions.sql >/dev/null 2>"$TMP/m18.err" \
  && ok "K0: migration 0018 on PostgreSQL $(q 'SHOW server_version')" || bad "K0: migration 0018: $(cat "$TMP/m18.err")"
s() { printf '00000000-0000-0000-0000-0000005e5e0%s' "$1"; }
hook() { printf "SELECT public.game_access_token_hook(jsonb_build_object('user_id', '%s', 'claims', jsonb_build_object('sub', '%s', 'role', 'authenticated', 'aud', 'authenticated'))) -> 'claims' ->> 'ayra_economy';
" "$1" "$1"; }
q "INSERT INTO auth.users (id, email) VALUES ('$(u 7)', 'c7@example.com'), ('$(u 8)', 'c8@example.com'), ('$(u 9)', 'c9@example.com');
   INSERT INTO auth.sessions (id, user_id) VALUES ('$(s 7)', '$(u 7)'), ('$(s 8)', '$(u 8)'), ('$(s 9)', '$(u 9)');
   INSERT INTO public.journal_notes (user_id, id, data) VALUES ('$(u 7)', 'n1', '{\"id\":\"n1\",\"templateKey\":\"lesson\",\"body\":\"Урок пользователя 7.\",\"createdAt\":\"2026-11-01T10:01:00Z\",\"updatedAt\":\"2026-11-01T10:01:00Z\"}');
   INSERT INTO public.user_features (user_id, game_sync) VALUES ('$(u 7)', TRUE) ON CONFLICT (user_id) DO UPDATE SET game_sync = TRUE;" >/dev/null

# K1. Ten sessions ask local → migration_scheduled at once: one change, nine replays; nothing written to the auth schema
for k in $(seq 1 10); do echo "SELECT public.game_economy_transition('$(u 7)', 'local', 'migration_scheduled') ->> 'changed';"; done | parallel
marks=$(q "SELECT count(*) FROM auth.users WHERE raw_app_meta_data ? 'ayra_economy'")
[ "$(count_out true)" = 1 ] && [ "$(count_out false)" = 9 ] && [ "$marks" = 0 ] && [ "$(other_errors no_error_is_expected)" = 0 ] \
  && ok "K1: local → scheduled ×10 at once → 1 change + 9 replays; no write to auth.users" \
  || bad "K1: true=$(count_out true) false=$(count_out false) marks=$marks errs=$(cat "$TMP"/out/*.err)"

# K2. Four callers who saw «scheduled» and four who still think «local», all asking for pending at once
for k in 1 2 3 4; do
  echo "SELECT public.game_economy_transition('$(u 7)', 'migration_scheduled', 'migration_pending') ->> 'changed';"
  echo "SELECT public.game_economy_transition('$(u 7)', 'local', 'migration_pending') ->> 'changed';"
done | parallel
st=$(q "SELECT state FROM public.game_accounts WHERE user_id = '$(u 7)'")
[ "$(count_out true)" = 1 ] && [ "$st" = migration_pending ] && [ "$(other_errors game_state_conflict)" = 0 ] \
  && ok "K2: 8 callers at once → exactly 1 change to pending; the rest replays or game_state_conflict" \
  || bad "K2: true=$(count_out true) state=$st errs=$(cat "$TMP"/out/*.err)"

# K8. Tokens issued while the activation commits: each carries pending or cloud_active (never anything lower), and every
#     token issued after the commit carries cloud_active
{ echo "SELECT public.game_economy_transition('$(u 7)', 'migration_pending', 'cloud_active') ->> 'changed';"
  for k in $(seq 1 10); do printf "RESET ROLE; SET ROLE supabase_auth_admin; "; hook "$(u 7)"; done; } | parallel
lower=$(grep -hvxE "t|true|migration_pending|cloud_active" "$TMP"/out/*.out 2>/dev/null | grep -c . || true)
issued=$(($(count_out migration_pending) + $(count_out cloud_active)))
after=$(psql -X -q -At -d "$DB" -c "SET ROLE supabase_auth_admin;" -c "$(hook "$(u 7)")" 2>&1)
[ "$(count_out true)" = 1 ] && [ "$issued" = 10 ] && [ "$lower" = 0 ] && [ "$after" = cloud_active ] && [ "$(other_errors no_error_is_expected)" = 0 ] \
  && ok "K8: 10 tokens issued during the activation → each pending or cloud_active; after the commit the auth server's role gets cloud_active" \
  || bad "K8: true=$(count_out true) lower=$lower after=$after out=$(cat "$TMP"/out/*.out | tr '\n' ' ') errs=$(cat "$TMP"/out/*.err)"

# K4. After the activation: the old token (mark «pending») is refused; a fresh one ×10 at once pays exactly once
q "SET ROLE service_role; SELECT public.game_day_open('$(u 7)', '{}'); SELECT public.game_day_set_mode('$(u 7)', 'study'); SELECT public.game_day_accept('$(u 7)', 'm_lesson');" >/dev/null || bad "K4: day setup"
OLD=$(psql -X -q -At -d "$DB" -c "SET ROLE service_role;" -c "SELECT public.game_apply_reward_for_session('$(u 7)', '$(s 7)', floor(extract(epoch FROM now()))::bigint, 'migration_pending', 'mission', 'm_lesson', public.test_ev('$(u 7)', 'n1'));" 2>&1)
NOMARK=$(psql -X -q -At -d "$DB" -c "SET ROLE service_role;" -c "SELECT public.game_apply_reward_for_session('$(u 7)', '$(s 7)', floor(extract(epoch FROM now()))::bigint, NULL, 'mission', 'm_lesson', public.test_ev('$(u 7)', 'n1'));" 2>&1)
for k in $(seq 1 10); do
  echo "SELECT public.game_apply_reward_for_session('$(u 7)', '$(s 7)', floor(extract(epoch FROM now()))::bigint, 'cloud_active', 'mission', 'm_lesson', public.test_ev('$(u 7)', 'n1')) ->> 'replay';"
done | parallel
rows=$(q "SELECT count(*) FROM public.game_ledger WHERE user_id = '$(u 7)'")
prof=$(q "SELECT xp_total || '/' || coins FROM public.game_profile WHERE user_id = '$(u 7)'")
echo "$OLD" | grep -q game_session_stale && echo "$NOMARK" | grep -q game_session_stale && [ "$(count_out false)" = 1 ] && [ "$(count_out true)" = 9 ] && [ "$rows" = 1 ] && [ "$prof" = "40/10" ] \
  && ok "K4: the old token and a token without a mark (hook off or failed) → game_session_stale; a fresh one ×10 at once → 1 award + 9 replays (40/10)" \
  || bad "K4: old=$OLD nomark=$NOMARK false=$(count_out false) true=$(count_out true) rows=$rows profile=$prof errs=$(cat "$TMP"/out/*.err)"

# K3. A second activation-like race: an account in pending, ten awards with its pending token while it is activated — 0 paid
q "SELECT public.game_economy_transition('$(u 9)', 'local', 'migration_pending');" >/dev/null
{ echo "SELECT public.game_economy_transition('$(u 9)', 'migration_pending', 'cloud_active') ->> 'changed';"
  for k in $(seq 1 10); do
    echo "SELECT public.game_apply_reward_for_session('$(u 9)', '$(s 9)', floor(extract(epoch FROM now()))::bigint, 'migration_pending', 'mission', 'm_lesson', '[]') ->> 'xp';"
  done; } | parallel
rows=$(q "SELECT count(*) FROM public.game_ledger WHERE user_id = '$(u 9)'")
st=$(q "SELECT state FROM public.game_accounts WHERE user_id = '$(u 9)'")
[ "$rows" = 0 ] && [ "$st" = cloud_active ] && [ "$(count_out true)" = 1 ] && [ "$(other_errors 'game_session_stale|game_account_not_active|game_day_not_open|game_profile_missing|game_evidence_required')" = 0 ] \
  && ok "K3: activation racing 10 awards with the pre-activation token → activated once, 0 paid" \
  || bad "K3: rows=$rows state=$st true=$(count_out true) errs=$(cat "$TMP"/out/*.err)"

# (K5 of an earlier draft — a sign-out racing the database's session checks — is gone with the checks: the database reads
#  no auth table; the auth server refuses an ended session's token itself, checked on the official local stack)

# K6. The API login (like Supabase's authenticator) and the auth server's role: only their own doors
K_OUT=$(PGPASSWORD=authenticator-test-only psql -X -q -At -h "$PGHOST" -U authenticator -d "$DB" -c "SET ROLE service_role;" -c "$(hook "$(u 7)")" 2>&1)
echo "$K_OUT" | grep -q "permission denied for function game_access_token_hook" && ok "K6a: service_role cannot run the hook (cannot mint a mark)" || bad "K6a: $K_OUT"
K_OUT=$(PGPASSWORD=authenticator-test-only psql -X -q -At -h "$PGHOST" -U authenticator -d "$DB" -c "SET ROLE service_role;" -c "SET ROLE supabase_auth_admin;" 2>&1)
echo "$K_OUT" | grep -q "permission denied to set role" && ok "K6b: authenticator → service_role cannot become the auth server's role" || bad "K6b: $K_OUT"
K_OUT=$(PGPASSWORD=authenticator-test-only psql -X -q -At -h "$PGHOST" -U authenticator -d "$DB" -c "SET ROLE service_role;" \
  -c "SELECT public.game_apply_reward('$(u 7)', 'mission', 'm_observation', '[]');" 2>&1)
echo "$K_OUT" | grep -q "permission denied for function game_apply_reward" && ok "K6c: service_role cannot award without the session check" || bad "K6c: $K_OUT"
K_OUT=$(psql -X -q -At -d "$DB" -c "SET ROLE supabase_auth_admin;" -c "SELECT public.game_economy_transition('$(u 9)', 'cloud_active', 'cloud_active');" 2>&1)
K_OUT2=$(psql -X -q -At -d "$DB" -c "SET ROLE supabase_auth_admin;" -c "SELECT count(*) FROM public.game_accounts;" 2>&1)
echo "$K_OUT" | grep -q "permission denied" && echo "$K_OUT2" | grep -q "permission denied" \
  && ok "K6d: the auth server's role cannot move an account or read the game tables (only the hook)" || bad "K6d: $K_OUT / $K_OUT2"

# K7. Five owner sessions try to move the activated account back at once: all refused, state unchanged
rm -rf "$TMP/out" && mkdir -p "$TMP/out"
for k in 1 2 3 4 5; do
  ( psql -X -q -At -d "$DB" -c "SET ROLE game_economy_owner; UPDATE public.game_accounts SET state = 'migration_scheduled' WHERE user_id = '$(u 7)';" >"$TMP/out/$k.out" 2>"$TMP/out/$k.err" ) &
done
wait
st=$(q "SELECT state FROM public.game_accounts WHERE user_id = '$(u 7)'")
[ "$(count_err game_state_one_way)" = 5 ] && [ "$st" = cloud_active ] \
  && ok "K7: 5 owner sessions moving cloud_active back at once → all game_state_one_way; state unchanged" \
  || bad "K7: one_way=$(count_err game_state_one_way) state=$st"

# L. 0019 (Q4.5-4): device snapshots, legacy reviews and the owner's activation under concurrency
psql -X -q -v ON_ERROR_STOP=1 -d "$DB" -f supabase/migrations/0019_game_migration_import.sql >/dev/null 2>"$TMP/m19.err" \
  && ok "L0: migration 0019 on PostgreSQL $(q 'SHOW server_version')" || bad "L0: migration 0019: $(cat "$TMP/m19.err")"
m() { printf '00000000-0000-0000-0000-00000019c0%02d' "$1"; }
snap() { printf '10000000-0000-0000-0000-00000019d0%02d' "$1"; }
inst() { printf '20000000-0000-0000-0000-00000019e0%02d' "$1"; }
# the route's call with a fresh token of the state the device saw (the database checks it against the state now)
imp() { printf "SELECT public.game_import_snapshot('%s', '%s', floor(extract(epoch FROM now()))::bigint, 'migration_pending', '%s', '%s', 1, '%s'::jsonb) ->> '%s';\n" "$1" "$(s 7)" "$2" "$3" "$4" "${5:-status}"; }
q "INSERT INTO auth.users (id, email) VALUES ('$(m 1)', 'l1@example.com'), ('$(m 2)', 'l2@example.com'), ('$(m 3)', 'l3@example.com');
   SELECT public.game_economy_transition('$(m 1)', 'local', 'migration_pending');
   SELECT public.game_economy_transition('$(m 2)', 'local', 'migration_pending');
   SELECT public.game_economy_transition('$(m 3)', 'local', 'migration_pending');" >/dev/null

# L1. One device retries its upload ×10 at once: one row, one first answer, nine replays
for k in $(seq 1 10); do imp "$(m 1)" "$(snap 1)" "$(inst 1)" '{"level":3,"xp":50,"coins":120}' replay; done | parallel
rows=$(q "SELECT count(*) FROM public.game_imports WHERE user_id = '$(m 1)'")
[ "$rows" = 1 ] && [ "$(count_out false)" = 1 ] && [ "$(count_out true)" = 9 ] && [ "$(other_errors no_error_is_expected)" = 0 ] \
  && ok "L1: the same snapshot ×10 at once → 1 row, 1 first answer + 9 replays" \
  || bad "L1: rows=$rows false=$(count_out false) true=$(count_out true) errs=$(cat "$TMP"/out/*.err)"

# L2. The same snapshot id with five different contents at once: exactly one stored, four refused
for k in 1 2 3 4 5; do imp "$(m 1)" "$(snap 2)" "$(inst 2)" "{\"level\":$k}"; done | parallel
rows=$(q "SELECT count(*) FROM public.game_imports WHERE user_id = '$(m 1)' AND snapshot_id = '$(snap 2)'")
[ "$rows" = 1 ] && [ "$(count_out accepted)" = 1 ] && [ "$(count_err game_import_conflict)" = 4 ] && [ "$(other_errors game_import_conflict)" = 0 ] \
  && ok "L2: one id, five contents at once → 1 stored + 4 game_import_conflict" \
  || bad "L2: rows=$rows accepted=$(count_out accepted) conflicts=$(count_err game_import_conflict) errs=$(cat "$TMP"/out/*.err)"

# L3. One install sends ten different snapshots at once: exactly one enters the reconciliation, nine are kept as duplicates
for k in $(seq 10 19); do imp "$(m 1)" "$(snap $k)" "$(inst 3)" "{\"level\":1,\"n\":$k}"; done | parallel
acc=$(q "SELECT count(*) FROM public.game_imports WHERE user_id = '$(m 1)' AND install_id = '$(inst 3)' AND status = 'accepted'")
dup=$(q "SELECT count(*) FROM public.game_imports WHERE user_id = '$(m 1)' AND install_id = '$(inst 3)' AND status = 'duplicate_install'")
[ "$acc" = 1 ] && [ "$dup" = 9 ] && [ "$(other_errors no_error_is_expected)" = 0 ] \
  && ok "L3: one install, 10 snapshots at once → 1 accepted + 9 duplicate_install (all kept)" \
  || bad "L3: accepted=$acc duplicates=$dup errs=$(cat "$TMP"/out/*.err)"

# the owner's preparation: the 7 days passed (the test clock: the database owner sets the window's end to now), the
# DATABASE's reconciliation saved, every remainder decided (the first accepted at its candidate, the rest rejected)
close_window() {
  q "SET ROLE game_economy_owner; INSERT INTO public.game_migration_windows (user_id, closes_at, changed_by, reason)
     VALUES ('$1', now(), 'test clock', 'simulated: 7 days passed') ON CONFLICT (user_id) DO UPDATE SET closes_at = now();" >/dev/null
}
save_rec() { q "SET ROLE game_migration_admin; SELECT public.game_mig_save_reconciliation('$1', public.game_mig_reconcile('$1'), 'ci') ->> 'saved';"; }
admin_prep() {
  close_window "$1"
  [ "$(save_rec "$1")" = true ] || return 1
  q "SET ROLE game_migration_admin;
     SELECT public.game_mig_decide_legacy('$1', snapshot_id, CASE WHEN n = 1 THEN 'accepted' ELSE 'rejected' END,
       CASE WHEN n = 1 THEN candidate_xp END, CASE WHEN n = 1 THEN candidate_coins END, 'ci', 'test decision')
     FROM (SELECT snapshot_id, candidate_xp, candidate_coins, row_number() OVER (ORDER BY snapshot_id) AS n
           FROM public.game_legacy_reviews WHERE user_id = '$1') r;" >/dev/null
}

# L4. Two reviewers accept two different remainders of one account at once: one wins, never two
for k in 20 21; do q "$(imp "$(m 2)" "$(snap $k)" "$(inst $k)" "{\"level\":2,\"coins\":10,\"n\":$k}")" >/dev/null; done
[ "$(save_rec "$(m 2)")" = true ] || bad "L4: draft"
for k in 20 21; do
  echo "RESET ROLE; SET ROLE game_migration_admin; SELECT public.game_mig_decide_legacy('$(m 2)', '$(snap $k)', 'accepted', 100, 10, 'reviewer $k', 'parallel test') ->> 'status';"
done | parallel
acc=$(q "SELECT count(*) FROM public.game_legacy_reviews WHERE user_id = '$(m 2)' AND status = 'accepted'")
[ "$acc" = 1 ] && [ "$(count_out accepted)" = 1 ] && [ "$(count_err 'duplicate key')" = 1 ] \
  && ok "L4: two reviewers accept two remainders of one account at once → exactly one accepted" \
  || bad "L4: accepted=$acc out=$(count_out accepted) errs=$(cat "$TMP"/out/*.err)"

# L5. The activation racing five new devices' uploads after the window closed: the uploads are kept apart (late, or
#     stale once the account is active) — never accepted, never left out of what was activated
admin_prep "$(m 1)" || bad "L5: owner's preparation"
rec=$(q "SELECT id FROM public.game_reconciliations WHERE user_id = '$(m 1)' AND status = 'draft'")
{ echo "RESET ROLE; SET ROLE game_migration_admin; SELECT public.game_mig_activate('$(m 1)', $rec, 'ci', 'test') ->> 'state';"
  for k in $(seq 30 34); do imp "$(m 1)" "$(snap $k)" "$(inst $k)" "{\"level\":1,\"n\":$k}"; done; } | parallel
st=$(q "SELECT state FROM public.game_accounts WHERE user_id = '$(m 1)'")
left_out=$(q "SELECT count(*) FROM public.game_imports i WHERE i.user_id = '$(m 1)' AND i.status = 'accepted' AND NOT EXISTS (SELECT 1 FROM public.game_reconciliations r
  WHERE r.user_id = i.user_id AND r.status = 'activated' AND (i.snapshot_id::text || ':' || i.content_md5) = ANY (r.inputs))")
late=$(q "SELECT count(*) FROM public.game_imports WHERE user_id = '$(m 1)' AND snapshot_id IN ('$(snap 30)', '$(snap 31)', '$(snap 32)', '$(snap 33)', '$(snap 34)') AND status = 'late'")
[ "$st" = cloud_active ] && [ "$left_out" = 0 ] && [ "$(count_out cloud_active)" = 1 ] && [ $((late + $(count_err game_session_stale))) = 5 ] \
  && [ "$(other_errors game_session_stale)" = 0 ] \
  && ok "L5: activation racing 5 uploads after the window → activated once; uploads late ($late) or stale ($(count_err game_session_stale)); nothing accepted left out" \
  || bad "L5: state=$st left_out=$left_out late=$late out=$(cat "$TMP"/out/*.out | tr '\n' ' ') errs=$(cat "$TMP"/out/*.err)"

# L6. Five activations of one account at once (double clicks, two owner windows): one activation, the ledger written once
q "$(imp "$(m 3)" "$(snap 40)" "$(inst 40)" '{"level":2,"xp":0,"coins":10,"history":[{"questId":"q_bias","xp":40,"coins":10,"completedAt":"2026-11-01"}]}')" >/dev/null
admin_prep "$(m 3)" || bad "L6: owner's preparation"
rec=$(q "SELECT id FROM public.game_reconciliations WHERE user_id = '$(m 3)' AND status = 'draft'")
for k in 1 2 3 4 5; do echo "RESET ROLE; SET ROLE game_migration_admin; SELECT public.game_mig_activate('$(m 3)', $rec, 'ci $k', NULL) ->> 'replay';"; done | parallel
ledger=$(q "SELECT count(*) || '/' || sum(xp) || '/' || sum(coins) FROM public.game_ledger WHERE user_id = '$(m 3)'")
prof=$(q "SELECT xp_total || '/' || coins FROM public.game_profile WHERE user_id = '$(m 3)'")
acts=$(q "SELECT count(*) FROM public.game_migration_audit WHERE user_id = '$(m 3)' AND action = 'activated'")
# the proven quest 40/10 + the accepted remainder 80/0 (level 2 = 120 XP in all)
[ "$(count_out false)" = 1 ] && [ "$(count_out true)" = 4 ] && [ "$ledger" = "2/120/10" ] && [ "$prof" = "120/10" ] && [ "$acts" = 1 ] \
  && ok "L6: 5 activations at once → 1 activation + 4 replays; ledger once (40 proven + 80 accepted XP), one audit entry" \
  || bad "L6: false=$(count_out false) true=$(count_out true) ledger=$ledger profile=$prof audit=$acts errs=$(cat "$TMP"/out/*.err)"

# L8. A save racing a new upload in the window: whatever wins, the saved result is the database's computation of the
#     snapshots it covered — and the activation computes it again (never activated on a stale result)
q "INSERT INTO auth.users (id, email) VALUES ('$(m 4)', 'l4@example.com'); SELECT public.game_economy_transition('$(m 4)', 'local', 'migration_pending');" >/dev/null
q "$(imp "$(m 4)" "$(snap 50)" "$(inst 50)" '{"level":1,"xp":40,"coins":10,"history":[{"questId":"q_a","xp":40,"coins":10,"completedAt":"2026-11-01"}]}')" >/dev/null
{ echo "RESET ROLE; SET ROLE game_migration_admin; SELECT public.game_mig_save_reconciliation('$(m 4)', public.game_mig_reconcile('$(m 4)'), 'ci') ->> 'saved';"
  imp "$(m 4)" "$(snap 51)" "$(inst 51)" '{"level":1,"xp":40,"coins":10,"history":[{"questId":"q_b","xp":40,"coins":10,"completedAt":"2026-11-01"}]}'; } | parallel
saved_ok=$(q "SELECT count(*) FROM public.game_reconciliations WHERE user_id = '$(m 4)' AND result = public.game_mig_reconcile('$(m 4)')")
saved_all=$(q "SELECT count(*) FROM public.game_reconciliations WHERE user_id = '$(m 4)'")
refused=$(q "SELECT count(*) FROM public.game_migration_audit WHERE user_id = '$(m 4)' AND action = 'reconciliation_refused'")
if [ "$saved_all" = 0 ]; then
  # the upload landed between the computation and the save: the save refused (the results differ) and logged it
  [ "$refused" = 1 ] && [ "$(count_out false)" = 1 ] && [ "$(q "SELECT state FROM public.game_accounts WHERE user_id = '$(m 4)'")" = migration_pending ] \
    && ok "L8: an upload between the computation and the save → the save refused (logged), nothing saved, still pending" \
    || bad "L8(c): refused=$refused out=$(cat "$TMP"/out/*.out | tr '\n' ' ') errs=$(cat "$TMP"/out/*.err)"
else
  close_window "$(m 4)"
  q "SET ROLE game_migration_admin; SELECT public.game_mig_decide_legacy('$(m 4)', snapshot_id, 'rejected', NULL, NULL, 'ci', 'test') FROM public.game_legacy_reviews WHERE user_id = '$(m 4)';" >/dev/null
  rec=$(q "SELECT id FROM public.game_reconciliations WHERE user_id = '$(m 4)' AND status = 'draft'")
  res=$(q "SET ROLE game_migration_admin; SELECT COALESCE(public.game_mig_activate('$(m 4)', $rec, 'ci', 'test') ->> 'refused', 'activated');" 2>&1)
  if [ "$saved_ok" = 1 ]; then
    # the save saw both snapshots: the activation goes through on exactly them
    [ "$res" = activated ] && [ "$(q "SELECT count(*) FROM public.game_ledger WHERE user_id = '$(m 4)'")" = 2 ] \
      && ok "L8: the save covered both snapshots → activated on exactly them (2 proven quests)" || bad "L8(a): $res"
  else
    # the upload came after the save: the activation computes again and refuses — nothing credited, still pending
    [ "$res" = game_mig_result_changed ] && [ "$(q "SELECT count(*) FROM public.game_ledger WHERE user_id = '$(m 4)'")" = 0 ] \
      && ok "L8: an upload after the save → the activation refuses (result changed), nothing credited" || bad "L8(b): $res"
  fi
fi

# L7. The API login cannot reach the owner's tool; the owner's role cannot log in
K_OUT=$(PGPASSWORD=authenticator-test-only psql -X -q -At -h "$PGHOST" -U authenticator -d "$DB" -c "SET ROLE game_migration_admin;" 2>&1)
K_OUT2=$(PGPASSWORD=authenticator-test-only psql -X -q -At -h "$PGHOST" -U authenticator -d "$DB" -c "SET ROLE service_role;" -c "SELECT count(*) FROM public.game_imports;" 2>&1)
LOGIN=$(q "SELECT rolcanlogin FROM pg_roles WHERE rolname = 'game_migration_admin'")
echo "$K_OUT" | grep -q "permission denied to set role" && echo "$K_OUT2" | grep -q "permission denied" && [ "$LOGIN" = f ] \
  && ok "L7: the API login cannot become the owner's role nor read snapshots; the owner's role has no login" \
  || bad "L7: $K_OUT / $K_OUT2 / login=$LOGIN"

# M. 0020 (Q4.6): achievements recorded once whatever runs at the same time; a deletion racing an upload
psql -X -q -v ON_ERROR_STOP=1 -d "$DB" -f supabase/migrations/0020_game_achievements.sql >/dev/null 2>"$TMP/m20.err" \
  && ok "M0: migration 0020 on PostgreSQL $(q 'SHOW server_version')" || bad "M0: migration 0020: $(cat "$TMP/m20.err")"
q "INSERT INTO auth.users (id, email) VALUES ('$(m 5)', 'm5@example.com'), ('$(m 6)', 'm6@example.com'), ('$(m 7)', 'm7@example.com');
   SELECT public.game_economy_transition('$(m 5)', 'local', 'migration_pending');
   SELECT public.game_economy_transition('$(m 6)', 'local', 'migration_pending');
   SELECT public.game_economy_transition('$(m 7)', 'local', 'migration_pending');" >/dev/null
ach_save='{"level":1,"xp":40,"coins":10,"history":[{"questId":"q_bias","xp":40,"coins":10,"completedAt":"2026-11-01"}],"achievements":{"firstQuest":true,"stylist":true,"author":true}}'
for k in 60 61; do q "$(imp "$(m 5)" "$(snap $k)" "$(inst $k)" "$ach_save")" >/dev/null; done

# M1. Five activations at once of an account whose two devices share achievements: one activation, each id once
admin_prep "$(m 5)" || bad "M1: owner's preparation"
rec=$(q "SELECT id FROM public.game_reconciliations WHERE user_id = '$(m 5)' AND status = 'draft'")
for k in 1 2 3 4 5; do echo "RESET ROLE; SET ROLE game_migration_admin; SELECT public.game_mig_activate('$(m 5)', $rec, 'ci $k', NULL) ->> 'replay';"; done | parallel
ach=$(q "SELECT count(*) || '/' || count(DISTINCT achievement_id) FROM public.game_achievements WHERE user_id = '$(m 5)'")
ledger=$(q "SELECT count(*) || '/' || sum(xp) FROM public.game_ledger WHERE user_id = '$(m 5)'")
[ "$(count_out false)" = 1 ] && [ "$(count_out true)" = 4 ] && [ "$ach" = "3/3" ] && [ "$ledger" = "1/40" ] \
  && ok "M1: 5 activations at once → 1 activation + 4 replays; 3 achievements once each (two devices); the ledger only the proven quest" \
  || bad "M1: false=$(count_out false) true=$(count_out true) achievements=$ach ledger=$ledger errs=$(cat "$TMP"/out/*.err)"

# M2. An account activated before 0020 (simulated by the database owner): five transfers at once record its achievements once
q "$(imp "$(m 6)" "$(snap 62)" "$(inst 62)" "$ach_save")" >/dev/null
admin_prep "$(m 6)" || bad "M2: owner's preparation"
rec=$(q "SELECT id FROM public.game_reconciliations WHERE user_id = '$(m 6)' AND status = 'draft'")
q "SET ROLE game_migration_admin; SELECT public.game_mig_activate('$(m 6)', $rec, 'ci', NULL);" >/dev/null
q "SET ROLE game_economy_owner; DELETE FROM public.game_achievements WHERE user_id = '$(m 6)'; UPDATE public.game_reconciliations SET achievements_transferred_at = NULL WHERE id = $rec;" >/dev/null
for k in 1 2 3 4 5; do echo "RESET ROLE; SET ROLE game_migration_admin; SELECT public.game_mig_transfer_achievements('$(m 6)', 'ci $k') ->> 'replay';"; done | parallel
ach=$(q "SELECT count(*) FROM public.game_achievements WHERE user_id = '$(m 6)'")
logs=$(q "SELECT count(*) FROM public.game_migration_audit WHERE user_id = '$(m 6)' AND action = 'achievements_transferred'")
[ "$(count_out false)" = 1 ] && [ "$(count_out true)" = 4 ] && [ "$ach" = 3 ] && [ "$logs" = 1 ] \
  && ok "M2: 5 transfers at once → 1 transfer + 4 replays; 3 achievements; one audit entry" \
  || bad "M2: false=$(count_out false) true=$(count_out true) achievements=$ach audit=$logs errs=$(cat "$TMP"/out/*.err)"

# M3. The account is deleted while its devices upload: whatever wins, nothing of the account is left
{ echo "RESET ROLE; DELETE FROM auth.users WHERE id = '$(m 7)';"
  for k in $(seq 70 74); do imp "$(m 7)" "$(snap $k)" "$(inst $k)" '{"level":1}'; done; } | parallel
count_left() { q "SELECT (SELECT count(*) FROM public.game_imports WHERE user_id = '$(m 7)') + (SELECT count(*) FROM public.game_accounts WHERE user_id = '$(m 7)')
  + (SELECT count(*) FROM public.game_migration_audit WHERE user_id = '$(m 7)')"; }
left=$(count_left)
# with the 0019 lock order this deadlocked and Postgres aborted the DELETION (3 of 3 runs); 0020 takes the user row first
[ "$left" = 0 ] && ! grep -q "deadlock detected" "$TMP"/out/*.err && [ "$(other_errors 'violates foreign key constraint|game_import_not_open|game_session_stale')" = 0 ] \
  && ok "M3: deletion racing 5 uploads → the deletion goes through (no deadlock), no row of the account left; later uploads refused" \
  || bad "M3: left=$left errs=$(cat "$TMP"/out/*.err)"

# M4. Under 0020's lock order: the same snapshot ×10 at once is still one row, one first answer and nine replays
q "INSERT INTO auth.users (id, email) VALUES ('$(m 8)', 'm8@example.com'); SELECT public.game_economy_transition('$(m 8)', 'local', 'migration_pending');" >/dev/null
for k in $(seq 1 10); do imp "$(m 8)" "$(snap 80)" "$(inst 80)" '{"level":2,"xp":10}' replay; done | parallel
rows=$(q "SELECT count(*) FROM public.game_imports WHERE user_id = '$(m 8)'")
[ "$rows" = 1 ] && [ "$(count_out false)" = 1 ] && [ "$(count_out true)" = 9 ] && [ "$(other_errors no_error_is_expected)" = 0 ] \
  && ok "M4: 0020 intake: the same snapshot ×10 at once → 1 row, 1 first answer + 9 replays" \
  || bad "M4: rows=$rows false=$(count_out false) true=$(count_out true) errs=$(cat "$TMP"/out/*.err)"

# M5. Under 0020's lock order: the activation racing 5 uploads after the window — nothing accepted is left out
for k in 81 82; do q "$(imp "$(m 8)" "$(snap $k)" "$(inst $k)" '{"level":1}')" >/dev/null; done
admin_prep "$(m 8)" || bad "M5: owner's preparation"
rec=$(q "SELECT id FROM public.game_reconciliations WHERE user_id = '$(m 8)' AND status = 'draft'")
{ echo "RESET ROLE; SET ROLE game_migration_admin; SELECT public.game_mig_activate('$(m 8)', $rec, 'ci', 'test') ->> 'state';"
  for k in $(seq 83 87); do imp "$(m 8)" "$(snap $k)" "$(inst $k)" "{\"level\":1,\"n\":$k}"; done; } | parallel
st=$(q "SELECT state FROM public.game_accounts WHERE user_id = '$(m 8)'")
left_out=$(q "SELECT count(*) FROM public.game_imports i WHERE i.user_id = '$(m 8)' AND i.status = 'accepted' AND NOT EXISTS (SELECT 1 FROM public.game_reconciliations r
  WHERE r.user_id = i.user_id AND r.status = 'activated' AND (i.snapshot_id::text || ':' || i.content_md5) = ANY (r.inputs))")
late=$(q "SELECT count(*) FROM public.game_imports WHERE user_id = '$(m 8)' AND status = 'late'")
[ "$st" = cloud_active ] && [ "$left_out" = 0 ] && [ "$(count_out cloud_active)" = 1 ] && [ $((late + $(count_err game_session_stale))) = 5 ] \
  && [ "$(other_errors game_session_stale)" = 0 ] \
  && ok "M5: 0020 intake: activation racing 5 uploads → activated once; uploads late ($late) or stale ($(count_err game_session_stale)); nothing left out" \
  || bad "M5: state=$st left_out=$left_out late=$late out=$(cat "$TMP"/out/*.out | tr '\n' ' ') errs=$(cat "$TMP"/out/*.err)"

# N. 0021 (Q4.7-B2): what proves an achievement — on a real PostgreSQL, applied twice; five activations at once still record
# each id once, under the q4.7 rules: stylist proven by a worn item, firstTrade claimed with only the first-trade reward waits
psql -X -q -v ON_ERROR_STOP=1 -d "$DB" -f supabase/migrations/0021_game_achievement_proof.sql >/dev/null 2>"$TMP/m21.err" \
  && psql -X -q -v ON_ERROR_STOP=1 -d "$DB" -f supabase/migrations/0021_game_achievement_proof.sql >/dev/null 2>>"$TMP/m21.err" \
  && ok "N0: migration 0021 on PostgreSQL (applied twice)" || bad "N0: migration 0021: $(cat "$TMP/m21.err")"
q "INSERT INTO auth.users (id, email) VALUES ('$(m 9)', 'm9@example.com');
   SELECT public.game_economy_transition('$(m 9)', 'local', 'migration_pending');" >/dev/null
proof_save='{"level":1,"xp":40,"coins":10,"history":[{"questId":"q_bias","xp":40,"coins":10,"completedAt":"2026-11-01"}],"equipment":{"Верх":0},"firstActions":{"trade":"2026-11-01T09:00:00Z"},"achievements":{"firstQuest":true,"stylist":true,"firstTrade":true}}'
for k in 90 91; do q "$(imp "$(m 9)" "$(snap $k)" "$(inst $k)" "$proof_save")" >/dev/null; done
admin_prep "$(m 9)" || bad "N1: owner's preparation"
rec=$(q "SELECT id FROM public.game_reconciliations WHERE user_id = '$(m 9)' AND status = 'draft'")
for k in 1 2 3 4 5; do echo "RESET ROLE; SET ROLE game_migration_admin; SELECT public.game_mig_activate('$(m 9)', $rec, 'ci $k', NULL) ->> 'replay';"; done | parallel
ach=$(q "SELECT string_agg(achievement_id || '=' || status || '/' || source || '/' || rules_version, ',' ORDER BY achievement_id) FROM public.game_achievements WHERE user_id = '$(m 9)'")
[ "$(count_out false)" = 1 ] && [ "$(count_out true)" = 4 ] \
  && [ "$ach" = "firstQuest=verified/reconciled_event/q4.7,firstTrade=pending_review/device_flag/q4.7,stylist=verified/snapshot_record/q4.7" ] \
  && ok "N1: 5 activations at once → 1 + 4 replays; each id once under q4.7: stylist by a worn item, firstTrade (reward only) waits" \
  || bad "N1: false=$(count_out false) true=$(count_out true) achievements=$ach errs=$(cat "$TMP"/out/*.err)"

# O. 0022 (Q4.7-Б3): the bulk review of one account's unproven achievements under concurrency
psql -X -q -v ON_ERROR_STOP=1 -d "$DB" -f supabase/migrations/0022_game_achievement_bulk_review.sql >/dev/null 2>"$TMP/m22.err" \
  && ok "O0: migration 0022 on PostgreSQL" || bad "O0: migration 0022: $(cat "$TMP/m22.err")"
bulk_save='{"level":1,"xp":0,"coins":0,"achievements":{"author":true,"plans7":true,"firstPlan":true}}'
for n in 10 11 12 13 14 15; do
  q "INSERT INTO auth.users (id, email) VALUES ('$(m $n)', 'm$n@example.com');
     SELECT public.game_economy_transition('$(m $n)', 'local', 'migration_pending');" >/dev/null
  q "$(imp "$(m $n)" "$(snap $((n + 82)))" "$(inst $((n + 82)))" "$bulk_save")" >/dev/null  # snapshots 92–97 (10–19 belong to L3)
  admin_prep "$(m $n)" || bad "O: owner's preparation of m$n"
  q "SET ROLE game_migration_admin; SELECT public.game_mig_activate('$(m $n)', (SELECT id FROM public.game_reconciliations WHERE user_id = '$(m $n)' AND status = 'draft'), 'ci', 'test');" >/dev/null
done
# the reviewed versions of the listed achievements (what the owner's tool sends) and the activated reconciliation
items_for() { q "SET ROLE game_migration_admin; SELECT jsonb_agg(jsonb_build_object('id', i ->> 'id', 'version', i ->> 'version') ORDER BY i ->> 'id')
  FROM jsonb_array_elements(public.game_mig_achievement_review('$1') -> 'items') i WHERE i ->> 'id' = ANY (string_to_array('$2', ','))"; }
rec_of() { q "SELECT id FROM public.game_reconciliations WHERE user_id = '$1' AND status = 'activated'"; }
bulk() { echo "RESET ROLE; SET ROLE game_migration_admin; SELECT public.game_mig_bulk_accept_achievements('$1', $2, '$3'::jsonb, '$4', 'ci', 'the user showed them on a call') ->> 'replay';"; }
op() { printf '50000000-0000-0000-0000-00000022e0%02d' "$1"; }
statuses() { q "SELECT string_agg(achievement_id || '=' || status, ',' ORDER BY achievement_id) FROM public.game_achievements WHERE user_id = '$1'"; }
summaries() { q "SELECT count(*) FROM public.game_migration_audit WHERE user_id = '$1' AND action = 'achievements_bulk_accepted'"; }

# O1. Two (five) people accept the same achievements of one account at once, each with their own operation: exactly one
# operation wins, the others are refused (the preview they saw is stale); nothing is accepted twice
it=$(items_for "$(m 10)" "author,plans7"); rc=$(rec_of "$(m 10)")
for k in 1 2 3 4 5; do bulk "$(m 10)" "$rc" "$it" "$(op $k)"; done | parallel
st=$(statuses "$(m 10)")
[ "$(count_out false)" = 1 ] && [ "$(count_out true)" = 0 ] && [ $(( $(count_err game_mig_review_stale) + $(count_err game_mig_achievement_decided) )) = 4 ] \
  && [ "$(other_errors 'game_mig_review_stale|game_mig_achievement_decided')" = 0 ] && [ "$(summaries "$(m 10)")" = 1 ] \
  && [ "$st" = "author=legacy_accepted,firstPlan=pending_review,plans7=legacy_accepted" ] \
  && ok "O1: 5 operations on the same achievements at once → 1 accepted, 4 refused (stale); one operation in the log; firstPlan untouched" \
  || bad "O1: false=$(count_out false) true=$(count_out true) st=$st summaries=$(summaries "$(m 10)") errs=$(cat "$TMP"/out/*.err)"

# O2. The same operation five times at once (a retried command): one decision and four replays
it=$(items_for "$(m 11)" "author,firstPlan,plans7"); rc=$(rec_of "$(m 11)")
for k in 1 2 3 4 5; do bulk "$(m 11)" "$rc" "$it" "$(op 20)"; done | parallel
[ "$(count_out false)" = 1 ] && [ "$(count_out true)" = 4 ] && [ "$(other_errors '^$')" = 0 ] && [ "$(summaries "$(m 11)")" = 1 ] \
  && [ "$(q "SELECT count(*) FROM public.game_migration_audit WHERE user_id = '$(m 11)' AND action = 'achievement_decided'")" = 3 ] \
  && ok "O2: the same operation ×5 at once → 1 decision + 4 replays; one entry per achievement" \
  || bad "O2: false=$(count_out false) true=$(count_out true) summaries=$(summaries "$(m 11)") errs=$(cat "$TMP"/out/*.err)"

# O3. The account is deleted while people decide: the deletion is never aborted (no deadlock); nothing of it is left
it=$(items_for "$(m 12)" "author,plans7"); rc=$(rec_of "$(m 12)")
{ echo "RESET ROLE; DELETE FROM auth.users WHERE id = '$(m 12)';"
  for k in 31 32 33 34; do bulk "$(m 12)" "$rc" "$it" "$(op $k)"; done; } | parallel
left=$(q "SELECT (SELECT count(*) FROM public.game_achievements WHERE user_id = '$(m 12)') + (SELECT count(*) FROM public.game_migration_audit WHERE user_id = '$(m 12)')
  + (SELECT count(*) FROM auth.users WHERE id = '$(m 12)')")
[ "$left" = 0 ] && [ "$(count_err deadlock)" = 0 ] \
  && [ "$(other_errors 'game_mig_no_such_account|game_mig_not_active|game_mig_review_stale|game_mig_achievement_decided')" = 0 ] \
  && ok "O3: deletion racing 4 bulk decisions → deleted, no deadlock; refused ones: no account / stale; nothing left" \
  || bad "O3: left=$left out=$(cat "$TMP"/out/*.out | tr '\n' ' ') errs=$(cat "$TMP"/out/*.err)"

# O4. A bulk decision racing a single decision on one of its achievements (the same policy, the same account lock): exactly
# one of them decides author; the other is refused; never a part of the bulk list
it=$(items_for "$(m 13)" "author,firstPlan"); rc=$(rec_of "$(m 13)")
{ bulk "$(m 13)" "$rc" "$it" "$(op 40)"
  echo "RESET ROLE; SET ROLE game_migration_admin; SELECT public.game_mig_decide_achievement('$(m 13)', 'author', 'rejected', 'ci', 'no post was ever made') ->> 'status';"; } | parallel
st=$(statuses "$(m 13)")
{ [ "$st" = "author=rejected,firstPlan=pending_review,plans7=pending_review" ] && [ "$(count_out false)" = 0 ] && [ "$(count_out rejected)" = 1 ] \
    && [ "$(count_err game_mig_achievement_rejected)" = 1 ]; } \
  || { [ "$st" = "author=legacy_accepted,firstPlan=legacy_accepted,plans7=pending_review" ] && [ "$(count_out false)" = 1 ] && [ "$(count_out rejected)" = 0 ] \
    && [ "$(count_err game_mig_achievement_decided)" = 1 ]; } \
  && ok "O4: bulk racing a single decision on author → one decides it, the other is refused whole ($st)" \
  || bad "O4: st=$st out=$(cat "$TMP"/out/*.out | tr '\n' ' ') errs=$(cat "$TMP"/out/*.err)"

# O5. One operation id sent at once with two different requests (another reason): exactly one is done; the others are
# refused as another request, or replayed when they are the same request — never two decisions under one id
it=$(items_for "$(m 14)" "author,plans7"); rc=$(rec_of "$(m 14)")
{ for k in 1 2 3; do bulk "$(m 14)" "$rc" "$it" "$(op 50)"; done
  for k in 1 2; do echo "RESET ROLE; SET ROLE game_migration_admin; SELECT public.game_mig_bulk_accept_achievements('$(m 14)', $rc, '$it'::jsonb, '$(op 50)', 'ci', 'another reason for the same id') ->> 'replay';"; done; } | parallel
summ=$(summaries "$(m 14)"); dec=$(q "SELECT count(*) FROM public.game_migration_audit WHERE user_id = '$(m 14)' AND action = 'achievement_decided'")
[ "$summ" = 1 ] && [ "$dec" = 2 ] && [ "$(count_out false)" = 1 ] && [ $(( $(count_out true) + $(count_err game_mig_operation_mismatch) )) = 4 ] \
  && [ "$(other_errors game_mig_operation_mismatch)" = 0 ] \
  && ok "O5: one operation id, two different requests at once → one decision; the rest replays or refused as another request" \
  || bad "O5: summaries=$summ decided=$dec false=$(count_out false) true=$(count_out true) errs=$(cat "$TMP"/out/*.err)"

# O6. The account is deleted while single decisions run (they now take the user row first, like the bulk): no deadlock
{ echo "RESET ROLE; DELETE FROM auth.users WHERE id = '$(m 15)';"
  for id in author plans7 firstPlan; do echo "RESET ROLE; SET ROLE game_migration_admin; SELECT public.game_mig_decide_achievement('$(m 15)', '$id', 'legacy_accepted', 'ci', 'the user showed it on a call') ->> 'status';"; done; } | parallel
left=$(q "SELECT (SELECT count(*) FROM public.game_achievements WHERE user_id = '$(m 15)') + (SELECT count(*) FROM public.game_migration_audit WHERE user_id = '$(m 15)')")
[ "$left" = 0 ] && [ "$(count_err deadlock)" = 0 ] && [ "$(other_errors 'game_mig_no_such_account|game_mig_no_such_achievement|game_mig_review_stale')" = 0 ] \
  && ok "O6: deletion racing 3 single decisions → deleted, no deadlock; nothing left" \
  || bad "O6: left=$left out=$(cat "$TMP"/out/*.out | tr '\n' ' ') errs=$(cat "$TMP"/out/*.err)"

# P. 0023 (Q4.7-Б1): deleting one's own account, files included — with the storage stand-in and the bucket of 0005
psql -X -q -v ON_ERROR_STOP=1 -d "$DB" -f supabase/tests/stub/storage_stub.sql >/dev/null 2>"$TMP/st.err" \
  && psql -X -q -v ON_ERROR_STOP=1 -d "$DB" -f supabase/migrations/0005_journal_attachments.sql >/dev/null 2>>"$TMP/st.err" \
  && psql -X -q -v ON_ERROR_STOP=1 -d "$DB" -f supabase/migrations/0023_account_deletion.sql >/dev/null 2>>"$TMP/st.err" \
  && ok "P0: storage stand-in, 0005 and 0023 on PostgreSQL" || bad "P0: $(cat "$TMP/st.err")"
d() { printf '00000000-0000-0000-0000-00000023e0%02d' "$1"; }
for n in 1 2 3 4; do
  q "INSERT INTO auth.users (id, email) VALUES ('$(d $n)', 'd$n@example.com');
     INSERT INTO public.user_features (user_id, cloud_sync) VALUES ('$(d $n)', TRUE) ON CONFLICT (user_id) DO UPDATE SET cloud_sync = TRUE;
     INSERT INTO storage.objects (bucket_id, name, owner_id, metadata)
       SELECT 'journal-attachments', '$(d $n)/f' || i || '.webp', '$(d $n)', '{\"size\": 10, \"mimetype\": \"image/webp\"}' FROM generate_series(1, 50) i;" >/dev/null
done
svc() { echo "RESET ROLE; SET ROLE service_role; SELECT public.$1('$2') ->> '${3:-state}';"; }
files_left() { q "SELECT count(*) FROM storage.objects WHERE bucket_id = 'journal-attachments' AND name LIKE '$1/%'"; }
# the Storage API removes what the manifest lists (as the route does), until the list is empty
drain() {
  local i
  for i in 1 2 3 4 5; do
    q "SET ROLE service_role; SELECT public.account_deletion_manifest('$1');" >/dev/null || return 1
    [ "$(q "SELECT count(*) FROM public.account_deletion_objects WHERE user_id = '$1' AND gone_at IS NULL")" = 0 ] && return 0
    q "DELETE FROM storage.objects o USING public.account_deletion_objects a WHERE a.user_id = '$1' AND a.gone_at IS NULL AND o.bucket_id = a.bucket_id AND o.name = a.name" >/dev/null
  done
}

# P1. The same request five times at once (a double click, two devices): one request, four repeats
for k in 1 2 3 4 5; do svc account_deletion_begin "$(d 1)" new; done | parallel
[ "$(q "SELECT count(*) FROM public.account_deletions WHERE user_id = '$(d 1)'")" = 1 ] && [ "$(count_out true)" = 1 ] && [ "$(count_out false)" = 4 ] \
  && [ "$(q "SELECT attempts FROM public.account_deletions WHERE user_id = '$(d 1)'")" = 4 ] \
  && ok "P1: 5 requests at once → 1 deletion, 4 repeats counted" || bad "P1: true=$(count_out true) false=$(count_out false) errs=$(cat "$TMP"/out/*.err)"

# P2. Five manifests at once: every file listed once; then removed, ready, and the auth user deleted: nothing left
for k in 1 2 3 4 5; do svc account_deletion_manifest "$(d 1)" pendingCount; done | parallel
[ "$(q "SELECT count(*) FROM public.account_deletion_objects WHERE user_id = '$(d 1)'")" = 50 ] && [ "$(count_out 50)" = 5 ] \
  && ok "P2: 5 manifests at once → 50 files listed once, every answer the same" || bad "P2: out=$(cat "$TMP"/out/*.out | tr '\n' ' ') errs=$(cat "$TMP"/out/*.err)"
drain "$(d 1)" && q "SET ROLE service_role; SELECT public.account_deletion_ready('$(d 1)');" >/dev/null && q "DELETE FROM auth.users WHERE id = '$(d 1)'" >/dev/null
[ "$(files_left "$(d 1)")" = 0 ] && [ "$(q "SELECT count(*) FROM public.account_deletions WHERE user_id = '$(d 1)'")" = 0 ] \
  && ok "P2b: removed, ready, auth user deleted → no file, no request left" || bad "P2b: files=$(files_left "$(d 1)")"

# P3. Uploads racing the request: each lands before it (listed, then removed) or is refused; none is left behind
up() { echo "RESET ROLE; SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub', '$1', false);
  INSERT INTO storage.objects (bucket_id, name, owner_id, metadata) VALUES ('journal-attachments', '$1/race$2.webp', '$1', '{\"size\": 10, \"mimetype\": \"image/webp\"}') RETURNING 'uploaded';"; }
{ svc account_deletion_begin "$(d 2)" new; for k in 1 2 3 4 5 6; do up "$(d 2)" "$k" | tr '\n' ' '; echo; done; } | parallel
uploaded=$(count_out uploaded); refused=$(count_err account_deletion_in_progress)
drain "$(d 2)" && q "SET ROLE service_role; SELECT public.account_deletion_ready('$(d 2)');" >/dev/null
late=$(psql -X -q -At -d "$DB" -c "SET ROLE authenticated;" -c "SELECT set_config('request.jwt.claim.sub', '$(d 2)', false);" \
  -c "INSERT INTO storage.objects (bucket_id, name, owner_id, metadata) VALUES ('journal-attachments', '$(d 2)/late.webp', '$(d 2)', '{\"size\": 10, \"mimetype\": \"image/webp\"}');" 2>&1 | grep -c account_deletion_in_progress)
[ $((uploaded + refused)) = 6 ] && [ "$(files_left "$(d 2)")" = 0 ] && [ "$late" = 1 ] && [ "$(other_errors account_deletion_in_progress)" = 0 ] \
  && ok "P3: request racing 6 uploads → $uploaded landed before (listed, removed), $refused refused; an upload after it is refused; nothing left" \
  || bad "P3: uploaded=$uploaded refused=$refused left=$(files_left "$(d 2)") late=$late errs=$(cat "$TMP"/out/*.err)"

# P4. The auth user deleted while manifests run: never a deadlock; nothing of the account is left
q "SET ROLE service_role; SELECT public.account_deletion_begin('$(d 3)');" >/dev/null
{ echo "RESET ROLE; DELETE FROM auth.users WHERE id = '$(d 3)';"; for k in 1 2 3; do svc account_deletion_manifest "$(d 3)" pendingCount; done; } | parallel
[ "$(count_err deadlock)" = 0 ] && [ "$(q "SELECT count(*) FROM public.account_deletions WHERE user_id = '$(d 3)'")" = 0 ] \
  && [ "$(q "SELECT count(*) FROM auth.users WHERE id = '$(d 3)'")" = 0 ] && [ "$(other_errors 'account_deletion_not_requested')" = 0 ] \
  && ok "P4: auth user deleted racing 3 manifests → no deadlock; the request gone with the account" \
  || bad "P4: errs=$(cat "$TMP"/out/*.err)"

# P5. An account that asked for nothing is never touched
[ "$(files_left "$(d 4)")" = 50 ] && [ "$(q "SELECT count(*) FROM public.account_deletions WHERE user_id = '$(d 4)'")" = 0 ] \
  && ok "P5: an account that asked for nothing keeps its 50 files" || bad "P5: files=$(files_left "$(d 4)")"

# Q. The in-flight upload, deterministic (real PostgreSQL transactions; the Storage server's insert of the object row is
# modelled as one transaction — the order the hosted Storage API uses must be checked there, docs section 7):
#   an upload has passed its check but not committed → the deletion starts → the list is empty → ready → the auth user is
#   deleted → the upload commits. Q0 runs this on 0023 without the account lock (the race is real: a file is left), Q1–Q3
#   on 0023 as it is.
qacc() { printf '00000000-0000-0000-0000-00000023f1%02d' "$1"; }
qsetup() {
  q "INSERT INTO auth.users (id, email) VALUES ('$1', 'q$2@example.com');
     INSERT INTO public.user_features (user_id, cloud_sync) VALUES ('$1', TRUE) ON CONFLICT (user_id) DO UPDATE SET cloud_sync = TRUE;" >/dev/null
}
# The order is set by the test, never by timing: a held transaction commits only once the test opens its gate
# (a row in q_gate; READ COMMITTED: every loop step sees it). The 60 s cap only ends a broken run, it orders nothing.
q "CREATE TABLE IF NOT EXISTS public.q_gate (id TEXT PRIMARY KEY); GRANT SELECT ON public.q_gate TO authenticated;" >/dev/null
qgate_wait_sql() {
  echo "DO \$g\$ BEGIN FOR i IN 1..1200 LOOP EXIT WHEN EXISTS (SELECT 1 FROM public.q_gate WHERE id = '$1'); PERFORM pg_sleep(0.05); END LOOP; END \$g\$;"
}
qgate_open() { q "INSERT INTO public.q_gate (id) VALUES ('$1') ON CONFLICT DO NOTHING" >/dev/null; }
# an upload as the person, past its check, held open until the gate «up_$2» opens (in the background)
qupload_held() {
  # one session, one transaction across the commands (no stdin)
  psql -X -q -At -v ON_ERROR_STOP=1 -d "$DB" -c "BEGIN;" -c "SET LOCAL ROLE authenticated;" -c "SELECT set_config('request.jwt.claim.sub', '$1', true);" \
    -c "INSERT INTO storage.objects (bucket_id, name, owner_id, metadata) VALUES ('journal-attachments', '$1/inflight.webp', '$1', '{\"size\": 10, \"mimetype\": \"image/webp\"}');" \
    -c "$(qgate_wait_sql "up_$2")" -c "COMMIT;" >"$TMP/up_$2.out" 2>"$TMP/up_$2.err" &
}
# waits until the held upload has inserted its row (its transaction is open)
qwait_inserted() {
  local i
  for i in $(seq 1 100); do
    [ "$(q "SELECT count(*) FROM pg_stat_activity WHERE state = 'active' AND query LIKE '%pg_sleep%' AND pid <> pg_backend_pid()")" -ge 1 ] && return 0
    sleep 0.1
  done
  return 1
}
qupload_now() {
  psql -X -q -At -d "$DB" -c "SET ROLE authenticated;" -c "SELECT set_config('request.jwt.claim.sub', '$1', false);" \
    -c "INSERT INTO storage.objects (bucket_id, name, owner_id, metadata) VALUES ('journal-attachments', '$1/$2.webp', '$1', '{\"size\": 10, \"mimetype\": \"image/webp\"}');" 2>&1
}
qready_and_delete() {
  q "SET ROLE service_role; SELECT public.account_deletion_manifest('$1') ->> 'pendingCount';" >/dev/null || return 1
  drain "$1" || return 1
  q "SET ROLE service_role; SELECT public.account_deletion_ready('$1') ->> 'state';" >/dev/null || return 1
  q "DELETE FROM auth.users WHERE id = '$1'" >/dev/null
}

# Q0 (control). 0023 without the account lock: the race leaves a file behind
grep -v "pg_advisory_xact_lock" supabase/migrations/0023_account_deletion.sql > "$TMP/0023_nolock.sql"
psql -X -q -v ON_ERROR_STOP=1 -d "$DB" -f "$TMP/0023_nolock.sql" >/dev/null 2>"$TMP/q0.err" || bad "Q0: the control migration: $(cat "$TMP/q0.err")"
U0=$(qacc 0); qsetup "$U0" 0
qupload_held "$U0" 0
qwait_inserted || bad "Q0: the upload did not start"
q "SET ROLE service_role; SELECT public.account_deletion_begin('$U0');" >/dev/null
q0_steps=$(qready_and_delete "$U0" && echo deleted)
# only now, after the auth user's deletion, the upload commits
qgate_open up_0
wait
q0_left=$(files_left "$U0")
[ "$q0_steps" = deleted ] && [ "$q0_left" = 1 ] \
  && ok "Q0 (control, no lock): the deletion finished while an upload was in flight; the upload committed after it — 1 file left (the race is real)" \
  || bad "Q0 (control): steps=$q0_steps left=$q0_left err=$(cat "$TMP"/up_0.err)"
q "DELETE FROM storage.objects WHERE name LIKE '$U0/%'" >/dev/null
# 0023 as it is
psql -X -q -v ON_ERROR_STOP=1 -d "$DB" -f supabase/migrations/0023_account_deletion.sql >/dev/null 2>"$TMP/q0b.err" || bad "Q0b: 0023 again: $(cat "$TMP/q0b.err")"

# Q1. The same order on 0023: the request cannot start while the upload is in flight (it waits for the account lock —
# a 0.5 s lock timeout proves it is blocked, not slow); once the upload commits, its file is listed and removed
U1=$(qacc 1); qsetup "$U1" 1
qupload_held "$U1" 1
qwait_inserted || bad "Q1: the upload did not start"
blocked=$(psql -X -q -At -d "$DB" -c "SET ROLE service_role;" -c "SET lock_timeout = '500ms';" -c "SELECT public.account_deletion_begin('$U1');" 2>&1 | grep -c "lock timeout")
[ "$(q "SELECT count(*) FROM public.account_deletions WHERE user_id = '$U1'")" = 0 ] || bad "Q1: a request exists while the upload is in flight"
qgate_open up_1
wait
q "SET ROLE service_role; SELECT public.account_deletion_begin('$U1');" >/dev/null
listed=$(q "SET ROLE service_role; SELECT public.account_deletion_manifest('$U1') ->> 'pendingCount';")
qready_and_delete "$U1" && q1_steps=deleted
[ "$blocked" = 1 ] && [ "$listed" = 1 ] && [ "$q1_steps" = deleted ] && [ "$(files_left "$U1")" = 0 ] \
  && ok "Q1: an upload in flight blocks the request (lock timeout); after it commits its file is listed, removed; nothing left" \
  || bad "Q1: blocked=$blocked listed=$listed steps=$q1_steps left=$(files_left "$U1") err=$(cat "$TMP"/up_1.err)"

# Q2. An upload between the (empty) list and ready: refused; Q3. between ready and the auth user's deletion: refused;
# and after the deletion (the old token): refused — nothing left
U2=$(qacc 2); qsetup "$U2" 2
q "SET ROLE service_role; SELECT public.account_deletion_begin('$U2');" >/dev/null
empty=$(q "SET ROLE service_role; SELECT public.account_deletion_manifest('$U2') ->> 'pendingCount';")
q2=$(qupload_now "$U2" between_list_and_ready | grep -c account_deletion_in_progress)
q "SET ROLE service_role; SELECT public.account_deletion_ready('$U2');" >/dev/null
q3=$(qupload_now "$U2" between_ready_and_delete | grep -c account_deletion_in_progress)
q "DELETE FROM auth.users WHERE id = '$U2'" >/dev/null
q3b=$(qupload_now "$U2" after_delete | grep -c "row-level security")
[ "$empty" = 0 ] && [ "$q2" = 1 ] && [ "$q3" = 1 ] && [ "$q3b" = 1 ] && [ "$(files_left "$U2")" = 0 ] \
  && ok "Q2–Q3: uploads between the list and ready, between ready and the deletion, and after it (old token): all refused; nothing left" \
  || bad "Q2–Q3: empty=$empty q2=$q2 q3=$q3 after=$q3b left=$(files_left "$U2")"

# Q4. The same order for another table (a journal row in flight): it cannot outlive the account (its foreign key)
U4=$(qacc 4); qsetup "$U4" 4
psql -X -q -At -d "$DB" -c "BEGIN;" -c "SET LOCAL ROLE authenticated;" -c "SELECT set_config('request.jwt.claim.sub', '$U4', true);" \
  -c "INSERT INTO public.journal_notes (user_id, id, data) VALUES ('$U4', 'n1', '{\"id\":\"n1\",\"body\":\"x\",\"createdAt\":\"2026-11-02T08:00:00Z\"}');" \
  -c "$(qgate_wait_sql up_4)" -c "COMMIT;" >"$TMP/up_4.out" 2>"$TMP/up_4.err" &
qwait_inserted || bad "Q4: the write did not start"
q "SET ROLE service_role; SELECT public.account_deletion_begin('$U4');" >/dev/null
qready_and_delete "$U4" &
# the auth user's deletion is seen waiting on the row the journal write holds; only then that write commits
for i in $(seq 1 200); do
  [ "$(q "SELECT count(*) FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND query LIKE 'DELETE FROM auth.users%'")" -ge 1 ] && break
  sleep 0.1
done
q4_waiting=$(q "SELECT count(*) FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND query LIKE 'DELETE FROM auth.users%'")
qgate_open up_4
wait
[ "$q4_waiting" -ge 1 ] || bad "Q4: the deletion was not seen waiting on the journal write"
[ "$(q "SELECT count(*) FROM public.journal_notes WHERE user_id = '$U4'")" = 0 ] && [ "$(q "SELECT count(*) FROM auth.users WHERE id = '$U4'")" = 0 ] \
  && ok "Q4: a journal row in flight during the deletion: none left (it commits before the cascade, or its foreign key refuses it)" \
  || bad "Q4: rows=$(q "SELECT count(*) FROM public.journal_notes WHERE user_id = '$U4'") err=$(cat "$TMP"/up_4.err)"

psql -X -q -d postgres -c "DROP DATABASE IF EXISTS $DB" >/dev/null
rm -rf "$TMP"
[ "$FAILED" = 0 ] && echo "ALL CONCURRENCY TESTS PASSED" || echo "SOME CONCURRENCY TESTS FAILED"
exit "$FAILED"
