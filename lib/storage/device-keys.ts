/**
 * Device-wide keys list (lib/storage/device-keys.ts).
 * These keys are stored unprefixed and shared across the device/browser session.
 * They MUST NOT contain user personal data, emails, tokens, game state, journal data, onboarding, or attachments.
 */

export const DEVICE_KEYS = [
  "ayra_lang",
  "ayra_guest_dismissed",
  "ayra_guest_banner_dismissed",
  "ayra_awakening_lease",
  "ayra_auth_event",
  "ayra_mock_auth_v1",
] as const;

export type DeviceKey = (typeof DEVICE_KEYS)[number];

const DEVICE_KEYS_SET = new Set<string>(DEVICE_KEYS);

/**
 * Checks if a given key is registered as a device-wide key.
 */
export function isDeviceKey(key: string): boolean {
  return DEVICE_KEYS_SET.has(key);
}
