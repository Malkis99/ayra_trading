import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { handleAccountDeletion, type DeletionDeps } from "@/lib/account-deletion/handler";
import { createRateLimiter } from "@/lib/game-server/rate-limit";
import {
  PILOT_EMAIL_RE, buildServeEnv, forgetSecrets, isDeletedResponse, isRetryResponse, keyFormatProblem, keyKind, nextEnvFiles,
  planCleanup, readRegistry, redact, secureDir, serveEnvProblems, verifyKeysOwnership, writeSecretFile,
  // @ts-expect-error a plain .mjs module (the pilot runs with node directly)
} from "./lib.mjs";

// Q4.7 hosted pilot — the tool's decisions (review of #228: A–E)
const PILOT = "pilotpilotpilotpilot";
const PROD = "prodprodprodprodprod";
const URL = `https://${PILOT}.supabase.co`;
const jwt = (ref: string | null, role: string) =>
  `${Buffer.from('{"alg":"HS256"}').toString("base64url")}.${Buffer.from(JSON.stringify({ ...(ref ? { ref } : {}), role })).toString("base64url")}.sig`;
const ANON = jwt(PILOT, "anon");
const SERVICE = jwt(PILOT, "service_role");

function deps(over: Partial<DeletionDeps> = {}): DeletionDeps {
  return {
    enabled: true,
    getUser: async () => ({ id: "00000000-0000-0000-0000-0000000000a1", email: "a@example.com", authAt: null }),
    verifyPassword: async () => true,
    rpc: async (fn) => {
      if (fn === "account_deletion_manifest") return { data: { pending: [{ bucket: "journal-attachments", name: "x/1.webp" }], pendingCount: 1 }, error: null };
      if (fn === "account_deletion_status") return { data: { state: "files_listed", listed: 1, gone: 0 }, error: null };
      return { data: { state: "requested" }, error: null };
    },
    removeFiles: async (_b, names) => ({ removed: names, error: null }),
    signOutOthers: async () => ({ error: null }),
    deleteAuthUser: async () => ({ error: null }),
    limiter: createRateLimiter({ limit: 100, windowMs: 60_000 }),
    now: () => Date.now(),
    ...over,
  };
}
const post = () => new Request("http://pilot/api/account/delete", { method: "POST", body: JSON.stringify({ confirm: "DELETE", password: "x" }) });

describe("A. the deletion route's success, exactly as the real handler answers it", () => {
  it("the handler's own success is recognised; its «retry» is not taken for success", async () => {
    let listed = 1;
    const ok = await handleAccountDeletion(post(), deps({
      rpc: async (fn) => {
        if (fn === "account_deletion_manifest") return { data: { pending: listed ? [{ bucket: "journal-attachments", name: "x/1.webp" }] : [], pendingCount: listed-- > 0 ? 1 : 0 }, error: null };
        return { data: { state: "files_deleted" }, error: null };
      },
    }));
    expect(ok.status).toBe(200);
    expect(isDeletedResponse(ok.status, ok.body)).toBe(true);
    expect(isRetryResponse(ok.status, ok.body)).toBe(false);

    const failed = await handleAccountDeletion(post(), deps({ removeFiles: async () => ({ removed: [], error: "storage_error" }) }));
    expect(failed.status).toBe(503);
    expect(isRetryResponse(failed.status, failed.body)).toBe(true);
    expect(isDeletedResponse(failed.status, failed.body)).toBe(false);
  });

  it("nothing else counts: the old wrong contract, a state of an unfinished deletion, a wrong status", () => {
    expect(isDeletedResponse(200, { deleted: true })).toBe(false);
    expect(isDeletedResponse(200, { state: "files_deleted" })).toBe(false);
    expect(isDeletedResponse(503, { state: "deleted" })).toBe(false);
    expect(isDeletedResponse(200, null)).toBe(false);
    expect(isDeletedResponse(200, "deleted")).toBe(false);
    expect(isRetryResponse(503, { retry: "true" })).toBe(false);
  });
});

