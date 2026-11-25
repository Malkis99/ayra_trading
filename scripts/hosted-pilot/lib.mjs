// AYRA Trading — Q4.7 hosted pilot: the parts of the runner that decide something, kept pure and tested (lib.test.ts).
import { mkdirSync, chmodSync, writeFileSync, existsSync, readFileSync, statSync, rmSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";

// ------------------------------------------------------------------ A. what the deletion route answers
/** Success is exactly what lib/account-deletion/handler.ts answers: 200 with { state: "deleted" }. Nothing else counts. */
export function isDeletedResponse(status, body) {
  return status === 200 && !!body && typeof body === "object" && body.state === "deleted";
}
/** «Continue»: 503 with { retry: true } (the request is kept, what is left is listed). */
export function isRetryResponse(status, body) {
  return status === 503 && !!body && typeof body === "object" && body.retry === true;
}

// ------------------------------------------------------------------ B. the keys belong to the pilot (fail closed)
/** The format of an API key, without revealing it. */
export function keyKind(key) {
  const k = String(key || "");
  if (/^sb_publishable_[A-Za-z0-9_-]{10,}$/.test(k)) return { format: "publishable" };
  if (/^sb_secret_[A-Za-z0-9_-]{10,}$/.test(k)) return { format: "secret" };
  const parts = k.split(".");
  if (parts.length === 3) {
    try {
      const p = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
      return { format: "jwt", ref: typeof p.ref === "string" ? p.ref : null, role: typeof p.role === "string" ? p.role : null };
    } catch {
      return { format: "unknown" };
    }
  }
  return { format: "unknown" };
}

/**
 * Offline rules: the anon key is a legacy JWT of role anon for exactly this ref, or a publishable key; the service key is a
 * legacy JWT of role service_role for exactly this ref, or a secret key. Anything else — another format, a JWT without
 * a ref — is refused: the absence of a ref proves nothing.
 */
export function keyFormatProblem(name, key, expected, ref) {
  const k = keyKind(key);
  if (k.format === "jwt") {
    if (k.ref !== ref) return `${name} is a JWT of another project or without a project ref`;
    if (k.role !== (expected === "anon" ? "anon" : "service_role")) return `${name} is a JWT of the wrong role`;
    return null;
  }
  if (expected === "anon" && k.format === "publishable") return null;
  if (expected === "service" && k.format === "secret") return null;
  return `${name} is not a supported key of the expected kind`;
}

const headersFor = (key) => (keyKind(key).format === "jwt" ? { apikey: key, Authorization: `Bearer ${key}` } : { apikey: key });

/**
 * Online proof, read only, against the pilot's own URL (a key of another project is refused by the pilot's gateway):
 *   anon key: GET /auth/v1/settings → 200; and it has NO admin power (GET /auth/v1/admin/users → 401/403);
 *   service key: GET /auth/v1/admin/users?per_page=1 → 200.
 * Any other answer or a network error is a refusal. Returns a list of problems (empty = proven); never a key.
 */
export async function verifyKeysOwnership({ url, anonKey, serviceKey }, fetchImpl = fetch) {
  const problems = [];
  const get = async (p, key) => {
    try {
      const r = await fetchImpl(`${url}${p}`, { method: "GET", headers: headersFor(key), redirect: "error" });
      return r.status;
    } catch {
      return -1;
    }
  };
  const settings = await get("/auth/v1/settings", anonKey);
  if (settings !== 200) problems.push(`the anon key is not accepted by the pilot project (status ${settings})`);
  const anonAdmin = await get("/auth/v1/admin/users?page=1&per_page=1", anonKey);
  if (anonAdmin !== 401 && anonAdmin !== 403) problems.push(`the anon key is not refused admin access (status ${anonAdmin})`);
  const admin = await get("/auth/v1/admin/users?page=1&per_page=1", serviceKey);
  if (admin !== 200) problems.push(`the service key is not accepted by the pilot project (status ${admin})`);
  return problems;
}

// ------------------------------------------------------------------ C. the pilot app's environment (an allowlist)
/** What the OS and Node need to run `npx next …`; nothing of the app, Vercel or Supabase is ever taken from the shell. */
export const SYSTEM_ENV_ALLOWLIST = [
  "PATH", "Path", "PATHEXT", "SystemRoot", "SYSTEMROOT", "windir", "WINDIR", "ComSpec", "COMSPEC", "SystemDrive",
  "TEMP", "TMP", "TMPDIR", "HOME", "USERPROFILE", "HOMEDRIVE", "HOMEPATH", "APPDATA", "LOCALAPPDATA", "ProgramData",
  "ProgramFiles", "ProgramFiles(x86)", "CommonProgramFiles", "NUMBER_OF_PROCESSORS", "PROCESSOR_ARCHITECTURE", "OS",
  "LANG", "LC_ALL", "TERM", "USER", "USERNAME", "SHELL",
];
/** The pilot app's whole environment: the allowlisted system variables and the pilot's own, set explicitly. */
export function buildServeEnv(systemEnv, T) {
  const out = {};
  for (const k of SYSTEM_ENV_ALLOWLIST) if (typeof systemEnv[k] === "string") out[k] = systemEnv[k];
  Object.assign(out, {
    NODE_ENV: "production",
    NEXT_TELEMETRY_DISABLED: "1",
    AYRA_NEXT_DIST_DIR: ".next-pilot",
    NEXT_PUBLIC_SUPABASE_URL: T.url,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: T.anonKey,
    SUPABASE_SERVICE_ROLE_KEY: T.serviceKey,
    NEXT_PUBLIC_AYRA_ACCOUNT_DELETION: "1", // only in this local process
    NEXT_PUBLIC_AYRA_SERVER_ECONOMY: "0",
    NEXT_PUBLIC_AYRA_MISSION_SHADOW: "0",
  });
  return out;
}
/** Refusals for an environment that could carry anything of Production. */
export function serveEnvProblems(envOut, T, prodRef) {
  const problems = [];
  for (const [k, v] of Object.entries(envOut)) {
    if (String(v).includes(prodRef)) problems.push(`${k} mentions the Production ref`);
  }
  if (envOut.NEXT_PUBLIC_SUPABASE_URL !== T.url) problems.push("the app would not talk to the pilot");
  const allowed = new Set([...SYSTEM_ENV_ALLOWLIST, "NODE_ENV", "NEXT_TELEMETRY_DISABLED", "AYRA_NEXT_DIST_DIR", "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY", "NEXT_PUBLIC_AYRA_ACCOUNT_DELETION", "NEXT_PUBLIC_AYRA_SERVER_ECONOMY", "NEXT_PUBLIC_AYRA_MISSION_SHADOW"]);
  for (const k of Object.keys(envOut)) if (!allowed.has(k)) problems.push(`${k} is not allowed in the pilot app`);
  return problems;
}
/** Files Next.js would load by itself (any .env* except the template and the pilot's own file, which Next never reads). */
export function nextEnvFiles(names) {
  return names.filter((n) => /^\.env/.test(n) && n !== ".env.example" && n !== ".env.pilot.local");
}

// ------------------------------------------------------------------ D. the throwaway accounts' passwords
export const SECRETS_DIR = ".pilot-secrets";
/** A directory only the current user can read: mode 700 (POSIX), or an ACL with inheritance removed (Windows). */
export function secureDir(dir) {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  if (process.platform === "win32") {
    const user = process.env.USERNAME;
    if (!user) return false;
    const r = spawnSync("icacls", [dir, "/inheritance:r", "/grant:r", `${user}:(OI)(CI)F`], { encoding: "utf8", windowsHide: true });
    return r.status === 0;
  }
  chmodSync(dir, 0o700);
  return (statSync(dir).mode & 0o077) === 0;
}
export function writeSecretFile(file, text) {
  writeFileSync(file, text, { mode: 0o600 });
  if (process.platform !== "win32") chmodSync(file, 0o600);
}
/** Overwrites, then removes every secret file of the pilot; removes the local pilot build. Returns what was removed. */
export function forgetSecrets(dir = SECRETS_DIR, build = ".next-pilot") {
  const removed = [];
  if (existsSync(dir)) {
    for (const f of readdirSync(dir)) {
      const p = path.join(dir, f);
      try {
        writeFileSync(p, Buffer.alloc(statSync(p).size));
      } catch {
        // removed below either way
      }
      removed.push(f);
    }
    rmSync(dir, { recursive: true, force: true });
  }
  if (existsSync(build)) rmSync(build, { recursive: true, force: true });
  return removed;
}
/** Replaces every known secret in a text (reports, console lines). */
export function redact(text, secrets) {
  let s = String(text);
  for (const v of secrets) if (v && v.length >= 6) s = s.split(v).join("[redacted]");
  return s;
}

// ------------------------------------------------------------------ server messages: NOTICE / WARNING / INFO
const NOTICE_TEXT_MAX = 300;
/**
 * What a server message may put into a report: severity, SQLSTATE, message and hint — redacted, then cut short. Never its
 * `detail`, `where` or `internalQuery` (they can quote row values or whole statements).
 */
export function formatNotice(msg, secrets, context = null) {
  const cut = (v) => (v == null ? null : redact(String(v), secrets).slice(0, NOTICE_TEXT_MAX));
  const m = msg && typeof msg === "object" ? msg : { message: msg };
  return {
    severity: String(m.severity || "NOTICE").toUpperCase(),
    code: typeof m.code === "string" ? m.code : null,
    message: cut(m.message),
    hint: cut(m.hint),
    context: context == null ? null : String(context),
  };
}
/** Collects every server message of a pg client into `sink`; `getContext` names what ran (e.g. the migration file). */
export function attachNoticeLog(client, sink, secrets, getContext = () => null) {
  client.on("notice", (msg) => sink.push(formatNotice(msg, secrets, getContext())));
  return client;
}
/** { NOTICE: n, WARNING: n, … } */
export function noticeCounts(notices) {
  const out = {};
  for (const n of notices) out[n.severity] = (out[n.severity] || 0) + 1;
  return out;
}

// ------------------------------------------------------------------ E. cleanup: all or nothing
export const PILOT_EMAIL_RE = /^ayra-pilot-[0-9]{14}-[a-z0-9]{1,16}-[0-9a-f]{6}@example\.com$/;
/**
 * The whole user list is checked before anything is deleted: every account must have a pilot e-mail AND be one this
 * tool created (its registry). One account that is not — and nothing at all is deleted.
 */
export function planCleanup(users, registryIds) {
  const known = new Set(registryIds);
  const foreign = users.filter((u) => !(typeof u.email === "string" && PILOT_EMAIL_RE.test(u.email) && known.has(u.id))).map((u) => u.id);
  return foreign.length ? { ok: false, foreign, targets: [] } : { ok: true, foreign: [], targets: users.map((u) => u.id) };
}
/** Every account id this tool created (pilot-runs/<run>/accounts.json: ids and e-mails only). */
export function readRegistry(root = "pilot-runs") {
  const ids = [];
  if (!existsSync(root)) return ids;
  for (const run of readdirSync(root)) {
    const f = path.join(root, run, "accounts.json");
    if (existsSync(f)) for (const a of JSON.parse(readFileSync(f, "utf8"))) ids.push(a.id);
  }
  return ids;
}
