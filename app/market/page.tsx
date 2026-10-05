"use client";

import React, { useState } from "react";
import { TabHeader } from "@/components/TabHeader";
import { useApp } from "@/lib/context";
import { formatString } from "@/lib/i18n";

export default function MarketPage() {
  const [activeTab, setActiveTab] = useState(0);
  const { dict } = useApp();

  const tabs = [
    dict.market.tabs.overview,
    dict.market.tabs.calendar,
    dict.market.tabs.macro,
    dict.market.tabs.news,
    dict.market.tabs.scanner,
    dict.market.tabs.watchlist,
  ];

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-serif text-2xl font-bold text-tx">{dict.market.title}</h1>
        <p className="text-xs text-mu mt-1">{dict.market.subtitle}</p>
      </div>

      <TabHeader tabs={tabs} activeTab={activeTab} onTabChange={setActiveTab} />

      <div className="card">
        <h4 className="h4">
          {formatString(dict.market.tabHeader, { tab: tabs[activeTab] })}
        </h4>
        <p className="text-xs text-mu">{dict.market.disclaimer}</p>
        <div className="mt-4 h-32 rounded-xl bg-s2/50 border border-line border-dashed flex items-center justify-center text-xs text-mu px-4 text-center">
          {formatString(dict.market.emptyState, { tab: tabs[activeTab] })}
        </div>
      </div>
    </div>
  );
}
