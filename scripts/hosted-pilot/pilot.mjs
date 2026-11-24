#!/usr/bin/env node
// AYRA Trading — Q4.7 hosted Supabase pilot (docs/q4-7-hosted-pilot-plan.md). For a SEPARATE, disposable project only.
//
//   node --import ./scripts/hosted-pilot/ts-resolve.mjs scripts/hosted-pilot/pilot.mjs <step> --target <pilot ref> [--confirm <pilot ref>] […]
//
// Read only (no --confirm):
//   preflight                 P0  what the project allows; that it holds nothing of AYRA and no other user
//   check-schema              P1b after the migrations: triggers, owners, privileges (supabase/checks/pilot_0023_hosted.sql)
//   leftovers --user <id>     P9  what is left of a deleted account (counts and yes/no only)
// Writing into the PILOT (each needs --confirm <ref>; all but init-marker also need the pilot marker in the database):
//   init-marker               marks the empty project as the pilot (public.ayra_pilot_marker)
//   migrate                   P1  applies supabase/migrations 0001…0023 in order (each once; the list is kept in the marker table)
//   race                      P2/P3 uploads against a deletion, ordered by locks (no sleeps)
//   auth-after-delete         P4  what Auth answers a deleted account's tokens
//   amr                       P5  the amr of every sign-in method and of a refresh, through the app's own newestAuthTime
//   delete                    P6  the whole deletion through the app's route (a local `serve` of this repo)
//   resume                    P7  a deletion that fails half-way, continued through the route
//   volume [--files N]        P8  many files, timed
//   cleanup                   removes every pilot test account that is still there (only ayra-pilot-…@example.com)
//   rollback [--to NNNN]      applies the .down files from 0023 back to NNNN (default 0001)
// Not against the database:
//   serve [--port 3200]       builds and starts THIS repo locally against the pilot (deletion flag on only in that process)
//
// Never prints a key, a password, a token or a connection string. Results go to pilot-runs/<run>/ (ignored by git).
import { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import path from "node:path";
import pg from "pg";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { PilotTargetError, describeEnv, loadPilotEnvFile, resolvePilotTarget } from "./env.mjs";
import {
  PILOT_EMAIL_RE, SECRETS_DIR, buildServeEnv, forgetSecrets, isDeletedResponse, isRetryResponse, nextEnvFiles, planCleanup,
  readRegistry, redact, secureDir, serveEnvProblems, verifyKeysOwnership, writeSecretFile,
} from "./lib.mjs";

const BUCKET = "journal-attachments";
const EMAIL_PREFIX = "ayra-pilot-";
const argv = process.argv.slice(2);
const step = argv[0];
const opt = (flag, dflt) => {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : dflt;
};
const WRITE_STEPS = new Set(["init-marker", "migrate", "race", "auth-after-delete", "amr", "delete", "resume", "volume", "cleanup", "rollback", "forget-secrets"]);
const READ_STEPS = new Set(["preflight", "check-schema", "leftovers", "serve"]);
// never in any output: the keys, the database address, and every password / token this run holds (redact())
const secrets = new Set();

let env;
let T;
try {
  if (!WRITE_STEPS.has(step) && !READ_STEPS.has(step)) throw new PilotTargetError(`unknown step «${step ?? ""}» (see the header of this file)`);
  env = loadPilotEnvFile();
  T = resolvePilotTarget(env, argv);
  for (const v of [T.anonKey, T.serviceKey, T.dbUrl, env.AYRA_PILOT_DB_URL]) secrets.add(v);
  if (WRITE_STEPS.has(step) && !T.confirmed) throw new PilotTargetError(`«${step}» writes into the pilot project: add --confirm <the pilot ref>`);
} catch (e) {
  if (e instanceof PilotTargetError) {
    console.error(`REFUSED ${e.message}`);
    if (env) console.error(JSON.stringify(describeEnv(env)));
    process.exit(2);
  }
  throw e;
}

// ---------------------------------------------------------------- output
const run = opt("--run", new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14));
if (!/^[0-9]{14}$/.test(run)) {
  console.error("REFUSED --run must be 14 digits (a time stamp)");
  process.exit(2);
}
const outDir = path.join("pilot-runs", run);
mkdirSync(outDir, { recursive: true });
const results = [];
const say = (line) => console.log(redact(line, secrets));
function check(name, pass, detail = {}) {
  results.push({ name, pass: !!pass, ...detail });
  say(`${pass ? "PASS" : "FAIL"} ${name}${Object.keys(detail).length ? " " + JSON.stringify(detail) : ""}`);
}
function note(name, detail) {
  results.push({ name, note: true, ...detail });
  say(`NOTE ${name} ${JSON.stringify(detail)}`);
}
function finish() {
  let text = JSON.stringify({ step, run, at: new Date().toISOString(), results }, null, 2);
  const clean = redact(text, secrets);
  if (clean !== text) {
    // a secret reached the report: it is not written, and the step fails
    results.push({ name: "no secret in the report", pass: false });
    text = redact(JSON.stringify({ step, run, at: new Date().toISOString(), results }, null, 2), secrets);
    console.log("FAIL no secret in the report (redacted before writing)");
  } else text = clean;
  writeFileSync(path.join(outDir, `${step}.json`), text);
  const failed = results.filter((r) => r.pass === false).length;
  console.log(`${failed ? "SOME CHECKS FAILED" : "ALL CHECKS PASSED"} (${step}; ${path.join(outDir, step + ".json")})`);
  process.exit(failed ? 1 : 0);
}

