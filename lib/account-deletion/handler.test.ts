import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { createRateLimiter } from "@/lib/game-server/rate-limit";
import { MAX_ROUNDS, handleAccountDeletion, type DeletionDeps } from "./handler";

// Q4.7-Б1: the route's logic over an in-memory stand-in of the database's steps (0023, 0024) and of Storage and Auth. The
// stand-in keeps the same rules: a file is the account's when it is in its folder AND uploaded by it; «gone» is what Storage
// no longer has; a challenge lives 10 minutes, opens again at most once a minute, allows 5 tries and is spent once; an
// e-mail code is single-use at the auth server and belongs to one account.

const NOW = Date.UTC(2026, 10, 24, 12, 0, 0);
const A = "00000000-0000-0000-0000-0000000000aa";
const B = "00000000-0000-0000-0000-0000000000bb";

type File = { bucket: string; name: string; owner: string };
function world(files: File[], opts: { userExists?: boolean } = {}) {
  const storage = new Map(files.map((f) => [`${f.bucket}/${f.name}`, f]));
  const requests = new Map<string, { state: string; listed: Set<string>; counted: boolean; lastError: string | null }>();
  let userExists = opts.userExists ?? true;
  const calls: string[] = [];
  let clock = NOW;
  const challenges = new Map<string, { id: string; issuedAt: number; expiresAt: number; tries: number; used: boolean }>();
  // the auth server: the live code of each e-mail (single-use) and the account it belongs to
  const codes = new Map<string, { code: string; userId: string }>();
  const accounts: Record<string, string> = { "a@example.com": A, "b@example.com": B };
  let codeNo = 100000;
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
    if (fn === "account_deletion_challenge_issue") {
      const c = challenges.get(u);
      if (c && c.issuedAt > clock - 60_000) return { data: null, error: { message: "account_deletion_challenge_too_soon" } };
      challenges.set(u, { id: randomUUID(), issuedAt: clock, expiresAt: clock + 600_000, tries: 0, used: false });
      return { data: { expiresInSec: 600, maxTries: 5 }, error: null };
    }
    if (fn === "account_deletion_challenge_try") {
      const c = challenges.get(u);
      if (!c) return { data: { ok: false, reason: "none" }, error: null };
      if (c.used) return { data: { ok: false, reason: "used" }, error: null };
      if (c.expiresAt <= clock) return { data: { ok: false, reason: "expired" }, error: null };
      if (c.tries >= 5) return { data: { ok: false, reason: "too_many" }, error: null };
      c.tries++;
      return { data: { ok: true, tryNo: c.tries, challengeId: c.id }, error: null };
    }
    if (fn === "account_deletion_challenge_use") {
      const c = challenges.get(u);
      // the same rules as 0024: only that challenge (its id), open, tried, not spent
      if (!c || c.id !== args.p_challenge || c.used || c.expiresAt <= clock || c.tries < 1 || c.tries > 5) return { data: false, error: null };
      c.used = true;
      return { data: true, error: null };
    }
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
    getUser: async () => ({ id: A, email: "a@example.com" }),
    verifyPassword: async (_e, p) => p === "right-password",
    async sendCode(email) {
      calls.push("sendCode");
      codes.set(email, { code: String(++codeNo), userId: accounts[email] });
      return { error: null };
    },
    async verifyCode(email, code) {
      calls.push("verifyCode");
      const c = codes.get(email);
      if (!c || c.code !== code) return null;
      codes.delete(email); // single-use at the auth server
      return { userId: c.userId };
    },
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
    now: () => clock,
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
    /** the code the auth server last sent to this e-mail (what the person reads in the letter) */
    letter: (email: string) => codes.get(email)?.code ?? null,
    advance: (ms: number) => { clock += ms; },
    challenge: (u: string) => challenges.get(u) ?? null,
  };
}
const post = (body: unknown) => new Request("http://x/api/account/delete", { method: "POST", body: JSON.stringify(body) });
const word = { confirm: "УДАЛИТЬ" };
const ok = { ...word, password: "right-password" };
const filesOf = (u: string, n: number, bucket = "journal-attachments"): File[] => Array.from({ length: n }, (_, i) => ({ bucket, name: `${u}/f${i}.webp`, owner: u }));

