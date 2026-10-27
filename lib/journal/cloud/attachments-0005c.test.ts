import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { AppStorage } from "@/lib/storage";
import { LocalStorageJournalRepository, resetStampClockForTests } from "../repository";
import { CloudJournalRepository } from "./cloud-repository";
import { FakeRemote, trade } from "./testing/fake-remote";
import { FakeFiles, MemoryAttachmentStore } from "./testing/fake-files";
import { markInitialSyncDone } from "./sync-state";
import { AttachmentFiles, attachmentPath, readUploadsPaused } from "./attachment-files";
import type { AttachmentMetadata } from "../attachments/types";
import type { CloudEntry } from "./records";

// 0005-C: screenshots that were on the device before 0005 go up (in batches, «Stop» / «Continue»), and the daily
// cleanup of the account's folder in the cloud.

const USER = "00000000-0000-0000-0000-0000000000c5";
const DAY = 24 * 3600 * 1000;
let cloud: FakeRemote;
let bucket: FakeFiles;
let store: MemoryAttachmentStore;
let repo: CloudJournalRepository;

const meta = (id: string, tradeId = "tr_1"): AttachmentMetadata => ({
  id,
  tradeId,
  kind: "before",
  width: 10,
  height: 10,
  bytes: 100,
  mime: "image/webp",
  hash: `h_${id}`,
  createdAt: "2026-10-01T09:00:00.000Z",
});
/** A screenshot from before 0005: the file in this browser, listed by its trade, no row in the journal. */
const legacy = async (id: string) => store.addAttachment({ ...meta(id), originalBlob: new Blob([`file ${id}`]), previewBlob: new Blob(["p"]) });

beforeEach(() => {
  localStorage.clear();
  resetStampClockForTests();
  AppStorage.setUserId(USER);
  cloud = new FakeRemote(USER);
  bucket = new FakeFiles();
  store = new MemoryAttachmentStore();
  repo = new CloudJournalRepository(new LocalStorageJournalRepository(), cloud, undefined, "tab_c", bucket, { files: () => store, makePreview: async () => new Blob(["p"]) });
  markInitialSyncDone(USER);
});
afterEach(() => {
  repo.dispose();
  AppStorage.setUserId(null);
});

describe("screenshots from before 0005", () => {
  it("get a row and go up after an exchange — rows only for live trades, no duplicates when run again", async () => {
    repo.saveTrade(trade("tr_1", { attachmentIds: ["old_1", "old_2"] }));
    await legacy("old_1");
    await legacy("old_2");
    await store.addAttachment({ ...meta("old_x", "tr_gone"), originalBlob: new Blob(["x"]), previewBlob: new Blob(["p"]) }); // no live trade
    await repo.syncNow();
    await repo.whenIdle();
    await repo.syncNow(); // the rows were queued by the first exchange: they go up now
    await repo.whenIdle();
    expect(repo.getAttachmentRecords().map((a) => a.id).sort()).toEqual(["old_1", "old_2"]);
    expect([...bucket.files.keys()].sort()).toEqual([attachmentPath(USER, "old_1", "image/webp"), attachmentPath(USER, "old_2", "image/webp")]);
    expect(cloud.get("journal_attachments", "old_1")).toBeTruthy();
    // the original time of the screenshot is kept
    expect(repo.getAttachmentRecords().find((a) => a.id === "old_1")?.createdAt).toBe("2026-10-01T09:00:00.000Z");
    await repo.syncNow();
    await repo.whenIdle();
    expect(bucket.log.filter((l) => l.startsWith("upload")).length).toBe(2);
    expect(repo.getScreenshotsCloudStatus()).toMatchObject({ total: 2, inCloud: 2, waiting: 0, paused: false });
  });

  it("«Automatic»: a few files per exchange (the rest right after), «Synchronise» sends them all", async () => {
    const files = new AttachmentFiles({ remote: bucket, readJournal: () => ({ snapshot: new LocalStorageJournalRepository().getAllRecords(), batches: [] }), files: () => store });
    const entries: CloudEntry[] = [];
    for (const id of ["a", "b", "c", "d", "e"]) {
      await legacy(id);
      entries.push({ table: "journal_attachments", id, record: { ...meta(id), updatedAt: "2026-10-01T09:00:00.000Z" } });
    }
    const auto = await files.prepare(USER, entries, { limit: 3 });
    expect(auto.ready.size).toBe(3);
    expect(auto.deferred?.map((d) => [d.id, d.reason])).toEqual([["d", "later"], ["e", "later"]]);
    const all = await files.prepare(USER, entries);
    expect(all.ready.size).toBe(5);
  });

  it("«Stop»: nothing more goes up, uploaded ones stay; «Continue»: the rest go up, no copies", async () => {
    repo.saveTrade(trade("tr_1", { attachmentIds: ["s1", "s2", "s3"] }));
    for (const id of ["s1", "s2", "s3"]) await legacy(id);
    await repo.syncNow();
    await repo.whenIdle();
    repo.pauseScreenshotUploads();
    expect(readUploadsPaused(USER)).toBe(true);
    await repo.syncNow();
    await repo.whenIdle();
    expect(bucket.files.size).toBe(0);
    const stopped = repo.getScreenshotsCloudStatus()!;
    expect(stopped).toMatchObject({ total: 3, inCloud: 0, waiting: 3, paused: true, uploading: false });
    // waiting screenshots still count as «waiting to be sent»; the badge never says «saved»
    expect(repo.getCloudStatus().pending).toBe(3);
    await repo.resumeScreenshotUploads();
    await repo.whenIdle();
    expect(bucket.files.size).toBe(3);
    expect(repo.getScreenshotsCloudStatus()).toMatchObject({ inCloud: 3, waiting: 0, paused: false });
    expect(bucket.log.filter((l) => l.startsWith("upload")).length).toBe(3);
  });
});

