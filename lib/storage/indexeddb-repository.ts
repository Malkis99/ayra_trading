import {
  AttachmentMetadata,
  AttachmentRecord,
  AttachmentRepository,
  AttachmentStorageEstimate,
} from "../journal/attachments/types";
import { AppStorage } from "./index";

const DB_VERSION = 1;
const STORE_NAME = "attachments";

/**
 * How an image is kept in IndexedDB: its bytes and type, not a Blob. WebKit (every browser on iPhone) cannot reliably
 * keep Blobs there — a store fails ("Error preparing Blob/File data to be stored in object store") or the kept copy
 * later does not open (a broken picture). Records written before keep their Blob and are read as they are.
 */
interface StoredBytes {
  bytes: ArrayBuffer;
  type: string;
}
type StoredImage = Blob | StoredBytes;
export type StoredRecord = Omit<AttachmentRecord, "originalBlob" | "previewBlob"> & { originalBlob: StoredImage; previewBlob: StoredImage };

/** The bytes of a Blob (also where Blob.arrayBuffer is missing, e.g. older WebKit and jsdom). */
export function readBlobBytes(blob: Blob): Promise<ArrayBuffer> {
  if (typeof blob.arrayBuffer === "function") return blob.arrayBuffer();
  if (typeof Response === "function") {
    try {
      return new Response(blob).arrayBuffer();
    } catch {
      // fall back to FileReader
    }
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
  });
}

// not `instanceof`: a value read back from IndexedDB may come from another realm
const isStoredBytes = (v: unknown): v is StoredBytes =>
  Boolean(v && typeof v === "object" && !(v instanceof Blob) && typeof (v as StoredBytes).bytes?.byteLength === "number" && typeof (v as StoredBytes).type === "string");

async function toStored(record: AttachmentRecord): Promise<StoredRecord> {
  const pack = async (b: Blob): Promise<StoredBytes> => ({ bytes: await readBlobBytes(b), type: b.type });
  return { ...record, originalBlob: await pack(record.originalBlob), previewBlob: await pack(record.previewBlob) };
}

export function fromStored(record: StoredRecord | undefined | null): AttachmentRecord | null {
  if (!record) return null;
  const unpack = (v: StoredImage): Blob => (isStoredBytes(v) ? new Blob([v.bytes], { type: v.type }) : (v as Blob));
  return { ...record, originalBlob: unpack(record.originalBlob), previewBlob: unpack(record.previewBlob) };
}

function openDB(dbName: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof window === "undefined" && typeof globalThis.indexedDB === "undefined") {
      reject(new Error("IndexedDB is not supported in this environment"));
      return;
    }

    const idb = typeof window !== "undefined" ? window.indexedDB : globalThis.indexedDB;
    if (!idb) {
      reject(new Error("IndexedDB is not available"));
      return;
    }

    const request = idb.open(dbName, DB_VERSION);

    request.onerror = () => {
      reject(request.error || new Error("Failed to open IndexedDB"));
    };

    request.onsuccess = () => {
      resolve(request.result);
    };

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: "id" });
        store.createIndex("tradeId", "tradeId", { unique: false });
        store.createIndex("createdAt", "createdAt", { unique: false });
        store.createIndex("hash", "hash", { unique: false });
      }
    };
  });
}

export class IndexedDBAttachmentRepository implements AttachmentRepository {
  private userId?: string | null;

  constructor(userId?: string | null) {
    this.userId = userId;
  }

  private async getDB(): Promise<IDBDatabase> {
    const dbName = AppStorage.getAttachmentDbName(this.userId);
    return openDB(dbName);
  }

