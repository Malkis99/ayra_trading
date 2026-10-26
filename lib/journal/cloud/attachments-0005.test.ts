import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { AppStorage } from "@/lib/storage";
import { LocalStorageJournalRepository, resetStampClockForTests } from "../repository";
import { CloudJournalRepository } from "./cloud-repository";
import { FakeRemote, trade } from "./testing/fake-remote";
import { FakeFiles, MemoryAttachmentStore } from "./testing/fake-files";
import { markInitialSyncDone } from "./sync-state";
import { writeSyncMode } from "./sync-mode";
import { SyncOutbox } from "./outbox";
import { ATTACHMENT_LOCAL_GRACE_MS, ATTACHMENT_QUOTA_BYTES } from "./config";
import type { AttachmentMetadata } from "../attachments/types";

const USER = "00000000-0000-0000-0000-0000000000a5";

/* ---------------------------------------------------------------- two devices, one cloud */
const storages = new Map<string, Record<string, string>>();
let current = "A";
function dumpStorage(): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i)!;
    out[k] = localStorage.getItem(k)!;
  }
  return out;
}
function onDevice(name: string) {
  storages.set(current, dumpStorage());
  localStorage.clear();
  for (const [k, v] of Object.entries(storages.get(name) ?? {})) localStorage.setItem(k, v);
  current = name;
}

let cloud: FakeRemote;
let bucket: FakeFiles;
let storeA: MemoryAttachmentStore;
let storeB: MemoryAttachmentStore;
let devA: CloudJournalRepository;
let devB: CloudJournalRepository;
let shift = 0; // moves the devices' clock forward (the «Undo» pause)
const now = () => new Date(Date.now() + shift);
const preview = async () => new Blob(["preview"], { type: "image/webp" });

const sync = async (repo: CloudJournalRepository) => {
  await repo.syncNow();
  await repo.whenIdle();
};

const meta = (id: string, extra: Partial<AttachmentMetadata> = {}): AttachmentMetadata => ({
  id,
  tradeId: "tr_1",
  kind: "before",
  width: 10,
  height: 10,
  bytes: 1000,
  mime: "image/webp",
  hash: `h_${id}`,
  createdAt: "2026-10-26T09:00:00.000Z",
  ...extra,
});

/** A screenshot added on device A: the file in its browser, the description in its journal. */
async function addShot(id: string, extra: Partial<AttachmentMetadata> = {}) {
  const m = meta(id, extra);
  await storeA.addAttachment({ ...m, originalBlob: new Blob([`file ${id}`], { type: "image/webp" }), previewBlob: new Blob(["p"]) });
  devA.saveAttachmentRecord(m);
}

beforeEach(() => {
  localStorage.clear();
  storages.clear();
  current = "A";
  shift = 0;
  resetStampClockForTests();
  AppStorage.setUserId(USER);
  cloud = new FakeRemote(USER);
  bucket = new FakeFiles();
  storeA = new MemoryAttachmentStore();
  storeB = new MemoryAttachmentStore();
  devA = new CloudJournalRepository(new LocalStorageJournalRepository(), cloud, now, "tab_A", bucket, { files: () => storeA, makePreview: preview });
  devB = new CloudJournalRepository(new LocalStorageJournalRepository(), cloud, now, "tab_B", bucket, { files: () => storeB, makePreview: preview });
  for (const d of ["A", "B"]) {
    onDevice(d);
    markInitialSyncDone(USER);
  }
  onDevice("A");
});
afterEach(() => {
  devA.dispose();
  devB.dispose();
  AppStorage.setUserId(null);
});

