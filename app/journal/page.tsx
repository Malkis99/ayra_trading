"use client";

import React, { useState } from "react";
import { TabHeader } from "@/components/TabHeader";
import { useApp } from "@/lib/context";
import { formatString } from "@/lib/i18n";

export default function JournalPage() {
  const [activeTab, setActiveTab] = useState(0);
  const { dict } = useApp();

  const tabs = [
    dict.journal.tabs.dashboard,
    dict.journal.tabs.trades,
    dict.journal.tabs.reports,
    dict.journal.tabs.tradingPlan,
    dict.journal.tabs.strategies,
    dict.journal.tabs.accounts,
    dict.journal.tabs.notes,
  ];

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-serif text-2xl font-bold text-tx">{dict.journal.title}</h1>
        <p className="text-xs text-mu mt-1">{dict.journal.subtitle}</p>
      </div>

      <TabHeader tabs={tabs} activeTab={activeTab} onTabChange={setActiveTab} />

      <div className="card">
        <h4 className="h4">
          {formatString(dict.journal.tabHeader, { tab: tabs[activeTab] })}
        </h4>
        <p className="text-xs text-mu">{dict.journal.inDev}</p>
        <div className="mt-4 h-32 rounded-xl bg-s2/50 border border-line border-dashed flex items-center justify-center text-xs text-mu px-4 text-center">
          {formatString(dict.journal.emptyState, { tab: tabs[activeTab] })}
        </div>
      </div>
    </div>
  );
}