describe("B. the keys belong to the pilot (fail closed)", () => {
  type Answer = number | "network";
  const fakeFetch = (answers: { settings: Answer; anonAdmin: Answer; serviceAdmin: Answer }) => {
    const seen: Array<{ url: string; headers: Record<string, string> }> = [];
    const f = async (url: string, init: { headers: Record<string, string> }) => {
      seen.push({ url, headers: init.headers });
      const isAdmin = url.includes("/auth/v1/admin/users");
      const a = !isAdmin ? answers.settings : init.headers.apikey === ANON || init.headers.apikey.startsWith("sb_publishable") ? answers.anonAdmin : answers.serviceAdmin;
      if (a === "network") throw new Error("ECONNRESET");
      return { status: a };
    };
    return { f, seen };
  };

  it("both keys accepted by the pilot's own gateway, the anon key without admin power: proven", async () => {
    const { f, seen } = fakeFetch({ settings: 200, anonAdmin: 401, serviceAdmin: 200 });
    expect(await verifyKeysOwnership({ url: URL, anonKey: ANON, serviceKey: SERVICE }, f)).toEqual([]);
    expect(seen.every((s) => s.url.startsWith(URL + "/auth/v1/"))).toBe(true);
  });

  it("a key of another project, an anon key with admin power, a network error: refused", async () => {
    for (const answers of [
      { settings: 401, anonAdmin: 401, serviceAdmin: 200 },
      { settings: 200, anonAdmin: 401, serviceAdmin: 401 },
      { settings: 200, anonAdmin: 200, serviceAdmin: 200 },
      { settings: "network" as const, anonAdmin: 401, serviceAdmin: 200 },
      { settings: 200, anonAdmin: 401, serviceAdmin: "network" as const },
      { settings: 301, anonAdmin: 401, serviceAdmin: 200 },
    ]) {
      const problems = await verifyKeysOwnership({ url: URL, anonKey: ANON, serviceKey: SERVICE }, fakeFetch(answers).f);
      expect(problems.length).toBeGreaterThan(0);
      expect(problems.join(" ")).not.toContain(ANON);
      expect(problems.join(" ")).not.toContain(SERVICE);
    }
  });

  it("the new key formats go in the apikey header only (they are not JWTs)", async () => {
    const pub = "sb_publishable_abcdefghijklmnop";
    const sec = "sb_secret_abcdefghijklmnopqrst";
    const { f, seen } = fakeFetch({ settings: 200, anonAdmin: 401, serviceAdmin: 200 });
    expect(await verifyKeysOwnership({ url: URL, anonKey: pub, serviceKey: sec }, f)).toEqual([]);
    expect(seen.every((s) => !("Authorization" in s.headers))).toBe(true);
  });

  it("offline: only the expected kinds; a JWT needs exactly this ref and role; no ref proves nothing", () => {
    expect(keyFormatProblem("A", ANON, "anon", PILOT)).toBeNull();
    expect(keyFormatProblem("S", SERVICE, "service", PILOT)).toBeNull();
    expect(keyFormatProblem("A", "sb_publishable_abcdefghijklmnop", "anon", PILOT)).toBeNull();
    expect(keyFormatProblem("S", "sb_secret_abcdefghijklmnopqrst", "service", PILOT)).toBeNull();
    expect(keyFormatProblem("A", jwt(null, "anon"), "anon", PILOT)).toMatch(/without a project ref/);
    expect(keyFormatProblem("A", jwt(PROD, "anon"), "anon", PILOT)).toMatch(/another project/);
    expect(keyFormatProblem("A", SERVICE, "anon", PILOT)).toMatch(/wrong role/);
    expect(keyFormatProblem("S", ANON, "service", PILOT)).toMatch(/wrong role/);
    expect(keyFormatProblem("A", "sb_secret_abcdefghijklmnopqrst", "anon", PILOT)).toMatch(/not a supported key/);
    expect(keyFormatProblem("S", "sb_publishable_abcdefghijklmnop", "service", PILOT)).toMatch(/not a supported key/);
    expect(keyFormatProblem("S", "some-random-token", "service", PILOT)).toMatch(/not a supported key/);
    expect(keyKind("a.b.c").format).toBe("unknown");
  });
});

