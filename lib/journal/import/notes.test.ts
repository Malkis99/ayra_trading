import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { AppStorage } from "@/lib/storage";
import { LocalStorageJournalRepository } from "../repository";
import { CloudJournalRepository } from "../cloud/cloud-repository";
import { FakeRemote, trade } from "../cloud/testing/fake-remote";
import { markInitialSyncDone } from "../cloud/sync-state";
import { journalBackupJson } from "../export";
import { readBacktest } from "../backtest";
import { ayraParser } from "./parsers/ayra";
import { buildPreview } from "./normalize";
import { ayraNotesFrom, isImportedNote, planNoteImport, sanitizeImportedNote } from "./notes";
import type { BacktestResult, Note } from "../types";

// Import of notes and backtest results from AYRA JSON: safe, no duplicates, no overwrite of newer data, no reward.

const NOW = "2026-11-14T12:00:00.000Z";
const result = (over: Partial<BacktestResult> = {}): BacktestResult => ({
  instrument: "EURUSD", timeframe: "H1", periodFrom: "2026-01-01", periodTo: "2026-06-30", setup: "Retest", strategyId: null,
  setups: 20, wins: 11, losses: 7, breakeven: 2, avgWinR: 1.8, avgLossR: -1, ...over,
});
const note = (id: string, over: Partial<Note> = {}): Note => ({
  id, body: `Text of ${id}: what I learned this week about entries.`, tags: [], pinned: false,
  createdAt: "2026-11-01T10:00:00.000Z", updatedAt: "2026-11-02T10:00:00.000Z", archivedAt: null, ...over,
});
const bt = (id: string, r: BacktestResult = result()) => note(id, { templateKey: "backtest", title: "EURUSD H1", backtest: r, body: "Retest works in London and fails in Asia, I keep it for London only." });

describe("AYRA JSON notes: reading files of every version", () => {
  it("the trades export (its notes), a profile export and a journal backup; old files without notes give none", () => {
    expect(ayraNotesFrom({ app: "ayra", kind: "trades", exportVersion: "1.3", trades: [], notes: [note("n1")] })).toHaveLength(1);
    expect(ayraNotesFrom({ app: "ayra", kind: "profile", journal: { trades: [], notes: [note("n1"), note("n2")] } })).toHaveLength(2);
    expect(ayraNotesFrom({ app: "ayra", kind: "journalBackup", journal: { trades: [], notes: [note("n1"), { ...note("n2"), deletedAt: NOW }] } })).toHaveLength(1);
    expect(ayraNotesFrom({ app: "ayra", kind: "trades", exportVersion: "1.1", trades: [] })).toEqual([]);
    expect(ayraNotesFrom({ app: "other", journal: { notes: [note("n1")] } })).toEqual([]);
    expect(ayraNotesFrom(null)).toEqual([]);
  });

  it("each note is checked and cut to the journal limits; unknown fields are dropped; it is marked as imported", () => {
    const n = sanitizeImportedNote({ ...note("n1"), title: "x".repeat(200), tags: ["a", 5, "b".repeat(40)], templateKey: "unknown", extra: "drop me", links: { instrument: "eurusd", date: "bad" } }, "b1", NOW)!;
    expect(n.title).toHaveLength(80);
    expect(n.tags).toEqual(["a", "b".repeat(24)]);
    expect(n.templateKey).toBeUndefined();
    expect(n).not.toHaveProperty("extra");
    expect(n.links).toEqual({ instrument: "EURUSD" });
    expect(n).toMatchObject({ importBatchId: "b1", importedAt: NOW, updatedAt: "2026-11-02T10:00:00.000Z" });
    expect(isImportedNote(n)).toBe(true);
    expect(sanitizeImportedNote({ id: "n2", body: "  " }, "b1", NOW)).toBeNull();
    expect(sanitizeImportedNote({ body: "no id" }, "b1", NOW)).toBeNull();
    // dates in the future are not trusted
    const f = sanitizeImportedNote({ ...note("n3"), createdAt: "2030-01-01T00:00:00.000Z", updatedAt: "2030-01-02T00:00:00.000Z" }, "b1", NOW)!;
    expect(f.createdAt).toBe(NOW);
    expect(f.updatedAt).toBe(NOW);
  });

  it("a backtest result keeps a valid structure only; a broken one stays a damaged backtest note", () => {
    expect(readBacktest(sanitizeImportedNote(bt("b1"), "x", NOW)!)).toEqual(result());
    const broken = sanitizeImportedNote({ ...bt("b2"), backtest: { instrument: "EURUSD", timeframe: "W9" } }, "x", NOW)!;
    expect(broken.templateKey).toBe("backtest");
    expect(broken.backtest).toBeUndefined();
  });
});

