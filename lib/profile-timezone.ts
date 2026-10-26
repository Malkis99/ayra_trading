import { AppStorage } from "@/lib/storage";

/**
 * Time zone of the account in the cloud profile (`profiles.timezone`, column from 0001 — no migration;
 * owner decision 2026-10-25). It is exchanged right after each cloud exchange of the journal, so it follows the
 * same rules: «Automatic» — by itself, «Manual» — on «Synchronise». Guests are not touched.
 *
 * The cloud column defaults to 'UTC' for every account, so 'UTC' that this device never saw counts as «not set yet».
 * Per device and account we keep the last value that matched the cloud and whether the local one changed since.
 */
export interface TimezoneSyncState {
  /** The value that last matched the cloud on this device (null: never exchanged here). */
  synced: string | null;
  /** Changed on this device since the last exchange. */
  dirty: boolean;
  /** When it was changed here (ISO), to compare with the cloud profile's updated_at. */
  changedAt?: string;
}

export interface CloudTimezone {
  timezone: string | null;
  updatedAt: string | null;
}

export type TimezoneAction = { kind: "none" } | { kind: "push"; value: string } | { kind: "take"; value: string };

const CLOUD_DEFAULT = "UTC";

export function decideTimezone(local: string | null, cloud: CloudTimezone, state: TimezoneSyncState): TimezoneAction {
  const cloudTz = cloud.timezone || null;
  const cloudNewerThanLocalChange = Boolean(cloud.updatedAt && state.changedAt && cloud.updatedAt > state.changedAt);

  if (state.synced === null) {
    // never exchanged on this device: a zone already set in the cloud wins; the default 'UTC' does not
    const cloudSet = cloudTz !== null && cloudTz !== CLOUD_DEFAULT;
    if (state.dirty && local && (!cloudSet || !cloudNewerThanLocalChange)) return local === cloudTz ? { kind: "none" } : { kind: "push", value: local };
    if (cloudSet) return local === cloudTz ? { kind: "none" } : { kind: "take", value: cloudTz! };
    return local && local !== cloudTz ? { kind: "push", value: local } : { kind: "none" };
  }

  const cloudChanged = cloudTz !== null && cloudTz !== state.synced;
  if (state.dirty && local && local !== state.synced) {
    // changed here and maybe on another device too: the newer change wins
    if (cloudChanged && cloudNewerThanLocalChange) return { kind: "take", value: cloudTz! };
    return local === cloudTz ? { kind: "none" } : { kind: "push", value: local };
  }
  if (cloudChanged) return local === cloudTz ? { kind: "none" } : { kind: "take", value: cloudTz! };
  return { kind: "none" };
}

const KEY = "ayra_tz_sync";

export function readTimezoneSync(userId: string): TimezoneSyncState {
  try {
    const raw = JSON.parse(AppStorage.getItem(KEY, userId) || "null");
    if (raw && typeof raw === "object") return { synced: typeof raw.synced === "string" ? raw.synced : null, dirty: Boolean(raw.dirty), changedAt: raw.changedAt };
  } catch {
    // broken value: start over
  }
  return { synced: null, dirty: false };
}

export function writeTimezoneSync(userId: string, state: TimezoneSyncState): void {
  AppStorage.setItem(KEY, JSON.stringify(state), userId);
}
