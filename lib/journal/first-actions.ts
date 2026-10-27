import type { FirstActionKind } from "@/lib/game";
import type { ImportBatch } from "./import/batches";
import type { JournalSnapshot } from "./types";

/**
 * Has the account's journal any record of this kind, deleted ones included? Then a new one is not «the first»
 * (deleted and added again, or downloaded from another device). docs/economy-coins-plan.md.
 */
export function hasRecordsOfKind(snapshot: JournalSnapshot, batches: ImportBatch[], kind: FirstActionKind): boolean {
  switch (kind) {
    case "trade":
      return snapshot.trades.length > 0;
    case "account":
      return snapshot.accounts.length > 0;
    case "strategy":
      return snapshot.strategies.length > 0;
    case "import":
      return batches.length > 0;
    case "dayPlan":
      return snapshot.plans.length > 0;
    case "weekPlan":
      return snapshot.weekPlans.length > 0;
    case "note":
      return snapshot.notes.length > 0;
    case "noTrade":
      return snapshot.noTrades.length > 0;
    case "screenshot":
      // screenshots from before 0005 are listed by their trade only
      return (snapshot.attachments?.length ?? 0) > 0 || snapshot.trades.some((t) => t.attachmentIds?.length);
  }
}