describe("Q4.7-Б1 account deletion route", () => {
  it("off by default (404); no session (401)", async () => {
    const w = world([]);
    expect((await handleAccountDeletion(post(ok), w.deps({ enabled: false }))).status).toBe(404);
    expect((await handleAccountDeletion(post(ok), w.deps({ getUser: async () => null }))).status).toBe(401);
    expect(w.calls).toEqual([]);
  });

  it("the typed confirmation and a proof made now are required; nothing starts without them", async () => {
    const w = world(filesOf(A, 2));
    expect((await handleAccountDeletion(post({ confirm: "yes", password: "right-password" }), w.deps())).body).toMatchObject({ error: "confirm_required" });
    // no proof at all — whatever the session (a sign-in a second ago, a magic link, a recovery link, a refresh): refused
    expect((await handleAccountDeletion(post(word), w.deps())).body).toEqual({ error: "reauth_required", methods: ["password", "code"] });
    expect((await handleAccountDeletion(post({ ...word, password: "wrong" }), w.deps())).body).toMatchObject({ error: "wrong_password" });
    expect((await handleAccountDeletion(post({ ...word, password: 42 }), w.deps())).body).toMatchObject({ error: "reauth_required" });
    expect(w.calls).toEqual([]);
    expect(w.files(A)).toBe(2);
    expect((await handleAccountDeletion(post(ok), w.deps())).body).toEqual({ state: "deleted" });
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

  it("the e-mail code: a challenge, the letter, the auth server's check — then the deletion; the challenge is spent", async () => {
    const w = world(filesOf(A, 1));
    const sent = await handleAccountDeletion(post({ ...word, action: "send_code" }), w.deps());
    expect(sent).toEqual({ status: 200, body: { challenge: "sent", expiresInSec: 600, maxTries: 5 } });
    expect(w.calls).toEqual(["account_deletion_challenge_issue", "sendCode"]);
    const code = w.letter("a@example.com")!;
    expect((await handleAccountDeletion(post({ ...word, code }), w.deps())).body).toEqual({ state: "deleted" });
    expect(w.calls.slice(2, 5)).toEqual(["account_deletion_challenge_try", "verifyCode", "account_deletion_challenge_use"]);
    expect(w.challenge(A)?.used).toBe(true);
  });

  it("a code needs the typed word too, and a challenge opened by the route (a code from any other letter alone is not enough)", async () => {
    const w = world(filesOf(A, 1));
    expect((await handleAccountDeletion(post({ action: "send_code" }), w.deps())).body).toMatchObject({ error: "confirm_required" });
    // a code the auth server sent for something else (a sign-in letter): no challenge of the deletion → refused, unchecked
    await w.deps().sendCode("a@example.com");
    expect((await handleAccountDeletion(post({ ...word, code: w.letter("a@example.com") }), w.deps())).body).toEqual({ error: "code_required" });
    expect(w.calls).not.toContain("verifyCode");
    expect(w.files(A)).toBe(1);
  });

  it("a wrong code spends a try; after 5 the challenge is closed even for the right code", async () => {
    const w = world(filesOf(A, 1));
    await handleAccountDeletion(post({ ...word, action: "send_code" }), w.deps());
    const code = w.letter("a@example.com")!;
    for (let i = 0; i < 5; i++) expect((await handleAccountDeletion(post({ ...word, code: "000000" }), w.deps())).body).toEqual({ error: "code_invalid" });
    expect((await handleAccountDeletion(post({ ...word, code }), w.deps())).body).toEqual({ error: "code_too_many" });
    expect(w.files(A)).toBe(1);
    // not a code at all: refused before anything is counted or sent to the auth server
    const before = w.challenge(A)!.tries;
    for (const bad of ["12345", "abcdef", "1234567890123", "12 34 56"]) {
      expect((await handleAccountDeletion(post({ ...word, code: bad }), w.deps())).body).toEqual({ error: "code_invalid" });
    }
    expect(w.challenge(A)!.tries).toBe(before);
  });

  it("an expired challenge: refused, the code is not even checked", async () => {
    const w = world(filesOf(A, 1));
    await handleAccountDeletion(post({ ...word, action: "send_code" }), w.deps());
    const code = w.letter("a@example.com")!;
    w.advance(600_000);
    const verifies = w.calls.filter((c) => c === "verifyCode").length;
    expect((await handleAccountDeletion(post({ ...word, code }), w.deps())).body).toEqual({ error: "code_expired" });
    expect(w.calls.filter((c) => c === "verifyCode").length).toBe(verifies);
    expect(w.files(A)).toBe(1);
  });

  it("a code used once cannot be used again: not with the spent challenge, not with a new one", async () => {
    const w = world([...filesOf(A, 1)]);
    let fails = 1; // the first deletion stops half-way, so the account is still there to try again
    const deps = () => w.deps({ deleteAuthUser: async () => (fails-- > 0 ? { error: "auth_delete_failed" } : { error: null }) });
    await handleAccountDeletion(post({ ...word, action: "send_code" }), deps());
    const code = w.letter("a@example.com")!;
    expect((await handleAccountDeletion(post({ ...word, code }), deps())).body).toMatchObject({ error: "auth_delete_failed", retry: true });
    expect((await handleAccountDeletion(post({ ...word, code }), deps())).body).toEqual({ error: "code_used" });
    w.advance(61_000);
    await handleAccountDeletion(post({ ...word, action: "send_code" }), deps());
    expect((await handleAccountDeletion(post({ ...word, code }), deps())).body).toEqual({ error: "code_invalid" });
    // the new letter's code continues it
    expect((await handleAccountDeletion(post({ ...word, code: w.letter("a@example.com")! }), deps())).body).toEqual({ state: "deleted" });
  });

  it("another account's code (or the auth server naming another account): refused; the challenge is not spent", async () => {
    const w = world([...filesOf(A, 1), ...filesOf(B, 1)]);
    await handleAccountDeletion(post({ ...word, action: "send_code" }), w.deps());
    await w.deps().sendCode("b@example.com");
    expect((await handleAccountDeletion(post({ ...word, code: w.letter("b@example.com")! }), w.deps())).body).toEqual({ error: "code_invalid" });
    const lying = w.deps({ verifyCode: async () => ({ userId: B }) });
    expect((await handleAccountDeletion(post({ ...word, code: "123456" }), lying)).body).toEqual({ error: "code_invalid" });
    expect(w.challenge(A)!.used).toBe(false);
    expect(w.files(A)).toBe(1);
    expect(w.files(B)).toBe(1);
  });

  it("fails closed: the database or the auth server answering oddly is a refusal, never a pass", async () => {
    const w = world(filesOf(A, 1));
    await handleAccountDeletion(post({ ...word, action: "send_code" }), w.deps());
    const code = w.letter("a@example.com")!;
    const rpcWith = (fn: string, answer: { data: unknown; error: { message?: string } | null }): Partial<DeletionDeps> => {
      const base = w.deps().rpc;
      return { rpc: async (f, a) => (f === fn ? answer : base(f, a)) };
    };
    expect((await handleAccountDeletion(post({ ...word, code }), w.deps(rpcWith("account_deletion_challenge_try", { data: null, error: { message: "x" } })))).status).toBe(503);
    expect((await handleAccountDeletion(post({ ...word, code }), w.deps(rpcWith("account_deletion_challenge_try", { data: { ok: "yes" }, error: null })))).body).toEqual({ error: "code_required" });
    expect((await handleAccountDeletion(post({ ...word, code }), w.deps(rpcWith("account_deletion_challenge_try", { data: { ok: false, reason: "new" }, error: null })))).body).toEqual({ error: "code_required" });
    // the auth server accepted it, but the challenge was spent meanwhile (a request racing this one)
    expect((await handleAccountDeletion(post({ ...word, code }), w.deps(rpcWith("account_deletion_challenge_use", { data: false, error: null })))).body).toEqual({ error: "code_used" });
    expect(w.files(A)).toBe(1);
    expect(w.calls).not.toContain("account_deletion_begin");
  });

  it("sending a code: at most once a minute (the database), the auth server's limit too; no e-mail, no code", async () => {
    const w = world([]);
    expect((await handleAccountDeletion(post({ ...word, action: "send_code" }), w.deps())).status).toBe(200);
    expect((await handleAccountDeletion(post({ ...word, action: "send_code" }), w.deps())).body).toEqual({ error: "code_too_soon" });
    expect(w.calls.filter((c) => c === "sendCode")).toHaveLength(1);
    w.advance(61_000);
    expect((await handleAccountDeletion(post({ ...word, action: "send_code" }), w.deps({ sendCode: async () => ({ error: "rate_limited" }) }))).body).toEqual({ error: "code_too_soon" });
    w.advance(61_000);
    expect((await handleAccountDeletion(post({ ...word, action: "send_code" }), w.deps({ sendCode: async () => ({ error: "failed" }) }))).body).toEqual({ error: "code_not_sent" });
    expect((await handleAccountDeletion(post({ ...word, action: "send_code" }), w.deps({ getUser: async () => ({ id: A, email: null }) }))).body).toEqual({ error: "code_unavailable" });
    expect((await handleAccountDeletion(post({ ...word, action: "other" }), w.deps())).body).toEqual({ error: "bad_request" });
  });

  it("one code checked by two requests at once: exactly one passes, even if the auth server accepted it twice", async () => {
    const w = world(filesOf(A, 1));
    await handleAccountDeletion(post({ ...word, action: "send_code" }), w.deps());
    const code = w.letter("a@example.com")!;
    // an auth server that would accept the same code twice: only the challenge (its id, spent once) stops the second
    const twice = w.deps({ verifyCode: async (_e, c) => (c === code ? { userId: A } : null) });
    const [x, y] = await Promise.all([handleAccountDeletion(post({ ...word, code }), twice), handleAccountDeletion(post({ ...word, code }), twice)]);
    const bodies = [x.body, y.body];
    expect(bodies.filter((b) => b.state === "deleted")).toHaveLength(1);
    expect(bodies.filter((b) => b.error === "code_used")).toHaveLength(1);
  });

  it("a challenge opened again while a code is checked: the old try is void, its code spends nothing", async () => {
    const w = world(filesOf(A, 1));
    await handleAccountDeletion(post({ ...word, action: "send_code" }), w.deps());
    const code = w.letter("a@example.com")!;
    const first = w.challenge(A)!.id;
    // during the auth server's check, another tab asks for a new code (a minute later): a new challenge with a new id
    const racing = w.deps({
      verifyCode: async () => {
        w.advance(61_000);
        expect((await handleAccountDeletion(post({ ...word, action: "send_code" }), w.deps())).status).toBe(200);
        return { userId: A };
      },
    });
    expect((await handleAccountDeletion(post({ ...word, code }), racing)).body).toEqual({ error: "code_used" });
    expect(w.challenge(A)!.id).not.toBe(first);
    expect(w.challenge(A)!.used).toBe(false);
    expect(w.files(A)).toBe(1);
    // the new letter's code works with the new challenge
    expect((await handleAccountDeletion(post({ ...word, code: w.letter("a@example.com")! }), w.deps())).body).toEqual({ state: "deleted" });
  });

  it("the client is never trusted for the proof: its flags, ids, times and claims are ignored", async () => {
    const w = world(filesOf(A, 1));
    await handleAccountDeletion(post({ ...word, action: "send_code" }), w.deps());
    const forged = { verified: true, reauthenticated: true, authAt: NOW / 1000, amr: [{ method: "password", timestamp: NOW / 1000 }],
      challengeId: w.challenge(A)!.id, userId: A, proof: "password" };
    expect((await handleAccountDeletion(post({ ...word, ...forged }), w.deps())).body).toEqual({ error: "reauth_required", methods: ["password", "code"] });
    // a code with a forged challenge id: the use names the id the database answered, not the request's
    const code = w.letter("a@example.com")!;
    const seen: unknown[] = [];
    const base = w.deps().rpc;
    const spy = w.deps({ rpc: async (fn, a) => { if (fn === "account_deletion_challenge_use") seen.push(a.p_challenge); return base(fn, a); } });
    await handleAccountDeletion(post({ ...word, code, challengeId: "00000000-0000-4000-8000-000000000000" }), spy);
    expect(seen).toEqual([w.challenge(A)!.id]);
    // the database answering a try without an id: refused, the code not checked
    const w2 = world(filesOf(A, 1));
    await handleAccountDeletion(post({ ...word, action: "send_code" }), w2.deps());
    const noId = w2.deps({ rpc: async (fn, a) => (fn === "account_deletion_challenge_try" ? { data: { ok: true, tryNo: 1 }, error: null } : w2.deps().rpc(fn, a)) });
    expect((await handleAccountDeletion(post({ ...word, code: w2.letter("a@example.com")! }), noId)).body).toEqual({ error: "code_required" });
    expect(w2.calls).not.toContain("verifyCode");
  });

  it("a continued deletion asks again for the word and a proof made now", async () => {
    const w = world(filesOf(A, 2));
    w.failFiles(2);
    expect((await handleAccountDeletion(post(ok), w.deps())).body).toMatchObject({ error: "storage_error" });
    expect((await handleAccountDeletion(post(word), w.deps())).body).toMatchObject({ error: "reauth_required" });
    expect((await handleAccountDeletion(post({ confirm: "no", password: "right-password" }), w.deps())).body).toMatchObject({ error: "confirm_required" });
    // a code works for it too (the challenge opens while the account is being deleted)
    await handleAccountDeletion(post({ ...word, action: "send_code" }), w.deps());
    expect((await handleAccountDeletion(post({ ...word, code: w.letter("a@example.com")! }), w.deps())).body).toEqual({ state: "deleted" });
  });
});
