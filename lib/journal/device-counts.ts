import type { JournalSnapshot } from "./types";

/** Journal kinds in the order of the owner's cloud check (`supabase/checks/cloud_sync_owner.sql`). */
export const DEVICE_COUNT_KINDS = [
  { table: "journal_accounts", field: "accounts" },
  { table: "journal_trades", field: "trades" },
  { table: "journal_strategies", field: "strategies" },
  { table: "journal_notes", field: "notes" },
  { table: "journal_no_trades", field: "noTrades" },
  { table: "journal_day_plans", field: "plans" },
  { table: "journal_week_plans", field: "weekPlans" },
] as const;

export type DeviceCountTable = (typeof DEVICE_COUNT_KINDS)[number]["table"];
type CountSource = Partial<Pick<JournalSnapshot, (typeof DEVICE_COUNT_KINDS)[number]["field"]>>;

/**
 * How many journal records of the open account are on this device, per cloud table.
 * Deleted records are not counted, the same as the `live` column of the cloud check; archived ones are.
 */
export function deviceJournalCounts(source: CountSource): { table: DeviceCountTable; count: number }[] {
  return DEVICE_COUNT_KINDS.map(({ table, field }) => ({
    table,
    count: ((source[field] || []) as { deletedAt?: string | null }[]).filter((r) => !r.deletedAt).length,
  }));
}
