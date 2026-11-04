import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { PAGE_SIZE, defaultSettings, type NotificationItem, type NotificationPreference, type NotificationSettings } from "./types";

export class NotificationRepositoryError extends Error {
  constructor(public kind: "setup" | "network") { super(kind); }
}
function client() {
  const c = createSupabaseBrowserClient();
  if (!c) throw new NotificationRepositoryError("setup");
  return c;
}
function check(error: { code?: string } | null) {
  if (error) throw new NotificationRepositoryError(["42P01", "PGRST202", "PGRST205", "42703", "42501"].includes(error.code ?? "") ? "setup" : "network");
}
export const notificationRepository = {
  async settings(userId: string, timezone: string) {
    const c = client();
    const [s, p] = await Promise.all([
      c.from("notification_settings").select("all_disabled,quiet_enabled,quiet_start,quiet_end,timezone,min_importance,instrument_ids").eq("user_id", userId).maybeSingle(),
      c.from("notification_preferences").select("type_code,channel_code,enabled").eq("user_id", userId),
    ]);
    check(s.error); check(p.error);
    return { settings: s.data ? { ...s.data, quiet_start: s.data.quiet_start.slice(0, 5), quiet_end: s.data.quiet_end.slice(0, 5) } as NotificationSettings : defaultSettings(timezone), preferences: (p.data ?? []) as NotificationPreference[] };
  },
  async save(userId: string, settings: NotificationSettings, preferences: NotificationPreference[]) {
    // One transaction prevents a partially saved matrix/settings pair.
    const { error } = await client().rpc("save_notification_settings", { p_user_id: userId, p_settings: settings, p_preferences: preferences });
    check(error);
  },
  async list(userId: string, unread: boolean, type: string, before?: { created_at: string; id: string }) {
    let q = client().from("notifications").select("id,type_code,payload,href,created_at,read_at").eq("user_id", userId)
      .gte("created_at", new Date(Date.now() - 90 * 86400000).toISOString()).order("created_at", { ascending: false }).order("id", { ascending: false }).limit(PAGE_SIZE);
    if (unread) q = q.is("read_at", null);
    if (type) q = q.eq("type_code", type);
    if (before) q = q.or(`created_at.lt.${before.created_at},and(created_at.eq.${before.created_at},id.lt.${before.id})`);
    const { data, error } = await q; check(error);
    return (data ?? []).map((row) => {
      const payload: NotificationItem["payload"] = {};
      for (const key of ["subject", "actual", "previous", "source"] as const) {
        if (typeof row.payload?.[key] === "string") payload[key] = row.payload[key];
      }
      return { ...row, payload } as NotificationItem;
    });
  },
  async count(userId: string) {
    const { count, error } = await client().from("notifications").select("id", { count: "exact", head: true }).eq("user_id", userId).is("read_at", null)
      .gte("created_at", new Date(Date.now() - 90 * 86400000).toISOString());
    check(error); return count ?? 0;
  },
  async markRead(userId: string, id?: string) {
    let q = client().from("notifications").update({ read_at: new Date().toISOString() }).eq("user_id", userId).is("read_at", null)
      .gte("created_at", new Date(Date.now() - 90 * 86400000).toISOString());
    if (id) q = q.eq("id", id);
    const { error } = await q; check(error);
  },
};
