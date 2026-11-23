#!/usr/bin/env node
// AYRA Trading — the owner's transfer tool (Q4.5-4, docs/q4-5-4-migration-provenance-audit.md, section 8).
// NOT an API: it runs on the owner's computer with a direct database connection, as the NOLOGIN role
// game_migration_admin (SET ROLE right after connecting). It can only read the quarantine and call the 0019 functions;
// every decision needs an author (--actor), a reason (--reason) and a typed confirmation (the account id). Every change
// is written to game_migration_audit by the database itself.
//
// The numbers are never the tool's: the database computes the reconciliation itself from the stored snapshots
// (game_mig_reconcile) and saves only when this tool's own computation (lib/migration/reconcile.ts) is EQUAL to it —
// two independent implementations; a difference is refused and logged. The activation computes it once more.
//
//   AYRA_MIGRATION_DB_URL=postgres://… node scripts/migration-admin.mjs <command> …
//
//   show       <user>                                         snapshots, reviews, reconciliations, decision log
//   open       <user> --actor A --reason R                    local / scheduled → migration_pending (the window)
//   window     <user> --until <ISO time> --actor A --reason R  extends the intake window (7 days by default; only later)
//   reconcile  <user> [--save --actor A]                      computes the preview; --save stores it as the draft
//   decide     <user> <snapshot> <pending_review|accepted|rejected|needs_evidence> [--xp N --coins N] --actor A --reason R
//   activate   <user> <reconciliation id> --actor A [--level-gap-ack TEXT]   (after the window closed)
//   activate-new <user> --actor A --reason R                  a genuinely new account: no snapshot, no history at all
//
// Confirmation: typed at the prompt, or --confirm <user> (the same account id) for a scripted run.
// The connection string is never printed or logged. Never point it at Production before the owner's written approval.
import { createInterface } from "node:readline/promises";
import pg from "pg";
import { journalEvidence, reconcile } from "../lib/migration/reconcile.ts";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseArgs(argv) {
  const pos = [];
  const opt = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const k = a.slice(2);
      if (k === "save") opt.save = true;
      else opt[k] = argv[++i];
    } else pos.push(a);
  }
  return { pos, opt };
}

function die(msg) {
  console.error(`ERROR ${msg}`);
  process.exit(2);
}
const need = (v, name) => (v && String(v).trim() ? String(v).trim() : die(`${name} is required`));

