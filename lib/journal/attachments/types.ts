export type AttachmentKind = "before" | "after" | "other";

export interface AttachmentMetadata {
  id: string;
  tradeId: string;
  kind: AttachmentKind;
  width: number;
  height: number;
  bytes: number;
  mime: "image/png" | "image/jpeg" | "image/webp";
  hash: string; // SHA-256 hex string
  createdAt: string; // ISO string
  caption?: string; // Max 120 chars
}

export interface AttachmentRecord extends AttachmentMetadata {
  originalBlob: Blob;
  previewBlob: Blob;
}

export interface AttachmentStorageEstimate {
  bytesUsed: number;
  bytesQuota: number;
  percentage: number;
  isWarning: boolean; // >= 80%
}

export interface AttachmentRepository {
  addAttachment(
    record: Omit<AttachmentRecord, "id" | "createdAt"> & { id?: string; createdAt?: string }
  ): Promise<AttachmentRecord>;
  getAttachment(id: string): Promise<AttachmentRecord | null>;
  getAttachmentsByTradeId(tradeId: string): Promise<AttachmentRecord[]>;
  getAllMetadata(): Promise<AttachmentMetadata[]>;
  updateMetadata(
    id: string,
    updates: Partial<Pick<AttachmentMetadata, "kind" | "caption">>
  ): Promise<AttachmentMetadata | null>;
  deleteAttachment(id: string): Promise<boolean>;
  deleteAttachmentsByTradeId(tradeId: string): Promise<number>;
  getStorageUsage(): Promise<AttachmentStorageEstimate>;
  requestPersistentStorage(): Promise<boolean>;
  cleanupOrphans(validTradeIds: Set<string>): Promise<number>;
}
