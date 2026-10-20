/**
 * What the Settings texts say about the account's journal in the cloud (T7b-4f).
 * null = guest or cloud sync off: the old «stored on this device» texts stay.
 */
export type CloudNoticeState = "synced" | "pending" | "conflict" | "notUploaded";

export interface CloudNoticeInput {
  cloudActive: boolean;
  /** The first upload is still to be done. */
  initialNeeded: boolean;
  pending: number;
  conflicts: number;
}

/** The most urgent wins: a choice, then the journal not uploaded yet, then unsent changes. */
export function cloudNoticeState(i: CloudNoticeInput): CloudNoticeState | null {
  if (!i.cloudActive) return null;
  if (i.conflicts > 0) return "conflict";
  if (i.initialNeeded) return "notUploaded";
  if (i.pending > 0) return "pending";
  return "synced";
}

/** Warning in the «Sign out and delete» confirmation: records waiting for a choice are not in the cloud either. */
export function signOutWarningState(i: CloudNoticeInput): Exclude<CloudNoticeState, "conflict"> | null {
  const s = cloudNoticeState(i);
  return s === "conflict" ? "pending" : s;
}
