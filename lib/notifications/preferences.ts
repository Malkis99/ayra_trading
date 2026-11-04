import { isCriticalType, type NotificationChannel } from "./registry";
import type { NotificationPreference, NotificationSettings } from "./types";
import { INSTRUMENT_IDS } from "@/lib/market/instruments";

export function validSettings(s: NotificationSettings): boolean {
  try { new Intl.DateTimeFormat("en", { timeZone: s.timezone }).format(); } catch { return false; }
  return typeof s.all_disabled === "boolean" && typeof s.quiet_enabled === "boolean"
    && /^([01]\d|2[0-3]):[0-5]\d$/.test(s.quiet_start) && /^([01]\d|2[0-3]):[0-5]\d$/.test(s.quiet_end)
    && (!s.quiet_enabled || s.quiet_start !== s.quiet_end)
    && [1, 2, 3].includes(s.min_importance) && s.instrument_ids.length <= INSTRUMENT_IDS.length
    && new Set(s.instrument_ids).size === s.instrument_ids.length
    && s.instrument_ids.every((id) => (INSTRUMENT_IDS as readonly string[]).includes(id));
}
export function preferenceEnabled(type: string, channel: NotificationChannel, prefs: NotificationPreference[]): boolean {
  if (isCriticalType(type) && channel === "site") return true;
  return prefs.find((p) => p.type_code === type && p.channel_code === channel)?.enabled ?? (channel === "site");
}
/** Future producers must use this policy. It does not activate any source or external channel. */
export function shouldStore(type: string, s: NotificationSettings, prefs: NotificationPreference[], importance = 3, instruments: string[] = []): boolean {
  if (isCriticalType(type)) return true;
  if (s.all_disabled || !preferenceEnabled(type, "site", prefs)) return false;
  if (type.startsWith("market_") && importance < s.min_importance) return false;
  return !instruments.length || !s.instrument_ids.length || instruments.some((id) => s.instrument_ids.includes(id));
}
export function inQuietHours(s: NotificationSettings, at: Date): boolean {
  if (!s.quiet_enabled) return false;
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: s.timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(at);
  const current = `${parts.find((p) => p.type === "hour")?.value}:${parts.find((p) => p.type === "minute")?.value}`;
  return s.quiet_start < s.quiet_end ? current >= s.quiet_start && current < s.quiet_end : current >= s.quiet_start || current < s.quiet_end;
}
export function safeNotificationHref(href: string | null): string | null {
  // Only same-app links. No external navigation, protocol-relative URLs or encoded path tricks.
  return href && /^\/(?!\/)[a-zA-Z0-9/_?=&.#%-]*$/.test(href) && !/%(?:2f|5c|0[ad])/i.test(href) ? href : null;
}