describe("AYRA JSON notes: the import plan", () => {
  it("never replaces an id already here (live or deleted), skips copies and the same backtest result", () => {
    const journal = [note("live"), { ...note("gone"), deletedAt: NOW }, note("other", { body: "The same text twice." }), bt("bt_here")];
    const plan = planNoteImport(
      [note("live"), note("gone"), note("copy", { body: "  the SAME text   twice. " }), bt("bt_copy"), bt("bt_new", result({ setup: "Range fade" })), note("fresh"), note("fresh"), { body: "no id" }],
      journal,
      "b1",
      NOW
    );
    expect(plan.add.map((n) => n.id)).toEqual(["bt_new", "fresh"]);
    expect(plan).toMatchObject({ existing: 3, duplicates: 2, invalid: 1, backtests: 1 });
    // a different strategy with the same numbers is a different result
    expect(planNoteImport([bt("s_b", result({ strategyId: "str_b" }))], [bt("s_a", result({ strategyId: "str_a" }))], "b", NOW).add).toHaveLength(1);
  });
});

describe("AYRA JSON notes: storage, export round trip, re-import, undo, cloud", () => {
  beforeEach(() => {
    localStorage.clear();
    AppStorage.setUserId(null);
  });
  afterEach(() => AppStorage.setUserId(null));

  it("export → import into an empty journal brings every note and backtest back; importing again adds nothing", () => {
    const source = new LocalStorageJournalRepository();
    source.saveNote(note("n1"));
    source.saveNote(bt("b1"));
    const file = JSON.parse(journalBackupJson(source.getAllRecords(), []));
    localStorage.clear();
    const target = new LocalStorageJournalRepository();
    const plan = planNoteImport(ayraNotesFrom(file), target.getAllRecords().notes, "imp1", new Date().toISOString());
    expect(target.importNotes(plan.add)).toBe(2);
    expect(readBacktest(target.getNote("b1")!)).toEqual(result());
    // the note keeps the dates of the file (not «now»), so a newer copy elsewhere wins in sync
    const exported = file.journal.notes.find((n: Note) => n.id === "n1");
    expect(target.getNote("n1")).toMatchObject({ body: note("n1").body, updatedAt: exported.updatedAt, createdAt: exported.createdAt, importBatchId: "imp1" });
    const again = planNoteImport(ayraNotesFrom(file), target.getAllRecords().notes, "imp2", NOW);
    expect(again.add).toHaveLength(0);
    expect(target.importNotes(again.add)).toBe(0);
    expect(target.getNotes()).toHaveLength(2);
  });

  it("the repository itself never replaces an id, and undo removes only the notes of that run", () => {
    const repo = new LocalStorageJournalRepository();
    repo.saveNote(note("mine", { body: "my newer text" }));
    expect(repo.importNotes([{ ...note("mine"), importBatchId: "b1" }, { ...note("n2"), importBatchId: "b1" }, { ...note("n3"), importBatchId: "b2" }])).toBe(2);
    expect(repo.getNote("mine")?.body).toBe("my newer text");
    expect(repo.deleteNotesByBatch("b1")).toBe(1);
    expect(repo.getNotes().map((n) => n.id).sort()).toEqual(["mine", "n3"]);
  });

  it("cloud: an old file copy never overwrites a newer cloud version of the same note", async () => {
    const USER = "00000000-0000-0000-0000-0000000000a1";
    AppStorage.setUserId(USER);
    markInitialSyncDone(USER);
    const remote = new FakeRemote(USER);
    remote.put("journal_notes", "n1", { ...note("n1", { body: "newer text written on the phone" }), updatedAt: "2099-01-01T00:00:00.000Z", schemaVersion: 6 });
    const repo = new CloudJournalRepository(new LocalStorageJournalRepository(), remote, undefined, "tab_a");
    // the device has not pulled yet: the old copy from a file is imported locally…
    expect(repo.importNotes([{ ...note("n1"), importBatchId: "b1" }])).toBe(1);
    await repo.syncNow();
    await repo.whenIdle();
    // …but the cloud keeps the newer version, and the device takes it instead of the file copy
    expect(remote.get("journal_notes", "n1")?.data.body).toBe("newer text written on the phone");
    await repo.syncNow();
    await repo.whenIdle();
    const local = repo.getNote("n1");
    const conflict = repo.listConflicts().find((c) => c.id === "n1");
    expect(local?.body === "newer text written on the phone" || !!conflict).toBe(true);
    repo.dispose();
  });

  it("an imported trade never brings a review time from the file (no fake «reviewed today»)", () => {
    const file = { app: "ayra", kind: "trades", exportVersion: "1.3", trades: [{ ...trade("t1"), entryReason: "Retest", emotions: ["calm"], executionRating: 4, reviewedAt: NOW }] };
    const parsed = ayraParser.parse({ kind: "json", json: file, rows: [], name: "f.json" } as never, {} as never);
    const rows = buildPreview(parsed.trades, [], { formatId: "ayra", accountId: "acc_1", batchId: "b1", rMode: "none" as never, nowIso: NOW });
    const repo = new LocalStorageJournalRepository();
    repo.importTrades(rows.map((r) => r.trade));
    expect(repo.getTrade("t1")?.entryReason).toBe("Retest");
    expect(repo.getTrade("t1")?.reviewedAt).toBeUndefined();
  });
});
