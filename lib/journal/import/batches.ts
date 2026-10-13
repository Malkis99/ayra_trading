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

function save(list: ImportBatch[]) {
  try {
    AppStorage.setItem(KEY, JSON.stringify(list.slice(-MAX_BATCHES)));
  } catch {}
}

export function addImportBatch(batch: ImportBatch): void {
  save([...listImportBatches().filter((b) => b.id !== batch.id), batch]);
}

export function markImportBatchUndone(id: string, at: string): void {
  save(listImportBatches().map((b) => (b.id === id ? { ...b, undoneAt: at } : b)));
}

export function newBatchId(now: Date = new Date()): string {
  return `imp_${now.getTime().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}
