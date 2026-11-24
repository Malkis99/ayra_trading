// AYRA Trading — Q4.7 hosted Supabase pilot (docs/q4-7-hosted-pilot-plan.md): which project the pilot talks to.
//
// The pilot runs ONLY against a separate, disposable Supabase project. Everything here exists to make a wrong target
// impossible to reach by mistake:
//   - the settings come from `.env.pilot.local` (ignored by git: `.env*`), never from the app's `.env.local`;
//   - the project ref is written three times and must agree: in the file, in the URL / database address, and on the command
//     line (`--target <ref>`); the Production ref is written too and must differ from all of them;
//   - a key in the JWT format must carry the pilot's ref;
//   - nothing secret is ever printed (only `set` / `missing`).
import { readFileSync, existsSync } from "node:fs";
import { keyFormatProblem } from "./lib.mjs";

export const ENV_FILE = ".env.pilot.local";
const REF_RE = /^[a-z0-9]{20}$/;

export class PilotTargetError extends Error {}

/** KEY=VALUE lines (# comments, optional quotes); nothing is printed. */
export function parseEnvFile(text) {
  const out = {};
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const i = line.indexOf("=");
    if (i < 1) continue;
    let v = line.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    out[line.slice(0, i).trim()] = v;
  }
  return out;
}

export function loadPilotEnvFile(path = ENV_FILE) {
  if (!existsSync(path)) throw new PilotTargetError(`${path} not found (see docs/q4-7-hosted-pilot-plan.md, section 2)`);
  return parseEnvFile(readFileSync(path, "utf8"));
}

/** The `ref` of a legacy JWT-format key (anon / service_role), or null for another format. */
export function jwtRef(key) {
  const parts = String(key || "").split(".");
  if (parts.length !== 3) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    return typeof payload.ref === "string" ? payload.ref : null;
  } catch {
    return null;
  }
}

function dbHostsRef(dbUrl, ref) {
  let u;
  try {
    u = new URL(dbUrl);
  } catch {
    return false;
  }
  if (!/^postgres(ql)?:$/.test(u.protocol)) return false;
  // direct: db.<ref>.supabase.co ; pooler: user «postgres.<ref>» at *.pooler.supabase.com
  return u.hostname === `db.${ref}.supabase.co` || (u.hostname.endsWith(".pooler.supabase.com") && decodeURIComponent(u.username).endsWith(`.${ref}`));
}

/**
 * Checks the settings against the command line. Returns the resolved target; throws PilotTargetError with a message that
 * names the failed rule and never a value.
 */
export function resolvePilotTarget(env, argv) {
  const need = (k) => {
    const v = String(env[k] ?? "").trim();
    if (!v) throw new PilotTargetError(`${k} is missing in ${ENV_FILE}`);
    return v;
  };
  const ref = need("AYRA_PILOT_PROJECT_REF");
  const prodRef = need("AYRA_PRODUCTION_PROJECT_REF");
  const url = need("AYRA_PILOT_SUPABASE_URL").replace(/\/+$/, "");
  const anonKey = need("AYRA_PILOT_ANON_KEY");
  const serviceKey = need("AYRA_PILOT_SERVICE_ROLE_KEY");
  const dbUrl = need("AYRA_PILOT_DB_URL");
  const dbCaFile = need("AYRA_PILOT_DB_CA_FILE");
  if (!existsSync(dbCaFile)) throw new PilotTargetError("AYRA_PILOT_DB_CA_FILE does not exist (the project's SSL certificate, see the plan)");

  if (!REF_RE.test(ref)) throw new PilotTargetError("AYRA_PILOT_PROJECT_REF is not a project ref (20 lowercase letters/digits)");
  if (!REF_RE.test(prodRef)) throw new PilotTargetError("AYRA_PRODUCTION_PROJECT_REF is not a project ref");
  if (ref === prodRef) throw new PilotTargetError("the pilot project is the Production project — refused");
  if (url !== `https://${ref}.supabase.co`) throw new PilotTargetError("AYRA_PILOT_SUPABASE_URL is not https://<AYRA_PILOT_PROJECT_REF>.supabase.co");
  if (!dbHostsRef(dbUrl, ref)) throw new PilotTargetError("AYRA_PILOT_DB_URL does not point at the pilot project (db.<ref>.supabase.co or pooler user postgres.<ref>)");
  // the transaction pooler (6543) keeps no session: read-only mode and the lock-ordered steps need a session connection
  if (new URL(dbUrl).port === "6543") throw new PilotTargetError("AYRA_PILOT_DB_URL uses the transaction pooler (6543): use the session pooler (5432) or the direct connection");
  for (const [name, v] of [["AYRA_PILOT_SUPABASE_URL", url], ["AYRA_PILOT_DB_URL", dbUrl], ["AYRA_PILOT_ANON_KEY", anonKey], ["AYRA_PILOT_SERVICE_ROLE_KEY", serviceKey]]) {
    if (v.includes(prodRef)) throw new PilotTargetError(`${name} mentions the Production ref — refused`);
  }
  // fail closed: only the supported formats of the expected kind; a JWT must carry exactly this ref and role (the online
  // proof that the pilot's own gateway accepts them follows in every step: lib.mjs verifyKeysOwnership)
  for (const [name, k, kind] of [["AYRA_PILOT_ANON_KEY", anonKey, "anon"], ["AYRA_PILOT_SERVICE_ROLE_KEY", serviceKey, "service"]]) {
    const problem = keyFormatProblem(name, k, kind, ref);
    if (problem) throw new PilotTargetError(`${problem} — refused`);
  }
  if (anonKey === serviceKey) throw new PilotTargetError("the anon key and the service key are the same — refused");

  const arg = (flag) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const target = arg("--target");
  if (target !== ref) throw new PilotTargetError("--target <ref> must be given and equal AYRA_PILOT_PROJECT_REF");
  const confirmed = arg("--confirm") === ref;
  return { ref, url, anonKey, serviceKey, dbUrl, dbCaFile, confirmed };
}

/** For reports: which settings are present, never their values. */
export function describeEnv(env) {
  const keys = ["AYRA_PILOT_PROJECT_REF", "AYRA_PRODUCTION_PROJECT_REF", "AYRA_PILOT_SUPABASE_URL", "AYRA_PILOT_ANON_KEY", "AYRA_PILOT_SERVICE_ROLE_KEY", "AYRA_PILOT_DB_URL", "AYRA_PILOT_DB_CA_FILE"];
  return Object.fromEntries(keys.map((k) => [k, env[k] ? "set" : "missing"]));
}