describe("0005: file first, then the row", () => {
  it("the file is uploaded before the description is sent; the status is «synced» only after both", async () => {
    devA.saveTrade(trade("tr_1", { attachmentIds: ["att_1"] }));
    await addShot("att_1");
    await sync(devA);
    expect(bucket.files.has(`${USER}/att_1.webp`)).toBe(true);
    expect(cloud.get("journal_attachments", "att_1")?.data.tradeId).toBe("tr_1");
    expect(devA.getCloudStatus().pending).toBe(0);
    expect(devA.getCloudStatus().state).toBe("synced");
    // the file went up before the row (the row in the cloud means the file is there)
    const rowSent = cloud.upserts.findIndex((u) => u.table === "journal_attachments");
    expect(rowSent).toBeGreaterThanOrEqual(0);
    expect(bucket.log[0]).toBe(`upload:${USER}/att_1.webp`);
  });

  it("no space in the cloud: the row is not sent, the screenshot waits (noSpace), the rest of the journal goes up", async () => {
    bucket.noSpace = true;
    devA.saveTrade(trade("tr_1", { attachmentIds: ["att_1"] }));
    await addShot("att_1");
    await sync(devA);
    expect(cloud.get("journal_trades", "tr_1")).toBeTruthy();
    expect(cloud.get("journal_attachments", "att_1")).toBeUndefined();
    const s = devA.getCloudStatus();
    expect(s.noSpace).toBe(1);
    expect(s.pending).toBe(1);
    expect(s.state).not.toBe("synced");
    expect(devA.attachmentCloudState("att_1")).toBe("noSpace");
    // space freed: it goes up by itself on the next exchange
    bucket.noSpace = false;
    await sync(devA);
    expect(cloud.get("journal_attachments", "att_1")).toBeTruthy();
    expect(devA.getCloudStatus().noSpace).toBe(0);
  });

  it("over 200 MB by this device's count: nothing is uploaded at all", async () => {
    devA.saveTrade(trade("tr_1"));
    await addShot("att_big", { bytes: ATTACHMENT_QUOTA_BYTES + 1 });
    await sync(devA);
    expect(bucket.log).toEqual([]);
    expect(devA.getCloudStatus().noSpace).toBe(1);
  });

  it("network down while uploading: the row stays queued, nothing is lost", async () => {
    bucket.down = true;
    devA.saveTrade(trade("tr_1"));
    await addShot("att_1");
    await sync(devA);
    expect(cloud.get("journal_attachments", "att_1")).toBeUndefined();
    expect(devA.getCloudStatus().pending).toBeGreaterThan(0);
    // retried after a pause, not in a tight loop
    const queued = new SyncOutbox(USER).list().find((e) => e.id === "att_1")!;
    expect(queued.attempts).toBe(1);
    expect(queued.nextAttemptAt).toBeGreaterThan(Date.now());
    bucket.down = false;
    await sync(devA);
    expect(cloud.get("journal_attachments", "att_1")).toBeTruthy();
  });

  it("a deletion needs no file and is sent as a tombstone; the file stays in the cloud", async () => {
    devA.saveTrade(trade("tr_1"));
    await addShot("att_1");
    await sync(devA);
    devA.deleteAttachmentRecord("att_1");
    await sync(devA);
    expect(cloud.get("journal_attachments", "att_1")?.data.deletedAt).toBeTruthy();
    expect(bucket.files.has(`${USER}/att_1.webp`)).toBe(true);
    expect(bucket.log.filter((l) => l.startsWith("upload")).length).toBe(1);
  });
});

