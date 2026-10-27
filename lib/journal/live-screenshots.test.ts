import { describe, it, expect } from "vitest";
import { withLiveScreenshots } from "./context";
import type { Trade } from "./types";

const t = (id: string, attachmentIds?: string[]) => ({ id, attachmentIds }) as Trade;

describe("screenshots shown for a trade follow deletions (owner's report 2026-10-27)", () => {
  it("ids of deleted screenshots are not shown or counted; the rest stays as it is", () => {
    const trades = [t("a", ["s1", "s2"]), t("b", ["s3"]), t("c")];
    const out = withLiveScreenshots(trades, new Set(["s2"]));
    expect(out[0].attachmentIds).toEqual(["s1"]);
    expect(out[1]).toBe(trades[1]); // untouched trades are the same objects
    expect(out[2]).toBe(trades[2]);
    expect(trades[0].attachmentIds).toEqual(["s1", "s2"]); // the record itself is not changed
  });

  it("nothing deleted: the same list", () => {
    const trades = [t("a", ["s1"])];
    expect(withLiveScreenshots(trades, new Set())).toBe(trades);
  });
});
