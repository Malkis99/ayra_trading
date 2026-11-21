import { describe, expect, it } from "vitest";
import { acceptConfirmedMeta, parseWatchlistMeta, proposePriority, type PriorityOperation, type WatchlistMeta } from "./watchlist-meta";

export const op = (overrides: Partial<PriorityOperation> = {}): PriorityOperation => ({ userId: "A", instrument: "eurusd", priority: true, expectedEntryRevision: 0, operationId: "00000000-0000-0000-0000-000000000001", ...overrides });
export function applied(operation = op(), previous: WatchlistMeta | null = null): WatchlistMeta {
  const proposal = proposePriority(previous, operation);
  if (proposal.kind !== "write") throw new Error(proposal.kind);
  return { ...proposal.data, updatedAt: "2026-11-21T10:00:00Z" };
}

describe("watchlist metadata contract", () => {
  it("creates revision 1, preserves explicit false and does not invent a server timestamp", () => {
    const proposal = proposePriority(null, op({ priority: false }));
    expect(proposal.kind).toBe("write");
    if (proposal.kind !== "write") return;
    expect(proposal.data).not.toHaveProperty("updatedAt");
    expect(proposal.data.entries.eurusd).toMatchObject({ priority: false, revision: 1 });
  });
  it("preserves unknown fields and unknown instruments without mutating the input", () => {
    const document = applied();
    document.future = { opaque: 42 };
    document.entries.futureasset = { priority: false, revision: 2, operationId: "00000000-0000-0000-0000-000000000009", extension: "keep" };
    document.entries.eurusd.extension = [1, 2];
    const before = structuredClone(document);
    const proposal = proposePriority(document, op({ priority: false, expectedEntryRevision: 1, operationId: "00000000-0000-0000-0000-000000000002" }));
    expect(proposal.kind).toBe("write");
    if (proposal.kind !== "write") return;
    expect(proposal.data.future).toEqual({ opaque: 42 });
    expect(proposal.data.entries.futureasset).toEqual(document.entries.futureasset);
    expect(proposal.data.entries.eurusd.extension).toEqual([1, 2]);
    expect(document).toEqual(before);
  });
  it("replays the last operation, but never an obsolete same-instrument operation", () => {
    const one = applied();
    expect(proposePriority(one, op()).kind).toBe("applied");
    const two = applied(op({ priority: false, expectedEntryRevision: 1, operationId: "00000000-0000-0000-0000-000000000002" }), one);
    expect(proposePriority(two, op()).kind).toBe("conflict");
    expect(two.entries.eurusd.priority).toBe(false);
  });
  it("allows rebase of another instrument, not a competing change to the same entry", () => {
    const one = applied();
    expect(proposePriority(one, op({ instrument: "gbpusd", operationId: "00000000-0000-0000-0000-000000000002" })).kind).toBe("write");
    expect(proposePriority(one, op({ priority: false, operationId: "00000000-0000-0000-0000-000000000002" })).kind).toBe("conflict");
    expect(proposePriority(one, op({ instrument: "gbpusd" })).kind).toBe("conflict");
  });
  it("treats newer versions as opaque and malformed records as invalid", () => {
    const future = { id: "watchlist_meta", version: 2, strange: true };
    expect(parseWatchlistMeta(future)).toEqual({ kind: "unsupported", raw: future });
    expect(parseWatchlistMeta(null).kind).toBe("missing");
    for (const raw of [{}, { ...applied(), updatedAt: "bad" }, { ...applied(), revision: 0 }, { ...applied(), entries: { bad: { priority: "true" } } }]) expect(parseWatchlistMeta(raw).kind).toBe("invalid");
    expect(parseWatchlistMeta(applied()).kind).toBe("v1");
    expect(proposePriority(null, op({ expectedEntryRevision: 1 })).kind).toBe("invalid");
  });
  it("never replaces a newer confirmed snapshot with a late acknowledgement", () => {
    const one = applied();
    const two = applied(op({ expectedEntryRevision: 1, priority: false, operationId: "00000000-0000-0000-0000-000000000002" }), one);
    expect(acceptConfirmedMeta(two, one)).toEqual({ kind: "older", document: two });
    expect(acceptConfirmedMeta(one, two).kind).toBe("accepted");
    expect(acceptConfirmedMeta(two, structuredClone(two)).kind).toBe("same");
    expect(acceptConfirmedMeta(two, { ...two, future: true }).kind).toBe("conflict");
  });
});
