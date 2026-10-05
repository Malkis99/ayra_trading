"use client";

import React, { useState } from "react";
import { TabHeader } from "@/components/TabHeader";
import { useApp } from "@/lib/context";
import { formatString } from "@/lib/i18n";

export default function CommunityPage() {
  const [activeTab, setActiveTab] = useState(0);
  const { dict } = useApp();

  const tabs = [
    dict.community.tabs.feed,
    dict.community.tabs.guilds,
    dict.community.tabs.arena,
    dict.community.tabs.myProfile,
  ];

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-serif text-2xl font-bold text-tx">{dict.community.title}</h1>
        <p className="text-xs text-mu mt-1">{dict.community.subtitle}</p>
      </div>

      <TabHeader tabs={tabs} activeTab={activeTab} onTabChange={setActiveTab} />

      <div className="card">
        <h4 className="h4">
          {formatString(dict.community.tabHeader, { tab: tabs[activeTab] })}
        </h4>
        <p className="text-xs text-mu">{dict.community.inDev}</p>
        <div className="mt-4 h-32 rounded-xl bg-s2/50 border border-line border-dashed flex items-center justify-center text-xs text-mu px-4 text-center">
          {formatString(dict.community.emptyState, { tab: tabs[activeTab] })}
        </div>
      </div>
    </div>
  );
}