// every step first proves, read only, that both keys are accepted by the pilot's own gateway (and the anon key is not admin)
if (step !== "forget-secrets") {
  const problems = await verifyKeysOwnership(T);
  if (problems.length) {
    for (const pr of problems) console.error(`REFUSED ${pr}`);
    process.exit(2);
  }
}

// ---------------------------------------------------------------- connections
// TLS with the certificate checked against Supabase's own CA (Project Settings → Database → SSL: download the certificate)
const dbCa = readFileSync(T.dbCaFile, "utf8");
async function connect({ readOnly = false } = {}) {
  const c = new pg.Client({ connectionString: T.dbUrl, ssl: { ca: dbCa, rejectUnauthorized: true }, application_name: "ayra-pilot" });
  await c.connect();
  if (readOnly) await c.query("SET default_transaction_read_only = on");
  return c;
}
const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const service = () => createClient(T.url, T.serviceKey, opts);
const anon = () => createClient(T.url, T.anonKey, opts);
const sqlFile = (f) => readFileSync(path.join("supabase", f), "utf8");
const errInfo = (e) => (e ? { status: e.status ?? null, code: e.code ?? e.error_code ?? null, message: String(e.message ?? e).slice(0, 160) } : null);

async function requireMarker(db) {
  const has = (await db.query("SELECT to_regclass('public.ayra_pilot_marker') IS NOT NULL AS ok")).rows[0].ok;
  const ref = has ? (await db.query("SELECT project_ref FROM public.ayra_pilot_marker LIMIT 1")).rows[0]?.project_ref : null;
  if (ref !== T.ref) {
    console.error("REFUSED this database is not marked as the pilot (run init-marker on the empty pilot project first)");
    process.exit(2);
  }
}

// ---------------------------------------------------------------- test accounts
function saveUser(u) {
  // the registry cleanup relies on: ids and e-mails only (reports may be shared)
  const reg = path.join(outDir, "accounts.json");
  const list = existsSync(reg) ? JSON.parse(readFileSync(reg, "utf8")) : [];
  list.push({ id: u.id, email: u.email, role: u.role });
  writeFileSync(reg, JSON.stringify(list, null, 2));
  // the passwords: a folder only this user can read, never in git (.gitignore), removed by forget-secrets
  if (!secureDir(SECRETS_DIR)) throw new Error(`cannot restrict ${SECRETS_DIR} to this user — no test account is kept`);
  const f = path.join(SECRETS_DIR, `${run}.accounts.secret.json`);
  const secret = existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : [];
  secret.push({ id: u.id, password: u.password });
  writeSecretFile(f, JSON.stringify(secret));
  secrets.add(u.password);
}
async function newUser(db, role, { cloud = true } = {}) {
  const email = `${EMAIL_PREFIX}${run}-${role}-${randomBytes(3).toString("hex")}@example.com`;
  if (!PILOT_EMAIL_RE.test(email)) throw new Error("internal: a test e-mail outside the pilot pattern");
  const password = randomBytes(18).toString("base64url");
  secrets.add(password);
  const { data, error } = await service().auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !data.user) throw new Error(`createUser: ${JSON.stringify(errInfo(error))}`);
  const u = { id: data.user.id, email, password, role };
  saveUser(u); // pilot-runs/ only: the pilot's own throwaway accounts
  if (cloud) await db.query("INSERT INTO public.user_features (user_id, cloud_sync) VALUES ($1, TRUE) ON CONFLICT (user_id) DO UPDATE SET cloud_sync = TRUE", [u.id]);
  return u;
}
async function signIn(u) {
  const c = anon();
  const { data, error } = await c.auth.signInWithPassword({ email: u.email, password: u.password });
  if (error || !data.session) throw new Error(`signIn: ${JSON.stringify(errInfo(error))}`);
  secrets.add(data.session.access_token);
  secrets.add(data.session.refresh_token);
  return { client: c, session: data.session };
}
const fileBytes = (n) => {
  const b = Buffer.alloc(n);
  b.write("RIFF", 0);
  b.write("WEBP", 8);
  return b;
};
async function upload(client, u, name, bytes = fileBytes(64)) {
  const { data, error } = await client.storage.from(BUCKET).upload(`${u.id}/${name}.webp`, bytes, { contentType: "image/webp", upsert: false });
  return { ok: !error && !!data, error: errInfo(error) };
}
async function uploadMany(client, u, n, prefix = "f") {
  let ok = 0;
  const names = Array.from({ length: n }, (_, i) => `${prefix}${String(i).padStart(5, "0")}`);
  for (let i = 0; i < names.length; i += 16) {
    const r = await Promise.all(names.slice(i, i + 16).map((nm) => upload(client, u, nm)));
    ok += r.filter((x) => x.ok).length;
  }
  return ok;
}
async function filesOf(db, id) {
  return Number((await db.query(
    "SELECT count(*) n FROM storage.objects WHERE bucket_id = $2 AND ((storage.foldername(name))[1] = $1 OR owner_id = $1)", [id, BUCKET])).rows[0].n);
}
async function rowExists(db, name) {
  return (await db.query("SELECT 1 FROM storage.objects WHERE bucket_id = $1 AND name = $2", [BUCKET, name])).rowCount > 0;
}