describe("C. the pilot app's environment is an allowlist", () => {
  const T = { url: URL, anonKey: ANON, serviceKey: SERVICE };
  const poisoned = {
    PATH: "/usr/bin", SystemRoot: "C:\\Windows", HOME: "/home/x",
    NEXT_PUBLIC_SUPABASE_URL: `https://${PROD}.supabase.co`, SUPABASE_SERVICE_ROLE_KEY: jwt(PROD, "service_role"),
    NEXT_PUBLIC_AYRA_SERVER_ECONOMY: "1", NEXT_PUBLIC_AYRA_E2E_AUTH_MOCK: "1", VERCEL_ENV: "production", VERCEL_TOKEN: "t",
    NODE_OPTIONS: "--require ./evil.js", AYRA_MIGRATION_DB_URL: `postgresql://postgres@db.${PROD}.supabase.co/postgres`,
    DATABASE_URL: "postgres://prod", npm_config_userconfig: "/x",
  };

  it("nothing of the shell but the system allowlist; the pilot's values set explicitly; flags as required", () => {
    const out = buildServeEnv(poisoned, T);
    expect(out.PATH).toBe("/usr/bin");
    expect(out.NEXT_PUBLIC_SUPABASE_URL).toBe(URL);
    expect(out.SUPABASE_SERVICE_ROLE_KEY).toBe(SERVICE);
    expect(out.NEXT_PUBLIC_AYRA_ACCOUNT_DELETION).toBe("1");
    expect(out.NEXT_PUBLIC_AYRA_SERVER_ECONOMY).toBe("0");
    for (const k of ["VERCEL_ENV", "VERCEL_TOKEN", "NODE_OPTIONS", "AYRA_MIGRATION_DB_URL", "DATABASE_URL", "NEXT_PUBLIC_AYRA_E2E_AUTH_MOCK", "npm_config_userconfig"]) {
      expect(out).not.toHaveProperty(k);
    }
    expect(JSON.stringify(out)).not.toContain(PROD);
    expect(serveEnvProblems(out, T, PROD)).toEqual([]);
  });

  it("a Production ref or an extra variable in the result is refused", () => {
    const out = buildServeEnv({ PATH: `/opt/${PROD}/bin` }, T);
    expect(serveEnvProblems(out, T, PROD).join(" ")).toMatch(/PATH mentions the Production ref/);
    expect(serveEnvProblems({ ...buildServeEnv({}, T), VERCEL_ENV: "production" }, T, PROD).join(" ")).toMatch(/VERCEL_ENV is not allowed/);
    expect(serveEnvProblems({ ...buildServeEnv({}, T), NEXT_PUBLIC_SUPABASE_URL: "https://x.supabase.co" }, T, PROD).join(" ")).toMatch(/not talk to the pilot/);
  });

  it("every .env* file Next would load is found (the template and the pilot's own file are not loaded by Next)", () => {
    expect(nextEnvFiles([".env", ".env.local", ".env.production", ".env.development.local", ".env.example", ".env.pilot.local", "package.json"]))
      .toEqual([".env", ".env.local", ".env.production", ".env.development.local"]);
  });
});

