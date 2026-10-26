import { AttachmentFileError, type AttachmentFileRemote } from "../attachment-files";
import type {
  AttachmentMetadata,
  AttachmentRecord,
  AttachmentRepository,
  AttachmentStorageEstimate,
} from "../../attachments/types";

/**
 * In-memory stand-in for the 0005 bucket, for unit tests only: a file is never replaced, uploads can be refused
 * (no space) or fail (network). `log` keeps the order of calls ("upload:<path>").
 */
export class FakeFiles implements AttachmentFileRemote {
  files = new Map<string, Blob>();
  noSpace = false;
  down = false;
  log: string[] = [];

  async upload(path: string, blob: Blob): Promise<void> {
    this.log.push(`upload:${path}`);
    if (this.down) throw new AttachmentFileError("network", "Failed to fetch");
    if (this.noSpace) throw new AttachmentFileError("noSpace", "new row violates row-level security policy");
    if (this.files.has(path)) throw new AttachmentFileError("exists", "The resource already exists");
    this.files.set(path, blob);
  }

  async download(path: string): Promise<Blob> {
    this.log.push(`download:${path}`);
    if (this.down) throw new AttachmentFileError("network", "Failed to fetch");
    const blob = this.files.get(path);
    if (!blob) throw new AttachmentFileError("other", "Object not found");
    return blob;
  }
}

/** The screenshots stored in one browser (one "device" of a test). */
export class MemoryAttachmentStore implements AttachmentRepository {
  items = new Map<string, AttachmentRecord>();

  async addAttachment(input: Omit<AttachmentRecord, "id" | "createdAt"> & { id?: string; createdAt?: string }): Promise<AttachmentRecord> {
    const id = input.id || `att_${this.items.size + 1}`;
    if (this.items.has(id)) throw new Error("exists");
    const record = { ...input, id, createdAt: input.createdAt || "2026-10-26T10:00:00.000Z" } as AttachmentRecord;
    this.items.set(id, record);
    return record;
  }
  async getAttachment(id: string) {
    return this.items.get(id) ?? null;
  }
  async getAttachmentsByTradeId(tradeId: string) {
    return [...this.items.values()].filter((a) => a.tradeId === tradeId);
  }
  async getAllMetadata(): Promise<AttachmentMetadata[]> {
    return [...this.items.values()].map(({ originalBlob: _o, previewBlob: _p, ...m }) => m);
  }
  async updateMetadata(id: string, updates: Partial<Pick<AttachmentMetadata, "kind" | "caption">>) {
    const item = this.items.get(id);
    if (!item) return null;
    const next = { ...item, ...(updates.kind ? { kind: updates.kind } : {}), ...(updates.caption !== undefined ? { caption: updates.caption || undefined } : {}) };
    this.items.set(id, next);
    const { originalBlob: _o, previewBlob: _p, ...meta } = next;
    return meta;
  }
  async deleteAttachment(id: string) {
    return this.items.delete(id);
  }
  async deleteAttachmentsByTradeId(tradeId: string) {
    const ids = [...this.items.values()].filter((a) => a.tradeId === tradeId).map((a) => a.id);
    ids.forEach((id) => this.items.delete(id));
    return ids.length;
  }
  async getStorageUsage(): Promise<AttachmentStorageEstimate> {
    return { bytesUsed: 0, bytesQuota: 1, percentage: 0, isWarning: false };
  }
  async requestPersistentStorage() {
    return true;
  }
  async cleanupOrphans() {
    return 0;
  }
}
