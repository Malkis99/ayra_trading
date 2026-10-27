import { describe, it, expect, beforeEach } from "vitest";
import "fake-indexeddb/auto";
import { AppStorage } from "./index";
import { IndexedDBAttachmentRepository, fromStored, readBlobBytes } from "./indexeddb-repository";

// Screenshots on iPhones (WebKit): a Blob cannot be kept in IndexedDB reliably, so the bytes and the type are kept
// instead and a Blob is made again when the screenshot is read. Records written before (with a Blob) still open.

const raw = (): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
    const r = indexedDB.open(AppStorage.getAttachmentDbName(undefined), 1);
    r.onupgradeneeded = () => {
      const store = r.result.createObjectStore("attachments", { keyPath: "id" });
      store.createIndex("tradeId", "tradeId", { unique: false });
      store.createIndex("createdAt", "createdAt", { unique: false });
      store.createIndex("hash", "hash", { unique: false });
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
const rawGet = async (id: string) => {
  const db = await raw();
  return new Promise<Record<string, unknown>>((resolve) => {
    const req = db.transaction("attachments", "readonly").objectStore("attachments").get(id);
    req.onsuccess = () => resolve(req.result);
  });
};
const meta = (id: string) => ({ id, tradeId: "tr_1", kind: "before" as const, width: 10, height: 10, bytes: 4, mime: "image/webp" as const, hash: "h", createdAt: "2026-10-26T10:00:00.000Z" });
const text = async (b: Blob) => new TextDecoder().decode(await readBlobBytes(b));

describe("screenshots kept as bytes in IndexedDB (WebKit)", () => {
  let repo: IndexedDBAttachmentRepository;
  beforeEach(() => {
    repo = new IndexedDBAttachmentRepository();
  });

  it("a new screenshot is stored as bytes + type, never as a Blob, and reads back as a Blob of the same type and content", async () => {
    await repo.addAttachment({ ...meta("att_b1"), originalBlob: new Blob(["full"], { type: "image/webp" }), previewBlob: new Blob(["prev"], { type: "image/png" }) });
    const stored = await rawGet("att_b1");
    const original = stored.originalBlob as { bytes: ArrayBuffer; type: string };
    expect(original.bytes.byteLength).toBe(4);
    expect(original.type).toBe("image/webp");
    expect((stored.previewBlob as { type: string }).type).toBe("image/png");

    const back = (await repo.getAttachment("att_b1"))!;
    expect(back.originalBlob.type).toBe("image/webp");
    expect(await text(back.originalBlob)).toBe("full");
    expect(await text(back.previewBlob)).toBe("prev");
    expect((await repo.getAttachmentsByTradeId("tr_1")).map((a) => a.originalBlob.type)).toEqual(["image/webp"]);
  });

  it("changing the caption keeps the image intact (bytes again, not a Blob)", async () => {
    await repo.addAttachment({ ...meta("att_b2"), originalBlob: new Blob(["full"], { type: "image/webp" }), previewBlob: new Blob(["prev"], { type: "image/webp" }) });
    await repo.updateMetadata("att_b2", { caption: "entry" });
    const stored = await rawGet("att_b2");
    expect((stored.originalBlob as { bytes: ArrayBuffer }).bytes.byteLength).toBe(4);
    const back = (await repo.getAttachment("att_b2"))!;
    expect(back.caption).toBe("entry");
    expect(await text(back.originalBlob)).toBe("full");
  });

  it("a screenshot stored before (as a Blob) is read as it is", async () => {
    // (the test database cannot hold a Blob, so the read step is checked on the record itself)
    const old = new Blob(["old"], { type: "image/webp" });
    const back = fromStored({ ...meta("att_old"), originalBlob: old, previewBlob: old })!;
    expect(back.originalBlob).toBe(old);
    expect(await text(back.originalBlob)).toBe("old");
  });
});
