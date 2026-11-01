"use client";

import React from "react";
import { useApp } from "@/lib/context";
import type { DataDelay } from "@/lib/market/instruments";
import { TRADINGVIEW_HOME } from "./TradingViewWidget";

/** «Source: TradingView · real-time / may be delayed» — on every block with TradingView data (PR 1.2). */
export function SourceLine({ delay, testId }: { delay: DataDelay; testId: string }) {
  const { dict } = useApp();
  const t = dict.market.overview;
  return (
    <p className="text-[11px] text-mu" data-testid={testId}>
      {t.sourcePrefix}{" "}
      <a href={TRADINGVIEW_HOME} target="_blank" rel="noopener noreferrer nofollow" className="text-vi hover:underline">
        {t.sourceName}
      </a>{" "}
      · {t.delay[delay]}
    </p>
  );
}