  async addAttachment(
    input: Omit<AttachmentRecord, "id" | "createdAt"> & { id?: string; createdAt?: string }
  ): Promise<AttachmentRecord> {
    const boundSpaceId = AppStorage.getSpaceId(this.userId);
    if (!AppStorage.isWriteAllowed(boundSpaceId)) {
      throw new Error(`Write dropped: operation was bound to space "${boundSpaceId}", but current active space is "${AppStorage.getActiveSpaceId()}".`);
    }
    const db = await this.getDB();
    const id = input.id || `att_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    const createdAt = input.createdAt || new Date().toISOString();

    const record: AttachmentRecord = {
      ...input,
      id,
      createdAt,
      caption: input.caption ? input.caption.substring(0, 120) : undefined,
    };
    // bytes are read before the transaction opens (it would close while waiting)
    const stored = await toStored(record);

    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const request = store.add(stored);

      request.onsuccess = () => {
        resolve(record);
      };

      request.onerror = () => {
        reject(request.error || new Error("Failed to save attachment to IndexedDB"));
      };
    });
  }

  async getAttachment(id: string): Promise<AttachmentRecord | null> {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const request = store.get(id);

      request.onsuccess = () => {
        resolve(fromStored(request.result as StoredRecord | undefined));
      };

      request.onerror = () => {
        reject(request.error || new Error(`Failed to fetch attachment ${id}`));
      };
    });
  }

  async getAttachmentsByTradeId(tradeId: string): Promise<AttachmentRecord[]> {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const index = store.index("tradeId");
      const request = index.getAll(tradeId);

      request.onsuccess = () => {
        const results = ((request.result as StoredRecord[]) || []).map((r) => fromStored(r)!);
        results.sort(
          (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
        );
        resolve(results);
      };

      request.onerror = () => {
        reject(request.error || new Error(`Failed to fetch attachments for trade ${tradeId}`));
      };
    });
  }

  async getAllMetadata(): Promise<AttachmentMetadata[]> {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const request = store.getAll();

      request.onsuccess = () => {
        const records = (request.result as AttachmentRecord[]) || [];
        const metadata: AttachmentMetadata[] = records.map((r) => ({
          id: r.id,
          tradeId: r.tradeId,
          kind: r.kind,
          width: r.width,
          height: r.height,
          bytes: r.bytes,
          mime: r.mime,
          hash: r.hash,
          createdAt: r.createdAt,
          caption: r.caption,
        }));
        resolve(metadata);
      };

      request.onerror = () => {
        reject(request.error || new Error("Failed to fetch all attachment metadata"));
      };
    });
  }

  async updateMetadata(
    id: string,
    updates: Partial<Pick<AttachmentMetadata, "kind" | "caption">>
  ): Promise<AttachmentMetadata | null> {
    const boundSpaceId = AppStorage.getSpaceId(this.userId);
    if (!AppStorage.isWriteAllowed(boundSpaceId)) {
      return null;
    }
    const db = await this.getDB();
    const existing = await this.getAttachment(id);
    if (!existing) return null;

    const updatedRecord: AttachmentRecord = {
      ...existing,
      ...(updates.kind ? { kind: updates.kind } : {}),
      ...(updates.caption !== undefined
        ? { caption: updates.caption ? updates.caption.substring(0, 120) : undefined }
        : {}),
    };
    const stored = await toStored(updatedRecord);

    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const request = store.put(stored);

      request.onsuccess = () => {
        const { originalBlob, previewBlob, ...meta } = updatedRecord;
        resolve(meta);
      };

      request.onerror = () => {
        reject(request.error || new Error(`Failed to update metadata for attachment ${id}`));
      };
    });
  }

  async deleteAttachment(id: string): Promise<boolean> {
    const boundSpaceId = AppStorage.getSpaceId(this.userId);
    if (!AppStorage.isWriteAllowed(boundSpaceId)) {
      return false;
    }
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const request = store.delete(id);

      request.onsuccess = () => {
        resolve(true);
      };

      request.onerror = () => {
        reject(request.error || new Error(`Failed to delete attachment ${id}`));
      };
    });
  }

  async deleteAttachmentsByTradeId(tradeId: string): Promise<number> {
    const boundSpaceId = AppStorage.getSpaceId(this.userId);
    if (!AppStorage.isWriteAllowed(boundSpaceId)) {
      return 0;
    }
    const db = await this.getDB();
    const items = await this.getAttachmentsByTradeId(tradeId);
    if (items.length === 0) return 0;

    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      let count = 0;

      for (const item of items) {
        store.delete(item.id);
        count++;
      }

      tx.oncomplete = () => {
        resolve(count);
      };

      tx.onerror = () => {
        reject(tx.error || new Error(`Failed to delete attachments for trade ${tradeId}`));
      };
    });
  }

  async getStorageUsage(): Promise<AttachmentStorageEstimate> {
    if (
      typeof navigator !== "undefined" &&
      navigator.storage &&
      typeof navigator.storage.estimate === "function"
    ) {
      try {
        const estimate = await navigator.storage.estimate();
        const bytesUsed = estimate.usage || 0;
        const bytesQuota = estimate.quota || 50 * 1024 * 1024;
        const percentage = bytesQuota > 0 ? (bytesUsed / bytesQuota) * 100 : 0;
        return {
          bytesUsed,
          bytesQuota,
          percentage,
          isWarning: percentage >= 80,
        };
      } catch (e) {
        console.warn("Storage estimate error:", e);
      }
    }

    try {
      const all = await this.getAllMetadata();
      const bytesUsed = all.reduce((sum, item) => sum + item.bytes, 0);
      const bytesQuota = 50 * 1024 * 1024;
      const percentage = (bytesUsed / bytesQuota) * 100;
      return {
        bytesUsed,
        bytesQuota,
        percentage,
        isWarning: percentage >= 80,
      };
    } catch {
      return {
        bytesUsed: 0,
        bytesQuota: 50 * 1024 * 1024,
        percentage: 0,
        isWarning: false,
      };
    }
  }

  async requestPersistentStorage(): Promise<boolean> {
    if (
      typeof navigator !== "undefined" &&
      navigator.storage &&
      typeof navigator.storage.persist === "function"
    ) {
      try {
        const isPersisted = await navigator.storage.persisted();
        if (!isPersisted) {
          return await navigator.storage.persist();
        }
        return true;
      } catch {
        return false;
      }
    }
    return false;
  }

  async cleanupOrphans(validTradeIds: Set<string>): Promise<number> {
    const boundSpaceId = AppStorage.getSpaceId(this.userId);
    if (!AppStorage.isWriteAllowed(boundSpaceId)) {
      return 0;
    }
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const request = store.getAll();

      request.onsuccess = () => {
        const records = (request.result as AttachmentRecord[]) || [];
        const now = Date.now();
        const TWENTY_FOUR_HOURS = 24 * 3600 * 1000;
        let deletedCount = 0;

        for (const record of records) {
          const isOrphan = !validTradeIds.has(record.tradeId);
          const age = now - new Date(record.createdAt).getTime();
          if (isOrphan && age > TWENTY_FOUR_HOURS) {
            store.delete(record.id);
            deletedCount++;
          }
        }

        resolve(deletedCount);
      };

      request.onerror = () => {
        reject(request.error || new Error("Failed to cleanup orphan attachments"));
      };
    });
  }
}

export const defaultAttachmentRepository = new IndexedDBAttachmentRepository();
