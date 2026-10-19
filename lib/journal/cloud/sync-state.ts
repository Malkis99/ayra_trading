import { AppStorage } from "@/lib/storage";

/**
 * Per-account sync state on this device (T7b-4). `initialSyncAt` is set once the first upload/download is done (4d);
 * until then nothing is sent automatically and cloud changes are not applied (plan section 3.1).
 */
export interface SyncStateData {
  initialSyncAt?: string;
  lastSyncAt?: string;
  /** The first upload was started (and maybe cancelled): the button offers to continue. */
  initialUploadStartedAt?: string;
}

const SYNC_STATE_KEY = "ayra_sync_state";

export function readSyncState(userId: string): SyncStateData {
  try {
    const raw = AppStorage.getItem(SYNC_STATE_KEY, userId);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function writeSyncState(userId: string, patch: Partial<SyncStateData>): void {
  try {
    AppStorage.setItem(SYNC_STATE_KEY, JSON.stringify({ ...readSyncState(userId), ...patch }), userId);
  } catch {}
}

export const isInitialSyncDone = (userId: string) => Boolean(readSyncState(userId).initialSyncAt);

/** Marks the first sync as done. Called by the first upload/download flow (4d) and by tests. */
export function markInitialSyncDone(userId: string, at: Date = new Date()): void {
  writeSyncState(userId, { initialSyncAt: at.toISOString() });
}
