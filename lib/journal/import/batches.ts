import { AppStorage } from "@/lib/storage";
import type { ImportFormatId } from "./types";

/** One import run; "undo" deletes exactly the trades carrying this batch id. */
export interface ImportBatch {
  id: string;
  createdAt: string;
  formatId: ImportFormatId;
  fileName: string;
  accountId: string;
  tradeCount: number;
  undoneAt?: string;
  /** Last change (sync, T7b). */
  updatedAt?: string;
}

const KEY = "ayra_import_batches";
const MAX_BATCHES = 50;

export function listImportBatches(): ImportBatch[] {
  try {
    const raw = AppStorage.getItem(KEY);
    const list = raw ? (JSON.parse(raw) as ImportBatch[]) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

type Listener = () => void;
const listeners = new Set<Listener>();

/** Called after every change of the import history (the cloud journal mirrors it). */
export function subscribeImportBatches(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function save(list: ImportBatch[], notify = true) {
  try {
    AppStorage.setItem(KEY, JSON.stringify(list.slice(-MAX_BATCHES)));
  } catch {}
  if (notify) listeners.forEach((l) => l());
}

/** Replaces the whole history (records merged from the cloud); does not notify — nothing new to send. */
export function replaceImportBatches(list: ImportBatch[]): void {
  save(list, false);
}

export function addImportBatch(batch: ImportBatch): void {
  save([...listImportBatches().filter((b) => b.id !== batch.id), { ...batch, updatedAt: batch.updatedAt ?? batch.createdAt }]);
}

export function markImportBatchUndone(id: string, at: string): void {
  save(listImportBatches().map((b) => (b.id === id ? { ...b, undoneAt: at, updatedAt: at } : b)));
}

export function newBatchId(now: Date = new Date()): string {
  return `imp_${now.getTime().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}
