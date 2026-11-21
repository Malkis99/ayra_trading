import "fake-indexeddb/auto";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { AppStorage } from "@/lib/storage";
import { spaceTabChannel } from "@/lib/auth/space-channel";
import { SupabaseWatchlistMetaRemote } from "./watchlist-meta-sync";
import { useWatchlistPriorities } from "./use-watchlist-priorities";

let userId: string | null = null;
vi.mock("@/lib/auth/auth-context", () => ({ useAuth: () => ({ user: userId ? { id: userId } : null, isSpaceReady: true }) }));
vi.mock("@/lib/supabase/config", () => ({ isE2EMockEnabled: () => false }));
vi.mock("@/lib/supabase/browser", () => ({ createSupabaseBrowserClient: () => null }));
const A = "00000000-0000-4000-8000-000000002711", B = "00000000-0000-4000-8000-000000002712";
const deferred = <T,>() => { let resolve!: (value: T) => void;const promise = new Promise<T>(r => resolve = r);return { promise, resolve }; };
function mocks() {
  vi.spyOn(SupabaseWatchlistMetaRemote.prototype, "currentUserId").mockImplementation(async () => AppStorage.getUserId());
  vi.spyOn(SupabaseWatchlistMetaRemote.prototype, "isSyncEnabled").mockResolvedValue(true);
  return vi.spyOn(SupabaseWatchlistMetaRemote.prototype, "read");
}
function switchTo(next: string | null) { const from = AppStorage.getActiveSpaceId();userId = next;AppStorage.setUserId(next);spaceTabChannel.notifyLocal(from, AppStorage.getActiveSpaceId()); }
afterEach(() => { cleanup();vi.restoreAllMocks();AppStorage.setUserId(null);userId = null; });
it("A's delayed cache read never paints B or Guest", async () => {
  const read = mocks(), gate = deferred<unknown>();read.mockImplementation(uid => uid === A ? gate.promise : Promise.resolve(null));
  switchTo(A);const hook = renderHook(() => useWatchlistPriorities());await waitFor(() => expect(read).toHaveBeenCalledWith(A));
  act(() => { switchTo(B); });hook.rerender();await waitFor(() => expect(hook.result.current.record?.checked).toBe(true));
  expect(hook.result.current.userId).toBe(B);
  gate.resolve({ id: "watchlist_meta", version: 2 });await act(async () => { await gate.promise; });
  expect(hook.result.current.userId).toBe(B);expect(hook.result.current.record?.raw).toBeNull();
  act(() => { switchTo(null); });hook.rerender();expect(hook.result.current.userId).toBeNull();expect(hook.result.current.record).toBeUndefined();
});
it("batched A → B → A creates a fresh controller instead of permanently invalidating A", async () => {
  const read = mocks(), gate = deferred<unknown>();read.mockImplementationOnce(() => gate.promise).mockResolvedValue(null);
  switchTo(A);const hook = renderHook(() => useWatchlistPriorities());await waitFor(() => expect(read).toHaveBeenCalled());
  act(() => { switchTo(B);switchTo(A); });hook.rerender();
  await waitFor(() => expect(read.mock.calls.filter(([id]) => id === A).length).toBe(2));
  await waitFor(() => expect(hook.result.current.record?.checked).toBe(true));
  gate.resolve({ id: "watchlist_meta", version: 2 });await act(async () => { await gate.promise; });
  expect(hook.result.current.record?.raw).toBeNull();expect(hook.result.current.controller).not.toBeNull();
});
it("Guest does not read or create metadata", async () => {
  const read = mocks().mockResolvedValue(null);switchTo(null);const hook = renderHook(() => useWatchlistPriorities());
  expect(hook.result.current.userId).toBeNull();expect(hook.result.current.controller).toBeNull();expect(read).not.toHaveBeenCalled();
});
