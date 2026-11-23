#!/usr/bin/env node
// AYRA Trading — Q4.5-4: the two implementations of the reconciliation must agree EXACTLY (the database saves a result
// only when the owner's tool computed the same one). Runs lib/migration/reconcile.ts (Node 24 type stripping) and the
// database's game_mig_reconcile (0019) on the same stored snapshots: the shared fixtures, the owner's review cases and a
// few hundred generated saves full of odd values (fractions, strings, huge numbers, impossible days and times, unknown
// kinds, duplicates, capped days) in time zones from −11 to +14. Never point it at Supabase or production.
//   AYRA_MIGRATION_DB_URL=postgres://postgres:postgres@localhost:5432/<test db> node scripts/test-reconcile-twins.mjs [seed]
import pg from "pg";
import { reconcile } from "../lib/migration/reconcile.ts";
import * as fixtures from "../test-fixtures/q4-5-4/saves.ts";

const url = process.env.AYRA_MIGRATION_DB_URL;
if (!url || !/@(localhost|127\.0\.0\.1)[:/]/.test(url)) {
  console.log("FAIL refusing to run: AYRA_MIGRATION_DB_URL must point at localhost");
  process.exit(2);
}
const SEED = Number(process.argv[2] ?? 20261123) >>> 0;
let state = SEED;
// mulberry32: the same seed gives the same saves (a failure is reproducible with its seed)
const rnd = () => {
  state = (state + 0x6d2b79f5) >>> 0;
  let t = state;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const pick = (a) => a[Math.floor(rnd() * a.length)];
const chance = (p) => rnd() < p;
const int = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));

const ZONES = ["UTC", "Europe/Moscow", "Asia/Tokyo", "America/New_York", "Pacific/Kiritimati", "Pacific/Pago_Pago", "Asia/Kolkata", "Australia/Lord_Howe"];
const DAYS = ["2026-10-20", "2026-10-26", "2026-10-27", "2026-10-28", "2026-11-01", "2026-11-02", "2026-11-03", "2026-12-31", "2027-01-01"];
const BAD_DAYS = ["2026-02-30", "2026-13-01", "1999-12-31", "2026-1-01", "", "2026-11-01T00:00:00Z"];
const KINDS = ["trade", "account", "strategy", "import", "dayPlan", "weekPlan", "note", "noTrade", "screenshot"];
const odd = () => pick([-1, 0.5, 40.0000001, 1e12, "10", null, true, [], {}, 1e21]);
const amount = (lo, hi) => (chance(0.08) ? odd() : int(lo, hi));
const time = (day) => {
  if (chance(0.07)) return pick(["yesterday", `${day} 07:00:00Z`, `${day}T24:00:00Z`, `${day}T07:00:00+03:00`, `${day}T07:00:60Z`, 12345]);
  const hh = String(int(0, 23)).padStart(2, "0");
  return `${day}T${hh}:${String(int(0, 59)).padStart(2, "0")}:${String(int(0, 59)).padStart(2, "0")}${chance(0.5) ? `.${String(int(0, 999)).padStart(3, "0")}` : ""}Z`;
};

