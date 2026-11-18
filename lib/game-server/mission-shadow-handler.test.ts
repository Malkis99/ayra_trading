import { describe, expect, it } from "vitest";
import { handleMissionShadow, type ShadowDeps, type ShadowJournalReader } from "./mission-shadow-handler";
import { createRateLimiter } from "./rate-limit";
import { supabaseJournalReader } from "./supabase-journal-reader";
import type { CloudRow, ShadowTable } from "../missions-shadow";
import type { SupabaseClient } from "@supabase/supabase-js";

const ORIGIN = "https://ayra.test";
const NOW = new Date("2026-11-18T10:00:00Z");
const DAY = "2026-11-18";
const LESSON = "Урок дня: вход только после закрытия свечи над уровнем, без догоняния цены и без лишних сделок.";
const A = "00000000-0000-0000-0000-00000000000a";
const B = "00000000-0000-0000-0000-00000000000b";

type Store = Map<string, { user: string; table: ShadowTable; row: CloudRow }>;
const lesson = (id: string, over: Record<string, unknown> = {}): CloudRow => {
  const data = { id, templateKey: "lesson", body: LESSON, createdAt: "2026-11-18T08:00:00Z", updatedAt: "2026-11-18T08:00:00Z", ...over };
  return { id, data, updated_at: "2026-11-18T09:00:00Z", client_updated_at: String(data.updatedAt), deleted_at: null };
};

/** A cloud journal of several users; the reader sees one user's rows only (as RLS does). */
function cloud(store: Store, user: string, opts: { sync?: boolean; tz?: string | null; failing?: boolean; onRead?: (n: number) => void } = {}): ShadowJournalReader {
  let reads = 0;
  const mine = (table: ShadowTable) => [...store.values()].filter((x) => x.user === user && x.table === table).map((x) => x.row);
  const guard = () => {
    if (opts.failing) throw new Error("connection refused: secret-db-host:5432 password=hunter2");
    opts.onRead?.(++reads);
  };
  return {
    async timezone() {
      guard();
      return opts.tz === undefined ? "UTC" : opts.tz;
    },
    async cloudSync() {
      guard();
      return opts.sync ?? true;
    },
    async allRows(table, max) {
      guard();
      const rows = mine(table);
      return rows.length > max ? "tooMany" : rows;
    },
    async rowsById(table, ids) {
      guard();
      return mine(table).filter((r) => ids.includes(r.id));
    },
  };
}

function deps(over: Partial<ShadowDeps> & { store?: Store; user?: string | null } = {}): ShadowDeps {
  const store = over.store ?? new Map();
  const user = over.user === undefined ? A : over.user;
  return {
    enabled: true,
    getUser: async () => (user ? { id: user } : null),
    reader: cloud(store, user || "nobody"),
    limiter: createRateLimiter({ limit: 20, windowMs: 60_000 }),
    now: () => NOW,
    origin: ORIGIN,
    ...over,
  };
}

