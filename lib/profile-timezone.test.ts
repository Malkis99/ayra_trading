import { describe, it, expect } from "vitest";
import { decideLocale, decideTimezone, type TimezoneSyncState } from "./profile-timezone";

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

describe("interface language in the cloud profile (profiles.locale)", () => {
  const at = "2026-11-02T10:00:00Z";
  it("a device where the language was never chosen takes the account's; the cloud default 'ru' changes nothing", () => {
    expect(decideLocale(null, { locale: "en", updatedAt: at }, fresh)).toEqual({ kind: "take", value: "en" });
    expect(decideLocale(null, { locale: "ru", updatedAt: at }, fresh)).toEqual({ kind: "none" });
  });

  it("first exchange: English chosen here goes up over the default 'ru'; a language set in the account wins", () => {
    expect(decideLocale("en", { locale: "ru", updatedAt: at }, fresh)).toEqual({ kind: "push", value: "en" });
    expect(decideLocale("ru", { locale: "en", updatedAt: at }, fresh)).toEqual({ kind: "take", value: "en" });
  });

  it("after that: a change here goes up, a change on another device comes in", () => {
    expect(decideLocale("en", { locale: "ru", updatedAt: at }, { synced: "ru", dirty: true, changedAt: "2026-11-02T11:00:00Z" })).toEqual({ kind: "push", value: "en" });
    expect(decideLocale("ru", { locale: "en", updatedAt: at }, synced("ru"))).toEqual({ kind: "take", value: "en" });
    expect(decideLocale("en", { locale: "en", updatedAt: at }, synced("en"))).toEqual({ kind: "none" });
  });
});