describe("D. the throwaway accounts' passwords", () => {
  const dirs: string[] = [];
  afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

  it("kept in a folder only this user can read, files readable by the owner only, removed by forget-secrets", () => {
    const root = mkdtempSync(path.join(tmpdir(), "ayra-pilot-"));
    dirs.push(root);
    const dir = path.join(root, ".pilot-secrets");
    expect(secureDir(dir)).toBe(true);
    const f = path.join(dir, "run.accounts.secret.json");
    writeSecretFile(f, '[{"id":"x","password":"p4ssw0rd-long"}]');
    if (process.platform !== "win32") {
      expect(statSync(dir).mode & 0o077).toBe(0);
      expect(statSync(f).mode & 0o077).toBe(0);
    }
    const build = path.join(root, ".next-pilot");
    mkdirSync(build);
    expect(forgetSecrets(dir, build)).toEqual(["run.accounts.secret.json"]);
    expect(existsSync(dir)).toBe(false);
    expect(existsSync(build)).toBe(false);
  });

  it("never in git: the secrets folder, the reports and the settings file are ignored", () => {
    for (const p of [".pilot-secrets/run.accounts.secret.json", "pilot-runs/20261124120000/race.json", ".env.pilot.local", ".next-pilot/x"]) {
      expect(spawnSync("git", ["check-ignore", "-q", p]).status, p).toBe(0);
    }
  });

  it("no known secret survives in a report line", () => {
    const secrets = new Set([ANON, "p4ssw0rd-long", "short"]);
    const line = redact(`PASS x {"k":"${ANON}","p":"p4ssw0rd-long"}`, secrets);
    expect(line).not.toContain(ANON);
    expect(line).not.toContain("p4ssw0rd-long");
    expect(readFileSync(path.join("scripts", "hosted-pilot", "pilot.mjs"), "utf8")).not.toMatch(/console\.(log|error)\([^)]*password/);
  });
});

describe("E. cleanup: the whole list first, all or nothing", () => {
  const a = { id: "00000000-0000-0000-0000-0000000000a1", email: "ayra-pilot-20261124120000-del-0a1b2c@example.com" };
  const b = { id: "00000000-0000-0000-0000-0000000000b2", email: "ayra-pilot-20261124120000-keep-3d4e5f@example.com" };

  it("only pilot accounts this tool created: all of them are the targets", () => {
    expect(planCleanup([a, b], [a.id, b.id])).toEqual({ ok: true, foreign: [], targets: [a.id, b.id] });
    expect(planCleanup([], [])).toEqual({ ok: true, foreign: [], targets: [] });
  });

  it("one account that is not a pilot test account: refused, and NOTHING is a target", () => {
    for (const other of [
      { id: "real-1", email: "person@gmail.com" },
      { id: "real-2", email: null },
      { id: "real-3", email: "ayra-pilot-20261124120000-del-0a1b2c@example.com.evil.com" },
      { id: "real-4", email: "AYRA-PILOT-20261124120000-del-0a1b2c@example.com" },
      { id: "real-5", email: "x-ayra-pilot-20261124120000-del-0a1b2c@example.com" },
    ]) {
      const plan = planCleanup([a, other, b], [a.id, b.id, other.id]);
      expect(plan.ok).toBe(false);
      expect(plan.targets).toEqual([]);
      expect(plan.foreign).toEqual([other.id]);
    }
  });

  it("a pilot-looking account this tool did not create (not in its registry): refused too", () => {
    const plan = planCleanup([a, b], [a.id]);
    expect(plan.ok).toBe(false);
    expect(plan.targets).toEqual([]);
    expect(plan.foreign).toEqual([b.id]);
  });

  it("the registry is read from every run; the pattern is strict", () => {
    const root = mkdtempSync(path.join(tmpdir(), "ayra-pilot-runs-"));
    mkdirSync(path.join(root, "20261124120000"));
    writeFileSync(path.join(root, "20261124120000", "accounts.json"), JSON.stringify([{ id: a.id, email: a.email, role: "del" }]));
    expect(readRegistry(root)).toEqual([a.id]);
    rmSync(root, { recursive: true, force: true });
    expect(PILOT_EMAIL_RE.test(a.email)).toBe(true);
    expect(PILOT_EMAIL_RE.test("ayra-pilot-2026-del-0a1b2c@example.com")).toBe(false);
  });
});
