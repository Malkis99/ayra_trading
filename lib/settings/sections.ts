/**
 * Settings sections (docs/settings-sections-plan.md): one address per section, `/settings/<slug>`.
 * The order is the order of the menu (desktop) and of the list (phone).
 */
export const SETTINGS_SECTIONS = ["profile", "journal", "cloud", "account", "interface", "privacy"] as const;
export type SettingsSection = (typeof SETTINGS_SECTIONS)[number];

export const settingsHref = (section: SettingsSection, anchor?: string) => `/settings/${section}${anchor ? `#${anchor}` : ""}`;

export function isSettingsSection(value: unknown): value is SettingsSection {
  return typeof value === "string" && (SETTINGS_SECTIONS as readonly string[]).includes(value);
}

/** `/settings` (no section) opens the first section on wide screens and the list on a phone. */
export const DEFAULT_SETTINGS_SECTION: SettingsSection = "profile";
