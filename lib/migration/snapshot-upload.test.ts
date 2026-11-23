import { describe, expect, it } from "vitest";
import type { RequestScope } from "../economy-scope";
import type { DayCall } from "../server-day-client";
import { freezeSnapshot, readUpload, SNAPSHOT_KEY, transferViewOf, uploadSnapshotOnce, UPLOAD_KEY, type PlainFrozen, type SpaceKV } from "./snapshot-upload";

const A = "00000000-0000-0000-0000-00000000000a";
const SCOPE: RequestScope = { space: `account:${A}`, account: A, spaceGeneration: 1, authGeneration: 1 };
const RAW = JSON.stringify({ level: 3, xp: 50, coins: 120 });
const NOW = new Date("2026-11-24T10:00:00Z");

function kvOf(init: Record<string, string> = {}, writable = true): SpaceKV & { data: Record<string, string> } {
  const data = { ...init };
  return { data, get: (k) => data[k] ?? null, set: (k, v) => (writable ? ((data[k] = v), true) : false) };
}
let n = 0;
const uuid = () => `6f1c1e3a-2b4d-4c5e-8f60-${String(++n).padStart(12, "0")}`;
const ok = (status: string, replay = false): DayCall => ({ ok: true, status: null, body: { status, replay, receivedAt: "2026-11-24T10:00:01Z", account: A }, account: A });

describe("Q4.5-4 device snapshot — frozen once", () => {
  it("the first freeze keeps the state as it was; later changes never rewrite it", () => {
    const kv = kvOf();
    const one = freezeSnapshot(kv, RAW, NOW, uuid)!;
    const two = freezeSnapshot(kv, JSON.stringify({ level: 9 }), new Date("2026-12-01T00:00:00Z"), uuid)!;
    expect(two).toEqual(one);
    expect((one as PlainFrozen).state).toEqual({ level: 3, xp: 50, coins: 120 });
  });
  it("nothing saved on the device: nothing frozen, nothing sent", async () => {
    const sent: unknown[] = [];
    const out = await uploadSnapshotOnce("migration_pending", SCOPE, { kv: kvOf(), rawState: null, now: NOW, uuid, belongs: () => true, send: async (b) => (sent.push(b), ok("accepted")) });
    expect(out).toEqual({ kind: "nothing" });
    expect(sent).toEqual([]);
  });
});

describe("Q4.5-4 device snapshot — sending", () => {
  it("before the window (local, scheduled) nothing is sent", async () => {
    for (const mode of ["local", "migration_scheduled"] as const) {
      const sent: unknown[] = [];
      const kv = kvOf();
      expect(await uploadSnapshotOnce(mode, SCOPE, { kv, rawState: RAW, now: NOW, uuid, belongs: () => true, send: async (b) => (sent.push(b), ok("accepted")) })).toEqual({ kind: "nothing" });
      expect(sent).toEqual([]);
      expect(kv.data[SNAPSHOT_KEY]).toBeUndefined();
    }
  });
  it("a failure is retried with the SAME snapshot id and content; the kept answer stops further sending", async () => {
    const sent: Array<Record<string, unknown>> = [];
    const kv = kvOf();
    const answers: DayCall[] = [{ ok: false, error: "network" }, ok("accepted")];
    const deps = { kv, now: NOW, uuid, belongs: () => true, send: async (b: unknown) => (sent.push(b as Record<string, unknown>), answers.shift()!) };
    expect(await uploadSnapshotOnce("migration_pending", SCOPE, { ...deps, rawState: RAW })).toEqual({ kind: "retry", error: "network" });
    // the device's state changed meanwhile: the frozen copy is what goes again
    expect(await uploadSnapshotOnce("migration_pending", SCOPE, { ...deps, rawState: JSON.stringify({ level: 4 }) })).toMatchObject({ kind: "done", record: { status: "accepted" } });
    expect(sent).toHaveLength(2);
    expect(sent[1]).toEqual(sent[0]);
    expect(sent[0]).toMatchObject({ schema: 1, state: { level: 3, xp: 50, coins: 120 } });
    expect(Object.keys(sent[0]).sort()).toEqual(["installId", "schema", "snapshotId", "state"]);
    expect(await uploadSnapshotOnce("migration_pending", SCOPE, { ...deps, rawState: RAW })).toMatchObject({ kind: "done" });
    expect(sent).toHaveLength(2);
    expect(readUpload(kv)).toMatchObject({ status: "accepted" });
  });
  it("an offline device after the transfer: sends once, the server keeps it apart (late)", async () => {
    const kv = kvOf();
    const out = await uploadSnapshotOnce("cloud_active", SCOPE, { kv, rawState: RAW, now: NOW, uuid, belongs: () => true, send: async () => ok("late") });
    expect(out).toMatchObject({ kind: "done", record: { status: "late" } });
    expect(transferViewOf("cloud_active", readUpload(kv), null)).toBe("late");
  });
  it("an answer for another account or after leaving the space keeps nothing", async () => {
    const kv = kvOf();
    const out = await uploadSnapshotOnce("migration_pending", SCOPE, { kv, rawState: RAW, now: NOW, uuid, belongs: () => false, send: async () => ok("accepted") });
    expect(out).toEqual({ kind: "ignored" });
    expect(kv.data[UPLOAD_KEY]).toBeUndefined();
  });
  it("a stale session tells the state; the refusal is kept for a retry, never as a result", async () => {
    const kv = kvOf();
    const out = await uploadSnapshotOnce("migration_pending", SCOPE, { kv, rawState: RAW, now: NOW, uuid, belongs: () => true, send: async () => ({ ok: false, error: "session_stale", state: "cloud_active", account: A }) });
    expect(out).toEqual({ kind: "retry", error: "session_stale", state: "cloud_active" });
    expect(readUpload(kv)).toBeNull();
  });
  it("an unknown answer is never kept as sent", async () => {
    const kv = kvOf();
    const out = await uploadSnapshotOnce("migration_pending", SCOPE, { kv, rawState: RAW, now: NOW, uuid, belongs: () => true, send: async () => ({ ok: true, status: null, body: { status: "credited" }, account: A }) });
    expect(out).toEqual({ kind: "retry", error: "bad_response" });
  });
  it("what the person sees", () => {
    expect(transferViewOf("local", null, null)).toBeNull();
    expect(transferViewOf("migration_scheduled", null, null)).toBeNull();
    expect(transferViewOf("migration_pending", null, null)).toBe("waiting");
    expect(transferViewOf("migration_pending", null, "import_too_large")).toBe("tooLarge");
    expect(transferViewOf("migration_pending", { status: "duplicate_install", receivedAt: null, replay: false }, null)).toBe("sent");
  });
});

