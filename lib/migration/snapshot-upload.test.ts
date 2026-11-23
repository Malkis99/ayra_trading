import { describe, expect, it } from "vitest";
import type { RequestScope } from "../economy-scope";
import type { DayCall } from "../server-day-client";
import { freezeSnapshot, readUpload, SNAPSHOT_KEY, transferViewOf, uploadSnapshotOnce, UPLOAD_KEY, type SpaceKV } from "./snapshot-upload";

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
    expect(one.state).toEqual({ level: 3, xp: 50, coins: 120 });
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
