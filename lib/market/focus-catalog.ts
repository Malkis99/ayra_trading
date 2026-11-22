import { FOCUS_FIELDS, FOCUS_ITEM_LIMIT, FocusDataError, customFocusId, focusText, focusUuid, parseFocus, type FocusField } from "./market-focus";
import { isValidTime } from "./sessions";
import type { InstrumentId } from "./instruments";

export const FOCUS_CATALOG_NOTICE = "__focus_catalog__";
export type CustomSession = { start: string; end: string; zone: string } & Record<string, unknown>;
export type CatalogItem = { version: 1; spaceId: string; kind: FocusField; id: string; revision: number; label: string; deleted: boolean; session?: CustomSession } & Record<string, unknown>;
export type FocusCatalog = { version: 1; revision: number; items: CatalogItem[] } & Record<string, unknown>;
export type CatalogSnapshot = { catalog: FocusCatalog; references: Record<string, string[]>; referencesKnown: boolean };
export type CatalogCommand = { create: string; kind: FocusField; label: string; session?: CustomSession }
  | { update: string; itemRevision: number; label: string; session?: CustomSession }
  | { remove: string; itemRevision: number; references: string[] };
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const revision = (n: unknown): n is number => Number.isSafeInteger(n) && Number(n) >= 0 && Number(n) < Number.MAX_SAFE_INTEGER;
export function validateCustomSession(raw: unknown): CustomSession {
  if (!object(raw) || typeof raw.start !== "string" || typeof raw.end !== "string" || !isValidTime(raw.start) || !isValidTime(raw.end) || raw.start === raw.end
    || typeof raw.zone !== "string" || !/^[A-Za-z_]+(?:\/[A-Za-z0-9_+\-]+)*$/.test(raw.zone)) throw new FocusDataError("invalid");
  try { new Intl.DateTimeFormat("en", { timeZone: raw.zone }).format(); } catch { throw new FocusDataError("invalid"); }
  return raw as CustomSession;
}
export function catalogFromPreference(raw: unknown, space: string): FocusCatalog {
  if (raw === undefined || raw === null) return { version: 1, revision: 0, items: [] };
  if (!object(raw) || raw.spaceId !== space || raw.version !== 1 || typeof raw.selectedInstrumentId !== "string") throw new FocusDataError(typeof (raw as Record<string,unknown> | null)?.version === "number" && Number((raw as Record<string,unknown>).version) > 1 ? "unsupported" : "invalid");
  if (raw.customCatalog === undefined) return { version: 1, revision: 0, items: [] };
  const catalog = raw.customCatalog;
  if (!object(catalog) || catalog.version !== 1) throw new FocusDataError("unsupported");
  if (!revision(catalog.revision) || !Array.isArray(catalog.items)) throw new FocusDataError("invalid");
  const ids = new Set<string>(), items = catalog.items;
  for (const item of items) {
    if (!object(item) || item.version !== 1 || !Object.hasOwn(FOCUS_FIELDS, String(item.kind))) throw new FocusDataError("unsupported");
    if (item.spaceId !== space || !focusUuid(item.id) || ids.has(item.id) || !revision(item.revision) || item.revision < 1 || typeof item.label !== "string" || focusText(item.label) !== item.label || typeof item.deleted !== "boolean") throw new FocusDataError("invalid");
    if (item.kind === "session") validateCustomSession(item.session);
    ids.add(item.id);
  }
  if (Object.keys(FOCUS_FIELDS).some(kind => items.filter(item => item.kind === kind && !item.deleted).length > FOCUS_ITEM_LIMIT)) throw new FocusDataError("invalid");
  return catalog as FocusCatalog;
}
export function catalogSnapshot(preference: unknown, rows: unknown[], space: string): CatalogSnapshot {
  const catalog = catalogFromPreference(preference, space), references: Record<string, string[]> = {};
  let referencesKnown = true;
  for (const row of rows) {
    try {
      if (!object(row) || row.spaceId !== space || typeof row.instrumentId !== "string") throw new FocusDataError("invalid");
      const entry = parseFocus(row, space, row.instrumentId as InstrumentId);
      for (const field of Object.keys(FOCUS_FIELDS) as FocusField[]) { const id = customFocusId(entry, field); if (id) (references[id] ??= []).push(entry.instrumentId); }
    } catch { referencesKnown = false; }
  }
  for (const id of Object.keys(references)) references[id].sort();
  return { catalog, references, referencesKnown };
}
export function patchCatalog(snapshot: CatalogSnapshot, command: CatalogCommand, space: string): FocusCatalog {
  const old = snapshot.catalog, items = old.items.slice();
  if ("create" in command) {
    if (!focusUuid(command.create) || !Object.hasOwn(FOCUS_FIELDS, command.kind)) throw new FocusDataError("invalid");
    if (items.some(item => item.id === command.create)) throw new FocusDataError("conflict");
    if (items.filter(item => item.kind === command.kind && !item.deleted).length >= FOCUS_ITEM_LIMIT) throw new FocusDataError("limit");
    const session = command.kind === "session" ? validateCustomSession(command.session) : undefined;
    items.push({ version: 1, spaceId: space, kind: command.kind, id: command.create, label: focusText(command.label), revision: 1, deleted: false, ...(session ? { session } : {}) });
  } else {
    const index = items.findIndex(item => item.id === ("update" in command ? command.update : command.remove)), item = items[index];
    if (!item || item.deleted || item.revision !== command.itemRevision) throw new FocusDataError("conflict");
    if ("remove" in command) {
      if (!snapshot.referencesKnown) throw new FocusDataError("unsupported");
      const refs = snapshot.references[item.id] ?? [];
      if (JSON.stringify(refs) !== JSON.stringify([...command.references].sort())) throw new FocusDataError("conflict");
      items[index] = { ...item, deleted: true, revision: item.revision + 1 };
    } else {
      const session = item.kind === "session" ? { ...item.session, ...validateCustomSession(command.session) } : undefined;
      items[index] = { ...item, label: focusText(command.label), revision: item.revision + 1, ...(session ? { session } : {}) };
    }
    if (!revision(items[index].revision)) throw new FocusDataError("invalid");
  }
  if (!revision(old.revision + 1)) throw new FocusDataError("invalid");
  return { ...old, revision: old.revision + 1, items };
}
