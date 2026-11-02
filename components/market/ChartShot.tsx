"use client";

import React, { useCallback, useEffect, useState } from "react";
import { Camera, Download } from "lucide-react";
import { useApp } from "@/lib/context";
import { formatString } from "@/lib/i18n";
import { Button, Modal, buttonClasses, cn } from "@/components/ui";
import {
  canCaptureTab,
  canvasToPng,
  captureTab,
  clipToWindow,
  intervalTag,
  composeShot,
  ShotError,
  shotFileName,
  type Rect,
  type ShotClock,
  type ShotErrorCode,
} from "@/lib/market/chart-shot";

type Shot = { phase: "idle" } | { phase: "busy" } | { phase: "done"; url: string; file: string } | { phase: "error"; code: ShotErrorCode };

const rectOf = (el: Element): Rect => {
  const r = el.getBoundingClientRect();
  return { x: r.left, y: r.top, w: r.width, h: r.height };
};
const textOf = (root: ParentNode, id: string) => root.querySelector(`[data-testid="${id}"]`)?.textContent?.replace(/\s+/g, " ").trim() ?? "";

/** The «Time and session» card's lines as the page shows them now (none when the card is hidden). */
function clockOf(root: HTMLElement, title: string): ShotClock | null {
  const el = root.querySelector('[data-testid="market-chart-clock"]');
  if (!el) return null;
  return {
    title,
    time: textOf(el, "market-chart-clock-time"),
    zone: textOf(el, "market-chart-clock-zone"),
    session: textOf(el, "market-chart-clock-session"),
    sessionOn: el.querySelector('[data-testid="market-chart-clock-session"]')?.getAttribute("data-on") === "true",
    market: textOf(el, "market-chart-clock-market"),
    marketOpen: el.querySelector('[data-testid="market-chart-clock-market"]')?.getAttribute("data-open") === "true",
    note: textOf(el, "market-chart-clock-note"),
  };
}

/** Is the tab capture there (computers)? Phones and browsers without it get a disabled button. */
export function useCanShoot(phone: boolean): boolean {
  const [can, setCan] = useState(false);
  useEffect(() => setCan(canCaptureTab()), []);
  return can && !phone;
}

/**
 * «Chart screenshot» (owner 2026-11-02): the browser asks to show this tab, one picture is taken, cut to the chart and
 * shown here before downloading as PNG. With 16–17 mode the chart's legend line (it names the broker) is covered.
 */
export function ChartShot({
  root,
  name,
  ticker,
  interval,
  intervalId,
  minor,
  drawing,
  enabled,
  onBusy,
  onOpen,
}: {
  root: React.RefObject<HTMLElement>;
  name: string;
  ticker: string;
  /** Shown in the picture («1ч»). */
  interval: string;
  /** TradingView's code («60»), for the file name. */
  intervalId: string;
  minor: boolean;
  drawing: boolean;
  enabled: boolean;
  /** While the browser films the tab (the full screen must not close under it). */
  onBusy: (busy: boolean) => void;
  onOpen: (open: boolean) => void;
}) {
  const { dict } = useApp();
  const t = dict.market.chart.shot;
  const [shot, setShot] = useState<Shot>({ phase: "idle" });
  const open = shot.phase === "done" || shot.phase === "error";

  useEffect(() => onOpen(open), [open, onOpen]);
  // the preview's file lives only while it is shown
  useEffect(() => {
    if (shot.phase !== "done") return;
    return () => URL.revokeObjectURL(shot.url);
  }, [shot]);

  const take = useCallback(async () => {
    const el = root.current;
    if (!el) return;
    const gridEl = el.querySelector('[data-testid="market-chart-grid"]');
    if (!gridEl) return;
    // the whole chart in the window (the workspace is as tall as the page's scroll area)
    gridEl.scrollIntoView({ block: "nearest", inline: "nearest" });
    setShot({ phase: "busy" });
    onBusy(true);
    try {
      const { frame, measured } = await captureTab(() => ({
        grid: clipToWindow(rectOf(gridEl), window.innerWidth, window.innerHeight),
        widgets: Array.from(el.querySelectorAll('[data-testid^="market-chart-widget"][role="region"]')).map((w) => clipToWindow(rectOf(w), window.innerWidth, window.innerHeight)),
        clock: clockOf(el, dict.market.chart.clock.title),
      }));
      const canvas = composeShot(frame, { ...measured, name, ticker, interval, minor, drawing });
      const blob = await canvasToPng(canvas);
      setShot({ phase: "done", url: URL.createObjectURL(blob), file: shotFileName(ticker, intervalTag(intervalId), new Date()) });
    } catch (e) {
      setShot({ phase: "error", code: e instanceof ShotError ? e.code : "failed" });
    } finally {
      onBusy(false);
    }
  }, [root, name, ticker, interval, intervalId, minor, drawing, onBusy, dict]);

  const close = () => setShot({ phase: "idle" });
  const busy = shot.phase === "busy";

  return (
    <>
      <button
        type="button"
        onClick={take}
        disabled={!enabled || busy}
        aria-label={enabled ? t.button : `${t.button}: ${t.phone}`}
        title={enabled ? t.hint : t.phone}
        aria-busy={busy}
        className={cn(
          "grid h-8 w-8 place-items-center rounded-md border border-line text-mu focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vi",
          enabled ? "hover:border-vi/50 hover:text-tx" : "cursor-not-allowed opacity-50",
          busy && "animate-pulse motion-reduce:animate-none"
        )}
        data-testid="market-chart-shot"
      >
        <Camera size={15} aria-hidden="true" />
      </button>
      <Modal
        isOpen={open}
        onClose={close}
        title={t.title}
        subtitle={shot.phase === "done" ? t.previewNote : undefined}
        closeLabel={t.close}
        size="xl"
        data-testid="market-chart-shot-dialog"
        footer={
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="ghost" onClick={close} data-testid="market-chart-shot-close">
              {t.close}
            </Button>
            <Button variant="ghost" onClick={take} data-testid="market-chart-shot-again">
              {t.again}
            </Button>
            {shot.phase === "done" && (
              <a href={shot.url} download={shot.file} className={buttonClasses()} data-testid="market-chart-shot-download">
                <Download size={15} aria-hidden="true" />
                {t.download}
              </a>
            )}
          </div>
        }
      >
        {shot.phase === "done" && (
          // eslint-disable-next-line @next/next/no-img-element -- a local picture (blob:), not a page image
          <img
            src={shot.url}
            alt={formatString(t.alt, { name })}
            className="max-h-[60vh] w-full rounded-md border border-line object-contain"
            data-testid="market-chart-shot-preview"
          />
        )}
        {shot.phase === "error" && (
          <p className="text-sm text-tx" role="alert" data-testid="market-chart-shot-error" data-code={shot.code}>
            {t.errors[shot.code]}
          </p>
        )}
      </Modal>
    </>
  );
}
