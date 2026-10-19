// @vitest-environment node
import { describe, it, expect } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { encodeEntry, jsonbTextLength, decodeRow, snapshotEntries } from "./records";
import { JOURNAL_CLOUD_MAX_CLOCK_SKEW_MS, JOURNAL_CLOUD_MAX_RECORD_BYTES } from "./config";
import type { JournalSnapshot } from "../types";

const empty = (): JournalSnapshot => ({ schemaVersion: 6, accounts: [], trades: [], strategies: [], noTrades: [], plans: [], weekPlans: [], notes: [] });

describe("T7b-3 cloud record format", () => {
  it("size is measured exactly like the server check (octet_length(data::text))", async () => {
    const db = new PGlite();
    const samples: unknown[] = [
      { id: "tr_1", notes: "Привет, мир 👋 \"quoted\" \\ \n tab\t", r: -1.25, ok: true, nothing: null, tags: ["a", "б"], nested: { x: [1, { y: 2 }] } },
      { emptyObj: {}, emptyArr: [], big: 123456789, small: 0.001 },
      "x".repeat(1000),
    ];
    for (const s of samples) {
      const { rows } = await db.query<{ n: number }>("SELECT octet_length($1::jsonb::text) AS n", [JSON.stringify(s)]);
      expect(jsonbTextLength(s)).toBe(rows[0].n);
    }
    await db.close();
  });

  it("limits: too large and from the future are refused; exactly at the limit is sent", () => {
    const now = new Date("2026-10-18T12:00:00.000Z");
    const base = { id: "n_1", updatedAt: "2026-10-18T12:00:00.000Z" };
    const fill = (n: number) => ({ ...base, body: "x".repeat(n) });
    const sizeWithout = jsonbTextLength({ ...fill(0), schemaVersion: 6 });
    const atLimit = fill(JOURNAL_CLOUD_MAX_RECORD_BYTES - sizeWithout);
    expect(encodeEntry({ table: "journal_notes", id: "n_1", record: atLimit }, null, now).ok).toBe(true);
    const over = fill(JOURNAL_CLOUD_MAX_RECORD_BYTES - sizeWithout + 1);
    expect(encodeEntry({ table: "journal_notes", id: "n_1", record: over }, null, now)).toEqual({ ok: false, reason: "tooLarge" });

    const soon = new Date(now.getTime() + JOURNAL_CLOUD_MAX_CLOCK_SKEW_MS).toISOString();
    const later = new Date(now.getTime() + JOURNAL_CLOUD_MAX_CLOCK_SKEW_MS + 1).toISOString();
    expect(encodeEntry({ table: "journal_notes", id: "n_1", record: { ...base, updatedAt: soon } }, null, now).ok).toBe(true);
    expect(encodeEntry({ table: "journal_notes", id: "n_1", record: { ...base, updatedAt: later } }, null, now)).toEqual({ ok: false, reason: "fromFuture" });
    expect(encodeEntry({ table: "journal_notes", id: "n_1", record: { id: "n_1" } }, null, now)).toEqual({ ok: false, reason: "missingUpdatedAt" });
  });

  it("settings row exists only after the primary prop account was set", () => {
    expect(snapshotEntries(empty(), []).some((e) => e.table === "journal_settings")).toBe(false);
    const withSettings = { ...empty(), primaryPropAccountId: null, settingsUpdatedAt: "2026-10-18T10:00:00.000Z" };
    expect(snapshotEntries(withSettings, [])).toEqual([
      { table: "journal_settings", id: "journal", record: { id: "journal", primaryPropAccountId: null, updatedAt: "2026-10-18T10:00:00.000Z" } },
    ]);
  });

  it("decode drops reward keys and rejects broken rows", () => {
    const res = decodeRow("journal_trades", { id: "tr_1", data: { id: "tr_1", xp: 9, updatedAt: "2026-10-18T10:00:00Z", schemaVersion: 6 }, updated_at: "t" });
    expect(res.ok && res.entry.record).toEqual({ id: "tr_1", updatedAt: "2026-10-18T10:00:00Z", schemaVersion: 6 });
    expect(decodeRow("journal_trades", { id: "tr_1", data: null as never, updated_at: "t" })).toEqual({ ok: false, reason: "invalid" });
  });

});
