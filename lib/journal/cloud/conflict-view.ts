import type { Account, JournalSnapshot, SyncConflict } from "../types";
import type { ImportBatch } from "../import/batches";

/**
 * What the conflict dialog shows for one record (T7b-4c): kind, both versions' key fields (values, not labels — the
 * component translates field ids), which fields differ, when each version changed and whether one side deleted it.
 */
export type ConflictKind = "trade" | "note" | "dayPlan" | "weekPlan" | "account" | "strategy" | "noTrade" | "importBatch" | "settings";

export type ConflictFieldId =
  | "instrument"
  | "direction"
  | "result"
  | "r"
  | "account"
  | "date"
  | "notes"
  | "title"
  | "body"
  | "goals"
  | "summary"
  | "name"
  | "type"
  | "rules"
  | "reason"
  | "fileName"
  | "trades"
  | "primaryProp";

export interface ConflictField {
  id: ConflictFieldId;
  device: string;
  cloud: string;
  differs: boolean;
}

export type ConflictSituation = "bothEdited" | "deletedInCloud" | "deletedHere";

export interface ConflictView {
  table: string;
  id: string;
  kind: ConflictKind;
  situation: ConflictSituation;
  /** Short name of the record (instrument, note title, plan date...). */
  label: string;
  /** Date shown next to a trade's name (ISO; the component formats it). */
  labelDate?: string;
  deviceChangedAt?: string;
  cloudChangedAt?: string;
  fields: ConflictField[];
}

const KIND_BY_TABLE: Record<string, ConflictKind> = {
  journal_trades: "trade",
  journal_notes: "note",
  journal_day_plans: "dayPlan",
  journal_week_plans: "weekPlan",
  journal_accounts: "account",
  journal_strategies: "strategy",
  journal_no_trades: "noTrade",
  journal_import_batches: "importBatch",
  journal_settings: "settings",
};

type Rec = Record<string, unknown>;
const str = (v: unknown) => (v === undefined || v === null ? "" : String(v));
const short = (v: unknown, n = 80) => {
  const s = str(v).replace(/\s+/g, " ").trim();
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
};
const money = (v: unknown) => (typeof v === "number" ? (v > 0 ? `+${v.toFixed(2)}` : v.toFixed(2)) : "");
const rText = (v: unknown) => (typeof v === "number" ? `${v > 0 ? "+" : ""}${v.toFixed(2)} R` : "");

/** The device version of a record by cloud table and id (tombstones included). */
export function deviceRecord(snapshot: JournalSnapshot, batches: ImportBatch[], table: string, id: string): Rec | undefined {
  const find = (list: unknown[] | undefined, key = "id") => (list as Rec[] | undefined)?.find((r) => r[key] === id);
  switch (table) {
    case "journal_trades":
      return find(snapshot.trades);
    case "journal_notes":
      return find(snapshot.notes);
    case "journal_day_plans":
      return find(snapshot.plans, "date");
    case "journal_week_plans":
      return find(snapshot.weekPlans, "weekStartDate");
    case "journal_accounts":
      return find(snapshot.accounts);
    case "journal_strategies":
      return find(snapshot.strategies);
    case "journal_no_trades":
      return find(snapshot.noTrades);
    case "journal_import_batches":
      return find(batches);
    case "journal_settings":
      return { id: "journal", primaryPropAccountId: snapshot.primaryPropAccountId ?? null, updatedAt: snapshot.settingsUpdatedAt };
    default:
      return undefined;
  }
}

function fieldsOf(kind: ConflictKind, r: Rec, accountName: (id: unknown) => string): Partial<Record<ConflictFieldId, string>> {
  switch (kind) {
    case "trade":
      return {
        instrument: str(r.instrument),
        direction: str(r.direction),
        result: money(r.pnlMoney),
        r: rText(r.rMultiple),
        account: accountName(r.accountId),
        date: str(r.openedAt),
        notes: short(r.notes),
      };
    case "note":
      return { title: short(r.title, 60), body: short(r.body) };
    case "dayPlan":
      return { date: str(r.date), notes: short(r.note) };
    case "weekPlan":
      return { date: str(r.weekStartDate), goals: short(Array.isArray(r.goals) ? r.goals.join(" · ") : ""), summary: short(r.summary) };
    case "account":
      return { name: str(r.name), type: str(r.type) };
    case "strategy":
      return { name: str(r.name), rules: String(Array.isArray(r.rules) ? r.rules.length : 0) };
    case "noTrade":
      return { date: str(r.date), reason: str(r.reason), notes: short(r.note) };
    case "importBatch":
      return { fileName: str(r.fileName), trades: str(r.tradeCount) };
    case "settings":
      return { primaryProp: accountName(r.primaryPropAccountId) };
  }
}

export function describeConflict(conflict: SyncConflict, device: Rec | undefined, accounts: Account[] = []): ConflictView {
  const kind = KIND_BY_TABLE[conflict.table] ?? "trade";
  const cloud = conflict.cloud;
  const dev = device ?? {};
  const accountName = (id: unknown) => (id ? accounts.find((a) => a.id === id)?.name ?? str(id) : "");
  const situation: ConflictSituation = cloud.deletedAt ? "deletedInCloud" : dev.deletedAt ? "deletedHere" : "bothEdited";
  const d = fieldsOf(kind, dev, accountName);
  const c = fieldsOf(kind, cloud, accountName);
  const ids = Object.keys({ ...d, ...c }) as ConflictFieldId[];
  const fields = ids
    // differences matter only when both versions exist (a deleted side has nothing to compare)
    .map((id) => ({ id, device: d[id] ?? "", cloud: c[id] ?? "", differs: situation === "bothEdited" && (d[id] ?? "") !== (c[id] ?? "") }))
    // empty on both sides says nothing
    .filter((f) => f.device || f.cloud);
  const labelSource = situation === "deletedHere" ? cloud : dev;
  const label =
    kind === "trade"
      ? str(labelSource.instrument)
      : kind === "note"
        ? short(labelSource.title || labelSource.body, 60)
        : str(labelSource.name ?? labelSource.date ?? labelSource.weekStartDate ?? labelSource.fileName ?? conflict.id);
  return {
    table: conflict.table,
    id: conflict.id,
    kind,
    situation,
    label: label || conflict.id,
    labelDate: kind === "trade" ? str(labelSource.openedAt) || undefined : undefined,
    deviceChangedAt: str(dev.deletedAt ?? dev.updatedAt) || undefined,
    cloudChangedAt: str(cloud.deletedAt ?? cloud.updatedAt) || undefined,
    fields,
  };
}
