import type { SupabaseClient } from "@supabase/supabase-js";
import type { CloudRow, ShadowTable } from "@/lib/missions-shadow";
import type { ShadowJournalReader } from "./mission-shadow-handler";

const COLUMNS = "id,data,updated_at,client_updated_at,deleted_at";
const PAGE = 1000;

/**
 * The cloud journal of the signed-in user, read with the USER's session: row-level security of 0004 returns only the
 * user's own rows, and every query names the user too (two independent fences). No service key is used.
 */
export function supabaseJournalReader(client: SupabaseClient, userId: string): ShadowJournalReader {
  const fail = (e: unknown) => {
    if (e) throw new Error("cloud_read_failed"); // the database message never leaves the server
  };
  return {
    async timezone() {
      const { data, error } = await client.from("profiles").select("timezone").eq("id", userId).maybeSingle();
      fail(error);
      const tz = (data as { timezone?: unknown } | null)?.timezone;
      return typeof tz === "string" && tz ? tz : null;
    },
    async cloudSync() {
      const { data, error } = await client.from("user_features").select("cloud_sync").eq("user_id", userId).maybeSingle();
      fail(error);
      return (data as { cloud_sync?: unknown } | null)?.cloud_sync === true;
    },
    async allRows(table: ShadowTable, max: number) {
      const out: CloudRow[] = [];
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await client.from(table).select(COLUMNS).eq("user_id", userId).order("id").range(from, from + PAGE - 1);
        fail(error);
        const rows = (data || []) as unknown as CloudRow[];
        out.push(...rows);
        if (out.length > max) return "tooMany";
        if (rows.length < PAGE) return out;
      }
    },
    async rowsById(table: ShadowTable, ids: string[]) {
      if (ids.length === 0) return [];
      const { data, error } = await client.from(table).select(COLUMNS).eq("user_id", userId).in("id", ids);
      fail(error);
      return (data || []) as unknown as CloudRow[];
    },
  };
}
