"use client";

import React, { useState } from "react";
import { TabHeader } from "@/components/TabHeader";
import { useApp } from "@/lib/context";
import { formatString, formatNumber } from "@/lib/i18n";

export default function ProfilePage() {
  const [activeTab, setActiveTab] = useState(0);
  const { showToast, dict, lang } = useApp();

  const tabs = [
    dict.profile.tabs.overview,
    dict.profile.tabs.wardrobe,
    dict.profile.tabs.achievements,
    dict.profile.tabs.chronicle,
    dict.profile.tabs.posts,
    dict.profile.tabs.stats,
  ];

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-serif text-2xl font-bold text-tx">{dict.profile.title}</h1>
        <p className="text-xs text-mu mt-1">{dict.profile.subtitle}</p>
      </div>

      <TabHeader tabs={tabs} activeTab={activeTab} onTabChange={setActiveTab} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        {/* Character Stage Placeholder */}
        <div className="lg:col-span-5 card min-h-[400px] flex flex-col items-center justify-between p-6 bg-radial-gradient">
          <div className="flex w-full justify-between text-xs text-mu">
            <span className="chip">{dict.profile.dragHint}</span>
            <span className="chip">{dict.profile.slotsHint}</span>
          </div>

          <div className="my-8 flex flex-col items-center text-center">
            <div className="lvbadge mb-4">1</div>
            <h3 className="font-serif text-xl font-bold text-tx">TraderOne</h3>
            <p className="text-xs text-mu">
              {formatString(dict.profile.levelStatus, {
                level: formatNumber(lang, 1),
                title: dict.profile.noviceTitle,
              })}
            </p>
          </div>

          <div className="flex gap-2">
            <button
              onClick={() => showToast(dict.profile.resetToast)}
              className="btn-ghost text-xs"
            >
              {dict.profile.reset}
            </button>
            <button
              onClick={() => showToast(dict.profile.rotateToast)}
              className="btn-ghost text-xs"
            >
              {dict.profile.rotate}
            </button>
            <button
              onClick={() => showToast(dict.profile.bgToast)}
              className="btn-ghost text-xs"
            >
              {dict.profile.background}
            </button>
          </div>
        </div>

        {/* Tab Content Panel */}
        <div className="lg:col-span-7 card">
          <h4 className="h4">
            {formatString(dict.profile.tabHeader, { tab: tabs[activeTab] })}
          </h4>
          <p className="text-xs text-mu">{dict.profile.inDev}</p>
          <div className="mt-4 h-48 rounded-xl bg-s2/50 border border-line border-dashed flex items-center justify-center text-xs text-mu px-4 text-center">
            {formatString(dict.profile.emptyDetails, { tab: tabs[activeTab] })}
          </div>
        </div>
      </div>
    </div>
  );
}
