/**
 * Notes (and backtest results) from an AYRA JSON file — the trades export (kind "trades": notes of the exported
 * trades), a full profile export or a journal backup (journal.notes). Older files without notes give none.
 *
 * Safe by design:
 * - every field is checked and cut to the journal limits; anything else in the file is dropped;
 * - an id already in the journal (live or deleted) is never replaced — the local copy or its deletion is newer;
 * - a plain note with the same text as a live note, or a backtest result equal to a live one (backtestFingerprint), is
 *   not added twice;
 * - the note keeps its own dates (a newer cloud copy wins in sync); it is marked with the import run
 *   (`importBatchId`, `importedAt`) so «undo» removes exactly it and no mission ever counts it (QH-6);
 * - nothing here gives XP, Coins or a one-time reward.
 */
import type { Note, NoteLinks, NoteTemplateKey } from "../types";
import { backtestFingerprint, readBacktest } from "../backtest";

const TEMPLATE_KEYS: NoteTemplateKey[] = ["session_review", "weekly_mistake", "idea", "lesson", "backtest"];

/** The raw notes of an AYRA JSON file (deleted ones skipped), or [] when the file has none. */
export function ayraNotesFrom(json: unknown): unknown[] {
  if (!json || typeof json !== "object") return [];
  const o = json as Record<string, unknown>;
  if (o.app !== "ayra") return [];
  const list = o.kind === "trades" ? o.notes : (o.journal as Record<string, unknown> | undefined)?.notes;
  return Array.isArray(list) ? list.filter((n) => n && typeof n === "object" && !(n as { deletedAt?: unknown }).deletedAt) : [];
}

const str = (v: unknown, max: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : undefined);
const iso = (v: unknown) => (typeof v === "string" && !Number.isNaN(Date.parse(v)) ? new Date(v).toISOString() : undefined);

/** One note of a file as a journal note, or null when it is not a usable note (no id or no text). */
export function sanitizeImportedNote(raw: unknown, batchId: string, nowIso: string): Note | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id = str(r.id, 120);
  const body = typeof r.body === "string" ? r.body.trim().slice(0, 5000) : "";
  if (!id || !body) return null;
  const templateKey = TEMPLATE_KEYS.includes(r.templateKey as NoteTemplateKey) ? (r.templateKey as NoteTemplateKey) : undefined;
  const rawLinks = r.links && typeof r.links === "object" ? (r.links as Record<string, unknown>) : {};
  const links: NoteLinks = {};
  const tradeId = str(rawLinks.tradeId, 120);
  const date = typeof rawLinks.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(rawLinks.date) ? rawLinks.date : undefined;
  const instrument = str(rawLinks.instrument, 20)?.toUpperCase();
  const strategyId = str(rawLinks.strategyId, 120);
  if (tradeId) links.tradeId = tradeId;
  if (date) links.date = date;
  if (instrument) links.instrument = instrument;
  if (strategyId) links.strategyId = strategyId;
  // a file date in the future is taken as «now»; a missing one falls back to the creation date
  const createdAt = iso(r.createdAt) && (iso(r.createdAt) as string) <= nowIso ? (iso(r.createdAt) as string) : nowIso;
  const fileUpdated = iso(r.updatedAt);
  const updatedAt = !fileUpdated ? createdAt : fileUpdated > nowIso ? nowIso : fileUpdated < createdAt ? createdAt : fileUpdated;
  const note: Note = {
    id,
    title: str(r.title, 80),
    body,
    tags: Array.isArray(r.tags) ? r.tags.filter((t): t is string => typeof t === "string" && !!t.trim()).map((t) => t.trim().slice(0, 24)).slice(0, 8) : [],
    pinned: r.pinned === true,
    templateKey,
    createdAt,
    updatedAt,
    archivedAt: iso(r.archivedAt) ?? null,
    importBatchId: batchId,
    importedAt: nowIso,
  };
  if (Object.keys(links).length) note.links = links;
  // a backtest result keeps only a valid structure; a broken one stays a «backtest» note that says it is damaged
  if (templateKey === "backtest") {
    const b = readBacktest({ templateKey, backtest: r.backtest as Note["backtest"] });
    if (b) note.backtest = b;
  }
  if (!note.title) delete note.title;
  return note;
}

const norm = (s: string | undefined) => (s || "").replace(/\s+/g, " ").trim().toLowerCase();
/** What makes two notes «the same note» for import: the template, the title and the text. */
const contentKey = (n: Pick<Note, "templateKey" | "title" | "body">) => `${n.templateKey || ""}|${norm(n.title)}|${norm(n.body)}`;

export interface NoteImportPlan {
  add: Note[];
  /** Already here by id (live or deleted): never replaced. */
  existing: number;
  /** The same content (or the same backtest result) as a live note. */
  duplicates: number;
  /** Not a usable note (no id or no text). */
  invalid: number;
  backtests: number;
}

/** What an import would add, and why the rest is skipped. `journal` is every local note, deleted ones included. */
export function planNoteImport(raw: unknown[], journal: Note[], batchId: string, nowIso: string): NoteImportPlan {
  const ids = new Set(journal.map((n) => n.id));
  const live = journal.filter((n) => !n.deletedAt);
  // plain notes are compared by text; a backtest result only by its result (lib/journal/backtest.ts, backtestFingerprint):
  // two results with the same title and conclusion but another setup or strategy are different results
  const contents = new Set(live.filter((n) => n.templateKey !== "backtest").map(contentKey));
  const results = new Set(live.map((n) => readBacktest(n)).filter((b): b is NonNullable<typeof b> => !!b).map(backtestFingerprint));
  const plan: NoteImportPlan = { add: [], existing: 0, duplicates: 0, invalid: 0, backtests: 0 };
  for (const r of raw) {
    const n = sanitizeImportedNote(r, batchId, nowIso);
    if (!n) {
      plan.invalid++;
      continue;
    }
    if (ids.has(n.id)) {
      plan.existing++;
      continue;
    }
    const fp = n.backtest ? backtestFingerprint(n.backtest) : null;
    const isResult = n.templateKey === "backtest";
    if ((!isResult && contents.has(contentKey(n))) || (fp && results.has(fp))) {
      plan.duplicates++;
      continue;
    }
    plan.add.push(n);
    ids.add(n.id);
    if (!isResult) contents.add(contentKey(n));
    if (fp) results.add(fp);
    if (n.backtest) plan.backtests++;
  }
  return plan;
}

/** A note brought by an import (it never closes a mission; QH-6). */
export const isImportedNote = (n: Pick<Note, "importBatchId">): boolean => !!n.importBatchId;
