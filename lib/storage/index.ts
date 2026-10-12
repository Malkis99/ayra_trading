import { DEVICE_KEYS, isDeviceKey } from "./device-keys";

export const GUEST_SPACE_ID = "guest";
export const CURRENT_STORAGE_SCHEMA_VERSION = 1;
export const STORAGE_SCHEMA_KEY = "ayra_storage_schema_version";

const UUID_REGEX = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const MOCK_USER_ID_REGEX = /^(mock-user-id-[\w-]+|mock-[\w-]+)$/;

export type StorageSpace =
  | { isGuest: true }
  | { isGuest: false; userId: string };

/**
 * Validates userId format. Must be a valid UUID or mock user ID.
 */
export function validateUserId(userId: string): void {
  if (!userId || typeof userId !== "string") {
    throw new Error("Invalid userId: must be a non-empty string.");
  }
  if (!UUID_REGEX.test(userId) && !MOCK_USER_ID_REGEX.test(userId)) {
    throw new Error(
      `Invalid userId format: "${userId}". Expected standard UUID or valid mock ID.`
    );
  }
}

/**
 * Validates key name. Cannot contain colons or whitespace.
 */
export function validateKeyName(keyName: string): void {
  if (!keyName || typeof keyName !== "string") {
    throw new Error("Invalid keyName: must be a non-empty string.");
  }
  if (/[:\s]/.test(keyName)) {
    throw new Error(
      `Invalid keyName: "${keyName}". Key names cannot contain colons or whitespace.`
    );
  }
}

/**
 * Builds the canonical storage key for a space and key name.
 */
export function buildKey(space: StorageSpace, name: string): string {
  if (isDeviceKey(name)) {
    return name;
  }

  if (space.isGuest) {
    validateKeyName(name);
    return name;
  }

  validateUserId(space.userId);
  validateKeyName(name);

  return `ayra:${space.userId}:${name}`;
}

export interface ParsedKey {
  isDevice: boolean;
  isGuest: boolean;
  userId: string | null;
  keyName: string;
}

/**
 * Parses a raw storage key into space details and original key name.
 */
export function parseKey(key: string): ParsedKey {
  if (isDeviceKey(key)) {
    return {
      isDevice: true,
      isGuest: false,
      userId: null,
      keyName: key,
    };
  }

  if (key.startsWith("ayra:")) {
    const parts = key.split(":");
    if (parts.length === 3 && parts[0] === "ayra") {
      return {
        isDevice: false,
        isGuest: false,
        userId: parts[1],
        keyName: parts[2],
      };
    }
  }

  return {
    isDevice: false,
    isGuest: true,
    userId: null,
    keyName: key,
  };
}

class AppStorageImpl {
  private activeUserId: string | null = null;
  private schemaVersionInitialized = false;

  constructor() {
    this.ensureSchemaVersion();
  }

  /**
   * Sets current active user ID for storage scoping.
   */
  public setUserId(userId: string | null): void {
    if (userId !== null && userId !== undefined && userId !== "") {
      validateUserId(userId);
      this.activeUserId = userId;
    } else {
      this.activeUserId = null;
    }
  }

  /**
   * Returns current active user ID.
   */
  public getUserId(): string | null {
    return this.activeUserId;
  }

  /**
   * Resolves storage space given optional user ID override.
   */
  public resolveSpace(userIdOverride?: string | null): StorageSpace {
    const uid =
      userIdOverride !== undefined ? userIdOverride : this.activeUserId;
    if (!uid) {
      return { isGuest: true };
    }
    return { isGuest: false, userId: uid };
  }

  /**
   * Reads item from localStorage for the given/current space.
   */
  public getItem(key: string, userIdOverride?: string | null): string | null {
    if (typeof window === "undefined") return null;

    try {
      const space = this.resolveSpace(userIdOverride);
      const fullKey = buildKey(space, key);
      return localStorage.getItem(fullKey);
    } catch (e) {
      console.error(`[AppStorage] Failed to getItem for key "${key}":`, e);
      return null;
    }
  }

