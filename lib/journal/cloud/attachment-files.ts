import type { SupabaseClient } from "@supabase/supabase-js";
import { AppStorage } from "@/lib/storage";
import { IndexedDBAttachmentRepository, readBlobBytes } from "@/lib/storage/indexeddb-repository";
import type { AttachmentRepository } from "../attachments/types";
import type { JournalAttachment } from "../types";
import { makePreviewBlob } from "../attachments/image-processor";
import {
  ATTACHMENT_DELETE_AFTER_DAYS,
  ATTACHMENT_LOCAL_GRACE_MS,
  ATTACHMENT_ORPHAN_MIN_AGE_HOURS,
  ATTACHMENT_QUOTA_BYTES,
  ATTACHMENTS_BUCKET,
} from "./config";
import type { AttachmentMetadata } from "../attachments/types";
import { readBase } from "./sync-merge";
import { entryKey, type CloudEntry } from "./records";
import type { LocalJournal } from "./sync-engine";

/**
 * Screenshot files in the cloud (0005, plan docs/t7b-0005-attachments-plan.md).
 *
 * The description of a screenshot is a journal record (table journal_attachments) and goes through the sync engine
 * like any other. This module handles the image itself:
 * - before a description is sent, its file is uploaded (file first, then the row: a row in the cloud means the file
 *   is there too);
 * - after an exchange, files of screenshots added on other devices are downloaded (automatic mode only; in manual
 *   mode only by «Download» on the trade), with a small preview made on this device;
 * - files of screenshots deleted on this device or elsewhere leave this browser after a short pause (so «Undo» finds
 *   them); in the cloud they stay 30 days (the server's rule, 0005).
 */

export const ATTACHMENTS_TABLE = "journal_attachments";

export type FileFailure = "noSpace" | "noFile" | "error";

export class AttachmentFileError extends Error {
  constructor(
    readonly kind: "noSpace" | "exists" | "network" | "other",
    message: string
  ) {
    super(message);
    this.name = "AttachmentFileError";
  }
}

/** Network side of the bucket. upload never overwrites (a file is never replaced). */
export interface AttachmentFileRemote {
  upload(path: string, blob: Blob, mime: string): Promise<void>;
  download(path: string): Promise<Blob>;
  /** Files in one folder (the user's own: the server shows nothing else). */
  list?(folder: string): Promise<{ path: string; createdAt: string }[]>;
  /** Removes what the server's rules allow; returns the paths actually removed. */
  remove?(paths: string[]): Promise<string[]>;
}

const EXT: Record<string, string> = { "image/webp": "webp", "image/png": "png", "image/jpeg": "jpg" };

/** Same path the server builds for the row (0005): `<user id>/<screenshot id>.<webp|png|jpg>`. */
export function attachmentPath(userId: string, id: string, mime: string): string {
  return `${userId}/${id}.${EXT[mime] ?? "webp"}`;
}

/** Supabase Storage: private bucket, short signed links, the file is kept in the browser after download. */
export class SupabaseAttachmentFiles implements AttachmentFileRemote {
  constructor(private readonly getClient: () => SupabaseClient | null) {}

  private bucket() {
    const c = this.getClient();
    if (!c) throw new AttachmentFileError("other", "Supabase is not configured");
    return c.storage.from(ATTACHMENTS_BUCKET);
  }

  async upload(path: string, blob: Blob, mime: string): Promise<void> {
    // Raw bytes with their type (not a form): the bucket checks the type and the size before taking the file
    const { error } = await this.bucket().upload(path, await readBlobBytes(blob), { contentType: mime, upsert: false });
    if (error) throw classify(error);
  }

  async list(folder: string): Promise<{ path: string; createdAt: string }[]> {
    const out: { path: string; createdAt: string }[] = [];
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await this.bucket().list(folder, { limit: 1000, offset, sortBy: { column: "name", order: "asc" } });
      if (error) throw classify(error);
      const page = (data || []).filter((f) => f.id); // folders have no id
      out.push(...page.map((f) => ({ path: `${folder}/${f.name}`, createdAt: f.created_at ?? new Date().toISOString() })));
      if ((data || []).length < 1000) return out;
    }
  }

  async remove(paths: string[]): Promise<string[]> {
    if (!paths.length) return [];
    const { data, error } = await this.bucket().remove(paths);
    if (error) throw classify(error);
    return (data || []).map((f) => f.name);
  }

  async download(path: string): Promise<Blob> {
    // A link for 60 seconds (owner decision 2026-10-26): never stored, the file itself is kept on the device
    const { data, error } = await this.bucket().createSignedUrl(path, 60);
    if (error || !data?.signedUrl) throw classify(error ?? { message: "no signed url" });
    const res = await fetch(data.signedUrl);
    if (!res.ok) throw new AttachmentFileError(res.status >= 500 ? "network" : "other", `download ${res.status}`);
    return res.blob();
  }
}