async function confirm(user, opt, what) {
  console.log(`\n${what}\nAccount: ${user}`);
  if (opt.confirm !== undefined) {
    if (opt.confirm !== user) die("--confirm does not match the account id: nothing done");
    return;
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const typed = (await rl.question("Type the account id to confirm (anything else cancels): ")).trim();
  rl.close();
  if (typed !== user) die("not confirmed: nothing done");
}

async function connect() {
  const url = process.env.AYRA_MIGRATION_DB_URL;
  if (!url) die("AYRA_MIGRATION_DB_URL is not set");
  const client = new pg.Client({ connectionString: url, application_name: "ayra-migration-admin" });
  await client.connect();
  await client.query("SET ROLE game_migration_admin");
  return client;
}

const table = (rows) => (rows.length ? console.table(rows) : console.log("  (none)"));

async function show(db, user) {
  const acc = (await db.query("SELECT state, state_changed_at, public.game_mig_window_closes_at(user_id) AS closes FROM public.game_accounts WHERE user_id = $1", [user])).rows[0];
  console.log(`State: ${acc ? `${acc.state} since ${acc.state_changed_at.toISOString()}` : "local (no row)"}`);
  if (acc?.closes) console.log(`Intake window: ${acc.closes > new Date() ? "open" : "CLOSED"} — closes at ${acc.closes.toISOString()} (closing deletes nothing; later snapshots are kept as late)`);
  console.log("\nSnapshots (quarantine — nothing here is credited):");
  table((await db.query(`SELECT snapshot_id, install_id, status, account_state, byte_size, received_at,
      content->>'level' AS level, content->>'xp' AS xp_in_level, content->>'coins' AS coins
    FROM public.game_imports WHERE user_id = $1 ORDER BY received_at`, [user])).rows);
  console.log("\nLegacy reviews:");
  table((await db.query(`SELECT snapshot_id, status, candidate_xp, candidate_coins, accepted_xp, accepted_coins, decided_by, decided_at, reason
    FROM public.game_legacy_reviews WHERE user_id = $1 ORDER BY snapshot_id`, [user])).rows);
  console.log("\nReconciliations:");
  table((await db.query(`SELECT id, status, created_by, created_at, activated_by, activated_at,
      result->'proposed'->>'confirmedXp' AS confirmed_xp, result->'proposed'->>'confirmedCoins' AS confirmed_coins,
      jsonb_array_length(result->'conflicts') AS conflicts
    FROM public.game_reconciliations WHERE user_id = $1 ORDER BY id`, [user])).rows);
  console.log("\nDecision log:");
  table((await db.query(`SELECT at, actor, db_user, action, details FROM public.game_migration_audit WHERE user_id = $1 ORDER BY id`, [user])).rows
    .map((r) => ({ ...r, details: JSON.stringify(r.details).slice(0, 160) })));
}

async function computePreview(db, user) {
  const tz = (await db.query("SELECT public.game_mig_timezone($1) AS tz", [user])).rows[0]?.tz || "UTC";
  const snaps = (await db.query(`SELECT snapshot_id, install_id, received_at, content, content_md5 FROM public.game_imports
    WHERE user_id = $1 AND status = 'accepted' ORDER BY snapshot_id`, [user])).rows;
  if (!snaps.length) die("no accepted snapshot for this account: nothing to reconcile");
  const r = reconcile(
    snaps.map((s) => ({ snapshotId: s.snapshot_id, installId: s.install_id, receivedAt: s.received_at.toISOString(), state: s.content })),
    tz,
    Object.fromEntries(snaps.map((s) => [s.snapshot_id, s.content_md5])),
  );
  // the database's own computation from the same stored snapshots: the two must be equal (the save checks it again)
  const server = (await db.query("SELECT public.game_mig_reconcile($1) AS r", [user])).rows[0].r;
  const agree = (await db.query("SELECT $1::jsonb = $2::jsonb AS eq", [JSON.stringify(r), JSON.stringify(server)])).rows[0].eq;
  const differs = agree ? [] : Object.keys(server).filter((k) => JSON.stringify(server[k]) !== JSON.stringify(r[k]));
  const journal = (await db.query("SELECT public.game_mig_journal_days($1, $2) AS d", [user, tz])).rows[0].d || {};
  const dayCounts = Object.fromEntries(Object.entries(journal).map(([d, c]) => [d, Object.entries(c).filter(([k]) => k !== "imported").reduce((a, [, n]) => a + Number(n), 0)]));
  return { tz, r, journal, dayCounts, agree, differs };
}

function printPreview({ tz, r, journal, dayCounts, agree, differs }) {
  console.log(`Time zone of the account: ${tz}. Algorithm ${r.algorithm}.`);
  console.log(agree ? "The database computed the SAME result on its own (two independent implementations agree)."
    : `THE DATABASE COMPUTED ANOTHER RESULT (${differs.join(", ")}): it will not be saved — report this, do not work around it.`);
  console.log(`\nProven events (${r.events.length}) — each counted once across devices:`);
  table(r.events.map((e) => ({ key: e.key, day: e.day, xp: e.xp, coins: e.coins, devices: e.sources.length })));
  console.log(`\nConflicts (${r.conflicts.length}) — nothing of these is confirmed:`);
  table(r.conflicts.map((c) => ({ code: c.code, subject: c.subject, xp: c.xp, coins: c.coins })));
  console.log("\nLegacy candidates (per device — NEVER summed; at most one can be accepted):");
  for (const l of r.legacy) {
    console.log(`  ${l.snapshotId}  original level ${l.original.level} (${l.original.totalXp} XP total), ${l.original.coins} Coins, save ${l.original.saveVersion}`);
    console.log(`    confirmed ${l.confirmed.xp} XP / ${l.confirmed.coins} Coins → candidate ${l.candidate.xp} XP / ${l.candidate.coins} Coins`);
    for (const x of l.reasons) console.log(`    · ${x.code}${x.xp ? ` ${x.xp} XP` : ""}${x.count ? ` ×${x.count}` : ""}${x.since ? ` since ${x.since}` : ""}`);
    const ev = journalEvidence(l, dayCounts);
    if (ev.length) console.log(`    Journal evidence (records per day, not a proof of any reward): ${ev.map((e) => `${e.day}:${e.recordsThatDay}`).join(" ")}`);
  }
  const imported = Object.values(journal).reduce((a, c) => a + Number(c.imported || 0), 0);
  if (imported) console.log(`  (imported Journal records, never rewarded: ${imported})`);
  const p = r.proposed;
  console.log(`\nProposed from proven events only: ${p.confirmedXp} XP → level ${p.level}; ${p.confirmedCoins} Coins.`);
  console.log(`Original (highest device): level ${p.originalLevel}, ${p.originalCoins} Coins.${p.levelGap ? `  LEVEL GAP ${p.levelGap}: activation needs --level-gap-ack or an accepted remainder.` : ""}`);
  console.log(`Achievements on the devices (kept in the snapshots; not on the server before Q4.6): ${r.achievements.join(", ") || "none"}`);
}

async function main() {
  const { pos, opt } = parseArgs(process.argv.slice(2));
  const [cmd, user, ...rest] = pos;
  if (!cmd || !["show", "open", "window", "reconcile", "decide", "activate", "activate-new"].includes(cmd)) die("command: show | open | window | reconcile | decide | activate | activate-new");
  if (!user || !UUID_RE.test(user)) die("<user> must be the account id (UUID)");
  const db = await connect();
  try {
    if (cmd === "show") return await show(db, user);
    if (cmd === "open") {
      const actor = need(opt.actor, "--actor");
      const reason = need(opt.reason, "--reason");
      const st = (await db.query("SELECT state FROM public.game_accounts WHERE user_id = $1", [user])).rows[0]?.state || "local";
      await confirm(user, opt, `Open the transfer window (${st} → migration_pending): the account's devices stop giving rewards.`);
      const v = (await db.query("SELECT public.game_mig_transition($1, $2, 'migration_pending', $3, $4) AS v", [user, st, actor, reason])).rows[0].v;
      return console.log(JSON.stringify(v));
    }
    if (cmd === "window") {
      const until = new Date(need(opt.until, "--until"));
      if (Number.isNaN(until.getTime())) die("--until must be a date and time (ISO, e.g. 2026-12-10T12:00:00Z)");
      const actor = need(opt.actor, "--actor");
      const reason = need(opt.reason, "--reason");
      await confirm(user, opt, `Extend the intake window to ${until.toISOString()}. Reason: ${reason}`);
      const v = (await db.query("SELECT public.game_mig_extend_window($1, $2, $3, $4) AS v", [user, until.toISOString(), actor, reason])).rows[0].v;
      return console.log(JSON.stringify(v));
    }
    if (cmd === "activate-new") {
      const actor = need(opt.actor, "--actor");
      const reason = need(opt.reason, "--reason");
      await confirm(user, opt, "ACTIVATE AS A NEW ACCOUNT (not a transfer): only for an account with no snapshot and no history at all; it starts at zero.");
      const v = (await db.query("SELECT public.game_mig_activate_new($1, $2, $3) AS v", [user, actor, reason])).rows[0].v;
      return console.log(JSON.stringify(v));
    }
    if (cmd === "reconcile") {
      const preview = await computePreview(db, user);
      printPreview(preview);
      if (!opt.save) return console.log("\nPreview only. Add --save --actor <name> to store it as the draft.");
      const actor = need(opt.actor, "--actor");
      await confirm(user, opt, "Save this reconciliation as the draft (reviews of changed candidates go back to pending_review).");
      const v = (await db.query("SELECT public.game_mig_save_reconciliation($1, $2, $3) AS v", [user, JSON.stringify(preview.r), actor])).rows[0].v;
      if (!v.saved) die(`${v.refused}: the database did not save it (the refusal is in the decision log)`);
      return console.log(`Saved draft reconciliation ${v.id} (result md5 ${v.result_md5}).`);
    }
    if (cmd === "decide") {
      const [snapshot, status] = rest;
      if (!snapshot || !UUID_RE.test(snapshot)) die("<snapshot> must be a snapshot id");
      if (!["pending_review", "accepted", "rejected", "needs_evidence"].includes(status)) die("status: pending_review | accepted | rejected | needs_evidence");
      const actor = need(opt.actor, "--actor");
      const reason = need(opt.reason, "--reason");
      const xp = status === "accepted" ? Number(need(opt.xp, "--xp")) : null;
      const coins = status === "accepted" ? Number(need(opt.coins, "--coins")) : null;
      if (status === "accepted" && (!Number.isInteger(xp) || !Number.isInteger(coins) || xp < 0 || coins < 0)) die("--xp and --coins must be whole numbers ≥ 0");
      await confirm(user, opt, `Decision on the remainder of ${snapshot}: ${status}${status === "accepted" ? ` ${xp} XP / ${coins} Coins` : ""}. Reason: ${reason}`);
      const v = (await db.query("SELECT public.game_mig_decide_legacy($1, $2, $3, $4, $5, $6, $7) AS v", [user, snapshot, status, xp, coins, actor, reason])).rows[0].v;
      return console.log(JSON.stringify(v));
    }
    if (cmd === "activate") {
      const id = Number(rest[0]);
      if (!Number.isSafeInteger(id) || id <= 0) die("<reconciliation id> is required (see show)");
      const actor = need(opt.actor, "--actor");
      const rec = (await db.query("SELECT status, result->'proposed' AS p FROM public.game_reconciliations WHERE id = $1 AND user_id = $2", [id, user])).rows[0];
      if (!rec) die("no such reconciliation for this account");
      await confirm(user, opt, `ACTIVATE the server economy for this account from reconciliation ${id} (${rec.status}): ${rec.p.confirmedXp} XP / ${rec.p.confirmedCoins} Coins proven + the accepted remainder. This cannot be undone.`);
      const v = (await db.query("SELECT public.game_mig_activate($1, $2, $3, $4) AS v", [user, id, actor, opt["level-gap-ack"] ?? null])).rows[0].v;
      if (v.refused) die(`${v.refused}: nothing was credited, the account stays in migration_pending (the refusal is in the decision log)`);
      if (v.achievements_transferred === false && !v.replay) console.log("Note: achievements stay on the devices and in the snapshots until Q4.6 — the transfer is not complete for the person yet.");
      return console.log(JSON.stringify(v));
    }
  } catch (e) {
    // the database's refusal (game_mig_…) — nothing was changed
    die(`${e.message}${e.detail ? ` (${e.detail})` : ""}`);
  } finally {
    await db.end();
  }
}

await main();
