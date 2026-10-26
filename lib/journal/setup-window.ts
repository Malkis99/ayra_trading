import { AppStorage } from "@/lib/storage";
import { isE2EMockEnabled } from "@/lib/supabase/config";

/**
 * First-run setup window of the Journal (docs/journal-setup-plan.md, sections 5 and 11; owner decisions 2026-10-25).
 * - guests: never;
 * - once per account on this device (answered or skipped = seen);
 * - waits until the server said whether cloud sync is on (otherwise the cloud question could be missing);
 * - cloud on: shown once; if the journal settings already came from another device (or were set in Settings),
 *   only the per-device cloud question is asked;
 * - cloud off: only a new account (nothing in its journal on this device) sees it; existing users do not.
 */
export type SetupWindowMode = "full" | "cloudOnly";

export interface SetupWindowInput {
  signedIn: boolean;
  seen: boolean;
  cloudFlagKnown: boolean;
  cloudActive: boolean;
  /** No live accounts and trades of this account on this device. */
  journalEmpty: boolean;
  /** Journal settings exist already (synced from another device or set in Settings). */
  preferencesSet: boolean;
}

export function setupWindowMode(i: SetupWindowInput): SetupWindowMode | null {
  if (!i.signedIn || i.seen || !i.cloudFlagKnown) return null;
  if (i.cloudActive) return i.preferencesSet ? "cloudOnly" : "full";
  return i.journalEmpty && !i.preferencesSet ? "full" : null;
}

const SEEN_KEY = "ayra_journal_setup_seen";

export function readSetupSeen(userId: string): boolean {
  return AppStorage.getItem(SEEN_KEY, userId) === "1";
}

export function markSetupSeen(userId: string): void {
  AppStorage.setItem(SEEN_KEY, "1", userId);
}

/**
 * e2e builds (auth mock or the fake Supabase) do not show the window unless a test asks for it, so the other
 * scenarios are not interrupted. Production builds always show it by the rules above.
 */
export function setupWindowSuppressedForTests(): boolean {
  if (typeof window === "undefined") return false;
  const e2eBuild = isE2EMockEnabled() || process.env.NEXT_PUBLIC_AYRA_E2E_EMAIL_OPEN === "1";
  if (!e2eBuild) return false;
  return AppStorage.getItem("ayra_e2e_setup_window") !== "1";
}
