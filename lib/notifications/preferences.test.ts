import { describe, expect, it } from "vitest";
import { defaultSettings } from "./types";
import { inQuietHours, preferenceEnabled, safeNotificationHref, shouldStore, validSettings } from "./preferences";
import { CHANNELS, TYPE_CODES, channelAvailable } from "./registry";

describe("notification policy", () => {
  it("keeps critical security enabled through master off, filters and preferences", () => {
    const s = { ...defaultSettings(), all_disabled: true, min_importance: 3, instrument_ids: ["btc"] };
    expect(shouldStore("security_new_device", s, [{ type_code: "security_new_device", channel_code: "site", enabled: false }], 1, ["eth"])).toBe(true);
    expect(shouldStore("quest", s, [])).toBe(false);
    expect(preferenceEnabled("security_suspicious", "web_push", [])).toBe(false);
  });
  it("does not filter general economics by selected instruments", () => {
    const s = { ...defaultSettings(), instrument_ids: ["btc"], min_importance: 2 };
    expect(shouldStore("market_actual", s, [], 3, [])).toBe(true);
    expect(shouldStore("market_actual", s, [], 3, ["eth"])).toBe(false);
    expect(shouldStore("market_actual", s, [], 3, ["btc"])).toBe(true);
    expect(shouldStore("market_actual", s, [], 1)).toBe(false);
  });
  it("evaluates local midnight and DST without altering on-site storage", () => {
    const s = { ...defaultSettings("Europe/Berlin"), quiet_enabled: true };
    expect(inQuietHours(s, new Date("2026-03-29T00:00:00Z"))).toBe(true);
    expect(inQuietHours(s, new Date("2026-03-29T01:30:00Z"))).toBe(true);
    expect(inQuietHours(s, new Date("2026-03-29T06:00:00Z"))).toBe(false);
    expect(shouldStore("quest", s, [])).toBe(true);
    expect(validSettings({ ...s, quiet_end: s.quiet_start })).toBe(false);
    expect(validSettings({ ...s, timezone: "Invalid/Zone" })).toBe(false);
  });
  it("does not claim pending sources or channels are live", () => {
    for (const type of TYPE_CODES) for (const channel of CHANNELS) expect(channelAvailable(type, channel)).toBe(false);
    for (const channel of CHANNELS.filter((c) => c !== "site")) expect(preferenceEnabled("quest", channel, [])).toBe(false);
  });
  it("blocks external and protocol-relative links", () => {
    expect(safeNotificationHref("/market?tab=calendar")).toBe("/market?tab=calendar");
    for (const href of ["//evil.test", "https://evil.test", "javascript:alert(1)", "/\\evil.test", "/%2fevil.test", "/%5cevil.test"]) expect(safeNotificationHref(href)).toBeNull();
  });
});
