import { AppStorage, parseKey, validateUserId, STORAGE_SCHEMA_KEY, GUEST_SPACE_ID } from "./index";
import { IndexedDBAttachmentRepository } from "./indexeddb-repository";
import { INITIAL_GAME_STATE } from "@/lib/game";
import { spaceTabChannel } from "@/lib/auth/space-channel";

const GAME_KEY = "ayra_demo_v1";
const JOURNAL_KEY = "ayra_journal_v1";

/**
 * Account-space key recording the decision made on /profile-select,
 * so the screen is offered at most once per account on this device.
 */
export const PROFILE_CHOICE_KEY = "ayra_profile_choice";
export type ProfileChoice = "copied" | "fresh";

export interface SpaceSummary {
  hasData: boolean;
  nickname: string | null;
  level: number;
  tradesCount: number;
  onboardingStatus: string;
  appearance: unknown;
  equipment: Record<string, number>;
}

function readJson(key: string, userId: string | null): any {
  try {
    const raw = AppStorage.getItem(key, userId);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/**
 * Summarizes the game/journal data stored in a space (null = guest).
 * A space "has data" only if it differs from what a fresh app writes on first load.
 */
export function summarizeSpace(userId: string | null): SpaceSummary {
  const game = readJson(GAME_KEY, userId);
  const journal = readJson(JOURNAL_KEY, userId);

  const onboardingStatus: string = game?.onboarding?.status || "none";
  const level = typeof game?.level === "number" ? game.level : 1;
  const name = typeof game?.name === "string" ? game.name.trim() : "";
  const tradesCount = Array.isArray(journal?.trades) ? journal.trades.length : 0;
  const journalItems =
    tradesCount +
    (Array.isArray(journal?.accounts) ? journal.accounts.length : 0) +
    (Array.isArray(journal?.notes) ? journal.notes.length : 0);

  const gameHasData =
    !!game &&
    (onboardingStatus !== "none" ||
      level > 1 ||
      (game.xp ?? 0) > 0 ||
      (game.coins ?? 0) > 0 ||
      (name !== "" && name !== INITIAL_GAME_STATE.name));

  return {
    hasData: gameHasData || journalItems > 0,
    nickname: name || null,
    level,
    tradesCount,
    onboardingStatus,
    appearance: game?.profile?.appearance ?? null,
    equipment: game?.equipment && typeof game.equipment === "object" ? game.equipment : {},
  };
}

export function getProfileChoice(userId: string): ProfileChoice | null {
  const value = AppStorage.getItem(PROFILE_CHOICE_KEY, userId);
  return value === "copied" || value === "fresh" ? value : null;
}

export function setProfileChoice(userId: string, choice: ProfileChoice): void {
  AppStorage.setItem(PROFILE_CHOICE_KEY, choice, userId);
}

/**
 * True when a freshly signed-in account should be asked whether to reuse the guest profile:
 * the cloud profile has no nickname yet, no decision was recorded, the account space on this
 * device is still empty, and the guest space holds real data.
 */
export function shouldOfferProfileSelect(
  userId: string,
  cloudNickname: string | null | undefined
): boolean {
  if (typeof window === "undefined") return false;
  if (cloudNickname && cloudNickname.trim().length > 0) return false;
  if (getProfileChoice(userId)) return false;
  if (summarizeSpace(userId).hasData) return false;
  return summarizeSpace(null).hasData;
}

/**
 * Lists guest-space app keys that belong to the guest profile (excludes device keys,
 * the schema tag and any non-AYRA keys such as auth session storage).
 */
export function listGuestDataKeys(): string[] {
  if (typeof window === "undefined") return [];
  const keys: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (!k || !k.startsWith("ayra_") || k === STORAGE_SCHEMA_KEY) continue;
    const parsed = parseKey(k);
    if (parsed.isGuest && !parsed.isDevice) keys.push(k);
  }
  return keys;
}

/**
 * Copies the guest profile (IndexedDB attachments, then localStorage keys) into the account space
 * and reloads this tab's providers from it. Guest data is left untouched.
 * The account space must be the active space.
 */
export async function copyGuestToAccount(
  userId: string,
  options: { nickname?: string | null } = {}
): Promise<{ copiedKeys: number; copiedAttachments: number; failedAttachments: number }> {
  validateUserId(userId);
  if (AppStorage.getActiveSpaceId() !== `account:${userId}`) {
    throw new Error("copyGuestToAccount requires the target account to be the active space.");
  }

  let copiedAttachments = 0;
  let failedAttachments = 0;
  try {
    const guestRepo = new IndexedDBAttachmentRepository(null);
    const accountRepo = new IndexedDBAttachmentRepository(userId);
    const metadata = await guestRepo.getAllMetadata();
    for (const meta of metadata) {
      try {
        const record = await guestRepo.getAttachment(meta.id);
        if (!record) continue;
        const existing = await accountRepo.getAttachment(record.id);
        if (!existing) await accountRepo.addAttachment(record);
        copiedAttachments++;
      } catch {
        failedAttachments++;
      }
    }
  } catch {
    // IndexedDB unavailable: localStorage data is still copied
  }

  // Synchronous from here on: copy keys and reload providers before any provider can save
  // its in-memory (empty) account state over the copied data.
  const keys = listGuestDataKeys();
  for (const key of keys) {
    let value = AppStorage.getItem(key, null);
    if (value === null) continue;
    if (key === GAME_KEY && options.nickname) {
      value = withNickname(value, options.nickname);
    }
    AppStorage.setItem(key, value, userId);
  }
  const spaceId = AppStorage.getActiveSpaceId();
  spaceTabChannel.notifyLocal(spaceId, spaceId);

  return { copiedKeys: keys.length, copiedAttachments, failedAttachments };
}

/** The cloud nickname always wins over the copied guest name. */
function withNickname(rawGame: string, nickname: string): string {
  try {
    const game = JSON.parse(rawGame);
    game.name = nickname;
    if (game.onboarding?.answers) game.onboarding.answers.nickname = nickname;
    return JSON.stringify(game);
  } catch {
    return rawGame;
  }
}

export interface GuestExport {
  app: "AYRA";
  kind: "guest-device-data";
  version: 1;
  exportedAt: string;
  attachmentsCount: number;
  data: Record<string, unknown>;
}

/**
 * Builds a JSON export of the guest profile. Screenshot files are not included (binary);
 * only their count is reported.
 */
export async function exportGuestData(): Promise<GuestExport> {
  const data: Record<string, unknown> = {};
  for (const key of listGuestDataKeys()) {
    const raw = AppStorage.getItem(key, null);
    if (raw === null) continue;
    try {
      data[key] = JSON.parse(raw);
    } catch {
      data[key] = raw;
    }
  }

  let attachmentsCount = 0;
  try {
    attachmentsCount = (await new IndexedDBAttachmentRepository(null).getAllMetadata()).length;
  } catch {
    // IndexedDB unavailable
  }

  return {
    app: "AYRA",
    kind: "guest-device-data",
    version: 1,
    exportedAt: new Date().toISOString(),
    attachmentsCount,
    data,
  };
}

/**
 * Empties the attachments store of a space's database without creating the database
 * when it does not exist (a store-less database would break later opens).
 */
function clearAttachmentStore(dbName: string): Promise<void> {
  return new Promise((resolve) => {
    const idb = typeof window !== "undefined" ? window.indexedDB : undefined;
    if (!idb) {
      resolve();
      return;
    }
    const request = idb.open(dbName);
    request.onupgradeneeded = () => {
      request.transaction?.abort();
    };
    request.onerror = () => resolve();
    request.onsuccess = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("attachments")) {
        db.close();
        resolve();
        return;
      }
      const tx = db.transaction("attachments", "readwrite");
      tx.objectStore("attachments").clear();
      tx.oncomplete = tx.onerror = tx.onabort = () => {
        db.close();
        resolve();
      };
    };
  });
}

/**
 * Deletes the guest profile from this device. Only allowed while an account is active,
 * so no in-memory provider can write the guest data back.
 */
export async function deleteGuestData(): Promise<{ removedKeys: number }> {
  if (AppStorage.getActiveSpaceId() === GUEST_SPACE_ID) {
    throw new Error("deleteGuestData requires an account to be the active space.");
  }
  const keys = listGuestDataKeys();
  for (const key of keys) AppStorage.removeItem(key, null);
  await clearAttachmentStore(AppStorage.getAttachmentDbName(null));
  return { removedKeys: keys.length };
}

/**
 * Deletes an account's data from this device (not from the cloud).
 * The account must no longer be the active space (sign out first).
 */
export async function deleteAccountDeviceData(userId: string): Promise<{ removedKeys: number }> {
  validateUserId(userId);
  if (AppStorage.getActiveSpaceId() === `account:${userId}`) {
    throw new Error("deleteAccountDeviceData requires signing out of the account first.");
  }
  const prefix = `ayra:${userId}:`;
  const keys: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith(prefix)) keys.push(k);
  }
  for (const k of keys) localStorage.removeItem(k);
  await clearAttachmentStore(AppStorage.getAttachmentDbName(userId));
  return { removedKeys: keys.length };
}
