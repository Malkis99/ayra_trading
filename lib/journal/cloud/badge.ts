/**
 * Cloud badge in the header (T7b-4e): one state for the signed-in account with cloud sync on.
 * Pure function — the component only draws what this returns.
 */
export type SyncBadgeState = "synced" | "syncing" | "offline" | "error" | "conflict" | "waitingInitial";

export type SyncBadgeAction = "resolve" | "upload" | "retry" | null;

export interface SyncBadgeInput {
  /** Cloud sync is used for this account (flag on, signed in). */
  cloudActive: boolean;
  /** State of the account's sync engine (JournalCloudStatus.state). */
  state: "local" | "waitingInitialSync" | "syncing" | "synced" | "offline" | "error";
  /** Changes waiting to be sent (records in conflict excluded). */
  pending: number;
  /** Records the server would refuse (too large / time from the future). */
  blocked: number;
  conflicts: number;
  /** The first upload is still to be done (local data, never synced). */
  initialNeeded: boolean;
  /** navigator.onLine */
  online: boolean;
}

export interface SyncBadgeView {
  state: SyncBadgeState;
  action: SyncBadgeAction;
  /** Animate only while something is being sent (and never with reduced motion — the component decides). */
  busy: boolean;
}

/** null = no badge (guest, flag off). The most urgent thing wins: a choice, the first upload, no network, an error, sending. */
export function syncBadge(i: SyncBadgeInput): SyncBadgeView | null {
  if (!i.cloudActive) return null;
  if (i.conflicts > 0) return { state: "conflict", action: "resolve", busy: false };
  if (i.initialNeeded) return { state: "waitingInitial", action: "upload", busy: false };
  if (!i.online || i.state === "offline") return { state: "offline", action: i.pending > 0 ? "retry" : null, busy: false };
  if (i.state === "error") return { state: "error", action: "retry", busy: false };
  if (i.state === "syncing") return { state: "syncing", action: null, busy: true };
  if (i.pending > 0) return { state: "syncing", action: "retry", busy: false };
  return { state: "synced", action: null, busy: false };
}