function classify(error: { message?: string; statusCode?: string | number; status?: number }): AttachmentFileError {
  const status = Number(error.statusCode ?? error.status ?? 0);
  const message = error.message || "storage error";
  if (status === 409 || /already exists|duplicate/i.test(message)) return new AttachmentFileError("exists", message);
  // The upload rule refused: with the cloud on, that is the 200 MB limit or the 400 MB hard cap
  if (status === 403 || /row-level security|violates/i.test(message)) return new AttachmentFileError("noSpace", message);
  if (/fetch|network|timed? ?out|abort/i.test(message) || status >= 500) return new AttachmentFileError("network", message);
  return new AttachmentFileError("other", message);
}

/* --------------------------------------------------------------- per-account memory on this device */

const IN_CLOUD_KEY = "ayra_attachments_in_cloud";

function readInCloud(userId: string): Set<string> {
  try {
    const raw = JSON.parse(AppStorage.getItem(IN_CLOUD_KEY, userId) || "[]");
    return new Set(Array.isArray(raw) ? raw.filter((x) => typeof x === "string") : []);
  } catch {
    return new Set();
  }
}

/** «Stop» on the upload of screenshots (this device, this account): kept until «Continue». */
const PAUSED_KEY = "ayra_attachments_paused";
export const readUploadsPaused = (userId: string) => AppStorage.getItem(PAUSED_KEY, userId) === "1";
export function writeUploadsPaused(userId: string, paused: boolean): void {
  if (paused) AppStorage.setItem(PAUSED_KEY, "1", userId);
  else AppStorage.removeItem(PAUSED_KEY, userId);
}

/** Last day this device cleaned the account's folder in the cloud (once a day). */
const CLEANUP_KEY = "ayra_attachments_cleanup_day";

function addInCloud(userId: string, ids: string[]): void {
  if (!ids.length) return;
  const set = readInCloud(userId);
  ids.forEach((id) => set.add(id));
  try {
    AppStorage.setItem(IN_CLOUD_KEY, JSON.stringify([...set]), userId);
  } catch {}
}

const isLive = (a: { deletedAt?: string | null }) => !a.deletedAt;

export interface AttachmentFilesDeps {
  remote: AttachmentFileRemote | null;
  readJournal: (userId: string) => LocalJournal;
  /** Screenshots stored in this browser for an explicit account. */
  files?: (userId: string) => AttachmentRepository;
  makePreview?: (blob: Blob) => Promise<Blob>;
  now?: () => number;
}

export interface PrepareResult {
  ready: Set<string>;
  failed: { id: string; reason: FileFailure }[];
  /** Not tried now: «later» = the next exchange (only a few files per exchange), «paused» = «Stop» was pressed. */
  deferred?: { id: string; reason: "later" | "paused" }[];
}

export class AttachmentFiles {
  private listeners = new Set<() => void>();
  private downloading = new Set<string>();
  private reconciling: Promise<void> | null = null;
  private readonly now: () => number;

  constructor(private readonly deps: AttachmentFilesDeps) {
    this.now = deps.now ?? (() => Date.now());
  }

