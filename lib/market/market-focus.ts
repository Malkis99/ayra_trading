import type { InstrumentId } from "./instruments";

export const FOCUS_FIELDS = {
  direction: ["bullish", "bearish", "neutral"], poi: ["fvg", "orderBlock", "liquidity"],
  mss: ["waiting", "bullish", "bearish", "notConfirmed"], session: ["london", "newYork", "none"],
} as const;
export const FOCUS_CHECKS = ["poiReached", "liquiditySweep", "displacement", "mssCisd", "retracementTest", "reaction"] as const;
/** Owner-approved WATCH-2B limits: 30 items and 160 Unicode code points per title. */
export const FOCUS_ITEM_LIMIT = 30, FOCUS_TEXT_LIMIT = 160;
export type FocusField = keyof typeof FOCUS_FIELDS;
export type FocusCheck = typeof FOCUS_CHECKS[number];
export type FocusValues = { [K in FocusField]: typeof FOCUS_FIELDS[K][number] | null };
export type FocusItem = { id: string; template: FocusCheck | null; text: string | null; checked: boolean; revision: number } & Record<string, unknown>;
export type FocusSelection = { kind: "system" | "custom"; id: string } & Record<string, unknown>;
export type FocusEntry = {
  spaceId: string; instrumentId: InstrumentId; revision: number;
  checklist: { items: FocusItem[]; orderRevision: number } & Record<string, unknown>;
} & Record<string, unknown> & ((FocusValues & { version: 2 }) | ({ [K in FocusField]: FocusSelection | null } & { version: 3; fieldRevisions: Record<FocusField, number> & Record<string, unknown> }));
export type FocusPatch = ({ [K in FocusField]: { field: K; value: FocusValues[K]; fieldRevision?: number } }[FocusField])
  | { custom: FocusField; id: string; entryRevision: number; fieldRevision: number; catalogRevision: number }
  | { check: string; value: boolean } | { add: string; text: string }
  | { rename: string; text: string; itemRevision: number } | { remove: string; itemRevision: number }
  | { move: string; step: -1 | 1; orderRevision: number };
