import { describe, it, expect } from "vitest";
import { decideTimezone, type TimezoneSyncState } from "./profile-timezone";

const fresh: TimezoneSyncState = { synced: null, dirty: false };
const synced = (v: string): TimezoneSyncState => ({ synced: v, dirty: false });

describe("time zone in the cloud profile", () => {
  it("first exchange on a device: a zone set in the cloud is taken; the cloud default UTC is not, ours goes up", () => {
    expect(decideTimezone("Asia/Tbilisi", { timezone: "Europe/Berlin", updatedAt: "2026-10-20T10:00:00Z" }, fresh)).toEqual({ kind: "take", value: "Europe/Berlin" });
    expect(decideTimezone("Asia/Tbilisi", { timezone: "UTC", updatedAt: "2026-10-01T10:00:00Z" }, fresh)).toEqual({ kind: "push", value: "Asia/Tbilisi" });
    expect(decideTimezone("Asia/Tbilisi", { timezone: "Asia/Tbilisi", updatedAt: null }, fresh)).toEqual({ kind: "none" });
  });

  it("changed here only → goes up; changed in the cloud only → comes down", () => {
    expect(decideTimezone("Europe/Berlin", { timezone: "Asia/Tbilisi", updatedAt: "2026-10-20T10:00:00Z" }, { synced: "Asia/Tbilisi", dirty: true, changedAt: "2026-10-21T10:00:00Z" })).toEqual({
      kind: "push",
      value: "Europe/Berlin",
    });
    expect(decideTimezone("Asia/Tbilisi", { timezone: "Europe/Berlin", updatedAt: "2026-10-21T10:00:00Z" }, synced("Asia/Tbilisi"))).toEqual({ kind: "take", value: "Europe/Berlin" });
    expect(decideTimezone("Asia/Tbilisi", { timezone: "Asia/Tbilisi", updatedAt: "2026-10-21T10:00:00Z" }, synced("Asia/Tbilisi"))).toEqual({ kind: "none" });
  });

  it("changed on both devices: the newer change wins", () => {
    const local: TimezoneSyncState = { synced: "Asia/Tbilisi", dirty: true, changedAt: "2026-10-21T10:00:00Z" };
    expect(decideTimezone("Europe/Berlin", { timezone: "America/New_York", updatedAt: "2026-10-21T11:00:00Z" }, local)).toEqual({ kind: "take", value: "America/New_York" });
    expect(decideTimezone("Europe/Berlin", { timezone: "America/New_York", updatedAt: "2026-10-21T09:00:00Z" }, local)).toEqual({ kind: "push", value: "Europe/Berlin" });
  });
});