  /**
   * Writes item to localStorage for the given/current space.
   */
  public setItem(
    key: string,
    value: string,
    userIdOverride?: string | null
  ): void {
    if (typeof window === "undefined") return;

    try {
      const space = this.resolveSpace(userIdOverride);
      const fullKey = buildKey(space, key);
      localStorage.setItem(fullKey, value);
    } catch (e) {
      console.error(`[AppStorage] Failed to setItem for key "${key}":`, e);
    }
  }

  /**
   * Removes item from localStorage for the given/current space.
   */
  public removeItem(key: string, userIdOverride?: string | null): void {
    if (typeof window === "undefined") return;

    try {
      const space = this.resolveSpace(userIdOverride);
      const fullKey = buildKey(space, key);
      localStorage.removeItem(fullKey);
    } catch (e) {
      console.error(`[AppStorage] Failed to removeItem for key "${key}":`, e);
    }
  }

  /**
   * Clears space-specific items from localStorage.
   */
  public clear(userIdOverride?: string | null): void {
    if (typeof window === "undefined") return;

    try {
      const space = this.resolveSpace(userIdOverride);
      const keysToRemove: string[] = [];

      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!k) continue;

        if (space.isGuest) {
          const parsed = parseKey(k);
          if (parsed.isGuest && !parsed.isDevice) {
            keysToRemove.push(k);
          }
        } else {
          const prefix = `ayra:${space.userId}:`;
          if (k.startsWith(prefix)) {
            keysToRemove.push(k);
          }
        }
      }

      for (const k of keysToRemove) {
        localStorage.removeItem(k);
      }
    } catch (e) {
      console.error("[AppStorage] Failed to clear storage space:", e);
    }
  }

  /**
   * Calculates storage usage for the specified space.
   */
  public getStorageUsage(userIdOverride?: string | null): {
    bytesUsed: number;
    bytesLimit: number;
    percentage: number;
    isWarning: boolean;
  } {
    if (typeof window === "undefined") {
      return { bytesUsed: 0, bytesLimit: 5 * 1024 * 1024, percentage: 0, isWarning: false };
    }

    let totalBytes = 0;
    const space = this.resolveSpace(userIdOverride);
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key) {
        const parsed = parseKey(key);
        if (space.isGuest && parsed.isGuest && !parsed.isDevice) {
          const val = localStorage.getItem(key);
          if (val) totalBytes += key.length + val.length;
        } else if (!space.isGuest && parsed.userId === space.userId) {
          const val = localStorage.getItem(key);
          if (val) totalBytes += key.length + val.length;
        }
      }
    }

    const limit = 5 * 1024 * 1024;
    const percentage = (totalBytes / limit) * 100;

    return {
      bytesUsed: totalBytes,
      bytesLimit: limit,
      percentage,
      isWarning: percentage >= 80,
    };
  }

  /**
   * Returns IndexedDB database name for attachments scoped to current or target space.
   */
  public getAttachmentDbName(userIdOverride?: string | null): string {
    const space = this.resolveSpace(userIdOverride);
    if (space.isGuest) {
      return "ayra_attachments_v1";
    }
    validateUserId(space.userId);
    return `ayra:${space.userId}:ayra_attachments_v1`;
  }

  /**
   * Ensures storage schema version tag is set in guest space on startup without altering data.
   */
  public ensureSchemaVersion(): void {
    if (typeof window === "undefined") return;

    try {
      const current = localStorage.getItem(STORAGE_SCHEMA_KEY);
      if (!current) {
        localStorage.setItem(
          STORAGE_SCHEMA_KEY,
          String(CURRENT_STORAGE_SCHEMA_VERSION)
        );
      }
      this.schemaVersionInitialized = true;
    } catch {
      // Ignore storage access errors in SSR/sandboxes
    }
  }
}

export const AppStorage = new AppStorageImpl();
