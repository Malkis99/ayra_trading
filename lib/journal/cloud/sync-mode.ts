import { AppStorage } from "@/lib/storage";

/**
 * How this device exchanges the account's journal with the cloud (owner decision 2026-10-21):
 * - "auto": every change goes up by itself; changes from other devices come down on open, on return to the tab,
 *   when the network is back and every 5 minutes;
 * - "manual": nothing is sent or fetched by itself; changes wait on the device until «Synchronise» is pressed.
 * Kept per device (in this account's space on this browser), never synced. Default: auto.
 */
export type SyncMode = "auto" | "manual";

const KEY = "ayra_sync_mode";

export function readSyncMode(userId: string): SyncMode {
  return AppStorage.getItem(KEY, userId) === "manual" ? "manual" : "auto";
}

export function writeSyncMode(userId: string, mode: SyncMode): void {
  AppStorage.setItem(KEY, mode, userId);
}
