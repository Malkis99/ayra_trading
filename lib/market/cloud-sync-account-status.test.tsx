import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { AppStorage } from "@/lib/storage";
import { appMarketStore, SupabaseMarketRemote, useMarketCloudSync, useMarketSyncStatus } from "./cloud-sync-engine";
import { DEFAULT_CHART_VIEW } from "./chart-workspace";
import { normalizeChartPrefs } from "./watchlist";
import { normalizeSettings } from "./sessions";
import { normalizeCalendarNews } from "./calendar-news";

vi.mock("@/lib/supabase/config", () => ({ isE2EMockEnabled: () => false }));
vi.mock("@/lib/supabase/browser", () => ({ createSupabaseBrowserClient: () => null }));
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it("does not show A's cached success/time when Market reopens as B or Guest", async () => {
  let user: string | null = "A";
  vi.spyOn(AppStorage, "getUserId").mockImplementation(() => user);
  vi.spyOn(AppStorage, "getActiveSpaceId").mockImplementation(() => user ? `user:${user}` : "guest");
  vi.spyOn(SupabaseMarketRemote.prototype, "currentUserId").mockImplementation(async () => user);
  vi.spyOn(SupabaseMarketRemote.prototype, "isSyncEnabled").mockResolvedValue(true);
  vi.spyOn(SupabaseMarketRemote.prototype, "fetchAll").mockResolvedValue([]);
  vi.spyOn(SupabaseMarketRemote.prototype, "upsert").mockResolvedValue();
  vi.spyOn(appMarketStore, "read").mockReturnValue({ watchlist: { version: 1, ids: [] }, view: { ...DEFAULT_CHART_VIEW }, notes: {}, prefs: normalizeChartPrefs(null), sessions: normalizeSettings(null), calendar: normalizeCalendarNews(null) });
  vi.spyOn(appMarketStore, "joined").mockReturnValue(true);
  vi.spyOn(appMarketStore, "markJoined").mockImplementation(() => {});
  const first = renderHook(() => { useMarketCloudSync(); return useMarketSyncStatus(); });
  await waitFor(() => expect(first.result.current.kind).toBe("on"));
  expect(first.result.current.lastSyncedAt).not.toBeNull();
  first.unmount();
  // There is no mounted Market listener during this account change.
  user = "B";
  const second = renderHook(() => useMarketSyncStatus());
  expect(second.result.current).toMatchObject({ kind: "waiting", lastSyncedAt: null });
  user = null; second.rerender();
  expect(second.result.current).toMatchObject({ kind: "guest", lastSyncedAt: null });
});
