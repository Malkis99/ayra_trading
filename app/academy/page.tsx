"use client";

import React, { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { Tabs } from "@/components/ui";
import { useApp } from "@/lib/context";
import { formatString } from "@/lib/i18n";

const ACADEMY_TABS = ["courses", "backtests", "progress"] as const;
type AcademyTab = typeof ACADEMY_TABS[number];

export default function AcademyPage() {
  return <Suspense><AcademySections /></Suspense>;
}

function AcademySections() {
  const searchParams = useSearchParams();
  const requested = searchParams.get("tab");
  const activeTab: AcademyTab = ACADEMY_TABS.find(tab => tab === requested) ?? "courses";
  const { dict } = useApp();
  const setActiveTab = (tab: AcademyTab) => {
    if (tab === activeTab) return;
    const url = new URL(window.location.href);
    url.searchParams.set("tab", tab);
    // Next integrates native history with useSearchParams, including Back/Forward.
    window.history.pushState(null, "", url.toString());
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-serif text-2xl font-bold text-tx">{dict.academy.title}</h1>
        <p className="text-xs text-mu mt-1">{dict.academy.subtitle}</p>
      </div>

      <Tabs items={ACADEMY_TABS.map(id => ({ id, label: dict.academy.tabs[id] }))}
        value={activeTab} onChange={setActiveTab} label={dict.academy.tabsLabel} idPrefix="academy" />

      <div className="card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vi" role="tabpanel"
        id={`academy-panel-${activeTab}`} aria-labelledby={`academy-tab-${activeTab}`} tabIndex={0}>
        <h4 className="h4">
          {formatString(dict.academy.tabHeader, { tab: dict.academy.tabs[activeTab] })}
        </h4>
        <p className="text-xs text-mu">{dict.academy.inDev}</p>
        <div className="mt-4 h-32 rounded-xl bg-s2/50 border border-line border-dashed flex items-center justify-center text-xs text-mu px-4 text-center">
          {formatString(dict.academy.emptyState, { tab: dict.academy.tabs[activeTab] })}
        </div>
      </div>
    </div>
  );
}
