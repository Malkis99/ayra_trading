import { describe, it, expect } from "vitest";
import { createRateLimiter } from "@/lib/game-server/rate-limit";
import { MAX_ROUNDS, REAUTH_MAX_AGE_S, handleAccountDeletion, newestAuthTime, type DeletionDeps } from "./handler";

// Q4.7-Б1: the route's logic over an in-memory stand-in of the database's steps (0023) and of Storage. The stand-in keeps
// the same rules: a file is the account's when it is in its folder AND uploaded by it; «gone» is what Storage no longer has.

const NOW = Date.UTC(2026, 10, 24, 12, 0, 0);
const A = "00000000-0000-0000-0000-0000000000aa";
const B = "00000000-0000-0000-0000-0000000000bb";

type File = { bucket: string; name: string; owner: string };
function world(files: File[], opts: { userExists?: boolean } = {}) {
  const storage = new Map(files.map((f) => [`${f.bucket}/${f.name}`, f]));
  const requests = new Map<string, { state: string; listed: Set<string>; counted: boolean; lastError: string | null }>();
  let userExists = opts.userExists ?? true;
  const calls: string[] = [];
  const owned = (u: string) => [...storage.values()].filter((f) => f.name.startsWith(`${u}/`) && f.owner === u);
  const foreign = (u: string) => [...storage.values()].some((f) => (f.name.startsWith(`${u}/`) && f.owner !== u) || (f.owner === u && !f.name.startsWith(`${u}/`)));
  const st = (u: string) => {
    const r = requests.get(u);
    return r ? { state: r.state, listed: r.listed.size, gone: [...r.listed].filter((k) => !storage.has(k)).length, lastError: r.lastError } : { state: null };
  };
  const rpc: DeletionDeps["rpc"] = async (fn, args) => {
    const u = String(args.p_user);
    calls.push(fn);
    const r = requests.get(u);
    if (fn === "account_deletion_status") return { data: st(u), error: null };
    if (fn === "account_deletion_begin") {
      if (!userExists) return { data: null, error: { message: "account_deletion_no_user" } };
      if (!r) requests.set(u, { state: "requested", listed: new Set(), counted: false, lastError: null });
      return { data: st(u), error: null };
    }
    if (fn === "account_deletion_manifest") {
      if (!r) return { data: null, error: { message: "account_deletion_not_requested" } };
      if (foreign(u)) return { data: null, error: { message: "account_deletion_foreign_object" } };
      for (const f of owned(u)) r.listed.add(`${f.bucket}/${f.name}`);
      r.state = "files_listed";
      const pending = [...r.listed].filter((k) => storage.has(k)).sort().map((k) => ({ bucket: k.split("/")[0], name: k.slice(k.indexOf("/") + 1) }));
      return { data: { ...st(u), pending: pending.slice(0, 1000), pendingCount: pending.length }, error: null };
    }
    if (fn === "account_deletion_ready") {
      if (!r) return { data: null, error: { message: "account_deletion_not_requested" } };
      if ([...storage.values()].some((f) => f.name.startsWith(`${u}/`) || f.owner === u)) return { data: null, error: { message: "account_deletion_files_left" } };
      r.state = "files_deleted";
      r.counted = true;
      return { data: st(u), error: null };
    }
    if (fn === "account_deletion_failed") {
      if (r) r.lastError = String(args.p_code);
      return { data: null, error: null };
    }
    return { data: null, error: { message: "unknown" } };
  };
  let failNext = 0;      // the Storage API fails for the next N files
  let storageDown = false;
  const deps = (over: Partial<DeletionDeps> = {}): DeletionDeps => ({
    enabled: true,
    getUser: async () => ({ id: A, email: "a@example.com", authAt: NOW / 1000 - 60 }),
    verifyPassword: async (_e, p) => p === "right-password",
    rpc,
    async removeFiles(bucket, names) {
      calls.push(`remove:${names.length}`);
      if (storageDown) return { removed: [], error: "storage_error" };
      const removed: string[] = [];
      for (const n of names) {
        if (failNext > 0) { failNext--; continue; }
        if (storage.delete(`${bucket}/${n}`)) removed.push(n);
      }
      return { removed, error: null };
    },
    signOutOthers: async () => { calls.push("signOutOthers"); return { error: null }; },
    deleteAuthUser: async (id) => { calls.push(`deleteUser:${id}`); userExists = false; requests.delete(id); return { error: null }; },
    limiter: createRateLimiter({ limit: 1000, windowMs: 60_000 }),
    now: () => NOW,
    ...over,
  });
  return {
    deps,
    storage,
    calls,
    requests,
    failFiles: (n: number) => { failNext = n; },
    setStorageDown: (v: boolean) => { storageDown = v; },
    files: (u: string) => [...storage.values()].filter((f) => f.name.startsWith(`${u}/`)).length,
  };
}
const post = (body: unknown) => new Request("http://x/api/account/delete", { method: "POST", body: JSON.stringify(body) });
const ok = { confirm: "УДАЛИТЬ" };
const filesOf = (u: string, n: number, bucket = "journal-attachments"): File[] => Array.from({ length: n }, (_, i) => ({ bucket, name: `${u}/f${i}.webp`, owner: u }));

