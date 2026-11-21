import { afterEach, describe, expect, it, vi } from "vitest";
import { mountQuotesFrame, quotesFrameDocument } from "./tradingview-quotes-frame";

afterEach(() => { document.body.replaceChildren(); vi.useRealTimers(); vi.restoreAllMocks(); });
const host = () => { const el = document.createElement("div"); document.body.append(el); return el; };
const url = "https://s3.tradingview.com/external-embedding/embed-widget-market-quotes.js";

describe("isolated quotes lifecycle", () => {
  it("keeps configuration as JSON, escaping HTML/script injection", () => {
    const html = quotesFrameDocument(url, { label: '</script><script>alert(1)</script>', locale: "ru" }, "1");
    expect(html).not.toContain('</script><script>alert');
    expect(html).toContain('\\u003c/script\\u003e');
    expect(html).toContain(url);
  });
  it("disposes the entire pending browsing context and its deadline/listener", () => {
    vi.useFakeTimers(); const finish = vi.fn(), remove = vi.spyOn(window, "removeEventListener"), el = host();
    const mounted = mountQuotesFrame(el, url, {}, "Quotes", 15000, finish);
    const frame = el.querySelector("iframe")!;
    expect(frame.title).toBe("Quotes");
    mounted.dispose();
    expect(el.children).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
    expect(remove).toHaveBeenCalledWith("message", expect.any(Function));
    vi.runAllTimers(); expect(finish).not.toHaveBeenCalled();
  });
  it("rejects forged readiness and accepts only the matching frame, token and status", () => {
    vi.useFakeTimers(); const finish = vi.fn(), el = host();
    const mounted = mountQuotesFrame(el, url, {}, "Quotes", 15000, finish);
    const frame = el.querySelector("iframe")!;
    const token = /token:"(\d+)"/.exec(frame.srcdoc)![1];
    const data = { type: "ayra-quotes-frame", token, status: "ready" };
    window.dispatchEvent(new MessageEvent("message", { source: window, data }));
    window.dispatchEvent(new MessageEvent("message", { source: frame.contentWindow, data: { ...data, token: "wrong" } }));
    expect(finish).not.toHaveBeenCalled();
    window.dispatchEvent(new MessageEvent("message", { source: frame.contentWindow, data }));
    expect(finish).toHaveBeenCalledTimes(1); expect(finish).toHaveBeenCalledWith("ready");
    expect(vi.getTimerCount()).toBe(0);
    mounted.release(); expect(el.children).toHaveLength(1);
    mounted.dispose(); expect(el.children).toHaveLength(0);
  });
  it("removes a timed-out frame before exposing error and permits a clean retry", () => {
    vi.useFakeTimers(); const finish = vi.fn(), el = host();
    mountQuotesFrame(el, url, {}, "Quotes", 15000, finish);
    vi.advanceTimersByTime(15000);
    expect(finish).toHaveBeenCalledTimes(1); expect(finish).toHaveBeenCalledWith("error");
    expect(el.children).toHaveLength(0);
    const retry = mountQuotesFrame(el, url, {}, "Quotes", 15000, finish);
    expect(el.children).toHaveLength(1);
    retry.dispose(); expect(vi.getTimerCount()).toBe(0);
  });
});