export class FocusDataError extends Error {
  constructor(readonly kind: "invalid" | "unsupported" | "storage" | "conflict" | "limit" | "text" | "cleared") { super(`market_focus_${kind}`); }
}
export const templateId = (key: FocusCheck) => `template:${key}`;
const templateItems = (): FocusItem[] => FOCUS_CHECKS.map(key => ({ id: templateId(key), template: key, text: null, checked: false, revision: 1 }));
export const emptyFocus = (spaceId: string, instrumentId: InstrumentId): Extract<FocusEntry, {version:2}> => ({
  version: 2, spaceId, instrumentId, revision: 0, direction: null, poi: null, mss: null, session: null,
  checklist: { items: templateItems(), orderRevision: 0 },
});
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const integer = (v: unknown, min = 0) => Number.isSafeInteger(v) && Number(v) >= min && Number(v) < Number.MAX_SAFE_INTEGER;
export const focusUuid = (id: unknown): id is string => typeof id === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id);
export function systemFocusValue(entry: FocusEntry, field: FocusField): string | null {
  if (entry.version === 2) return entry[field];
  const value = entry[field]; return value?.kind === "system" ? value.id : null;
}
export function customFocusId(entry: FocusEntry, field: FocusField): string | null { return entry.version === 3 && entry[field]?.kind === "custom" ? entry[field]!.id : null; }
export function focusFieldRevision(entry: FocusEntry, field: FocusField): number { return entry.version === 3 ? entry.fieldRevisions[field] : 0; }
export function focusSelectionValue(entry: FocusEntry, field: FocusField): string { const custom = customFocusId(entry, field); return custom ? `custom:${custom}` : systemFocusValue(entry, field) ?? ""; }
function validValues(raw: Record<string, unknown>): boolean {
  if (raw.version === 2) return Object.entries(FOCUS_FIELDS).every(([key, values]) => raw[key] === null || (values as readonly unknown[]).includes(raw[key]));
  return object(raw.fieldRevisions) && Object.entries(FOCUS_FIELDS).every(([key, values]) => {
    const value = raw[key];
    return integer((raw.fieldRevisions as Record<string, unknown>)[key]) && (value === null || object(value) && (value.kind === "system" && (values as readonly unknown[]).includes(value.id) || value.kind === "custom" && focusUuid(value.id)));
  });
}
/** Lazy conversion: only an explicit custom selection calls this, never a read or database upgrade. */
function focusV3(entry: FocusEntry): Extract<FocusEntry, {version:3}> {
  if (entry.version === 3) return entry;
  if (Object.hasOwn(entry, "fieldRevisions")) throw new FocusDataError("unsupported");
  const value = (field: FocusField): FocusSelection | null => entry[field] === null ? null : { kind: "system", id: entry[field]! };
  return { ...entry, version: 3, direction: value("direction"), poi: value("poi"), mss: value("mss"), session: value("session"), fieldRevisions: { direction: 0, poi: 0, mss: 0, session: 0 } };
}
export function focusText(text: string): string {
  const value = text.trim();
  if (!value || Array.from(value).length > FOCUS_TEXT_LIMIT || /[\u0000-\u001f\u007f]/.test(value)) throw new FocusDataError("text");
  return value;
}
function validItem(raw: unknown): raw is FocusItem {
  if (!object(raw) || typeof raw.id !== "string" || !/^(template:[a-zA-Z]+|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/.test(raw.id)
    || !(raw.template === null || (FOCUS_CHECKS as readonly unknown[]).includes(raw.template)) || !integer(raw.revision, 1) || typeof raw.checked !== "boolean") return false;
  if (raw.text === null) return raw.template !== null;
  try { return typeof raw.text === "string" && focusText(raw.text) === raw.text; } catch { return false; }
}
export function parseFocus(raw: unknown, spaceId: string, id: InstrumentId): FocusEntry {
  if (raw === undefined) return emptyFocus(spaceId, id);
  if (object(raw) && typeof raw.version === "number" && raw.version > 3) throw new FocusDataError("unsupported");
  if (!object(raw) || (raw.version !== 2 && raw.version !== 3) || raw.spaceId !== spaceId || raw.instrumentId !== id || !integer(raw.revision, 1)
    || !object(raw.checklist) || !integer(raw.checklist.orderRevision) || !Array.isArray(raw.checklist.items)
    || raw.checklist.items.length > FOCUS_ITEM_LIMIT || !raw.checklist.items.every(validItem)
    || new Set(raw.checklist.items.map(item => item.id)).size !== raw.checklist.items.length
    || !validValues(raw)) throw new FocusDataError("invalid");
  return raw as FocusEntry;
}
/** Pure conversion used only by the atomic IDB version upgrade; invalid/future rows remain untouched. */
export function migrateFocusV1(raw: unknown): unknown {
  if (!object(raw) || raw.version !== 1) return raw;
  if (typeof raw.spaceId !== "string" || typeof raw.instrumentId !== "string" || !integer(raw.revision, 1) || !object(raw.checklist)
    || !FOCUS_CHECKS.every(key => typeof (raw.checklist as Record<string, unknown>)[key] === "boolean")
    || !Object.entries(FOCUS_FIELDS).every(([key, values]) => raw[key] === null || (values as readonly unknown[]).includes(raw[key]))) return raw;
  if (Number(raw.revision) + 1 >= Number.MAX_SAFE_INTEGER) return raw;
  const extras = { ...raw.checklist }; for (const key of FOCUS_CHECKS) delete extras[key];
  if (Object.prototype.hasOwnProperty.call(extras, "items") || Object.prototype.hasOwnProperty.call(extras, "orderRevision")) return raw;
  return { ...raw, version: 2, revision: Number(raw.revision) + 1, checklist: { ...extras, orderRevision: 0,
    items: templateItems().map(item => ({ ...item, checked: (raw.checklist as Record<string, unknown>)[item.template!] as boolean })) } };
}
export const focusChecked = (entry: FocusEntry, key: FocusCheck) => entry.checklist.items.find(item => item.id === templateId(key))?.checked ?? false;
export function patchFocus(entry: FocusEntry, patch: FocusPatch): FocusEntry {
  if ("custom" in patch) {
    if (!Object.hasOwn(FOCUS_FIELDS, patch.custom) || !focusUuid(patch.id)) throw new FocusDataError("invalid");
    if (entry.version === 2 && patch.entryRevision !== entry.revision || patch.fieldRevision !== focusFieldRevision(entry, patch.custom)) throw new FocusDataError("conflict");
    const next = focusV3(entry), revision = next.fieldRevisions[patch.custom] + 1;
    if (!integer(revision)) throw new FocusDataError("invalid");
    return { ...next, [patch.custom]: { kind: "custom", id: patch.id }, fieldRevisions: { ...next.fieldRevisions, [patch.custom]: revision } };
  }
  if ("field" in patch) {
    if (!Object.prototype.hasOwnProperty.call(FOCUS_FIELDS, patch.field) || (patch.value !== null && !(FOCUS_FIELDS[patch.field] as readonly unknown[]).includes(patch.value))) throw new FocusDataError("invalid");
    if (entry.version === 2) return { ...entry, [patch.field]: patch.value };
    if (patch.fieldRevision !== entry.fieldRevisions[patch.field]) throw new FocusDataError("conflict");
    const revision = entry.fieldRevisions[patch.field] + 1;
    if (!integer(revision)) throw new FocusDataError("invalid");
    return { ...entry, [patch.field]: patch.value === null ? null : { kind: "system", id: patch.value }, fieldRevisions: { ...entry.fieldRevisions, [patch.field]: revision } };
  }
  const items = entry.checklist.items.slice(); let orderRevision = entry.checklist.orderRevision;
  if ("add" in patch) {
    if (items.length >= FOCUS_ITEM_LIMIT) throw new FocusDataError("limit");
    if (items.some(item => item.id === patch.add) || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(patch.add)) throw new FocusDataError("conflict");
    items.push({ id: patch.add, template: null, text: focusText(patch.text), checked: false, revision: 1 }); orderRevision++;
  } else {
    const identity = "check" in patch ? ((FOCUS_CHECKS as readonly string[]).includes(patch.check) ? `template:${patch.check}` : patch.check)
      : "rename" in patch ? patch.rename : "remove" in patch ? patch.remove : patch.move;
    const index = items.findIndex(item => item.id === identity), item = items[index];
    if (!item) throw new FocusDataError("conflict");
    if ("check" in patch) {
      if (typeof patch.value !== "boolean") throw new FocusDataError("invalid");
      items[index] = { ...item, checked: patch.value, revision: item.revision + 1 };
    } else if ("rename" in patch || "remove" in patch) {
      if (patch.itemRevision !== item.revision) throw new FocusDataError("conflict");
      if ("rename" in patch) items[index] = { ...item, text: focusText(patch.text), revision: item.revision + 1 };
      else { items.splice(index, 1); orderRevision++; }
    } else {
      if (patch.orderRevision !== orderRevision || (patch.step !== -1 && patch.step !== 1)) throw new FocusDataError("conflict");
      const target = index + patch.step;
      if (target < 0 || target >= items.length) throw new FocusDataError("conflict");
      [items[index], items[target]] = [items[target], items[index]]; orderRevision++;
    }
  }
  if (!integer(orderRevision) || !items.every(item => integer(item.revision, 1))) throw new FocusDataError("invalid");
  return { ...entry, checklist: { ...entry.checklist, items, orderRevision } };
}
/** A reset clears observations, never deletes or renames the user's checklist. */
export function clearedFocus(entry: FocusEntry): FocusEntry {
  if (entry.checklist.items.some(item => item.revision + 1 >= Number.MAX_SAFE_INTEGER)) throw new FocusDataError("invalid");
  const revisions = entry.version === 3 ? Object.fromEntries(Object.entries(entry.fieldRevisions).map(([key, value]) => [key, Object.hasOwn(FOCUS_FIELDS, key) ? Number(value) + 1 : value])) : undefined;
  if (revisions && Object.keys(FOCUS_FIELDS).some(key => !integer(revisions[key]))) throw new FocusDataError("invalid");
  return { ...entry, ...(entry.version === 3 ? { fieldRevisions: revisions as Record<FocusField, number> } : {}), direction: null, poi: null, mss: null, session: null,
    checklist: { ...entry.checklist, items: entry.checklist.items.map(item => ({ ...item, checked: false, revision: item.revision + 1 })) } };
}
export const hasFocus = (entry: FocusEntry) => Object.keys(FOCUS_FIELDS).some(key => entry[key] !== null) || entry.checklist.items.some(item => item.checked);