// ---------------------------------------------------------------- lock observation (the race steps are ordered by locks)
async function lockKey(db, id) {
  return (await db.query("SELECT public.account_deletion_lock_key($1)::text AS k", [id])).rows[0].k;
}
/** waits until n sessions wait on the account's deletion lock (a bigint advisory key: classid = high, objid = low 32 bits) */
async function waitWaiters(db, key, n, ms) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    const r = await db.query(
      `SELECT count(*)::int AS n FROM pg_locks WHERE locktype = 'advisory' AND NOT granted AND objsubid = 1
         AND classid::bigint = (($1::bigint >> 32) & 4294967295) AND objid::bigint = ($1::bigint & 4294967295)`, [key]);
    if (r.rows[0].n >= n) return true;
    await new Promise((res) => setTimeout(res, 20));
  }
  return false;
}

// ---------------------------------------------------------------- the app's route (a local build of this repo against the pilot)
const APP = opt("--app", "http://localhost:3200");
async function routeSession(u) {
  const jar = new Map();
  const c = createServerClient(T.url, T.anonKey, {
    cookies: { getAll: () => [...jar].map(([name, value]) => ({ name, value })), setAll: (l) => l.forEach(({ name, value }) => (value ? jar.set(name, value) : jar.delete(name))) },
  });
  const { error } = await c.auth.signInWithPassword({ email: u.email, password: u.password });
  if (error) throw new Error(`route sign-in: ${JSON.stringify(errInfo(error))}`);
  return () => [...jar].map(([n, v]) => `${n}=${v}`).join("; ");
}
async function callRoute(cookie, body) {
  const t0 = Date.now();
  const r = await fetch(`${APP}/api/account/delete`, { method: body ? "POST" : "GET", headers: { cookie: cookie(), "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  let json = null;
  try {
    json = await r.json();
  } catch {
    json = null;
  }
  return { status: r.status, body: json, ms: Date.now() - t0 };
}
async function deleteThroughRoute(u, { maxCalls = 10 } = {}) {
  const cookie = await routeSession(u);
  const calls = [];
  for (let i = 0; i < maxCalls; i++) {
    const r = await callRoute(cookie, { confirm: "DELETE", password: u.password });
    const deleted = isDeletedResponse(r.status, r.body);
    calls.push({ status: r.status, ms: r.ms, deleted, state: r.body?.state ?? null, error: r.body?.error ?? null, retry: r.body?.retry ?? null });
    if (deleted) break;
    if (!isRetryResponse(r.status, r.body)) break;
  }
  return calls;
}

// ---------------------------------------------------------------- leftovers of a deleted account (counts and yes/no only)
async function leftovers(db, id, email) {
  const one = async (sql, args = [id]) => Number((await db.query(sql, args)).rows[0]?.n ?? 0);
  const out = {};
  out.auth_users = await one("SELECT count(*) n FROM auth.users WHERE id = $1");
  out.auth_identities = await one("SELECT count(*) n FROM auth.identities WHERE user_id = $1");
  out.auth_sessions = await one("SELECT count(*) n FROM auth.sessions WHERE user_id = $1");
  out.auth_refresh_tokens = await one("SELECT count(*) n FROM auth.refresh_tokens WHERE user_id = $1::text");
  out.auth_mfa_factors = await one("SELECT count(*) n FROM auth.mfa_factors WHERE user_id = $1");
  if ((await db.query("SELECT to_regclass('auth.one_time_tokens') IS NOT NULL ok")).rows[0].ok) out.auth_one_time_tokens = await one("SELECT count(*) n FROM auth.one_time_tokens WHERE user_id = $1");
  const tables = (await db.query(
    `SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r' AND EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attname = 'user_id' AND NOT a.attisdropped)`)).rows.map((r) => r.relname);
  let publicRows = 0;
  for (const t of tables) publicRows += await one(`SELECT count(*) n FROM public.${pg.escapeIdentifier(t)} WHERE user_id::text = $1::text`);
  out.public_rows = publicRows + (await one("SELECT count(*) n FROM public.profiles WHERE id = $1"));
  out.storage_objects = await filesOf(db, id);
  // the Auth audit log keeps the system's own records (owner decision: not deleted by AYRA) — only what is there
  if ((await db.query("SELECT to_regclass('auth.audit_log_entries') IS NOT NULL ok")).rows[0].ok) {
    try {
      const a = (await db.query(
        `SELECT count(*)::int n, coalesce(jsonb_agg(DISTINCT payload ->> 'action'), '[]') actions,
                bool_or($2::text IS NOT NULL AND payload::text ILIKE '%' || $2::text || '%') has_email,
                bool_or(coalesce(ip_address::text, '') <> '') has_ip
           FROM auth.audit_log_entries WHERE payload::text LIKE '%' || $1::text || '%'`, [id, email || null])).rows[0];
      out.audit_log = { entries: a.n, actions: a.actions, contains_email: !!a.has_email, contains_ip: !!a.has_ip };
    } catch (e) {
      out.audit_log = { unreadable: String(e.code || e.message).slice(0, 60) };
    }
  } else out.audit_log = "no table (database copy of the audit log is off)";
  return out;
}
const isGone = (l) => l.auth_users === 0 && l.auth_identities === 0 && l.auth_sessions === 0 && l.auth_refresh_tokens === 0 && l.public_rows === 0 && l.storage_objects === 0;
async function snapshot(db, u) {
  const l = await leftovers(db, u.id, u.email);
  const names = (await db.query("SELECT name FROM storage.objects WHERE bucket_id = $1 AND owner_id = $2 ORDER BY name", [BUCKET, u.id])).rows.map((r) => r.name);
  return JSON.stringify({ users: l.auth_users, rows: l.public_rows, files: names });
}

// ================================================================ steps
const steps = {
  async preflight() {
    const db = await connect({ readOnly: true });
    const p = (await db.query(sqlFile("checks/pilot_preflight.sql"))).rows[0].preflight;
    await db.end();
    note("project", { server_version: p.server_version, current_user: p.current_user, storage_objects_owner: p.storage_objects_owner, roles: p.roles, buckets: p.storage_buckets });
    check("storage.objects: the migration role may create triggers on it", p.storage_objects_trigger_privilege === true);
    check("storage.objects: the migration role may read it", p.storage_objects_select_privilege === true);
    check("storage.objects has owner_id (text)", p.storage_objects_owner_id === true && p.storage_objects_owner_id_type === "text");
    check("storage.foldername(text) exists", p.storage_foldername === true);
    check("auth.users may be referenced (foreign keys of 0001…)", p.auth_users_references_privilege === true);
    check("roles anon, authenticated, service_role, supabase_auth_admin, supabase_storage_admin exist", Object.values(p.roles).every(Boolean));
    check("uuid-ossp is available", p.uuid_ossp_available === true);
    check("no user except pilot test accounts", p.auth_users_not_pilot === 0, { auth_users: p.auth_users });
    check("empty project, or already marked as the pilot", p.public_tables === 0 || p.pilot_marker === true, { public_tables: p.public_tables, pilot_marker: p.pilot_marker });
    note("storage.objects before AYRA", { triggers: p.storage_objects_triggers, policies: p.storage_objects_policies, objects: p.storage_objects });
    note("auth.audit_log_entries table present", { present: p.audit_log_entries_table });
    finish();
  },

  async "init-marker"() {
    const db = await connect();
    const p = (await db.query(sqlFile("checks/pilot_preflight.sql"))).rows[0].preflight;
    if (p.pilot_marker) {
      await requireMarker(db);
      check("already marked as the pilot", true);
      await db.end();
      return finish();
    }
    if (p.public_tables !== 0 || p.auth_users_not_pilot !== 0) {
      check("the project is empty (no public table, no other user)", false, { public_tables: p.public_tables, auth_users_not_pilot: p.auth_users_not_pilot });
      await db.end();
      return finish();
    }
    await db.query(`BEGIN;
      CREATE TABLE public.ayra_pilot_marker (project_ref TEXT PRIMARY KEY, created_at TIMESTAMPTZ NOT NULL DEFAULT now());
      CREATE TABLE public.ayra_pilot_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now());
      ALTER TABLE public.ayra_pilot_marker ENABLE ROW LEVEL SECURITY;
      ALTER TABLE public.ayra_pilot_migrations ENABLE ROW LEVEL SECURITY;
      REVOKE ALL ON public.ayra_pilot_marker, public.ayra_pilot_migrations FROM PUBLIC, anon, authenticated, service_role;
      COMMIT;`);
    await db.query("INSERT INTO public.ayra_pilot_marker (project_ref) VALUES ($1)", [T.ref]);
    await requireMarker(db);
    check("the project is marked as the pilot", true);
    await db.end();
    finish();
  },

  async migrate() {
    const db = await connect();
    await requireMarker(db);
    const files = readdirSync("supabase/migrations").filter((f) => /^\d{4}_.+\.sql$/.test(f) && !f.endsWith(".down.sql")).sort();
    const done = new Set((await db.query("SELECT name FROM public.ayra_pilot_migrations")).rows.map((r) => r.name));
    for (const f of files) {
      if (done.has(f)) continue;
      const t0 = Date.now();
      try {
        // each file manages its own transaction (BEGIN … COMMIT); a failure stops here, nothing later is applied
        await db.query(readFileSync(path.join("supabase/migrations", f), "utf8"));
        await db.query("INSERT INTO public.ayra_pilot_migrations (name) VALUES ($1)", [f]);
        check(`applied ${f}`, true, { ms: Date.now() - t0 });
      } catch (e) {
        await db.query("ROLLBACK").catch(() => undefined);
        check(`applied ${f}`, false, { error: { code: e.code ?? null, message: String(e.message).slice(0, 200) } });
        break;
      }
    }
    await db.end();
    finish();
  },

  async "check-schema"() {
    const db = await connect({ readOnly: true });
    await requireMarker(db);
    const r = (await db.query(sqlFile("checks/pilot_0023_hosted.sql"))).rows[0].after_0023;
    await db.end();
    check("guard trigger on storage.objects is installed and enabled", r.storage_trigger_ok === true);
    check("every user table has its guard", Array.isArray(r.guard_missing) && r.guard_missing.length === 0, { user_tables: r.user_tables, missing: r.guard_missing });
    check("guards run as their owner (SECURITY DEFINER)", r.guards_security_definer_ok === true);
    check("the owner of 0023's functions can read storage.objects", r.owner_reads_storage_objects_ok === true, { owners: [...new Set(Object.values(r.function_owners || {}))] });
    check("only service_role calls the deletion steps", r.service_role_steps_ok === true && r.api_roles_no_execute_ok === true);
    check("the deletion tables are closed to every API role", r.tables_closed_ok === true);
    check("cloud_sync_enabled() closes writes during a deletion", r.cloud_sync_closes_ok === true);
    check("0005 Storage policies and the private bucket are in place", r.bucket_ok === true && r.storage_policies_0005.length === 3);
    note("the hook function exists (the hook stays OFF in the dashboard)", { present: r.hook_function_present });
    finish();
  },

  async race() {
    const db = await connect();
    await requireMarker(db);
    const big = fileBytes(4.5 * 1024 * 1024); // the bucket allows 5 MB: long enough for the bytes to be written after the check

    // P2.0 control: an ordinary upload lands (row, owner_id = the uploader)
    const A0 = await newUser(db, "race0");
    const s0 = await signIn(A0);
    const up0 = await upload(s0.client, A0, "plain");
    const owner0 = (await db.query("SELECT owner_id FROM storage.objects WHERE bucket_id = $1 AND name = $2", [BUCKET, `${A0.id}/plain.webp`])).rows[0]?.owner_id;
    check("P2.0 an ordinary upload lands, owner_id = the uploader", up0.ok && owner0 === A0.id, { error: up0.error });

    // P2.1 the upload passed its check, its bytes are being written, THEN the deletion starts: the final insert is refused
    {
      const A = await newUser(db, "race1");
      const s = await signIn(A);
      const key = await lockKey(db, A.id);
      const hold = await connect();
      await hold.query("BEGIN");
      await hold.query("SELECT pg_advisory_xact_lock($1::bigint)", [key]); // stands for a deletion that is about to start
      const up = upload(s.client, A, "inflight", big);
      const probeWaits = await waitWaiters(db, key, 1, 20_000); // the Storage server's permission check reached our trigger
      const beginner = await connect();
      const begin = beginner.query("SELECT public.account_deletion_begin($1) AS r", [A.id]);
      const beginQueued = await waitWaiters(db, key, 2, 10_000); // the request queues behind the check
      await hold.query("COMMIT"); // the check goes first (passes), then the request; the bytes are written meanwhile
      const begun = (await begin).rows[0].r;
      const res = await up;
      const landed = await rowExists(db, `${A.id}/inflight.webp`);
      check("P2.1 the Storage check reached the guard before the bytes (probe seen waiting)", probeWaits);
      check("P2.1 the deletion request queued behind it", beginQueued, { begin: begun?.state ?? null });
      check("P2.1 the upload finishing after the request is refused; no row", !res.ok && !landed, { upload_error: res.error });
      note("P2.1 what the client saw", { error: res.error });
      await hold.end();
      await beginner.end();
      await db.query("SELECT public.account_deletion_manifest($1)", [A.id]);
      await db.query("SELECT public.account_deletion_ready($1)", [A.id]);
      const del = await service().auth.admin.deleteUser(A.id);
      check("P2.1 the account is then deleted (no file owned)", !del.error, { error: errInfo(del.error) });
    }

    // P2.2 the final insert arrives between ready and the auth user's deletion: refused
    {
      const A = await newUser(db, "race2");
      const s = await signIn(A);
      const key = await lockKey(db, A.id);
      const hold = await connect();
      await hold.query("BEGIN");
      await hold.query("SELECT pg_advisory_xact_lock($1::bigint)", [key]);
      const up = upload(s.client, A, "late", big);
      const probeWaits = await waitWaiters(db, key, 1, 20_000);
      const beginner = await connect();
      const begin = beginner.query("SELECT public.account_deletion_begin($1)", [A.id]);
      await waitWaiters(db, key, 2, 10_000);
      await hold.query("COMMIT");
      await begin;
      // ready in an open transaction: it holds the account lock until COMMIT, so the upload's final insert waits behind it
      const readyTx = await connect();
      await readyTx.query("BEGIN");
      await readyTx.query("SELECT public.account_deletion_manifest($1)", [A.id]);
      const ready = (await readyTx.query("SELECT public.account_deletion_ready($1) AS r", [A.id])).rows[0].r;
      let settledEarly = false;
      up.then(() => (settledEarly = true));
      const finalWaits = await waitWaiters(db, key, 1, 30_000);
      await readyTx.query("COMMIT");
      const res = await up;
      const landed = await rowExists(db, `${A.id}/late.webp`);
      check("P2.2 the Storage check passed before the request", probeWaits);
      check("P2.2 the upload's final insert was positioned after ready (seen waiting)", finalWaits && !settledEarly, { ready: ready?.state ?? null });
      check("P2.2 refused; no row", !res.ok && !landed, { upload_error: res.error });
      await hold.end();
      await beginner.end();
      await readyTx.end();
      const del = await service().auth.admin.deleteUser(A.id);
      check("P2.2 the account is then deleted", !del.error, { error: errInfo(del.error) });
      // P2.4 after the deletion, with the still valid old token: refused
      const after = await upload(s.client, A, "after");
      check("P2.4 an upload with the deleted account's old token is refused; no row", !after.ok && !(await rowExists(db, `${A.id}/after.webp`)), { error: after.error });
    }

    // P2.3 uploads after the request: between the request and the list, between the list and ready
    {
      const A = await newUser(db, "race3");
      const s = await signIn(A);
      await db.query("SELECT public.account_deletion_begin($1)", [A.id]);
      const a = await upload(s.client, A, "after_begin");
      await db.query("SELECT public.account_deletion_manifest($1)", [A.id]);
      const b = await upload(s.client, A, "after_list");
      check("P2.3 uploads after the request and after the list are refused; no rows",
        !a.ok && !b.ok && !(await rowExists(db, `${A.id}/after_begin.webp`)) && !(await rowExists(db, `${A.id}/after_list.webp`)), { errors: [a.error, b.error] });
      await db.query("SELECT public.account_deletion_ready($1)", [A.id]);
      await service().auth.admin.deleteUser(A.id);
    }

    // P3 nothing reachable is left of the refused uploads (the bytes themselves: the Storage server's own cleanup, see the plan)
    for (const name of ["inflight", "late", "after", "after_begin", "after_list"]) {
      const n = Number((await db.query("SELECT count(*) n FROM storage.objects WHERE bucket_id = $1 AND name LIKE $2", [BUCKET, `%/${name}.webp`])).rows[0].n);
      check(`P3 no metadata row for the refused «${name}»`, n === 0);
    }
    await s0.client.storage.from(BUCKET).remove([`${A0.id}/plain.webp`]);
    await service().auth.admin.deleteUser(A0.id);
    await db.end();
    finish();
  },

  async "auth-after-delete"() {
    const db = await connect();
    await requireMarker(db);
    const A = await newUser(db, "authdel", { cloud: false });
    const s = await signIn(A);
    const del = await service().auth.admin.deleteUser(A.id);
    check("deleteUser of an account without files succeeds", !del.error, { error: errInfo(del.error) });
    const gu = await anon().auth.getUser(s.session.access_token);
    check("getUser with the old access token: no user, user_not_found (the app's other-device detection relies on it)",
      !gu.data.user && (gu.error?.code === "user_not_found" || /sub claim in JWT does not exist/i.test(gu.error?.message || "")), { got: errInfo(gu.error) });
    const c = anon();
    const rf = await c.auth.refreshSession({ refresh_token: s.session.refresh_token });
    check("the old refresh token no longer works", !rf.data.session, { got: errInfo(rf.error) });
    const si = await anon().auth.signInWithPassword({ email: A.email, password: A.password });
    check("signing in again is refused", !si.data.session, { got: errInfo(si.error) });
    note("the access token stays valid for the database until it expires (Auth docs); AYRA's guard: rows need auth.users (FK), files need cloud_sync", {});
    await db.end();
    finish();
  },

  async amr() {
    const { newestAuthTime, REAUTH_MAX_AGE_S } = await import("../../lib/account-deletion/handler.ts");
    const db = await connect();
    await requireMarker(db);
    const decode = (t) => JSON.parse(Buffer.from(t.split(".")[1], "base64url").toString("utf8"));
    const now = () => Math.floor(Date.now() / 1000);
    const show = (t) => (decode(t).amr || []).map((a) => ({ method: a.method, age_s: now() - a.timestamp }));
    const admin = service().auth.admin;
    const cases = [];

    const signupEmail = `${EMAIL_PREFIX}${run}-signup-${randomBytes(3).toString("hex")}@example.com`;
    const signupPw = randomBytes(18).toString("base64url");
    const gl = await admin.generateLink({ type: "signup", email: signupEmail, password: signupPw });
    if (gl.data?.user) saveUser({ id: gl.data.user.id, email: signupEmail, password: signupPw, role: "signup" });
    const vs = gl.data?.properties?.hashed_token ? await anon().auth.verifyOtp({ token_hash: gl.data.properties.hashed_token, type: "signup" }) : { error: gl.error };
    cases.push(["email/signup (confirming the sign-up link)", vs.data?.session?.access_token, vs.error, true]);

    const U = await newUser(db, "amr", { cloud: false });
    const pw = await anon().auth.signInWithPassword({ email: U.email, password: U.password });
    cases.push(["password", pw.data?.session?.access_token, pw.error, true]);

    const ml = await admin.generateLink({ type: "magiclink", email: U.email });
    const vo = ml.data?.properties?.email_otp ? await anon().auth.verifyOtp({ email: U.email, token: ml.data.properties.email_otp, type: "email" }) : { error: ml.error };
    cases.push(["e-mail code (OTP)", vo.data?.session?.access_token, vo.error, true]);

    const ml2 = await admin.generateLink({ type: "magiclink", email: U.email });
    const vm = ml2.data?.properties?.hashed_token ? await anon().auth.verifyOtp({ token_hash: ml2.data.properties.hashed_token, type: "magiclink" }) : { error: ml2.error };
    cases.push(["magic link", vm.data?.session?.access_token, vm.error, true]);

    const rl = await admin.generateLink({ type: "recovery", email: U.email });
    const vr = rl.data?.properties?.hashed_token ? await anon().auth.verifyOtp({ token_hash: rl.data.properties.hashed_token, type: "recovery" }) : { error: rl.error };
    cases.push(["recovery link (must NOT count)", vr.data?.session?.access_token, vr.error, false]);

    for (const [, token] of cases) if (token) secrets.add(token);
    for (const [name, token, error, proven] of cases) {
      if (!token) {
        check(`amr: ${name} — a session was issued`, false, { error: errInfo(error) });
        continue;
      }
      const at = newestAuthTime(token);
      note(`amr: ${name}`, { amr: show(token) });
      check(`amr: ${name} — the app ${proven ? "counts it as a fresh sign-in" : "does not count it"}`,
        proven ? at !== null && now() - at <= REAUTH_MAX_AGE_S : at === null, { authAt_age_s: at === null ? null : now() - at });
    }

    // refresh: the sign-in time the app reads must stay the sign-in's, never the refresh's
    if (pw.data?.session) {
      const before = newestAuthTime(pw.data.session.access_token);
      await new Promise((r) => setTimeout(r, 3000));
      const c = anon();
      const rf = await c.auth.refreshSession({ refresh_token: pw.data.session.refresh_token });
      const token = rf.data?.session?.access_token;
      if (token) secrets.add(token);
      if (!token) check("refresh issued a token", false, { error: errInfo(rf.error) });
      else {
        note("amr after a refresh", { amr: show(token) });
        const after = newestAuthTime(token);
        check("after a refresh the app reads the ORIGINAL sign-in time (a refresh is not a sign-in)", after !== null && Math.abs(after - before) <= 1, { moved_s: after === null ? null : after - before });
      }
    }
    await db.end();
    finish();
  },

  async delete() {
    const db = await connect();
    await requireMarker(db);
    const A = await newUser(db, "del");
    const B = await newUser(db, "keep");
    const sa = await signIn(A);
    const sb = await signIn(B);
    const na = await uploadMany(sa.client, A, 30);
    await uploadMany(sb.client, B, 5);
    // a person's own rows through the API (as the app writes them)
    const ja = await sa.client.from("journal_notes").insert({ user_id: A.id, id: "n1", data: { id: "n1", body: "pilot", createdAt: new Date().toISOString() } });
    const jb = await sb.client.from("journal_notes").insert({ user_id: B.id, id: "n1", data: { id: "n1", body: "pilot", createdAt: new Date().toISOString() } });
    check("test data: 30 files of the account to delete", na === 30, { uploaded: na });
    check("test data: a journal row of each account (through the API, as the app writes it)", !ja.error && !jb.error, { errors: [errInfo(ja.error), errInfo(jb.error)] });
    const before = await snapshot(db, B);
    const stats0 = (await db.query("SELECT metric, sum(n)::int n FROM public.account_deletion_stats GROUP BY metric")).rows;
    const calls = await deleteThroughRoute(A);
    note("route calls", { calls });
    check("the route answered «deleted» (200, state: deleted)", calls.at(-1)?.deleted === true, { last: calls.at(-1) });
    const l = await leftovers(db, A.id, A.email);
    note("leftovers of the deleted account", l);
    check("no Auth user, identity, session or refresh token; no AYRA row; no file", isGone(l));
    check("the other account is unchanged", (await snapshot(db, B)) === before);
    const statsCols = (await db.query("SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'account_deletion_stats' ORDER BY 1")).rows.map((r) => r.column_name);
    check("the technical record holds only day, metric and a number", JSON.stringify(statsCols) === JSON.stringify(["day", "metric", "n"]), { columns: statsCols });
    note("counters before / after", { before: stats0, after: (await db.query("SELECT metric, sum(n)::int n FROM public.account_deletion_stats GROUP BY metric")).rows });
    await db.end();
    finish();
  },

  async resume() {
    const { handleAccountDeletion, newestAuthTime } = await import("../../lib/account-deletion/handler.ts");
    const { createRateLimiter } = await import("../../lib/game-server/rate-limit.ts");
    const db = await connect();
    await requireMarker(db);
    const A = await newUser(db, "resume");
    const s = await signIn(A);
    await uploadMany(s.client, A, 40);
    const svc = service();
    let calls = 0;
    // the app's own handler with the real database and Storage — except that the first removal removes only half and fails
    const res = await handleAccountDeletion(new Request("http://pilot/api/account/delete", { method: "POST", body: JSON.stringify({ confirm: "DELETE", password: A.password }) }), {
      enabled: true,
      getUser: async () => ({ id: A.id, email: A.email, authAt: newestAuthTime(s.session.access_token) }),
      verifyPassword: async (email, password) => !(await anon().auth.signInWithPassword({ email, password })).error,
      rpc: async (fn, args) => {
        const { data, error } = await svc.rpc(fn, args);
        return { data, error: error ? { code: error.code, message: error.message } : null };
      },
      removeFiles: async (bucket, names) => {
        calls += 1;
        if (calls === 1) {
          const half = names.slice(0, Math.ceil(names.length / 2));
          const { data } = await svc.storage.from(bucket).remove(half);
          return { removed: (data || []).map((o) => o.name), error: "storage_error" };
        }
        const { data, error } = await svc.storage.from(bucket).remove(names);
        return { removed: (data || []).map((o) => o.name), error: error ? "storage_error" : null };
      },
      signOutOthers: async () => ({ error: null }),
      deleteAuthUser: async () => ({ error: "not in this half" }),
      limiter: createRateLimiter({ limit: 100, windowMs: 60_000 }),
      now: () => Date.now(),
    });
    const leftHalf = await filesOf(db, A.id);
    check("a failure half-way answers «retry» and keeps the request", isRetryResponse(res.status, res.body) && !isDeletedResponse(res.status, res.body), { status: res.status, body: res.body });
    check("about half of the files are still there; the account too", leftHalf > 0 && leftHalf < 40 && (await leftovers(db, A.id, A.email)).auth_users === 1, { files_left: leftHalf });
    const st = (await db.query("SELECT state, attempts, last_error FROM public.account_deletions WHERE user_id = $1", [A.id])).rows[0];
    note("the request after the failure", st || {});
    const cont = await deleteThroughRoute(A);
    note("continued through the route", { calls: cont });
    const l = await leftovers(db, A.id, A.email);
    check("continued through the route: deleted, nothing left", cont.at(-1)?.deleted === true && isGone(l), l);
    await db.end();
    finish();
  },

  async volume() {
    const n = Number(opt("--files", "3000"));
    const db = await connect();
    await requireMarker(db);
    const A = await newUser(db, "volume");
    const s = await signIn(A);
    const t0 = Date.now();
    const up = await uploadMany(s.client, A, n);
    note("uploaded", { files: up, ms: Date.now() - t0 });
    const calls = await deleteThroughRoute(A, { maxCalls: 20 });
    const total = calls.reduce((x, c) => x + c.ms, 0);
    note("route calls", { calls, total_ms: total });
    const l = await leftovers(db, A.id, A.email);
    check(`${up} files deleted, nothing left`, calls.at(-1)?.deleted === true && isGone(l), l);
    check("no single call came near the Vercel limit (Hobby 300 s; alarm at 240 s)", calls.every((c) => c.ms < 240_000), { longest_ms: Math.max(...calls.map((c) => c.ms)) });
    await db.end();
    finish();
  },

  async leftovers() {
    const id = opt("--user");
    if (!/^[0-9a-f-]{36}$/i.test(id || "")) {
      console.error("REFUSED --user <uuid> is required");
      process.exit(2);
    }
    const db = await connect({ readOnly: true });
    await requireMarker(db);
    const l = await leftovers(db, id, opt("--email"));
    await db.end();
    note("leftovers", l);
    check("nothing of the account is left in Auth, AYRA tables or Storage", isGone(l));
    finish();
  },

  async cleanup() {
    const db = await connect();
    await requireMarker(db);
    // the WHOLE list first (every row of auth.users, soft-deleted ones included); one account that is not a pilot test
    // account created by this tool — and nothing at all is deleted
    const users = (await db.query("SELECT id::text AS id, email FROM auth.users")).rows;
    const plan = planCleanup(users, readRegistry());
    if (!plan.ok) {
      check("every account in the project is a pilot test account created by this tool — nothing deleted", false, { foreign_accounts: plan.foreign.length });
      await db.end();
      return finish();
    }
    check("every account in the project is a pilot test account created by this tool", true, { accounts: plan.targets.length });
    const svc = service();
    for (const u of users) {
      // only this account's own files (its folder or its uploads); its rows go with the auth user (foreign keys)
      for (;;) {
        const names = (await db.query("SELECT name FROM storage.objects WHERE bucket_id = $1 AND (owner_id = $2 OR (storage.foldername(name))[1] = $2) LIMIT 1000", [BUCKET, u.id])).rows.map((r) => r.name);
        if (!names.length) break;
        const { error } = await svc.storage.from(BUCKET).remove(names);
        if (error) break;
      }
      const del = await svc.auth.admin.deleteUser(u.id);
      check(`removed test account ${u.id.slice(0, 8)}`, !del.error, { error: errInfo(del.error) });
    }
    await db.end();
    finish();
  },

  async rollback() {
    const to = opt("--to", "0001");
    const db = await connect();
    await requireMarker(db);
    const applied = (await db.query("SELECT name FROM public.ayra_pilot_migrations ORDER BY name DESC")).rows.map((r) => r.name);
    for (const f of applied) {
      if (f.slice(0, 4) < to) break;
      const down = f.replace(/\.sql$/, ".down.sql");
      if (!existsSync(path.join("supabase/migrations", down))) {
        check(`rollback ${f}`, false, { error: "no .down file" });
        break;
      }
      try {
        await db.query(readFileSync(path.join("supabase/migrations", down), "utf8"));
        await db.query("DELETE FROM public.ayra_pilot_migrations WHERE name = $1", [f]);
        check(`rolled back ${f}`, true);
      } catch (e) {
        await db.query("ROLLBACK").catch(() => undefined);
        check(`rolled back ${f}`, false, { error: { code: e.code ?? null, message: String(e.message).slice(0, 200) } });
        break;
      }
    }
    await db.end();
    finish();
  },

  async "forget-secrets"() {
    // local only (nothing in the pilot project changes): overwrites and removes the throwaway passwords and the pilot build
    const removed = forgetSecrets();
    check("the pilot's local secrets are removed", true, { files: removed.length });
    finish();
  },

  async serve() {
    // Next loads .env* files by itself: none may be in this folder (the pilot's own .env.pilot.local is never read by Next)
    const loaded = nextEnvFiles(readdirSync("."));
    if (loaded.length) {
      console.error(`REFUSED ${loaded.join(", ")} in this folder: Next would load it into the pilot app (use a clean worktree)`);
      process.exit(2);
    }
    const port = opt("--port", "3200");
    if (!/^[0-9]{4,5}$/.test(port)) {
      console.error("REFUSED --port must be a number");
      process.exit(2);
    }
    // the app's whole environment: system variables from an allowlist and the pilot's own — nothing else of this shell
    const appEnv = buildServeEnv(process.env, T);
    const problems = serveEnvProblems(appEnv, T, env.AYRA_PRODUCTION_PROJECT_REF);
    if (problems.length) {
      for (const pr of problems) console.error(`REFUSED ${redact(pr, secrets)}`);
      process.exit(2);
    }
    const runCmd = (args) => new Promise((res, rej) => {
      const p = spawn(process.platform === "win32" ? "npx.cmd" : "npx", args, { env: appEnv, stdio: "inherit", shell: process.platform === "win32" });
      p.on("exit", (c) => (c === 0 ? res() : rej(new Error(`${args.join(" ")} exited ${c}`))));
    });
    await runCmd(["next", "build"]);
    console.log(`pilot app on http://localhost:${port} (deletion flag on in this process only; Ctrl+C stops it)`);
    await runCmd(["next", "start", "-p", port]);
  },
};

steps[step]().catch((e) => {
  console.error(`ERROR ${String(e?.message ?? e).slice(0, 300)}`);
  try {
    results.push({ name: "error", pass: false, message: String(e?.message ?? e).slice(0, 300) });
    writeFileSync(path.join(outDir, `${step}.json`), JSON.stringify({ step, run, results }, null, 2));
  } catch {
    // nothing more to save
  }
  process.exit(1);
});