describe("Q4.7-Б1 account deletion route", () => {
  it("off by default (404); no session (401)", async () => {
    const w = world([]);
    expect((await handleAccountDeletion(post(ok), w.deps({ enabled: false }))).status).toBe(404);
    expect((await handleAccountDeletion(post(ok), w.deps({ getUser: async () => null }))).status).toBe(401);
    expect(w.calls).toEqual([]);
  });

  it("the typed confirmation and a recent proof are required; nothing starts without them", async () => {
    const w = world(filesOf(A, 2));
    expect((await handleAccountDeletion(post({ confirm: "yes" }), w.deps())).body).toMatchObject({ error: "confirm_required" });
    const old = w.deps({ getUser: async () => ({ id: A, email: "a@example.com", authAt: NOW / 1000 - REAUTH_MAX_AGE_S - 1 }) });
    expect((await handleAccountDeletion(post(ok), old)).body).toMatchObject({ error: "reauth_required" });
    expect((await handleAccountDeletion(post({ ...ok, password: "wrong" }), old)).body).toMatchObject({ error: "wrong_password" });
    expect(w.calls).toEqual([]);
    expect(w.files(A)).toBe(2);
    // the password proves it when the sign-in is old
    expect((await handleAccountDeletion(post({ ...ok, password: "right-password" }), old)).body).toEqual({ state: "deleted" });
  });

  it("one file: the request, other devices signed out, the file removed, checked, the auth user deleted — in this order", async () => {
    const w = world([...filesOf(A, 1), ...filesOf(B, 1)]);
    const r = await handleAccountDeletion(post(ok), w.deps());
    expect(r).toEqual({ status: 200, body: { state: "deleted" } });
    expect(w.calls).toEqual(["account_deletion_begin", "signOutOthers", "account_deletion_manifest", "remove:1", "account_deletion_manifest",
      "account_deletion_ready", `deleteUser:${A}`]);
    expect(w.files(A)).toBe(0);
    expect(w.files(B)).toBe(1); // nothing of another account
  });

  it("hundreds of files over two buckets and pages", async () => {
    const w = world([...filesOf(A, 1500), ...filesOf(A, 30, "other-bucket")]);
    expect((await handleAccountDeletion(post(ok), w.deps())).body).toEqual({ state: "deleted" });
    expect(w.files(A)).toBe(0);
    expect(w.calls.filter((c) => c.startsWith("remove:"))).toEqual(["remove:1000", "remove:500", "remove:30"]);
  });

  it("some files fail: «retry» with what is left, the account kept; the retry finishes", async () => {
    const w = world(filesOf(A, 10));
    w.failFiles(10);
    const first = await handleAccountDeletion(post(ok), w.deps());
    expect(first.status).toBe(503);
    expect(first.body).toMatchObject({ error: "storage_error", retry: true, state: "files_listed", lastError: "storage_error" });
    expect(w.calls).not.toContain(`deleteUser:${A}`);
    w.failFiles(3); // some again: removed the others, then the rest
    expect((await handleAccountDeletion(post(ok), w.deps())).body).toEqual({ state: "deleted" });
    expect(w.files(A)).toBe(0);
  });

  it("Storage unreachable (the network): nothing is called done; the retry after it is back finishes", async () => {
    const w = world(filesOf(A, 3));
    w.setStorageDown(true);
    expect((await handleAccountDeletion(post(ok), w.deps())).body).toMatchObject({ error: "storage_error", retry: true });
    w.setStorageDown(false);
    expect((await handleAccountDeletion(post(ok), w.deps())).body).toEqual({ state: "deleted" });
  });

  it("the auth user cannot be deleted: «retry»; the retry deletes it; already deleted counts as done", async () => {
    const w = world(filesOf(A, 2));
    let fails = 1;
    const flaky = w.deps({ deleteAuthUser: async () => (fails-- > 0 ? { error: "auth_delete_failed" } : { error: null }) });
    expect((await handleAccountDeletion(post(ok), flaky)).body).toMatchObject({ error: "auth_delete_failed", retry: true, state: "files_deleted" });
    expect((await handleAccountDeletion(post(ok), flaky)).body).toEqual({ state: "deleted" });
    const gone = world([]);
    expect((await handleAccountDeletion(post(ok), gone.deps({ deleteAuthUser: async () => ({ error: "auth_delete_failed", notFound: true }) }))).body)
      .toEqual({ state: "deleted" });
  });

  it("a file in the folder the account did not upload: stopped for the owner (409); nothing deleted, the auth user kept", async () => {
    const w = world([...filesOf(A, 2), { bucket: "journal-attachments", name: `${A}/planted.webp`, owner: B }]);
    const r = await handleAccountDeletion(post(ok), w.deps());
    expect(r.status).toBe(409);
    expect(r.body).toMatchObject({ error: "foreign_object" });
    expect(w.files(A)).toBe(3);
    expect(w.calls).not.toContain(`deleteUser:${A}`);
  });

  it("Storage removes nothing in a round: stopped (never an endless loop)", async () => {
    const w = world(filesOf(A, 5));
    const r = await handleAccountDeletion(post(ok), w.deps({ removeFiles: async () => ({ removed: [], error: null }) }));
    expect(r.body).toMatchObject({ error: "storage_error", retry: true });
    expect(w.calls.filter((c) => c === "account_deletion_manifest").length).toBeLessThanOrEqual(MAX_ROUNDS);
  });

  it("two requests at once: both end with the account deleted once; the files removed once", async () => {
    const w = world(filesOf(A, 40));
    const [x, y] = await Promise.all([handleAccountDeletion(post(ok), w.deps()), handleAccountDeletion(post(ok), w.deps())]);
    expect([x, y].map((r) => r.body)).toEqual([{ state: "deleted" }, { state: "deleted" }]);
    expect(w.files(A)).toBe(0);
  });

  it("the account was deleted already: the next request is told so (410), no retry", async () => {
    const w = world([], { userExists: false });
    expect((await handleAccountDeletion(post(ok), w.deps())).body).toMatchObject({ error: "account_deletion_no_user", retry: false });
  });

  it("GET: the state of the person's own deletion only", async () => {
    const w = world(filesOf(A, 1));
    const g = await handleAccountDeletion(new Request("http://x/api/account/delete"), w.deps());
    expect(g).toEqual({ status: 200, body: { state: null } });
  });

  it("the sign-in time: the newest amr timestamp of a proven method only — never iat (a refresh), never another method", () => {
    const tok = (claims: object) => `x.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.y`;
    // password and e-mail code: the newest one
    expect(newestAuthTime(tok({ amr: [{ method: "password", timestamp: 100 }, { method: "otp", timestamp: 300 }], iat: 999 }))).toBe(300);
    // registration (e-mail sign-up), a magic link
    expect(newestAuthTime(tok({ amr: [{ method: "email/signup", timestamp: 200 }] }))).toBe(200);
    expect(newestAuthTime(tok({ amr: [{ method: "magiclink", timestamp: 250 }] }))).toBe(250);
    // a token refresh keeps the sign-in's amr: a fresh iat proves nothing
    expect(newestAuthTime(tok({ amr: [{ method: "password", timestamp: 100 }], iat: 99_999 }))).toBe(100);
    // other methods are not a proof: OAuth, SSO, a recovery link, anonymous, an unknown one
    for (const method of ["oauth", "sso/saml", "recovery", "anonymous", "token_refresh", "web3", "invite"]) {
      expect(newestAuthTime(tok({ amr: [{ method, timestamp: 999 }] }))).toBeNull();
    }
    // a proven method next to another: only the proven one counts
    expect(newestAuthTime(tok({ amr: [{ method: "oauth", timestamp: 999 }, { method: "password", timestamp: 100 }] }))).toBe(100);
    // no amr, a broken amr, a bad token
    expect(newestAuthTime(tok({ iat: 999 }))).toBeNull();
    expect(newestAuthTime(tok({ amr: [{ method: "password" }], iat: 999 }))).toBeNull();
    expect(newestAuthTime(tok({ amr: "password" }))).toBeNull();
    expect(newestAuthTime("garbage")).toBeNull();
  });

  it("an old session restored (a sign-in long ago, refreshed since): the password is required every time", async () => {
    const w = world(filesOf(A, 1));
    const restored = w.deps({ getUser: async () => ({ id: A, email: "a@example.com", authAt: NOW / 1000 - 7 * 86400 }) });
    expect((await handleAccountDeletion(post(ok), restored)).body).toMatchObject({ error: "reauth_required" });
    // a repeated call is asked again (nothing is remembered between calls)
    expect((await handleAccountDeletion(post(ok), restored)).body).toMatchObject({ error: "reauth_required" });
    expect(w.calls).toEqual([]);
  });

  it("no proven sign-in time (another method, no amr): only the password", async () => {
    const w = world(filesOf(A, 1));
    const other = w.deps({ getUser: async () => ({ id: A, email: "a@example.com", authAt: null }) });
    expect((await handleAccountDeletion(post(ok), other)).body).toMatchObject({ error: "reauth_required" });
    expect((await handleAccountDeletion(post({ ...ok, password: "right-password" }), other)).body).toEqual({ state: "deleted" });
  });

  it("a continued deletion asks again for the word and the proof", async () => {
    const w = world(filesOf(A, 2));
    w.failFiles(2);
    expect((await handleAccountDeletion(post(ok), w.deps())).body).toMatchObject({ error: "storage_error" });
    const stale = w.deps({ getUser: async () => ({ id: A, email: "a@example.com", authAt: NOW / 1000 - REAUTH_MAX_AGE_S - 5 }) });
    expect((await handleAccountDeletion(post(ok), stale)).body).toMatchObject({ error: "reauth_required" });
    expect((await handleAccountDeletion(post({ confirm: "no" }), w.deps())).body).toMatchObject({ error: "confirm_required" });
  });
});