const post = (body: unknown, headers: Record<string, string> = {}) =>
  new Request(`${ORIGIN}/api/game/missions/shadow`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: ORIGIN, ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
const lessonReq = (source = "note:n1", done = true) => ({ missions: [{ id: "m_lesson", day: DAY, done, source }] });

function storeWith(...rows: Array<[string, ShadowTable, CloudRow]>): Store {
  const s: Store = new Map();
  for (const [user, table, row] of rows) s.set(`${user}:${table}:${row.id}`, { user, table, row });
  return s;
}

describe("Q4.2 shadow route — who may ask", () => {
  it("off unless the owner turns it on (404)", async () => {
    expect((await handleMissionShadow(post(lessonReq()), deps({ enabled: false }))).status).toBe(404);
  });
  it("only POST, only JSON, only from the site itself", async () => {
    expect((await handleMissionShadow(new Request(`${ORIGIN}/x`, { method: "GET", headers: { origin: ORIGIN } }), deps())).status).toBe(405);
    expect((await handleMissionShadow(post(lessonReq(), { origin: "https://evil.example" }), deps())).status).toBe(403);
    const noOrigin = new Request(`${ORIGIN}/x`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    expect((await handleMissionShadow(noOrigin, deps())).status).toBe(403);
    expect((await handleMissionShadow(post(lessonReq(), { "content-type": "text/plain" }), deps())).status).toBe(415);
  });
  it("without a verified session: 401 (a user id in the body is not a session)", async () => {
    const r = await handleMissionShadow(post({ ...lessonReq(), userId: A }), deps({ user: null }));
    expect(r.status).toBe(401);
    expect(r.body).toEqual({ error: "not_signed_in" });
    const thrown = await handleMissionShadow(post(lessonReq()), deps({ getUser: async () => { throw new Error("jwt expired"); } }));
    expect(thrown.status).toBe(401);
  });
  it("a body that is too large, not JSON or not the expected shape: refused", async () => {
    expect((await handleMissionShadow(post("x".repeat(9000)), deps())).status).toBe(413);
    expect((await handleMissionShadow(post("{not json"), deps())).status).toBe(400);
    expect((await handleMissionShadow(post({ missions: [{ id: "m_lesson", day: DAY, done: true, xp: 40 }] }), deps())).status).toBe(400);
  });
  it("rate limit per account: the 21st check in a minute is refused with Retry-After; another account is not affected", async () => {
    const limiter = createRateLimiter({ limit: 20, windowMs: 60_000 });
    const store = storeWith([A, "journal_notes", lesson("n1")]);
    for (let i = 0; i < 20; i++) expect((await handleMissionShadow(post(lessonReq()), deps({ store, limiter }))).status).toBe(200);
    const over = await handleMissionShadow(post(lessonReq()), deps({ store, limiter }));
    expect(over.status).toBe(429);
    expect(Number(over.headers["Retry-After"])).toBeGreaterThan(0);
    expect((await handleMissionShadow(post(lessonReq()), deps({ store, limiter, user: B }))).status).toBe(200);
  });
});

describe("Q4.2 shadow route — the check", () => {
  it("a suitable record: 200, shadow only, no payment authorised, no-store", async () => {
    const r = await handleMissionShadow(post(lessonReq()), deps({ store: storeWith([A, "journal_notes", lesson("n1")]) }));
    expect(r.status).toBe(200);
    expect(r.headers["Cache-Control"]).toBe("no-store");
    expect(r.body.authorizedForPayout).toBe(false);
    const res = (r.body.results as Array<{ comparison: string; payout: string }>)[0];
    expect(res).toMatchObject({ comparison: "agree_done", payout: "not_authorized" });
  });

  it("account isolation: B's record with A's session is not seen; A's answer never mentions B's rows", async () => {
    const store = storeWith([B, "journal_notes", lesson("n_b")]);
    const r = await handleMissionShadow(post(lessonReq("note:n_b")), deps({ store }));
    const res = (r.body.results as Array<{ comparison: string; server: { sources: string[]; flags: string[] } }>)[0];
    expect(res.comparison).toBe("client_only");
    expect(res.server.sources).toEqual([]);
    expect(res.server.flags).toContain("sourceNotConfirmed");
  });

  it("the cloud journal is off for the account: 409 cloud_journal_off", async () => {
    const r = await handleMissionShadow(post(lessonReq()), deps({ reader: cloud(new Map(), A, { sync: false }) }));
    expect(r).toMatchObject({ status: 409, body: { error: "cloud_journal_off" } });
  });

  it("the cloud journal is unavailable: 503 with a code only — no database message, host or user id", async () => {
    const r = await handleMissionShadow(post(lessonReq()), deps({ reader: cloud(new Map(), A, { failing: true }) }));
    expect(r).toMatchObject({ status: 503, body: { error: "cloud_journal_unavailable" } });
    const text = JSON.stringify(r);
    for (const leak of ["secret-db-host", "hunter2", "refused", A]) expect(text).not.toContain(leak);
  });

  it("a journal larger than the limit: 422 journal_too_large", async () => {
    const reader = cloud(new Map(), A);
    reader.allRows = async () => "tooMany";
    expect((await handleMissionShadow(post(lessonReq()), deps({ reader }))).status).toBe(422);
  });

  it("the record changes between the check and its re-read: 409 evidence_changed (nothing is decided on stale data)", async () => {
    const store = storeWith([A, "journal_notes", lesson("n1")]);
    // after the first full read, another tab edits the note with the SAME updatedAt (the journal takes it as a retry)
    const reader = cloud(store, A, {
      onRead: (n) => {
        if (n === 5) store.get(`${A}:journal_notes:n1`)!.row = { ...lesson("n1"), data: { ...lesson("n1").data, body: LESSON + " (исправлено)" } };
      },
    });
    const r = await handleMissionShadow(post(lessonReq()), deps({ store, reader }));
    expect(r).toMatchObject({ status: 409, body: { error: "evidence_changed" } });
  });

  it("the record is deleted between the check and its re-read: 409 evidence_changed", async () => {
    const store = storeWith([A, "journal_notes", lesson("n1")]);
    const reader = cloud(store, A, {
      onRead: (n) => {
        if (n === 5) {
          const del = lesson("n1", { deletedAt: "2026-11-18T09:59:00Z", updatedAt: "2026-11-18T09:59:00Z" });
          store.get(`${A}:journal_notes:n1`)!.row = { ...del, deleted_at: "2026-11-18T09:59:00Z" };
        }
      },
    });
    expect((await handleMissionShadow(post(lessonReq()), deps({ store, reader }))).status).toBe(409);
  });

  it("two tabs asking at once get the same answer; a repeat changes nothing (the route writes nothing)", async () => {
    const store = storeWith([A, "journal_notes", lesson("n1")]);
    const before = JSON.stringify([...store.values()]);
    const d = deps({ store });
    const [one, two] = await Promise.all([handleMissionShadow(post(lessonReq()), d), handleMissionShadow(post(lessonReq()), d)]);
    expect(one).toEqual(two);
    const three = await handleMissionShadow(post(lessonReq()), d);
    expect(three).toEqual(one);
    expect(JSON.stringify([...store.values()])).toBe(before);
  });
});

describe("Q4.2 journal reader — two fences around the user's rows", () => {
  it("every query names the signed-in user (RLS is the second fence), reads only, pages and stops at the limit", async () => {
    const calls: string[] = [];
    const page = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `n${i}`, data: {}, updated_at: "", client_updated_at: "", deleted_at: null }));
    const pages = [page(1000), page(1000), page(3)];
    const query = (table: string) => {
      const q = {
        select: (cols: string) => (calls.push(`${table}.select(${cols})`), q),
        eq: (col: string, v: string) => (calls.push(`${table}.eq(${col},${v})`), q),
        in: (col: string, v: string[]) => (calls.push(`${table}.in(${col},${v.join("|")})`), Promise.resolve({ data: [], error: null })),
        order: () => q,
        range: (from: number) => Promise.resolve({ data: pages[from / 1000] ?? [], error: null }),
        maybeSingle: () => Promise.resolve({ data: table === "profiles" ? { timezone: "Asia/Tbilisi" } : { cloud_sync: true }, error: null }),
        insert: () => { throw new Error("no writes"); },
        update: () => { throw new Error("no writes"); },
        upsert: () => { throw new Error("no writes"); },
        delete: () => { throw new Error("no writes"); },
      };
      return q;
    };
    const client = { from: query, rpc: () => { throw new Error("no rpc"); } } as unknown as SupabaseClient;
    const r = supabaseJournalReader(client, A);
    expect(await r.timezone()).toBe("Asia/Tbilisi");
    expect(await r.cloudSync()).toBe(true);
    expect(((await r.allRows("journal_notes", 5000)) as CloudRow[]).length).toBe(2003);
    expect(await r.allRows("journal_notes", 1500)).toBe("tooMany");
    await r.rowsById("journal_day_plans", [DAY]);
    expect(calls.filter((c) => c.includes(".eq(")).every((c) => c.endsWith(`,${A})`))).toBe(true);
    expect(calls).toContain(`profiles.eq(id,${A})`);
    expect(calls).toContain(`journal_day_plans.eq(user_id,${A})`);
  });

  it("a database error leaves the reader as a bare code", async () => {
    const q = { select: () => q, eq: () => q, maybeSingle: () => Promise.resolve({ data: null, error: { message: "permission denied for table profiles at db.internal" } }) };
    const r = supabaseJournalReader({ from: () => q } as unknown as SupabaseClient, A);
    await expect(r.timezone()).rejects.toThrow(/^cloud_read_failed$/);
  });
});
