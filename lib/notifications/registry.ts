/** Capabilities are deliberately off until a real server producer/delivery exists. */
export const CHANNELS = ["site", "web_push", "telegram", "email", "mobile_push"] as const;
export type NotificationChannel = (typeof CHANNELS)[number];
export const TYPES = {
  market_actual: { group: "market", critical: false, available: false },
  market_revision: { group: "market", critical: false, available: false },
  market_reminder_15: { group: "market", critical: false, available: false },
  market_reminder_5: { group: "market", critical: false, available: false },
  market_statement: { group: "market", critical: false, available: false },
  session_open: { group: "market", critical: false, available: false },
  session_close: { group: "market", critical: false, available: false },
  price_trigger: { group: "price", critical: false, available: false },
  quest: { group: "product", critical: false, available: false },
  streak: { group: "product", critical: false, available: false },
  daily_reward: { group: "product", critical: false, available: false },
  journal: { group: "product", critical: false, available: false },
  weekly_review: { group: "product", critical: false, available: false },
  security_new_device: { group: "security", critical: true, available: false },
  security_suspicious: { group: "security", critical: true, available: false },
  sync_incident: { group: "security", critical: false, available: false },
  community: { group: "community", critical: false, available: false },
} as const;
export type NotificationType = keyof typeof TYPES;
export const TYPE_CODES = Object.keys(TYPES) as NotificationType[];
export const isNotificationType = (value: string): value is NotificationType => Object.hasOwn(TYPES, value);
export const isCriticalType = (value: string) => isNotificationType(value) && TYPES[value].critical;

export function channelAvailable(type: NotificationType, channel: NotificationChannel): boolean {
  return TYPES[type].available && channel === "site";
}