  private files(userId: string): AttachmentRepository {
    return this.deps.files ? this.deps.files(userId) : new IndexedDBAttachmentRepository(userId);
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify = () => this.listeners.forEach((l) => l());

  isDownloading(id: string): boolean {
    return this.downloading.has(id);
  }

  /** The cloud holds this screenshot's file: its row came from the cloud, or this device uploaded it. */
  isInCloud(userId: string, id: string): boolean {
    return readInCloud(userId).has(id) || readBase(userId)[entryKey({ table: ATTACHMENTS_TABLE, id })] !== undefined;
  }

  /**
   * File first, then the row: uploads the files of these screenshot descriptions that the cloud does not have yet.
   * Ready = the row may be sent now. Not ready stay queued and are retried (no space, file missing here, error).
   * Throws on network errors (the engine retries the whole send).
   */
  async prepare(userId: string, entries: CloudEntry[], opts: { limit?: number } = {}): Promise<PrepareResult> {
    const result: PrepareResult = { ready: new Set(), failed: [], deferred: [] };
    const journal = this.deps.readJournal(userId);
    const rows = (journal.snapshot.attachments || []) as JournalAttachment[];
    // Space already taken in the cloud (live screenshots whose file is there); the server checks it again
    let used = rows.filter((a) => isLive(a) && this.isInCloud(userId, a.id)).reduce((s, a) => s + (a.bytes || 0), 0);
    const store = this.files(userId);
    const base = readBase(userId);
    let uploads = 0;
    for (const e of entries) {
      const meta = e.record as unknown as JournalAttachment;
      // a deletion needs no file; a row the cloud already confirmed means its file is there
      if (!isLive(meta) || base[entryKey({ table: ATTACHMENTS_TABLE, id: e.id })] !== undefined) {
        result.ready.add(e.id);
        continue;
      }
      if (readUploadsPaused(userId)) {
        // read for each file: «Stop» pressed during a batch stops it after the file being uploaded
        result.deferred!.push({ id: e.id, reason: "paused" });
        continue;
      }
      if (opts.limit !== undefined && uploads >= opts.limit) {
        result.deferred!.push({ id: e.id, reason: "later" });
        continue;
      }
      if (used + (meta.bytes || 0) > ATTACHMENT_QUOTA_BYTES) {
        result.failed.push({ id: e.id, reason: "noSpace" });
        continue;
      }
      const local = await store.getAttachment(e.id).catch(() => null);
      if (!local) {
        result.failed.push({ id: e.id, reason: "noFile" });
        continue;
      }
      if (AppStorage.getUserId() !== userId) break; // the account changed: send nothing more
      // Uploaded before but the row never confirmed (it failed, or the device was offline): try again — the server
      // answers «already there», or takes it again if the daily cleanup removed it after 24 hours without a row.
      uploads++;
      try {
        await this.deps.remote!.upload(attachmentPath(userId, e.id, meta.mime), local.originalBlob, meta.mime);
      } catch (err) {
        const kind = err instanceof AttachmentFileError ? err.kind : "network";
        if (kind === "network") throw err;
        if (kind !== "exists") {
          result.failed.push({ id: e.id, reason: kind === "noSpace" ? "noSpace" : "error" });
          continue;
        }
        // already there (an earlier attempt got through): fine
      }
      addInCloud(userId, [e.id]);
      used += meta.bytes || 0;
      result.ready.add(e.id);
      this.notify(); // progress
    }
    return result;
  }

  /**
   * Screenshots in this browser that the journal does not describe yet (added before 0005, or copied from the guest
   * before it): their trade is live. They become rows and go up like new ones.
   */
  async undescribed(userId: string): Promise<AttachmentMetadata[]> {
    const journal = this.deps.readJournal(userId);
    const described = new Set(((journal.snapshot.attachments || []) as JournalAttachment[]).map((a) => a.id));
    const liveTrades = new Set(journal.snapshot.trades.filter(isLive).map((t) => t.id));
    const here = await this.files(userId).getAllMetadata().catch(() => [] as AttachmentMetadata[]);
    return here.filter((m) => !described.has(m.id) && liveTrades.has(m.tradeId));
  }

  /**
   * Once a day: files in this account's folder that may go — of screenshots deleted 30+ days ago, and files without
   * a screenshot row older than 24 hours. The server decides again by its own clock and rules (0005); a refused file
   * simply stays. Returns how many were removed.
   */
  async cleanup(userId: string, opts: { force?: boolean } = {}): Promise<number> {
    const remote = this.deps.remote;
    if (!remote?.list || !remote.remove) return 0;
    const now = this.now();
    const day = new Date(now).toISOString().slice(0, 10);
    if (!opts.force && AppStorage.getItem(CLEANUP_KEY, userId) === day) return 0;
    const files = await remote.list(userId);
    if (AppStorage.getUserId() !== userId) return 0;
    const rows = (this.deps.readJournal(userId).snapshot.attachments || []) as JournalAttachment[];
    const byPath = new Map(rows.map((a) => [attachmentPath(userId, a.id, a.mime), a]));
    const DAY = 24 * 3600 * 1000;
    const gone = files.filter((f) => {
      const row = byPath.get(f.path);
      if (row) return !isLive(row) && now - Date.parse(String(row.deletedAt)) >= ATTACHMENT_DELETE_AFTER_DAYS * DAY;
      return now - Date.parse(f.createdAt) >= ATTACHMENT_ORPHAN_MIN_AGE_HOURS * 3600 * 1000;
    });
    const removed = gone.length ? await remote.remove(gone.map((f) => f.path)) : [];
    AppStorage.setItem(CLEANUP_KEY, day, userId);
    return removed.length;
  }

  /**
   * Downloads one screenshot's file from the cloud into this browser (also «Download» in manual mode).
   * `replace`: the copy here cannot be shown (broken) — a fresh one replaces it, only once it is fully downloaded.
   */
  async download(userId: string, id: string, opts: { replace?: boolean } = {}): Promise<boolean> {
    if (!this.deps.remote || this.downloading.has(id)) return false;
    const meta = ((this.deps.readJournal(userId).snapshot.attachments || []) as JournalAttachment[]).find((a) => a.id === id);
    if (!meta || !isLive(meta)) return false;
    const store = this.files(userId);
    // already here (the trade card and the exchange both asked): nothing to download
    if (!opts.replace && (await store.getAttachment(id).catch(() => null))) return true;
    if (this.downloading.has(id)) return false;
    this.downloading.add(id);
    this.notify();
    try {
      const downloaded = await this.deps.remote.download(attachmentPath(userId, id, meta.mime));
      if (AppStorage.getUserId() !== userId) return false;
      // WebKit (iPhone) cannot keep a Blob that came from the network in IndexedDB ("Error preparing Blob/File data
      // to be stored in object store", or a copy that later does not open): store a fresh Blob of the bytes, with the
      // type of the screenshot, never the response's own
      const originalBlob = await storableBlob(downloaded, meta.mime);
      const preview = await (this.deps.makePreview ?? makePreviewBlob)(originalBlob);
      const previewBlob = await storableBlob(preview, preview.type || meta.mime);
      const { updatedAt: _u, deletedAt: _d, ...plain } = meta;
      if (opts.replace) await store.deleteAttachment(id).catch(() => false);
      if (!(await store.getAttachment(id).catch(() => null))) await store.addAttachment({ ...plain, originalBlob, previewBlob });
      addInCloud(userId, [id]);
      return true;
    } catch (err) {
      console.warn("Screenshot download failed", id, err);
      return false; // tried again after the next exchange
    } finally {
      this.downloading.delete(id);
      this.notify();
    }
  }

  /**
   * After an exchange: files of screenshots from other devices come down (only when `download`), type and caption
   * changed elsewhere are copied to the stored file, files of deleted screenshots leave this browser after the pause.
   */
  reconcile(userId: string, opts: { download: boolean }): Promise<void> {
    if (this.reconciling) return this.reconciling;
    const run = this.reconcileOnce(userId, opts).finally(() => {
      this.reconciling = null;
    });
    this.reconciling = run;
    return run;
  }

  private async reconcileOnce(userId: string, opts: { download: boolean }): Promise<void> {
    const journal = this.deps.readJournal(userId);
    const rows = (journal.snapshot.attachments || []) as JournalAttachment[];
    if (!rows.length) return;
    const liveTrades = new Set(journal.snapshot.trades.filter(isLive).map((t) => t.id));
    const store = this.files(userId);
    let changed = await cleanupFiles(store, rows, this.now());
    const here = new Map((await store.getAllMetadata().catch(() => [])).map((m) => [m.id, m]));
    for (const row of rows) {
      if (AppStorage.getUserId() !== userId) return;
      if (!isLive(row)) continue;
      const stored = here.get(row.id);
      if (stored) {
        if (stored.kind !== row.kind || (stored.caption || "") !== (row.caption || "")) {
          await store.updateMetadata(row.id, { kind: row.kind, caption: row.caption ?? "" }).catch(() => null);
          changed = true;
        }
        continue;
      }
      if (opts.download && liveTrades.has(row.tradeId) && this.isInCloud(userId, row.id)) {
        if (await this.download(userId, row.id)) changed = true;
      }
    }
    if (changed) this.notify();
  }
}

/** A Blob made of the bytes themselves (not tied to a network response), with an explicit type. */
export async function storableBlob(blob: Blob, type: string): Promise<Blob> {
  return new Blob([await readBlobBytes(blob)], { type });
}

/**
 * Files in this browser whose screenshot was deleted (here or elsewhere) more than a short pause ago: removed. The
 * pause lets «Undo» bring the screenshot back without downloading it again. Returns whether anything was removed.
 */
export async function cleanupFiles(store: AttachmentRepository, rows: JournalAttachment[], now: number): Promise<boolean> {
  const live = new Set(rows.filter(isLive).map((a) => a.id));
  const gone = rows.filter((a) => !isLive(a) && !live.has(a.id) && now - Date.parse(String(a.deletedAt)) >= ATTACHMENT_LOCAL_GRACE_MS);
  if (!gone.length) return false;
  const here = new Set((await store.getAllMetadata().catch(() => [])).map((m) => m.id));
  let removed = false;
  for (const a of gone) {
    if (!here.has(a.id)) continue;
    if (await store.deleteAttachment(a.id).catch(() => false)) removed = true;
  }
  return removed;
}
