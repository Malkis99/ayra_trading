"use client";

import React, { useEffect, useRef, useState } from "react";
import { WifiOff } from "lucide-react";
import { cn } from "@/components/ui";

/**
 * The free TradingView widgets used on the Market (PR 1.2). «Technical analysis» is not here on purpose: it shows a
 * «buy / sell» rating, which looks like a signal (`docs/market-plan.md` section 9).
 */
export type TradingViewWidgetName = "mini-symbol-overview" | "market-quotes" | "advanced-chart";

export const TRADINGVIEW_SCRIPT_BASE = "https://s3.tradingview.com/external-embedding/embed-widget-";
export const TRADINGVIEW_HOME = "https://www.tradingview.com/";
/** No iframe after this long — TradingView is treated as unavailable. */
export const WIDGET_LOAD_TIMEOUT_MS = 15_000;

/**
 * The config every widget gets: dark theme, the app language, a transparent background (the card shows through),
 * and clicks on a symbol lead back into the app (`largeChartUrl`), not to an outside page. Nothing else is passed —
 * no referral or partner parameters (16–17 mode: no partner links, `docs/market-plan.md` decision 10).
 */
export function widgetConfig(options: Record<string, unknown>, locale: "ru" | "en", origin: string): Record<string, unknown> {
  return {
    ...options,
    colorTheme: "dark",
    theme: "dark",
    isTransparent: true,
    locale,
    largeChartUrl: `${origin}/market`,
  };
}

type Status = "idle" | "loading" | "ready" | "error";

/**
 * A TradingView widget in a box of a fixed height: it loads only once the box is near the screen, shows a loading
 * line until the widget's frame appears, and a plain message with «Try again» when TradingView does not answer.
 */
export function TradingViewWidget({
  widget,
  config,
  height,
  label,
  loadingText,
  errorText,
  retryLabel,
  testId,
}: {
  widget: TradingViewWidgetName;
  config: Record<string, unknown>;
  height: number;
  label: string;
  loadingText: string;
  errorText: string;
  retryLabel: string;
  testId: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [attempt, setAttempt] = useState(0);
  const configJson = JSON.stringify(config);

  // Start only when the box is (nearly) visible
  useEffect(() => {
    if (status !== "idle") return;
    const el = box.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      setStatus("loading");
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          io.disconnect();
          setStatus("loading");
        }
      },
      { rootMargin: "200px 0px" }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [status]);

  // Insert TradingView's own embed script; its frame replaces nothing React renders (the host has no React children)
  useEffect(() => {
    if (status !== "loading") return;
    const el = host.current;
    if (!el) return;
    let settled = false;
    const finish = (next: Status) => {
      if (settled) return;
      settled = true;
      observer.disconnect();
      window.clearTimeout(timer);
      setStatus(next);
    };
    const observer = new MutationObserver(() => {
      if (el.querySelector("iframe")) finish("ready");
    });
    observer.observe(el, { childList: true, subtree: true });
    const timer = window.setTimeout(() => finish("error"), WIDGET_LOAD_TIMEOUT_MS);

    const inner = document.createElement("div");
    inner.className = "tradingview-widget-container__widget";
    inner.style.height = "100%";
    const script = document.createElement("script");
    script.type = "text/javascript";
    script.async = true;
    script.src = `${TRADINGVIEW_SCRIPT_BASE}${widget}.js`;
    script.textContent = configJson;
    script.onerror = () => finish("error");
    el.append(inner, script);

    return () => {
      settled = true;
      observer.disconnect();
      window.clearTimeout(timer);
    };
  }, [status, widget, configJson, attempt]);

  // Leaving the page or retrying: drop what the widget put into the host
  useEffect(() => {
    const el = host.current;
    return () => {
      if (el) el.replaceChildren();
    };
  }, [attempt]);

  const retry = () => {
    host.current?.replaceChildren();
    setAttempt((a) => a + 1);
    setStatus("loading");
  };

  return (
    <div ref={box} className="relative w-full overflow-hidden" style={{ height }} role="region" aria-label={label} aria-busy={status === "loading"} data-testid={testId} data-status={status}>
      {/* The page is `color-scheme: dark`, TradingView's frame is not: with different schemes the browser paints the
          frame white, so the host uses the frame's own scheme and the dark transparent widget shows the card. */}
      <div ref={host} className={cn("tradingview-widget-container h-full w-full [color-scheme:normal]", status === "error" && "hidden")} />
      {(status === "idle" || status === "loading") && (
        <p className="absolute inset-0 grid place-items-center text-xs text-mu" data-testid={`${testId}-loading`}>
          {loadingText}
        </p>
      )}
      {status === "error" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-4 text-center" role="alert" data-testid={`${testId}-error`}>
          <WifiOff size={18} className="text-mu" aria-hidden="true" />
          <p className="text-xs text-mu">{errorText}</p>
          <button
            type="button"
            onClick={retry}
            className="rounded-md border border-line px-3 py-1.5 text-xs font-semibold text-tx hover:border-vi focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vi"
            data-testid={`${testId}-retry`}
          >
            {retryLabel}
          </button>
        </div>
      )}
    </div>
  );
}
