import { describe, it, expect, vi, beforeEach } from "vitest";
import { AuthTabChannel, currentTabId } from "./tab-channel";

describe("AuthTabChannel (T7a.3)", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("broadcasts and receives messages correctly", () => {
    const channel1 = new AuthTabChannel();
    const handler = vi.fn();

    channel1.subscribe(handler);

    // Simulate storage event from another tab
    const event = new StorageEvent("storage", {
      key: "ayra_auth_event",
      newValue: JSON.stringify({
        type: "AUTH_SIGNED_IN",
        tabId: "other_tab_123",
        timestamp: Date.now(),
      }),
    });

    window.dispatchEvent(event);

    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "AUTH_SIGNED_IN",
        tabId: "other_tab_123",
      })
    );
  });

  it("ignores messages originating from the same tab", () => {
    const channel1 = new AuthTabChannel();
    const handler = vi.fn();

    channel1.subscribe(handler);

    // Event with same tabId
    const event = new StorageEvent("storage", {
      key: "ayra_auth_event",
      newValue: JSON.stringify({
        type: "AUTH_SIGNED_IN",
        tabId: currentTabId,
        timestamp: Date.now(),
      }),
    });

    window.dispatchEvent(event);

    expect(handler).not.toHaveBeenCalled();
  });
});
