import type { NotificationChannel, NotificationType } from "./registry";

export interface NotificationSettings {
  all_disabled: boolean;
  quiet_enabled: boolean;
  quiet_start: string;
  quiet_end: string;
  timezone: string;
  min_importance: number;
  instrument_ids: string[];
}
export interface NotificationPreference {
  type_code: NotificationType;
  channel_code: NotificationChannel;
  enabled: boolean;
}
export interface NotificationItem {
  id: string;
  type_code: string;
  payload: { subject?: string; actual?: string; previous?: string; source?: string };
  href: string | null;
  created_at: string;
  read_at: string | null;
}
export type NotificationError = "setup" | "network";
export const PAGE_SIZE = 20;
export function defaultSettings(timezone = "UTC"): NotificationSettings {
  return { all_disabled: false, quiet_enabled: false, quiet_start: "22:00", quiet_end: "08:00", timezone,
    min_importance: 1, instrument_ids: [] };
}