describe("0005: second device", () => {
  async function shotOnA() {
    devA.saveTrade(trade("tr_1", { attachmentIds: ["att_1"] }));
    await addShot("att_1", { caption: "entry" });
    await sync(devA);
  }

  it("automatic: the file comes down by itself after the exchange, with a preview made on this device", async () => {
    await shotOnA();
    onDevice("B");
    await sync(devB);
    await devB.whenIdle();
    const got = await storeB.getAttachment("att_1");
    expect(got?.caption).toBe("entry");
    expect(await got!.previewBlob.text()).toBe("preview");
    expect(await got!.originalBlob.text()).toBe("file att_1");
  });

  it("manual: nothing comes down by itself; «Download» brings the file", async () => {
    await shotOnA();
    onDevice("B");
    writeSyncMode(USER, "manual");
    await sync(devB);
    expect(await storeB.getAttachment("att_1")).toBeNull();
    expect(devB.attachmentCloudState("att_1")).toBe("inCloud");
    expect(await devB.downloadAttachment("att_1")).toBe(false); // not by itself in manual mode
    expect(await storeB.getAttachment("att_1")).toBeNull();
    expect(await devB.downloadAttachment("att_1", { byUser: true })).toBe(true);
    expect((await storeB.getAttachment("att_1"))?.previewBlob).toBeTruthy();
  });

  it("caption changed on A arrives on B's stored file", async () => {
    await shotOnA();
    onDevice("B");
    await sync(devB);
    onDevice("A");
    devA.updateAttachmentRecord("att_1", { caption: "exit" });
    await sync(devA);
    onDevice("B");
    await sync(devB);
    expect((await storeB.getAttachment("att_1"))?.caption).toBe("exit");
  });

  it("deleted on A: B hides it and drops its copy after the pause; the cloud keeps the file", async () => {
    await shotOnA();
    onDevice("B");
    await sync(devB);
    onDevice("A");
    devA.deleteAttachmentRecord("att_1");
    await sync(devA);
    onDevice("B");
    await sync(devB);
    expect(devB.getAttachmentRecords().map((a) => a.id)).toEqual([]);
    expect(await storeB.getAttachment("att_1")).toBeTruthy(); // still within the «Undo» pause
    shift = ATTACHMENT_LOCAL_GRACE_MS + 1000;
    await sync(devB);
    expect(await storeB.getAttachment("att_1")).toBeNull();
    expect(bucket.files.has(`${USER}/att_1.webp`)).toBe(true);
  });

  it("deleted → «Undo»: the file is still in the cloud and on the device, the row is live again", async () => {
    await shotOnA();
    devA.deleteAttachmentRecord("att_1");
    await sync(devA);
    devA.restoreAttachmentRecord("att_1");
    await sync(devA);
    expect(cloud.get("journal_attachments", "att_1")?.data.deletedAt ?? null).toBeNull();
    expect(await storeA.getAttachment("att_1")).toBeTruthy();
    expect(bucket.files.has(`${USER}/att_1.webp`)).toBe(true);
    onDevice("B");
    await sync(devB);
    expect(await storeB.getAttachment("att_1")).toBeTruthy();
  });

  it("trade deleted on A against an edit on B, «Take from cloud» on A: the trade and its screenshot come back, the file is there", async () => {
    await shotOnA();
    onDevice("B");
    await sync(devB);
    // A deletes the trade (its screenshot goes with it) while B edits the trade
    onDevice("A");
    devA.deleteTrade("tr_1");
    expect(devA.getAttachmentRecords().length).toBe(0);
    onDevice("B");
    devB.saveTrade({ ...devB.getTrade("tr_1")!, notes: "edited on B" });
    await sync(devB);
    onDevice("A");
    await sync(devA);
    const conflict = devA.listConflicts().find((c) => c.table === "journal_trades");
    expect(conflict).toBeTruthy();
    expect(devA.resolveConflict("journal_trades", "tr_1", "cloud")).toBe(true);
    await devA.whenIdle();
    expect(devA.getTrade("tr_1")?.notes).toBe("edited on B");
    expect(devA.getAttachmentRecords().map((a) => a.id)).toEqual(["att_1"]);
    await sync(devA);
    expect(cloud.get("journal_attachments", "att_1")?.data.deletedAt ?? null).toBeNull();
    expect(bucket.files.has(`${USER}/att_1.webp`)).toBe(true);
  });
});

describe("0005: the journal describes screenshots", () => {
  it("deleting a trade deletes its screenshots' descriptions (tombstones, synced)", () => {
    const repo = new LocalStorageJournalRepository();
    repo.saveTrade(trade("tr_1"));
    repo.saveAttachmentRecord(meta("att_1"));
    repo.saveAttachmentRecord(meta("att_2", { tradeId: "tr_other" }));
    repo.deleteTrade("tr_1");
    const all = repo.getAttachmentRecords(true);
    expect(all.find((a) => a.id === "att_1")?.deletedAt).toBeTruthy();
    expect(all.find((a) => a.id === "att_2")?.deletedAt ?? null).toBeNull();
  });

  it("restore after delete brings back the same description with a newer time", () => {
    const repo = new LocalStorageJournalRepository();
    const saved = repo.saveAttachmentRecord(meta("att_1"));
    repo.deleteAttachmentRecord("att_1");
    const back = repo.restoreAttachmentRecord("att_1")!;
    expect(back.deletedAt).toBeNull();
    expect(back.updatedAt! > saved.updatedAt!).toBe(true);
  });

  it("no blobs ever go into the journal", () => {
    const repo = new LocalStorageJournalRepository();
    repo.saveAttachmentRecord({ ...meta("att_1"), originalBlob: new Blob(["x"]), previewBlob: new Blob(["y"]) } as AttachmentMetadata);
    const row = repo.getAttachmentRecords()[0] as unknown as Record<string, unknown>;
    expect(row.originalBlob).toBeUndefined();
    expect(row.previewBlob).toBeUndefined();
  });
});