/** A generated save: shared pools of ids make the same event appear on several devices (with equal or other amounts). */
function genSave() {
  const s = {};
  if (chance(0.9)) s.level = chance(0.9) ? int(1, 12) : odd();
  if (chance(0.9)) s.xp = chance(0.9) ? int(0, 600) : odd();
  if (chance(0.9)) s.coins = chance(0.9) ? int(0, 900) : odd();
  if (chance(0.85)) {
    s.history = Array.from({ length: int(0, 18) }, () => {
      const day = chance(0.93) ? pick(DAYS) : pick(BAD_DAYS);
      const h = { questId: chance(0.95) ? `q_${int(0, 9)}` : pick(["q 1", "", "ä", 7]), questTitle: "Q", category: "x", xp: amount(0, 60), coins: amount(0, 18), completedAt: day };
      if (chance(0.5)) h.at = time(day);
      return h;
    });
  }
  // a busy day: many different quests on one day (the devices share part of the ids) — the cap across devices
  if (chance(0.35)) {
    const day = pick(["2026-10-26", "2026-10-27", "2026-11-03"]);
    s.history = [...(Array.isArray(s.history) ? s.history : []), ...Array.from({ length: int(4, 12) }, () => ({ questId: `q_busy_${int(0, 15)}`, questTitle: "Q", category: "x", xp: 40, coins: int(5, 15), completedAt: day }))];
  }
  if (chance(0.6)) {
    s.firstActions = {};
    for (const k of KINDS) if (chance(0.4)) s.firstActions[k] = time(pick(DAYS));
    if (chance(0.1)) s.firstActions[pick(["constructor", "__proto__", "unknown"])] = time("2026-11-01");
  }
  if (chance(0.7)) {
    s.coinLogSince = chance(0.9) ? time("2026-10-28") : 5;
    s.coinLog = Array.from({ length: int(0, 12) }, () => {
      const day = pick(DAYS);
      const kind = pick(KINDS);
      return pick([
        { at: time(day), source: "dailyReward", amount: chance(0.85) ? pick([10, 15, 20, 25, 50, int(1, 49)]) : odd() },
        { at: time(day), source: "firstAction", amount: chance(0.85) ? pick([5, 10, 20]) : odd(), kind },
        { at: time(day), source: "quest", amount: 10, questId: "q_1", title: "Q" },
        "junk",
      ]);
    });
  }
  if (chance(0.4)) {
    s.personalLedger = Array.from({ length: int(0, 4) }, () => ({ runId: chance(0.95) ? `run_${int(0, 5)}` : "bad id", xp: chance(0.85) ? pick([50, 90, 100, 125, 180, 250]) : amount(0, 400), day: chance(0.93) ? pick(DAYS) : pick(BAD_DAYS), paid: chance(0.8) ? true : pick([false, "true", 1]) }));
  }
  if (chance(0.5)) {
    s.dailyStats = {};
    for (const d of DAYS) if (chance(0.4)) s.dailyStats[d] = { xpGained: amount(0, 200), coinsGained: int(0, 100) };
    if (chance(0.2)) s.dailyStats["not-a-day"] = { xpGained: 50 };
  }
  if (chance(0.3)) s.rewardedScreenshotHashes = Array.from({ length: int(0, 5) }, (_, i) => `h${i}`);
  if (chance(0.5)) s.achievements = { firstTrade: chance(0.5), streak3: true, "bad key": true, deep: { x: true } };
  if (chance(0.2)) s.missionLedger = chance(0.5) ? { day: "2026-11-16", claims: {} } : [];
  return s;
}

const db = new pg.Client({ connectionString: url, application_name: "ayra-reconcile-twins" });
await db.connect();
let failed = 0;
let passed = 0;
const ok = (m) => (passed++, console.log(`PASS ${m}`));
const bad = (m) => (failed++, console.log(`FAIL ${m}`));
let userNo = 0;
const seen = new Map(); // conflict code → how many generated accounts had it (the generator must reach every rule)

async function account(saves, tz) {
  userNo += 1;
  const user = `00000000-0000-4000-8000-${(0x7a0000000000 + userNo).toString(16)}`;
  await db.query("INSERT INTO auth.users (id, email) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING", [user, `twins${userNo}@example.com`]);
  await db.query("INSERT INTO public.profiles (id, timezone) VALUES ($1, $2) ON CONFLICT (id) DO UPDATE SET timezone = EXCLUDED.timezone", [user, tz]);
  await db.query("SELECT public.game_economy_transition($1, 'local', 'migration_pending')", [user]);
  for (const [i, save] of saves.entries()) {
    const snapId = `10000000-0000-4000-8000-${String(userNo * 16 + i).padStart(12, "0")}`;
    const install = `20000000-0000-4000-8000-${String(userNo * 16 + i).padStart(12, "0")}`;
    await db.query("SELECT public.game_import_snapshot($1, gen_random_uuid(), floor(extract(epoch FROM now()))::bigint, 'migration_pending', $2, $3, 1, $4::jsonb)",
      [user, snapId, install, JSON.stringify(save)]);
  }
  return user;
}

async function compare(label, saves, tz) {
  const user = await account(saves, tz);
  const rows = (await db.query("SELECT snapshot_id::text AS id, install_id::text AS install, content, content_md5 FROM public.game_imports WHERE user_id = $1 AND status = 'accepted'", [user])).rows;
  const tzDb = (await db.query("SELECT public.game_mig_timezone($1) AS tz", [user])).rows[0].tz;
  const ts = reconcile(rows.map((r) => ({ snapshotId: r.id, installId: r.install, state: r.content })), tzDb, Object.fromEntries(rows.map((r) => [r.id, r.content_md5])));
  // the database's own comparison (jsonb equality — exactly what the save does)
  const { equal, server } = (await db.query("SELECT $2::jsonb = public.game_mig_reconcile($1) AS equal, public.game_mig_reconcile($1) AS server", [user, JSON.stringify(ts)])).rows[0];
  for (const code of new Set(ts.conflicts.map((c) => c.code))) seen.set(code, (seen.get(code) ?? 0) + 1);
  if (ts.events.length) seen.set("(events)", (seen.get("(events)") ?? 0) + 1);
  if (equal) return { user, ts };
  bad(`${label} (tz ${tz}, seed ${SEED}): the implementations differ`);
  for (const k of Object.keys(server)) if (JSON.stringify(server[k]) !== JSON.stringify(ts[k])) console.log(`  ${k}:\n    sql ${JSON.stringify(server[k]).slice(0, 900)}\n    ts  ${JSON.stringify(ts[k]).slice(0, 900)}`);
  console.log(`  saves: ${JSON.stringify(saves).slice(0, 1500)}`);
  return null;
}

