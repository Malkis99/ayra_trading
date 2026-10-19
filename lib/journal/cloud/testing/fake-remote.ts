import type { JournalCloudRemote } from "../remote";
import type { JournalCloudReadRow, JournalCloudTable, JournalCloudWriteRow } from "../records";
import type { Trade } from "../../types";

/**
 * In-memory stand-in for the 0004 tables, for unit tests only: rows belong to the session user (RLS), the newer
 * client version wins (a refused older version is not in `written`), the server stamps updated_at.
 */
export class FakeRemote implements JournalCloudRemote {
  session: string | null;
  enabled = true;
  down = false;
  flagCalls = 0;
  upserts: { table: JournalCloudTable; rows: JournalCloudWriteRow[] }[] = [];
  rows = new Map<string, JournalCloudReadRow & { table: JournalCloudTable; user: string }>();
  /** Called after every fetchSince (to simulate another device writing in between). */
  afterFetch?: (table: JournalCloudTable) => void;
  private clock = Date.parse("2026-10-18T12:00:00Z");

  constructor(user: string | null) {
    this.session = user;
  }

  private net() {
    if (this.down) throw new Error("Failed to fetch");
  }
  async currentUserId() {
    return this.session;
  }
  async isSyncEnabled() {
    this.flagCalls++;
    this.net();
    return this.enabled;
  }
  /** Server clock, independent of the device clocks the test moves. When set, times > server + 5 min are refused (0004). */
  serverClock: (() => number) | null = null;

  async upsert(table: JournalCloudTable, rows: JournalCloudWriteRow[]) {
    this.net();
    if (this.serverClock) {
      const limit = this.serverClock() + 5 * 60 * 1000;
      // Like the 0004 trigger: one row from the future fails the whole request
      if (rows.some((r) => Date.parse(String(r.data.updatedAt)) > limit)) throw Object.assign(new Error("journal_row_from_future"), { code: "P0001" });
    }
    this.upserts.push({ table, rows });
    const written: string[] = [];
    for (const r of rows) if (this.put(table, r.id, r.data)) written.push(r.id);
    return { written };
  }
  async fetchByIds(table: JournalCloudTable, ids: string[]) {
    this.net();
    return ids.map((id) => this.rows.get(this.key(table, id))).filter((r): r is NonNullable<typeof r> => Boolean(r));
  }
  private key(table: JournalCloudTable, id: string, user = this.session) {
    return `${user}:${table}:${id}`;
  }
  /** Server-side write of the session user (or another device of it): an older client version is refused. */
  put(table: JournalCloudTable, id: string, data: Record<string, unknown>, user = this.session): boolean {
    const key = this.key(table, id, user);
    const old = this.rows.get(key);
    if (old && Date.parse(String(old.data.updatedAt)) > Date.parse(String(data.updatedAt))) return false;
    this.clock += 1000;
    this.rows.set(key, { table, id, user: user!, data: structuredClone(data), updated_at: new Date(this.clock).toISOString() });
    return true;
  }
  get(table: JournalCloudTable, id: string, user = this.session) {
    return this.rows.get(this.key(table, id, user));
  }
  async fetchSince(table: JournalCloudTable, since: string | null) {
    this.net();
    const out = [...this.rows.values()]
      .filter((r) => r.user === this.session && r.table === table && (!since || r.updated_at > since))
      .sort((a, b) => a.updated_at.localeCompare(b.updated_at));
    this.afterFetch?.(table);
    return out;
  }
  sent(table: JournalCloudTable) {
    return this.upserts.filter((u) => u.table === table).flatMap((u) => u.rows);
  }
}

export function trade(id: string, extra: Partial<Trade> = {}): Trade {
  return {
    id,
    accountId: "acc_1",
    instrument: "EURUSD",
    direction: "long",
    status: "closed",
    openedAt: "2026-10-17T09:00:00.000Z",
    result: "win",
    emotions: [],
    mistakes: [],
    verification: "unverified",
    source: "manual",
    createdAt: "2026-10-17T09:00:00.000Z",
    updatedAt: "2026-10-17T09:00:00.000Z",
    schemaVersion: 6,
    ...extra,
  };
}
