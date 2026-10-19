import type { SupabaseClient } from "@supabase/supabase-js";
import type { JournalCloudReadRow, JournalCloudTable, JournalCloudWriteRow } from "./records";
import { JOURNAL_CLOUD_PAGE_SIZE } from "./config";

/** Network side of the cloud journal. Every method may throw on network/server errors; the repository catches. */
export interface JournalCloudRemote {
  /** User of the current cloud session, or null when signed out / not configured. */
  currentUserId(): Promise<string | null>;
  /** user_features.cloud_sync for this user (0004). No row = off. */
  isSyncEnabled(userId: string): Promise<boolean>;
  /**
   * Insert or update by (user_id, id). The server keeps the newer version: rows it did not take (an older version
   * than the one already stored) are missing from the returned ids.
   */
  upsert(table: JournalCloudTable, rows: JournalCloudWriteRow[]): Promise<{ written: string[] }>;
  /** Current cloud rows by id (to see what the server kept instead of a refused version). */
  fetchByIds(table: JournalCloudTable, ids: string[]): Promise<JournalCloudReadRow[]>;
  /** Rows changed after `since` (server time), oldest first; all rows when `since` is null. */
  fetchSince(table: JournalCloudTable, since: string | null): Promise<JournalCloudReadRow[]>;
}

export class JournalCloudError extends Error {
  constructor(
    public readonly op: string,
    public readonly code: string | undefined,
    message: string
  ) {
    super(message);
    this.name = "JournalCloudError";
  }
}

type ErrorLike = { code?: string; message?: string } | null;

function check(op: string, error: ErrorLike): void {
  if (error) throw new JournalCloudError(op, error.code, error.message || op);
}

/** Supabase implementation: the client is resolved lazily (null = Supabase not configured). */
export class SupabaseJournalRemote implements JournalCloudRemote {
  constructor(private readonly getClient: () => SupabaseClient | null) {}

  private client(): SupabaseClient {
    const c = this.getClient();
    if (!c) throw new JournalCloudError("client", undefined, "Supabase is not configured");
    return c;
  }

  async currentUserId(): Promise<string | null> {
    const c = this.getClient();
    if (!c) return null;
    const { data } = await c.auth.getSession();
    return data.session?.user?.id ?? null;
  }

  async isSyncEnabled(userId: string): Promise<boolean> {
    const { data, error } = await this.client()
      .from("user_features")
      .select("cloud_sync")
      .eq("user_id", userId)
      .maybeSingle();
    check("isSyncEnabled", error);
    return (data as { cloud_sync?: boolean } | null)?.cloud_sync === true;
  }

  async upsert(table: JournalCloudTable, rows: JournalCloudWriteRow[]): Promise<{ written: string[] }> {
    if (rows.length === 0) return { written: [] };
    // Only id, data and device_id: user_id comes from the session (auth.uid()), the rest is filled by the server.
    // Rows skipped by the server's last-write-wins trigger are not returned.
    const { data, error } = await this.client().from(table).upsert(rows, { onConflict: "user_id,id" }).select("id");
    check(`upsert:${table}`, error);
    return { written: ((data || []) as { id: string }[]).map((r) => r.id) };
  }

  async fetchByIds(table: JournalCloudTable, ids: string[]): Promise<JournalCloudReadRow[]> {
    if (ids.length === 0) return [];
    const { data, error } = await this.client().from(table).select("id, data, updated_at").in("id", ids);
    check(`fetchByIds:${table}`, error);
    return (data || []) as JournalCloudReadRow[];
  }

  async fetchSince(table: JournalCloudTable, since: string | null): Promise<JournalCloudReadRow[]> {
    const out: JournalCloudReadRow[] = [];
    for (let from = 0; ; from += JOURNAL_CLOUD_PAGE_SIZE) {
      let query = this.client().from(table).select("id, data, updated_at");
      if (since) query = query.gt("updated_at", since);
      const { data, error } = await query
        .order("updated_at", { ascending: true })
        .order("id", { ascending: true })
        .range(from, from + JOURNAL_CLOUD_PAGE_SIZE - 1);
      check(`fetch:${table}`, error);
      const page = (data || []) as JournalCloudReadRow[];
      out.push(...page);
      if (page.length < JOURNAL_CLOUD_PAGE_SIZE) return out;
    }
  }
}