describe("daily cleanup of the account's folder", () => {
  it("removes files of screenshots deleted 30+ days ago and files without a row older than 24 h; keeps the rest; once a day", async () => {
    const now = Date.now();
    const local = new LocalStorageJournalRepository();
    local.saveTrade(trade("tr_1"));
    const iso = (ms: number) => new Date(ms).toISOString();
    const row = (id: string, deletedAgoDays?: number) => {
      local.saveAttachmentRecord(meta(id));
      if (deletedAgoDays !== undefined) {
        const all = local.getAllRecords();
        all.attachments = all.attachments!.map((a) => (a.id === id ? { ...a, deletedAt: iso(now - deletedAgoDays * DAY), updatedAt: iso(now - deletedAgoDays * DAY) } : a));
        local.replaceAllRecords(all);
      }
    };
    row("live");
    row("deleted_31", 31);
    row("deleted_10", 10);
    const put = (id: string, agoMs: number) => {
      const p = attachmentPath(USER, id, "image/webp");
      bucket.files.set(p, new Blob(["x"]));
      bucket.createdAt.set(p, iso(now - agoMs));
    };
    put("live", 40 * DAY);
    put("deleted_31", 40 * DAY);
    put("deleted_10", 40 * DAY);
    put("orphan_old", 25 * 3600 * 1000);
    put("orphan_new", 3600 * 1000);
    bucket.files.set(`${"00000000-0000-0000-0000-0000000000ff"}/other.webp`, new Blob(["x"])); // another user: never listed

    const files = new AttachmentFiles({ remote: bucket, readJournal: () => ({ snapshot: local.getAllRecords(), batches: [] }), files: () => store });
    expect(await files.cleanup(USER)).toBe(2);
    expect(bucket.removed.sort()).toEqual([attachmentPath(USER, "deleted_31", "image/webp"), attachmentPath(USER, "orphan_old", "image/webp")]);
    expect(bucket.files.has(attachmentPath(USER, "deleted_10", "image/webp"))).toBe(true);
    expect(bucket.files.has(attachmentPath(USER, "orphan_new", "image/webp"))).toBe(true);
    expect(bucket.files.has(attachmentPath(USER, "live", "image/webp"))).toBe(true);
    // once a day
    put("orphan_old2", 30 * 3600 * 1000);
    expect(await files.cleanup(USER)).toBe(0);
    expect(await files.cleanup(USER, { force: true })).toBe(1);
  });
});