try {
  const named = [
    ["legacy", [fixtures.legacySave], "UTC"],
    ["cap (#98)", [fixtures.capSave], "Europe/Moscow"],
    ["coin log (#99)", [fixtures.coinLogSave], "Asia/Tokyo"],
    ["missions and personal quests", [fixtures.missionsSave], "UTC"],
    ["tampered", [fixtures.tamperedSave], "UTC"],
    ["two devices, one amount differs", [fixtures.capSave, fixtures.capSaveDeviceB], "UTC"],
    ["owner's case: 70 + 70 Coins of different events on one day", [fixtures.capDayDeviceA, fixtures.capDayDeviceB], "UTC"],
    ["the same 70 Coins on both devices", [fixtures.capDayDeviceA, fixtures.capDayDeviceA], "UTC"],
    ["all fixtures together", [fixtures.legacySave, fixtures.capSave, fixtures.capSaveDeviceB, fixtures.coinLogSave, fixtures.missionsSave, fixtures.tamperedSave, fixtures.capDayDeviceA, fixtures.capDayDeviceB], "Australia/Lord_Howe"],
  ];
  let all = true;
  let owners = null;
  for (const [label, saves, tz] of named) {
    const r = await compare(label, saves, tz);
    all = !!r && all;
    if (label.startsWith("owner's case")) owners = r;
  }
  if (all) ok(`the fixtures and the owner's review cases: both implementations give the same result (${named.length} accounts)`);

  // the comparison is not blind: one Coin more, one event more, one conflict less — each is a different result
  if (owners) {
    const { user, ts } = owners;
    const variants = {
      "one Coin more on an event": { ...ts, events: ts.events.map((e, i) => (i === 0 ? { ...e, coins: e.coins + 1 } : e)) },
      "a forged event": { ...ts, events: [...ts.events, { key: "quest:2026-11-03:q_forged", kind: "quest", day: "2026-11-03", xp: 40, coins: 10, sources: [ts.legacy[0].snapshotId] }] },
      "the cap conflict dropped": { ...ts, conflicts: ts.conflicts.filter((c) => c.code !== "daily_coin_cap") },
      "one more confirmed XP": { ...ts, proposed: { ...ts.proposed, confirmedXp: ts.proposed.confirmedXp + 1 } },
      "a bigger candidate": { ...ts, legacy: ts.legacy.map((l) => ({ ...l, candidate: { ...l.candidate, coins: l.candidate.coins + 100 } })) },
    };
    let blind = [];
    for (const [name, v] of Object.entries(variants)) {
      const eq = (await db.query("SELECT $2::jsonb = public.game_mig_reconcile($1) AS eq", [user, JSON.stringify(v)])).rows[0].eq;
      if (eq) blind.push(name);
    }
    blind.length === 0 ? ok(`every altered result differs from the database's (${Object.keys(variants).join("; ")})`) : bad(`altered results seen as equal: ${blind.join("; ")}`);
  }

  const N = Number(process.env.TWINS_ACCOUNTS ?? 300);
  let same = 0;
  seen.clear();
  for (let n = 0; n < N; n++) {
    const devices = int(1, 4);
    const saves = Array.from({ length: devices }, genSave);
    if (await compare(`generated account ${n}`, saves, pick(ZONES))) same++;
  }
  const must = ["(events)", "amount_mismatch", "amount_out_of_rule", "daily_coin_cap", "first_action_unlogged", "duplicate_in_snapshot", "balance_below_records", "level_xp_inconsistent", "bad_record"];
  const missing = must.filter((c) => !seen.get(c));
  console.log(`  reached: ${[...seen].map(([c, n]) => `${c} ${n}`).join(", ")}`);
  missing.length === 0 ? ok("the generated accounts reach every rule (every conflict code and proven events)") : bad(`the generator never reached: ${missing.join(", ")}`);
  same === N ? ok(`${N} generated accounts (1–4 devices, odd values, 8 time zones, seed ${SEED}): identical results`) : bad(`${N - same} of ${N} generated accounts differ (seed ${SEED})`);
} finally {
  await db.end();
}
console.log(failed ? "SOME RECONCILIATION TWIN TESTS FAILED" : "ALL RECONCILIATION TWIN TESTS PASSED");
process.exit(failed ? 1 : 0);