/* ------------------------------------------------------------------ Q4.6: large saves, compressed once */

import { createHash } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";
import { PLAIN_MAX_BYTES, RAW_MAX_BYTES, snapshotBody, type Codec } from "./snapshot-upload";

const nodeCodec: Codec = { gzip: async (b) => new Uint8Array(gzipSync(b)), sha256Hex: async (b) => createHash("sha256").update(b).digest("hex") };
/** A synthetic save of MORE than `bytes` bytes (no real data; an entry is about 97 bytes). */
const bigRaw = (bytes: number) => JSON.stringify({ level: 30, xp: 10, coins: 4000, history: Array.from({ length: Math.ceil(bytes / 90) }, (_, i) => ({ questId: `q_${i % 60}`, xp: 40, coins: 10, completedAt: "2026-11-01", at: "2026-11-01T09:00:00.000Z" })) });
const sizeOf = (raw: string) => new TextEncoder().encode(raw).length;
const unpack = (body: Record<string, unknown>) => JSON.parse(gunzipSync(Buffer.from(body.stateGzip as string, "base64")).toString("utf8"));
const IDS = { snapshotId: expect.any(String), installId: expect.any(String), schema: 1 };

describe("Q4.6 device snapshot — a save above 1 MiB", () => {
  it("frozen ONCE compressed (exact bytes, length, SHA-256); sent in one request; a retry sends the very same body", async () => {
    const raw = bigRaw(1_500_000);
    expect(new TextEncoder().encode(raw).length).toBeGreaterThan(PLAIN_MAX_BYTES);
    const kv = kvOf();
    const sent: Array<Record<string, unknown>> = [];
    const deps = { kv, rawState: raw, now: NOW, uuid, belongs: () => true, codec: nodeCodec, send: async (b: unknown) => (sent.push(b as Record<string, unknown>), { ok: false as const, error: "network", status: 0 }) };
    await uploadSnapshotOnce("migration_pending", SCOPE, deps);
    const frozen = JSON.parse(kv.data[SNAPSHOT_KEY]);
    expect(frozen).toMatchObject({ encoding: "gzip", stateBytes: new TextEncoder().encode(raw).length, stateSha256: createHash("sha256").update(raw).digest("hex") });
    expect(frozen.state).toBeUndefined(); // the large state is not stored twice uncompressed
    // the save changes afterwards; the retry still sends the frozen moment, byte for byte
    await uploadSnapshotOnce("migration_pending", SCOPE, { ...deps, rawState: bigRaw(1_600_000) });
    expect(sent).toHaveLength(2);
    expect(sent[1]).toEqual(sent[0]);
    expect(sent[0]).toMatchObject({ ...IDS, encoding: "gzip" });
    expect(unpack(sent[0])).toEqual(JSON.parse(raw));
  });
  it("a save up to 1 MiB is sent exactly as before (no compression)", async () => {
    const sent: Array<Record<string, unknown>> = [];
    await uploadSnapshotOnce("migration_pending", SCOPE, { kv: kvOf(), rawState: RAW, now: NOW, uuid, belongs: () => true, codec: nodeCodec, send: async (b) => (sent.push(b as Record<string, unknown>), ok("accepted")) });
    expect(sent).toEqual([{ ...IDS, state: JSON.parse(RAW) }]);
  });
  it("a browser that cannot compress: nothing sent, the person is told, the moment kept when the storage has room; a newer browser sends that same copy", async () => {
    const raw = bigRaw(1_200_000);
    expect(sizeOf(raw)).toBeGreaterThan(PLAIN_MAX_BYTES);
    const kv = kvOf();
    const sent: Array<Record<string, unknown>> = [];
    const send = async (b: unknown) => (sent.push(b as Record<string, unknown>), ok("accepted"));
    const out = await uploadSnapshotOnce("migration_pending", SCOPE, { kv, rawState: raw, now: NOW, uuid, belongs: () => true, codec: null, send });
    expect(out).toEqual({ kind: "retry", error: "compression_unavailable" });
    expect(transferViewOf("migration_pending", null, "compression_unavailable")).toBe("unsupported");
    expect(sent).toEqual([]);
    const frozenBefore = kv.data[SNAPSHOT_KEY];
    expect(JSON.parse(frozenBefore).state).toEqual(JSON.parse(raw));
    // later, with compression: the plain frozen copy is compressed for the request only — never rewritten
    await uploadSnapshotOnce("migration_pending", SCOPE, { kv, rawState: bigRaw(1_300_000), now: NOW, uuid, belongs: () => true, codec: nodeCodec, send });
    expect(kv.data[SNAPSHOT_KEY]).toBe(frozenBefore);
    expect(sent[0]).toMatchObject({ snapshotId: JSON.parse(frozenBefore).snapshotId, encoding: "gzip" });
    expect(unpack(sent[0])).toEqual(JSON.parse(raw));
  });
  it("above 4 MiB: refused on the device (nothing frozen, nothing sent); the person is told", async () => {
    const kv = kvOf();
    const sent: unknown[] = [];
    expect(sizeOf(bigRaw(RAW_MAX_BYTES + 200_000))).toBeGreaterThan(RAW_MAX_BYTES);
    const out = await uploadSnapshotOnce("migration_pending", SCOPE, { kv, rawState: bigRaw(RAW_MAX_BYTES + 200_000), now: NOW, uuid, belongs: () => true, codec: nodeCodec, send: async (b) => (sent.push(b), ok("accepted")) });
    expect(out).toEqual({ kind: "retry", error: "import_too_large" });
    expect(transferViewOf("migration_pending", null, "import_too_large")).toBe("tooLarge");
    expect(kv.data[SNAPSHOT_KEY]).toBeUndefined();
    expect(sent).toEqual([]);
  });
  it("two tabs at once (one shared lock, as Web Locks): one frozen copy, the same snapshot id in both requests", async () => {
    const kv = kvOf();
    let chain = Promise.resolve();
    const lock = <T,>(fn: () => Promise<T>) => { const r = chain.then(fn); chain = r.then(() => undefined, () => undefined); return r; };
    const sent: Array<Record<string, unknown>> = [];
    const deps = { kv, rawState: bigRaw(1_200_000), now: NOW, uuid, belongs: () => true, codec: nodeCodec, lock, send: async (b: unknown) => (sent.push(b as Record<string, unknown>), ok("accepted")) };
    await Promise.all([uploadSnapshotOnce("migration_pending", SCOPE, deps), uploadSnapshotOnce("migration_pending", SCOPE, deps)]);
    expect(new Set(sent.map((b) => b.snapshotId)).size).toBe(1);
  });
  it("without a lock, a tab that froze meanwhile wins (re-read before writing)", async () => {
    const kv = kvOf();
    const slow: Codec = { ...nodeCodec, gzip: async (b) => { await new Promise((r) => setTimeout(r, 20)); return nodeCodec.gzip(b); } };
    const sent: Array<Record<string, unknown>> = [];
    const deps = { kv, rawState: bigRaw(1_200_000), now: NOW, uuid, belongs: () => true, send: async (b: unknown) => (sent.push(b as Record<string, unknown>), ok("accepted")) };
    await Promise.all([uploadSnapshotOnce("migration_pending", SCOPE, { ...deps, codec: slow }), uploadSnapshotOnce("migration_pending", SCOPE, { ...deps, codec: nodeCodec })]);
    expect(new Set(sent.map((b) => b.snapshotId)).size).toBe(1);
  });
  it("the request body of a small plain copy is unchanged; of a large plain copy it is compressed (the copy untouched)", async () => {
    const small = await snapshotBody({ snapshotId: "s", frozenAt: "t", state: { level: 1 } }, "i", nodeCodec);
    expect(small).toEqual({ ok: true, body: { snapshotId: "s", installId: "i", schema: 1, state: { level: 1 } } });
    const large = await snapshotBody({ snapshotId: "s", frozenAt: "t", state: JSON.parse(bigRaw(1_200_000)) }, "i", nodeCodec);
    expect(large.ok && large.body.encoding).toBe("gzip");
  });
});
